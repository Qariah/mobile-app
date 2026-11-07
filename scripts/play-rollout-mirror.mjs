#!/usr/bin/env node
// @ai
//
// scripts/play-rollout-mirror.mjs
// -------------------------------
// Give the Android production release the same 7-day ramp as the iOS phased
// release (owner, 2026-11-01: "Use the 7 day ramp for iOS. Mirror it in
// Android"). The rules are in scripts/lib/play-rollout-mirror.mjs.
//
//   node scripts/play-rollout-mirror.mjs status
//   node scripts/play-rollout-mirror.mjs mirror [--apply]
//   node scripts/play-rollout-mirror.mjs promote --from=beta --fraction=0.01 \
//        [--version-code=<n>] [--notes-file=<file>] [--apply]
//
// `status` prints the iOS phased release, the Android release and the target.
// `mirror` sets the Android fraction to the iOS rung (a dry run without
// --apply). `promote` puts a version code from another track on production as
// a staged rollout (a dry run without --apply); Play reviews it before it
// serves it.
//
// The input is the `androidMirror` block of docs/operations/active-rollout.json:
//   {"enabled": true, "iosVersion": "3.2.3", "androidVersionCode": 3763}
//
// Exit codes: 0 = OK (a change, or nothing to change); 1 = an error;
// 2 = a usage or input error; 3 = nothing more to do (the Android release is
// completed, or the block says enabled: false). The local runner
// (scripts/play-rollout-mirror-local.sh) removes its launch agent on 3.
//
// Controls:
//   - Hold both platforms: `node scripts/asc-phased-release.mjs pause`.
//   - Stop Android at once: halt the release in the Play Console. The mirror
//     never changes a halted release.
//
// Env (from .env.local): APP_STORE_CONNECT_API_KEY_ID, _ISSUER_ID and
// ~/.appstoreconnect/private_keys/AuthKey_<KID>.p8; a Play key with the
// "Release manager" role (scripts/lib/google-play-auth.mjs finds it). The
// cloud's Play key is view-only by design, so `mirror --apply` runs on the Mac.

import {Buffer} from 'node:buffer';
import {createSign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ANDROID_PACKAGE_NAME, APP_STORE_ID} from './lib/app-ids.mjs';
import {loadServiceAccount, mintPlayToken} from './lib/google-play-auth.mjs';
import {
  findRelease,
  iosTarget,
  pct,
  planAndroid,
  promoteTrack,
  trackForPlan,
} from './lib/play-rollout-mirror.mjs';

const ROLLOUT_FILE = new URL(
  '../docs/operations/active-rollout.json',
  import.meta.url,
);
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}`;

function usage(msg) {
  console.error(`❌ ${msg}`);
  console.error(
    'usage: play-rollout-mirror.mjs status | mirror [--apply] | promote --from=<track> --fraction=<0-1> [--version-code=<n>] [--notes-file=<file>] [--apply]',
  );
  process.exit(2);
}

const [cmd, ...rest] = process.argv.slice(2);
const opts = {};
for (const a of rest) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
  if (!m) usage(`unknown argument ${a}`);
  opts[m[1]] = m[2] ?? true;
}
if (!['status', 'mirror', 'promote'].includes(cmd))
  usage(`unknown command ${cmd ?? ''}`);
const apply = opts.apply === true;

let cfg;
try {
  cfg = JSON.parse(readFileSync(ROLLOUT_FILE, 'utf8')).androidMirror;
} catch (e) {
  usage(`cannot read docs/operations/active-rollout.json: ${e.message}`);
}
if (!cfg)
  usage('docs/operations/active-rollout.json has no androidMirror block');
const versionCode = Number(opts['version-code'] ?? cfg.androidVersionCode);
if (!Number.isInteger(versionCode)) usage('no Android version code');

// ── App Store Connect ────────────────────────────────────────────────────
function ascHeaders() {
  const KID = process.env.APP_STORE_CONNECT_API_KEY_ID;
  const ISS = process.env.APP_STORE_CONNECT_ISSUER_ID;
  if (!KID || !ISS)
    usage(
      'APP_STORE_CONNECT_API_KEY_ID / _ISSUER_ID not set (source .env.local)',
    );
  const key = readFileSync(
    `${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${KID}.p8`,
    'utf8',
  );
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({alg: 'ES256', kid: KID, typ: 'JWT'})}.${b64({iss: ISS, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1'})}`;
  const sig = createSign('SHA256')
    .update(unsigned)
    .sign({key, dsaEncoding: 'ieee-p1363'});
  return {
    authorization: `Bearer ${unsigned}.${Buffer.from(sig).toString('base64url')}`,
  };
}

async function readIos(versionString) {
  const h = ascHeaders();
  const get = async p => {
    const r = await fetch(`https://api.appstoreconnect.apple.com/v1/${p}`, {
      headers: h,
    });
    if (!r.ok) throw new Error(`App Store Connect ${p}: HTTP ${r.status}`);
    return r.json();
  };
  const vs = await get(
    `apps/${APP_STORE_ID}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${encodeURIComponent(versionString)}&limit=1`,
  );
  const v = vs.data?.[0];
  if (!v) return {version: null, phased: null};
  const pr = await get(`appStoreVersions/${v.id}/appStoreVersionPhasedRelease`);
  return {version: v.attributes, phased: pr.data?.attributes ?? null};
}

