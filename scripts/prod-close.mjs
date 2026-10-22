#!/usr/bin/env node
// @ai
//
// scripts/prod-close.mjs — close what production now carries.
// ---------------------------------------------------------------------------
// Owner decision 2026-09-07: an issue is DONE when its fix is in production,
// not when a beta carries it. This script runs the moment a production release
// reaches 100% (the daily loop's rollout watch, Step 1.5, or by hand) and, for
// every open issue whose `fixed-in:<build>` label is ≤ the production build:
//
//   1. closes the GitHub issue as COMPLETED with a comment naming the build,
//      the production version and the date (machine lanes AND human-reported
//      issues — TestFlight, store reviews, hand-filed);
//   2. resolves the matching Sentry issue (marker `sentry-triage-id:<shortId>`
//      in the body) when SENTRY_WRITE_TOKEN is present — otherwise it says so;
//   3. appends an audit line to build/prod-close.ndjson (not in a cloud
//      session, CLAUDE_CODE_REMOTE=true — the close comments are the record).
//
// An issue with a `behind-flag:<key>` label (scripts/stamp-fixed-in.mjs) closes
// only when that PostHog flag is on FOR THE PRODUCTION BUILD: active, and one
// release-condition group at 100% with either no property filter or only an
// `$app_build` filter that includes the production build (isFlagFullyOn in
// scripts/lib/fixed-in.mjs). The build alone does not fix it — the fix is off
// until the flag is on. When the flag cannot be read, it stays open.
//
// THE RELEASE LINE (2026-09-28). A lower build NUMBER is not proof that the
// fix is in production: each branch has its own VERSION_CODE_OFFSET, so the
// numbers of `qariah-main` betas and of a hotfix line interleave. Before an
// issue closes, the commit of its fixed-in build must be an ancestor of the
// production commit (scripts/lib/build-lines.mjs). The production commit is
// the rollout file's `sha` (or --sha); without one, the one commit that
// derives the production build. A fix on another line waits. When the answer
// is not certain (a shallow clone, an ambiguous build, an unknown commit) the
// issue is HELD open and the output says why.
//
// It does NOT add a "do not reopen" ledger line: `triage-lifecycle.mjs`
// reopen-on-recurrence must still fire if the same signature returns on a
// newer build — that is a real regression, not noise.
//
// Usage:
//   node scripts/prod-close.mjs --build=1717 [--sha=<commit>] [--version=3.2.0] [--dry-run] [--json]
//   node scripts/prod-close.mjs --from-rollout            # read docs/operations/active-rollout.json
//
// --from-rollout accepts the file only when `active` is false AND `completedAt`
// is set (the rollout finished). A build still ramping is never a production
// close: users on the old build have nothing yet.
//
// Env: GH_REPO (default omar-zarka/qariah-v2), SENTRY_WRITE_TOKEN (optional; the
// read token cannot PUT), SENTRY_ORG, SENTRY_PROJECT, SENTRY_REGION_HOST.
// POSTHOG_PERSONAL_API_TOKEN + POSTHOG_PROJECT_ID (+ POSTHOG_HOST) read the flag
// of a `behind-flag:` issue; without them those issues stay open.
// Exit 0 on a completed pass (including "nothing to close"), 2 on usage error.

import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {
  gitBuildLines,
  lineVerdict,
  resolveProduction,
} from './lib/build-lines.mjs';
import {behindFlagsOf, isFlagFullyOn} from './lib/fixed-in.mjs';
import {
  closeIssue,
  isCloudSession,
  isShadowRun,
  listIssues,
} from './lib/triage-common.mjs';
import {createSentryClient, sentryConfig} from './lib/sentry-client.mjs';
import {parseTriageState} from './lib/triage-taxonomy.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
// Shadow mode (scripts/run-start.sh triage --shadow) forces a dry run: no
// GitHub close and no Sentry resolve.
const DRY = !!args['dry-run'] || isShadowRun();
// The write token: the read token cannot PUT.
const S = sentryConfig({tokenVars: ['SENTRY_WRITE_TOKEN']});

function resolveTarget() {
  if (args['from-rollout']) {
    const p = 'docs/operations/active-rollout.json';
    if (!existsSync(p)) throw new Error(`${p} not found`);
    const r = JSON.parse(readFileSync(p, 'utf8'));
    if (r.active || !r.completedAt)
      throw new Error(
        `rollout is ${r.active ? 'still active' : 'not marked complete'} — a ramping build is not a production close`,
      );
    return {
      build: Number(r.build),
      version: r.release,
      completedAt: r.completedAt,
      sha: r.sha || null,
    };
  }
  const build = Number(args.build);
  if (!Number.isFinite(build) || build < 500) {
    console.error(
      'usage: prod-close.mjs --build=<versionCode> [--sha=<commit>] [--version=x.y.z] [--dry-run] | --from-rollout',
    );
    process.exit(2);
  }
  return {
    build,
    version: args.version || null,
    completedAt: new Date().toISOString().slice(0, 10),
    sha: typeof args.sha === 'string' ? args.sha : null,
  };
}

