#!/usr/bin/env node
// @ai
//
// scripts/asc-phased-release.mjs
// ------------------------------
// Drive (and inspect) Apple's phased release for the current App Store
// version, alongside the Google Play staged-rollout fraction.
//
// Why this exists: Apple's phased release ADVANCES BY ITSELF, one rung per
// day (1/2/5/10/20/50/100%), and the ladder is not configurable. Google
// Play does the opposite — a staged rollout holds at whatever userFraction
// you set until you change it. So "pause at 20%" is a no-op on Android and
// an ACTIVE, time-sensitive step on iOS: miss the day and Apple has already
// moved you to 50%. This script makes that one command.
//
//   node scripts/asc-phased-release.mjs status
//   node scripts/asc-phased-release.mjs pause
//   node scripts/asc-phased-release.mjs resume
//   node scripts/asc-phased-release.mjs complete   # jump to 100% immediately
//
// Env (from .env.local): APP_STORE_CONNECT_API_KEY_ID, APP_STORE_CONNECT_ISSUER_ID,
//   and ~/.appstoreconnect/private_keys/AuthKey_<KID>.p8
//   Optional for the Play half: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.

import {readFileSync} from 'node:fs';
import {createSign} from 'node:crypto';

const APP_ID = '1594917787'; // com.qariah.app
const PKG = 'com.qariah.app';

const cmd = process.argv[2] || 'status';
if (!['status', 'pause', 'resume', 'complete'].includes(cmd)) {
  console.error('usage: asc-phased-release.mjs <status|pause|resume|complete>');
  process.exit(2);
}

// ── App Store Connect ────────────────────────────────────────────────────
const KID = process.env.APP_STORE_CONNECT_API_KEY_ID;
const ISS = process.env.APP_STORE_CONNECT_ISSUER_ID;
if (!KID || !ISS) {
  console.error('❌ APP_STORE_CONNECT_API_KEY_ID / _ISSUER_ID not set (source .env.local)');
  process.exit(2);
}
const key = readFileSync(`${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${KID}.p8`, 'utf8');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({alg: 'ES256', kid: KID, typ: 'JWT'})}.${b64({iss: ISS, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1'})}`;
const sig = createSign('SHA256').update(unsigned).sign({key, dsaEncoding: 'ieee-p1363'});
const H = {authorization: `Bearer ${unsigned}.${Buffer.from(sig).toString('base64url')}`, 'content-type': 'application/json'};
const asc = async (p, opts = {}) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com/v1/${p}`, {headers: H, ...opts});
  const t = await r.text();
  return {status: r.status, body: t ? JSON.parse(t) : null};
};

// Newest version record = the one being released.
const vs = await asc(`apps/${APP_ID}/appStoreVersions?limit=1`);
const version = vs.body?.data?.[0];
if (!version) {
  console.error('❌ no App Store version found');
  process.exit(1);
}
const vState = version.attributes.appStoreState ?? version.attributes.appVersionState;
const pr = await asc(`appStoreVersions/${version.id}/appStoreVersionPhasedRelease`);
const phased = pr.body?.data;

// Apple's fixed ladder, by day index.
const LADDER = [1, 2, 5, 10, 20, 50, 100];

// Describe the CURRENT reach of a phased release, from the state AND the day.
//
// The day counter alone is not the answer. Apple leaves `currentDayNumber`
// frozen at whatever rung the ramp had reached when it ended, so a COMPLETE
// release goes on reporting its last rung forever. Reading a percentage off
// the day without consulting the state is how a finished, 100% rollout came
// to be printed as "day=6 ≈50%" for days (2026-09-04) — wrong by half, in the
// safe-sounding direction, on the one number the ramp is steered by.
//
// Returns {pct, text}. `pct` is the honest reach, or null when there isn't
// one; `text` follows the state token already printed by the caller, so it
// never repeats the state name.
function describeReach(st, day) {
  const rung =
    typeof day === 'number' && day > 0
      ? LADDER[Math.min(day - 1, LADDER.length - 1)]
      : null;
  const unknown = what => ({pct: null, text: `${what} — reach unknown`});
  switch (st) {
    case 'COMPLETE':
      // Finished: everyone on auto-update can have it. The day is stale, so
      // report it as provenance only and never as a rung.
      return {
        pct: 100,
        text: `100% of auto-updating users — the ramp is FINISHED${typeof day === 'number' ? ` (day counter frozen at ${day}; it is not the reach)` : ''}`,
      };
    case 'ACTIVE':
      // The live ramp. This is the branch the loop's auto-pause gate reads,
      // so it keeps the day= and ≈pct% shape exactly as before.
      return rung == null
        ? unknown('started but no day counter yet')
        : {
            pct: rung,
            text: `day=${day}  ≈${rung}% of auto-updating users — ADVANCING one rung per day`,
          };
    case 'PAUSED':
      // The rung is accurate — pause freezes exposure where it stands — but
      // it must not read as "still on schedule".
      return rung == null
        ? unknown('paused before the first rung')
        : {
            pct: rung,
            text: `day=${day}  ≈${rung}% of auto-updating users — HELD here; does NOT advance until resumed`,
          };
    case 'INACTIVE':
      // Configured but not started (version not released yet). Nobody is
      // being phased, so there is no percentage to quote.
      return {
        pct: null,
        text: 'not started — no one is being phased onto this build yet',
      };
    default:
      // An unrecognised state means the ladder mapping above is unverified.
      // Say so rather than quoting a number that may be as stale as COMPLETE's.
      return rung == null
        ? unknown('UNRECOGNISED STATE')
        : {
            pct: null,
            text: `UNRECOGNISED STATE — day=${day} would map to ≈${rung}%, but do not trust that without checking Apple's meaning`,
          };
  }
}