// ── Google Play ──────────────────────────────────────────────────────────
async function play() {
  const token = await mintPlayToken(loadServiceAccount(), {scope: 'publisher'});
  const call = async (method, p, body) => {
    const r = await fetch(`${API}/${p}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body
          ? {'content-type': 'application/json'}
          : {'content-length': '0'}),
      },
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    const t = await r.text();
    const json = t ? JSON.parse(t) : null;
    if (!r.ok) {
      const err = new Error(
        `Play ${method} ${p}: HTTP ${r.status} ${json?.error?.message ?? ''}`.trim(),
      );
      err.status = r.status;
      throw err;
    }
    return json;
  };
  const edit = await call('POST', 'edits');
  return {
    track: name => call('GET', `edits/${edit.id}/tracks/${name}`),
    put: (name, body) => call('PUT', `edits/${edit.id}/tracks/${name}`, body),
    // A plain commit: Play sends a new production release for review by itself,
    // and a fraction change needs no review. If Play asks for
    // changesNotSentForReview, the change would wait for a person, so stop.
    commit: () => call('POST', `edits/${edit.id}:commit`),
    discard: () => call('DELETE', `edits/${edit.id}`).catch(() => null),
    id: edit.id,
  };
}

function describe(rel) {
  if (!rel) return 'not on the production track';
  const f = rel.status === 'completed' ? 1 : rel.userFraction;
  return `vc ${rel.versionCodes.join(',')} status=${rel.status} rollout=${pct(f)}`;
}

async function readBack(expect) {
  const p = await play();
  try {
    const rel = findRelease(await p.track('production'), versionCode);
    console.log(`read back: ${describe(rel)}`);
    const ok =
      expect === 'complete'
        ? rel?.status === 'completed'
        : rel?.status === 'inProgress' &&
          Math.abs(Number(rel.userFraction) - expect) < 1e-9;
    if (!ok) throw new Error('the read back does not match the change');
  } finally {
    await p.discard();
  }
}

// ── Commands ─────────────────────────────────────────────────────────────
if (cmd === 'promote') {
  const from = opts.from;
  const fraction = Number(opts.fraction);
  if (!from || from === true) usage('promote needs --from=<track>');
  const notes =
    typeof opts['notes-file'] === 'string'
      ? readFileSync(opts['notes-file'], 'utf8').trim()
      : null;
  if (notes != null && Array.from(notes).length > 500)
    usage(
      `the release notes have ${Array.from(notes).length} characters; Play allows 500`,
    );
  const p = await play();
  try {
    const [production, source] = await Promise.all([
      p.track('production'),
      p.track(from),
    ]);
    const body = promoteTrack({
      production,
      source,
      versionCode,
      fraction,
      notes,
    });
    console.log(
      `production now: ${(production.releases ?? []).map(describe).join('; ') || 'empty'}`,
    );
    console.log(`production after: ${body.releases.map(describe).join('; ')}`);
    if (!apply) {
      console.log('dry run: nothing changed (add --apply)');
      await p.discard();
      process.exit(0);
    }
    await p.put('production', body);
    await p.commit();
    console.log(
      `✓ committed edit ${p.id}: vc ${versionCode} on production at ${pct(fraction)}. Play serves it after its review.`,
    );
  } catch (e) {
    await p.discard();
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  await readBack(fraction);
  process.exit(0);
}

if (cfg.enabled === false) {
  console.log('androidMirror.enabled is false: nothing to do');
  process.exit(3);
}

const ios = await readIos(cfg.iosVersion);
const target = iosTarget(ios.phased);
console.log(
  `iOS  ${cfg.iosVersion}: ${ios.version ? `state=${ios.version.appStoreState ?? ios.version.appVersionState}` : 'no such version'}; ${target.reason}`,
);

const p = await play();
let plan;
try {
  const track = await p.track('production');
  const rel = findRelease(track, versionCode);
  plan = planAndroid(target, rel);
  console.log(`Play production: ${describe(rel)}`);
  console.log(
    `plan: ${plan.action}${plan.action === 'set' ? ` → ${pct(plan.fraction)}` : ''} (${plan.reason})`,
  );
  if (
    cmd === 'status' ||
    plan.action === 'none' ||
    plan.action === 'done' ||
    !apply
  ) {
    if (
      cmd === 'mirror' &&
      !apply &&
      (plan.action === 'set' || plan.action === 'complete')
    ) {
      console.log('dry run: nothing changed (add --apply)');
    }
    await p.discard();
    process.exit(plan.action === 'done' ? 3 : 0);
  }
  await p.put('production', trackForPlan(track, versionCode, plan));
  await p.commit();
  console.log(
    `✓ committed edit ${p.id}: Android ${plan.action === 'complete' ? 'completed (100%)' : `at ${pct(plan.fraction)}`}`,
  );
} catch (e) {
  await p.discard();
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
await readBack(plan.action === 'complete' ? 'complete' : plan.fraction);
