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
//   3. appends an audit line to build/prod-close.ndjson.
//
// It does NOT add a "do not reopen" ledger line: `triage-lifecycle.mjs`
// reopen-on-recurrence must still fire if the same signature returns on a
// newer build — that is a real regression, not noise.
//
// Usage:
//   node scripts/prod-close.mjs --build=1717 [--version=3.2.0] [--dry-run] [--json]
//   node scripts/prod-close.mjs --from-rollout            # read docs/operations/active-rollout.json
//
// --from-rollout accepts the file only when `active` is false AND `completedAt`
// is set (the rollout finished). A build still ramping is never a production
// close: users on the old build have nothing yet.
//
// Env: GH_REPO (default omar-zarka/qariah-v2), SENTRY_WRITE_TOKEN (optional; the
// read token cannot PUT), SENTRY_ORG, SENTRY_PROJECT, SENTRY_REGION_HOST.
// Exit 0 on a completed pass (including "nothing to close"), 2 on usage error.

import {execFileSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {parseTriageState} from './lib/triage-taxonomy.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const DRY = !!args['dry-run'];
const REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';
const S = {
  token: process.env.SENTRY_WRITE_TOKEN,
  org: process.env.SENTRY_ORG || 'qariah',
  project: process.env.SENTRY_PROJECT || 'qariahv2',
  host: (process.env.SENTRY_REGION_HOST || 'https://de.sentry.io').replace(
    /\/$/,
    '',
  ),
};

function gh(a, {input} = {}) {
  return execFileSync('gh', [...a, '-R', REPO], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

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
    };
  }
  const build = Number(args.build);
  if (!Number.isFinite(build) || build < 500) {
    console.error(
      'usage: prod-close.mjs --build=<versionCode> [--version=x.y.z] [--dry-run] | --from-rollout',
    );
    process.exit(2);
  }
  return {
    build,
    version: args.version || null,
    completedAt: new Date().toISOString().slice(0, 10),
  };
}

async function sentry(path, init) {
  const res = await fetch(`${S.host}/api/0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${S.token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok)
    throw new Error(
      `Sentry ${res.status} ${init?.method || 'GET'} ${path}: ${(await res.text()).slice(0, 200)}`,
    );
  return res.status === 204 ? null : res.json();
}

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
  const open = JSON.parse(
    gh([
      'issue',
      'list',
      '--state',
      'open',
      '--limit',
      '500',
      '--json',
      'number,title,labels,body',
    ]),
  );
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
      return {number: i.number, title: i.title, fixedIn, shortId, humanLane};
    })
    .filter(r => r.fixedIn !== null);

  const due = rows.filter(r => r.fixedIn <= t.build);
  const waiting = rows.filter(r => r.fixedIn > t.build);

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
    if (!DRY)
      gh([
        'issue',
        'close',
        String(r.number),
        '--reason',
        'completed',
        '--comment',
        comment,
      ]);
    results.push({...r, closed: !DRY, sentry: sentryRes});
    console.log(
      `  ${DRY ? '·' : '✓'} #${r.number} (fixed-in ${r.fixedIn}${r.humanLane ? ', human-reported' : ''})` +
        `${r.shortId ? `  sentry ${r.shortId}: ${sentryRes?.status}${sentryRes?.why ? ` (${sentryRes.why})` : ''}` : ''}`,
    );
  }
  for (const r of waiting)
    console.log(
      `  ⏳ #${r.number} fixed-in ${r.fixedIn} > prod ${t.build} — waits for the next production promote`,
    );
  if (!due.length) console.log('  nothing to close');

  if (!DRY && due.length) {
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
    console.log(JSON.stringify({target: t, closed: results, waiting}, null, 2));
  console.log(
    `\n▶ done — ${DRY ? 'would close' : 'closed'} ${due.length}, waiting ${waiting.length}${S.token ? '' : ' · Sentry resolve skipped (no SENTRY_WRITE_TOKEN)'}`,
  );
})().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