function reportIOS() {
  console.log(`iOS  version ${version.attributes.versionString}  state=${vState}`);
  if (!phased) {
    console.log('     phased release: NOT CONFIGURED (version will go to 100% at once on release)');
    return;
  }
  const st = phased.attributes.phasedReleaseState;
  const day = phased.attributes.currentDayNumber;
  const {pct, text} = describeReach(st, day);
  console.log(`     phased release: ${st}  ${text}`);
  // Only an ACTIVE ramp can overshoot: PAUSED holds, COMPLETE has nowhere
  // left to go, INACTIVE has not started.
  if (st === 'ACTIVE' && pct != null && pct >= 20) {
    console.log('     ⛔ AT/PAST 20% AND STILL ADVANCING — pause now if you meant to stop here.');
  }
}

async function setState(next) {
  if (!phased) {
    console.error('❌ no phased release exists on this version — nothing to change.');
    console.error('   (Enable "Phased Release for Automatic Updates" on the version first.)');
    process.exit(1);
  }
  const r = await asc(`appStoreVersionPhasedReleases/${phased.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {type: 'appStoreVersionPhasedReleases', id: phased.id, attributes: {phasedReleaseState: next}},
    }),
  });
  if (r.status >= 200 && r.status < 300) {
    console.log(`✓ iOS phased release → ${next}`);
  } else {
    console.error(`❌ failed (HTTP ${r.status}):`, JSON.stringify(r.body));
    process.exit(1);
  }
}

// ── Google Play (status only — advancing is android-upload-play.sh) ──────
async function reportPlay() {
  const saPath = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || `${process.env.HOME}/.android/play-service-account.json`;
  let sa;
  try {
    sa = JSON.parse(readFileSync(saPath, 'utf8'));
  } catch {
    console.log('Play  (service account not readable — skipping)');
    return;
  }
  const claim = {iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now};
  const u = `${b64({alg: 'RS256', typ: 'JWT'})}.${b64(claim)}`;
  const s = createSign('RSA-SHA256').update(u).sign(sa.private_key, 'base64url');
  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${u}.${s}`}),
  })).json();
  if (!tok.access_token) {
    console.log('Play  (auth failed — skipping)');
    return;
  }
  const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
  const A = {authorization: `Bearer ${tok.access_token}`};
  const edit = await (await fetch(`${API}/edits`, {method: 'POST', headers: A})).json();
  const tr = await (await fetch(`${API}/edits/${edit.id}/tracks/production`, {headers: A})).json();
  for (const rel of tr.releases ?? []) {
    const frac = rel.userFraction != null ? `${(rel.userFraction * 100).toFixed(0)}%` : rel.status === 'completed' ? '100%' : '—';
    console.log(`Play  production: vc ${(rel.versionCodes || []).join(',')}  status=${rel.status}  rollout=${frac}`);
    if (rel.status === 'inProgress' && rel.userFraction >= 0.2) {
      console.log('     ⛔ at/past 20% — holds here until you advance it (Android does NOT auto-advance).');
    }
  }
  await fetch(`${API}/edits/${edit.id}`, {method: 'DELETE', headers: A}); // discard; read-only
}

if (cmd === 'status') {
  reportIOS();
  await reportPlay();
} else {
  await setState({pause: 'PAUSED', resume: 'ACTIVE', complete: 'COMPLETE'}[cmd]);
}
