#!/usr/bin/env node
/**
 * play-vitals.mjs — read-only Google Play Android-vitals queries via the
 * Play Developer Reporting API, authenticated with the same publishing
 * service account used by scripts/android-upload-play.sh.
 *
 * Origin: the 2026-06-11 investigation that attributed the Play Console
 * "user-perceived crash rate" rise on Android 16 to the legacy v1 app
 * (versionCode 35) — the Console chart aggregates all app versions and hides
 * composition effects; this API splits by versionCode × apiLevel in minutes.
 * See planning/retro-post-sprint33-followon-2026-06-11.md.
 *
 * Usage:
 *   node scripts/play-vitals.mjs rates [--dims=versionCode,apiLevel] [--days=14]
 *                                      [--metric=both|crash|anr]
 *   node scripts/play-vitals.mjs issues [--filter='versionCode = 35'] [--days=14]
 *
 * `rates` reports CRASH **and** ANR by default (--metric=both). It queried only
 * crashRateMetricSet until 2026-08-28, which quietly made one of the documented
 * stop-the-ramp conditions — "a Play-vitals ANR or crash rate for this
 * versionCode meaningfully above trend" (qariah-triage-loop Step 1.5) —
 * impossible to check: the rollout watch called this script, got a crash-only
 * answer, and reported the ANR half as if it had been looked at. Keep ANR in the
 * default; a condition nobody can measure is not a condition.
 *
 * Env:
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  path to the SA key JSON
 *                                     (default ~/.android/play-service-account.json)
 *   PLAY_PACKAGE                      app package (default com.qariah.app)
 *
 * Notes:
 *   - Read-only scope (playdeveloperreporting); cannot mutate anything.
 *   - Play suppresses slices below a privacy threshold (~50-60 users/day):
 *     an absent row means "cohort too small to report", NOT "zero crashes".
 */
import {readFileSync} from 'fs';
import {createSign} from 'crypto';
import {homedir} from 'os';

const SA_PATH =
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ||
  `${homedir()}/.android/play-service-account.json`;
