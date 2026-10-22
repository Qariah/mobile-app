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
 *   node scripts/play-vitals.mjs issues [--filter='versionCode = 35'] [--days=14]
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
      "       node scripts/play-vitals.mjs issues [--filter='versionCode = 35'] [--days=14]",
  );
  process.exit(2);
}

const days = Number(args.days || 14);
const end = new Date();
const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
const ymd = d => ({
  year: d.getUTCFullYear(),
  month: d.getUTCMonth() + 1,
  day: d.getUTCDate(),
});

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
  const res = await fetch(`${API}/crashRateMetricSet:query`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      timelineSpec: {
        aggregationPeriod: 'DAILY',
        startTime: ymd(start),
        endTime: ymd(end),
      },
      dimensions: dims,
      metrics: ['userPerceivedCrashRate', 'distinctUsers'],
      pageSize: 1000,
    }),
  });
  const data = await res.json();
  if (data.error) {
    console.error('API error:', res.status, JSON.stringify(data.error).slice(0, 400));
    process.exit(1);
  }
  for (const row of data.rows ?? []) {
    const d = row.startTime;
    const dimStr = (row.dimensions ?? [])
      .map(x => `${x.dimension}=${x.stringValue ?? x.int64Value}`)
      .join(' ');
    const mets = Object.fromEntries(
      (row.metrics ?? []).map(x => [x.metric, x.decimalValue?.value ?? x.decimalValue]),
    );
    console.log(
      `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')} ` +
        `${dimStr} rate=${mets.userPerceivedCrashRate} users=${mets.distinctUsers}`,
    );
  }
  console.log(`rows: ${(data.rows ?? []).length}`);
} else {
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
  const res = await fetch(url, {headers: {Authorization: `Bearer ${tk}`}});
  const data = await res.json();
  if (data.error) {
    console.error('API error:', res.status, JSON.stringify(data.error).slice(0, 400));
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