const PH = {
  token: process.env.POSTHOG_PERSONAL_API_TOKEN,
  project: process.env.POSTHOG_PROJECT_ID,
  host: (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(
    /\/$/,
    '',
  ),
};

// One read per flag key. Returns {fullyOn:boolean} or {error:string}.
// `fullyOn` means "on for the users of production build `build`".
const flagCache = new Map();
async function flagState(key, build) {
  if (flagCache.has(key)) return flagCache.get(key);
  let out;
  if (!PH.token || !PH.project) {
    out = {error: 'no POSTHOG_PERSONAL_API_TOKEN / POSTHOG_PROJECT_ID'};
  } else {
    try {
      const res = await fetch(
        `${PH.host}/api/projects/${PH.project}/feature_flags/?search=${encodeURIComponent(key)}`,
        {headers: {Authorization: `Bearer ${PH.token}`}},
      );
      if (!res.ok) throw new Error(`PostHog ${res.status}`);
      const flag = ((await res.json()).results || []).find(f => f.key === key);
      out = flag
        ? {fullyOn: isFlagFullyOn(flag, build)}
        : {error: 'flag not found'};
    } catch (e) {
      out = {error: e.message.slice(0, 120)};
    }
  }
  flagCache.set(key, out);
  return out;
}

const sentry = createSentryClient(S);

async function resolveSentry(shortId) {
  if (!S.token) return {status: 'skipped', why: 'SENTRY_WRITE_TOKEN not set'};
  const q = encodeURIComponent(`issue:${shortId}`);
  const hits = await sentry(
    `/projects/${S.org}/${S.project}/issues/?query=${q}`,
  );
  const hit = hits.find(h => h.shortId === shortId);
  if (!hit) return {status: 'skipped', why: 'shortId not found'};
  if (hit.status === 'resolved') return {status: 'already-resolved'};
  if (!DRY)
    await sentry(`/organizations/${S.org}/issues/${hit.id}/`, {
      method: 'PUT',
      body: JSON.stringify({status: 'resolved'}),
    });
  return {status: DRY ? 'would-resolve' : 'resolved', from: hit.status};
}

(async () => {
  const t = resolveTarget();
  console.log(
    `▶ prod-close  build=${t.build}${t.version ? ` version=${t.version}` : ''}  since=${t.completedAt}${DRY ? '  (DRY RUN)' : ''}`,
  );

  // Two sources of "fixed in": the `fixed-in:<build>` label (post-sprint Step 14b)
  // and the hand-kept "Fixed in build" section of docs/operations/triage-state.md —
  // the same two sources triage-lifecycle.mjs reads, so the two never disagree on
  // which build carries which fix.
  const ledger = existsSync('docs/operations/triage-state.md')
    ? parseTriageState(readFileSync('docs/operations/triage-state.md', 'utf8'))
        .fixedInBuild
    : new Map();
  const open = listIssues({state: 'open', limit: 500});
  const rows = open
    .map(i => {
      const lbl = (i.labels || [])
        .map(l => l.name)
        .find(n => /^fixed-in:\d+$/.test(n));
      const fromLedger = Number(ledger.get(i.number));
      const fixedIn = lbl
        ? Number(lbl.split(':')[1])
        : Number.isFinite(fromLedger)
          ? fromLedger
          : null;
      const shortId =
        (i.body || '').match(/sentry-triage-id:([A-Z0-9-]+)/)?.[1] || null;
      const humanLane = (i.labels || []).some(l =>
        [
          'testflight',
          'user-review',
          'email',
          'feedback',
          'app-store',
        ].includes(l.name),
      );
      const flags = behindFlagsOf((i.labels || []).map(l => l.name));
      return {
        number: i.number,
        title: i.title,
        fixedIn,
        shortId,
        humanLane,
        flags,
      };
    })
    .filter(r => r.fixedIn !== null);

  const byNumber = rows.filter(r => r.fixedIn <= t.build);
  const waiting = rows.filter(r => r.fixedIn > t.build);

  // The release line: a lower number is not enough. The fix's build commit
  // must be an ancestor of the production commit (scripts/lib/build-lines.mjs).
  const inBuild = [];
  const offLine = [];
  const lineHold = [];
  let prod = {build: t.build, commit: null, why: 'not needed'};
  if (byNumber.length) {
    const lines = gitBuildLines();
    prod = resolveProduction(t, lines);
    console.log(
      `  production commit: ${prod.commit ? prod.commit.slice(0, 8) : 'UNKNOWN'} (${prod.why})`,
    );
    const verdicts = new Map();
    for (const r of byNumber) {
      if (!verdicts.has(r.fixedIn)) {
        const candidates =
          prod.commit && r.fixedIn !== t.build
            ? lines.candidates(r.fixedIn)
            : [];
        verdicts.set(
          r.fixedIn,
          lineVerdict({
            fixBuild: r.fixedIn,
            prod,
            candidates,
            indexError: lines.indexError,
            isAncestor: (a, b) => lines.isAncestor(a, b),
          }),
        );
      }
      const v = verdicts.get(r.fixedIn);
      if (v.state === 'in') inBuild.push(r);
      else if (v.state === 'out') offLine.push({...r, why: v.why});
      else lineHold.push({...r, why: v.why});
    }
  }

  // A build that carries a fix behind a flag is not enough: the flag must be
  // on for the production build too. Otherwise the issue waits, and says which
  // flag it waits for.
  const due = [];
  const flagWait = [];
  for (const r of inBuild) {
    let hold = null;
    const on = [];
    for (const key of r.flags) {
      const st = await flagState(key, t.build);
      if (st.error)
        hold = `waits for flag ${key} (could not read it: ${st.error})`;
      else if (!st.fullyOn)
        hold = hold || `waits for flag ${key} (not on for build ${t.build})`;
      else on.push(key);
    }
    if (hold) flagWait.push({...r, hold});
    else due.push({...r, flagsOn: on});
  }

  const results = [];
  for (const r of due) {
    const versionTxt = t.version ? `production ${t.version}` : 'production';
    const comment =
      `Fixed in build ${r.fixedIn}. Live in ${versionTxt} (build ${t.build}) since ${t.completedAt}. ` +
      `Closed by \`scripts/prod-close.mjs\`. If this returns on a newer build the lifecycle pass reopens it.`;
    let sentryRes = null;
    if (r.shortId) {
      try {
        sentryRes = await resolveSentry(r.shortId);
      } catch (e) {
        sentryRes = {status: 'error', why: e.message.slice(0, 120)};
      }
    }
    if (!DRY) closeIssue(r.number, {reason: 'completed', comment});
    results.push({...r, closed: !DRY, sentry: sentryRes});
    console.log(
      `  ${DRY ? '·' : '✓'} #${r.number} (fixed-in ${r.fixedIn}${r.humanLane ? ', human-reported' : ''})` +
        `${r.flagsOn && r.flagsOn.length ? `  flag ${r.flagsOn.join(', ')} on for ${t.build}` : ''}` +
        `${r.shortId ? `  sentry ${r.shortId}: ${sentryRes?.status}${sentryRes?.why ? ` (${sentryRes.why})` : ''}` : ''}`,
    );
  }
  for (const r of flagWait) console.log(`  ⏸ #${r.number} ${r.hold}`);
  for (const r of lineHold)
    console.log(`  ⏸ #${r.number} fixed-in ${r.fixedIn} held: ${r.why}`);
  for (const r of offLine)
    console.log(
      `  ⏳ #${r.number} fixed-in ${r.fixedIn} not in production: ${r.why} — waits for a production build that carries it`,
    );
  for (const r of waiting)
    console.log(
      `  ⏳ #${r.number} fixed-in ${r.fixedIn} > prod ${t.build} — waits for the next production promote`,
    );
  if (!due.length) console.log('  nothing to close');

  // build/ is a local audit file. A cloud session has no persistent disk: its
  // GitHub close comments are the record there.
  if (!DRY && due.length && !isCloudSession()) {
    mkdirSync('build', {recursive: true});
    appendFileSync(
      'build/prod-close.ndjson',
      JSON.stringify({
        at: new Date().toISOString(),
        build: t.build,
        version: t.version,
        closed: due.map(r => r.number),
        sentry: results.map(r => r.sentry),
      }) + '\n',
    );
  }
  if (args.json)
    console.log(
      JSON.stringify(
        {
          target: t,
          production: prod,
          closed: results,
          flagWait,
          lineHold,
          offLine,
          waiting,
        },
        null,
        2,
      ),
    );
  console.log(
    `\n▶ done — ${DRY ? 'would close' : 'closed'} ${due.length}, waiting for a flag ${flagWait.length}, waiting for a build ${waiting.length}, on another line ${offLine.length}, held (line not certain) ${lineHold.length}${S.token ? '' : ' · Sentry resolve skipped (no SENTRY_WRITE_TOKEN)'}`,
  );
})().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