const PACKAGE = process.env.PLAY_PACKAGE || 'com.qariah.app';
const API = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${PACKAGE}`;

const [, , cmd, ...rest] = process.argv;
const args = Object.fromEntries(
  rest
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.join('=') || true];
    }),
);

if (cmd !== 'rates' && cmd !== 'issues') {
  console.error(
    'usage: node scripts/play-vitals.mjs rates [--dims=versionCode,apiLevel] [--days=14]\n' +
      '                                          [--metric=both|crash|anr]\n' +
      "       node scripts/play-vitals.mjs issues [--filter='versionCode = 35'] [--days=14]",
  );
  process.exit(2);
}

const days = Number(args.days || 14);
let end = new Date();
let start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
const ymd = d => ({
  year: d.getUTCFullYear(),
  month: d.getUTCMonth() + 1,
  day: d.getUTCDate(),
});

// Play's Reporting API publishes on a lag (typically 2-5 days) and REJECTS any
// window ending past its freshness date outright — so a naive `end = now` 400s
// and the caller sees NOTHING, not even the data that does exist. That blinds
// the rollout watch exactly when a release is new and most needs watching
// (found 2026-08-04: freshness 2026-07-30 predated the 2026-08-02 rollout).
// The error message carries the freshness date, so clamp to it and retry once.
const FRESHNESS_RE = /current freshness (\d{4})-(\d{2})-(\d{2})/;
async function queryWindow(run) {
  let out = await run();
  const m = out.data?.error?.message?.match(FRESHNESS_RE);
  if (out.data?.error && m) {
    end = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    console.error(
      `  ⚠ Play data freshness is ${m[1]}-${m[2]}-${m[3]} — window clamped to it.\n` +
        `    Anything newer is NOT published yet and cannot be checked here; a brand-new\n` +
        `    release may legitimately have zero rows for several days.`,
    );
    out = await run();
  }
  return out;
}

async function token() {
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned =
    b64({alg: 'RS256', typ: 'JWT'}) +
    '.' +
    b64({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/playdeveloperreporting',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    });
  const sign = createSign('RSA-SHA256');
  sign.update(unsigned);
  const jwt = unsigned + '.' + sign.sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      encodeURIComponent(jwt),
  });
  const tok = await res.json();
  if (!tok.access_token) {
    console.error('token mint failed:', JSON.stringify(tok).slice(0, 300));
    process.exit(1);
  }
  return tok.access_token;
}

const tk = await token();

if (cmd === 'rates') {
  const dims = String(args.dims || 'versionCode,apiLevel')
    .split(',')
    .filter(Boolean);

  const which = String(args.metric || 'both');
  if (!['both', 'crash', 'anr'].includes(which)) {
    console.error(`--metric must be one of: both, crash, anr (got "${which}")`);
    process.exit(2);
  }
  const SETS = [
    {
      kind: 'crash',
      set: 'crashRateMetricSet',
      metric: 'userPerceivedCrashRate',
    },
    {kind: 'anr', set: 'anrRateMetricSet', metric: 'userPerceivedAnrRate'},
  ].filter(s => which === 'both' || s.kind === which);

  let total = 0;
  for (const {kind, set, metric} of SETS) {
    const {res, data} = await queryWindow(async () => {
      const r = await fetch(`${API}/${set}:query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tk}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timelineSpec: {
            aggregationPeriod: 'DAILY',
            startTime: ymd(start),
            endTime: ymd(end),
          },
          dimensions: dims,
          metrics: [metric, 'distinctUsers'],
          pageSize: 1000,
        }),
      });
      return {res: r, data: await r.json()};
    });
    if (data.error) {
      // One metric set failing must not silently take the other down with it —
      // a crash-only answer that LOOKS complete is the exact failure this
      // command was widened to prevent. Report it and keep going.
      console.error(
        `API error on ${set}:`,
        res.status,
        JSON.stringify(data.error).slice(0, 400),
      );
      process.exitCode = 1;
      continue;
    }
    for (const row of data.rows ?? []) {
      const d = row.startTime;
      const dimStr = (row.dimensions ?? [])
        .map(x => `${x.dimension}=${x.stringValue ?? x.int64Value}`)
        .join(' ');
      const mets = Object.fromEntries(
        (row.metrics ?? []).map(x => [
          x.metric,
          x.decimalValue?.value ?? x.decimalValue,
        ]),
      );
      console.log(
        `[${kind}]`.padEnd(8) +
          `${d.year}-${String(d.month).padStart(2, '0')}-${String(
            d.day,
          ).padStart(2, '0')} ` +
          `${dimStr} rate=${mets[metric]} users=${mets.distinctUsers}`,
      );
    }
    const n = (data.rows ?? []).length;
    total += n;
    // Zero rows is NOT zero incidents — Play suppresses slices under its privacy
    // threshold. Say which it is, so an absent ANR row is never read as "clean".
    console.log(
      `rows[${kind}]: ${n}` +
        (n === 0
          ? '  (no rows — cohort under Play privacy threshold, NOT proof of zero)'
          : ''),
    );
  }
  console.log(`rows: ${total}`);
} else {
  const {res, data} = await queryWindow(async () => {
    const url = new URL(`${API}/errorIssues:search`);
    const s = ymd(start);
    const e = ymd(end);
    url.searchParams.set('interval.startTime.year', String(s.year));
    url.searchParams.set('interval.startTime.month', String(s.month));
    url.searchParams.set('interval.startTime.day', String(s.day));
    url.searchParams.set('interval.endTime.year', String(e.year));
    url.searchParams.set('interval.endTime.month', String(e.month));
    url.searchParams.set('interval.endTime.day', String(e.day));
    if (args.filter) url.searchParams.set('filter', String(args.filter));
    url.searchParams.set('orderBy', 'errorReportCount desc');
    url.searchParams.set('pageSize', '25');
    const r = await fetch(url, {headers: {Authorization: `Bearer ${tk}`}});
    return {res: r, data: await r.json()};
  });
  if (data.error) {
    console.error(
      'API error:',
      res.status,
      JSON.stringify(data.error).slice(0, 400),
    );
    process.exit(1);
  }
  for (const i of data.errorIssues ?? []) {
    console.log(
      `[${i.type}] reports=${i.errorReportCount} users=${i.distinctUsers} :: ` +
        `${(i.cause ?? '').slice(0, 90)} @ ${(i.location ?? '').slice(0, 70)}`,
    );
  }
  console.log(`issues: ${(data.errorIssues ?? []).length}`);
}
