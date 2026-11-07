// @ai
//
// Signals snapshot section `stores`: what the two stores report, for the 30
// LA days that end at dataThrough.
//
// Android (Play Developer Reporting API, read-only scope):
//   crashRateMetricSet `distinctUsers`, dimension versionCode, DAILY. Play
//   counts a user who used the app on the day and shares usage and diagnostics
//   data with Google. Play aggregates DAILY data in America/Los_Angeles; the
//   date of each row is recorded as Play gives it. Play rounds the values and
//   publishes no row for a cohort under its privacy threshold (about 50 users),
//   so a missing row is null, never 0. Play publishes on a lag of 1 to 3 days:
//   `dataThrough` is the date of the newest row, `publishedThrough` the last
//   day that Play accepts. v1 = versionCode < 1257 (V2_MIN_VERSION_CODE).
//   v1Users and v2Users add the versionCodes of the line, so a user who updated
//   on the day counts twice, and a suppressed versionCode is not in the sum.
//
// iOS (App Store Connect analytics reports, copied by Phase 0 into the
// signals bucket; scripts/signals/lib/asc-reports.mjs reads them):
//   "App Sessions Standard", DAILY: Sessions and Unique Devices for each Date
//   and App Version. v1 = app version < 3.1.0. Opted-in devices only (users
//   who share analytics with developers). Apple gives Unique Devices for each
//   row (version x device x OS x territory x source), and this section adds
//   the rows, so a device that changed version or OS on the day counts twice.
//   "App Store Installation and Deletion Standard", DAILY: install and delete
//   events (Counts) for each Date, when the report is in the bucket.
//   No bucket key (SIGNALS_R2_*) → not_configured; no report yet → pending.
//
// Status: ok when both parts work, partial when one works.

import {V2_MIN_VERSION_CODE} from '../../lib/anr-card.mjs';
import {ANDROID_PACKAGE_NAME} from '../../lib/app-ids.mjs';
import {missingBucketEnv} from '../lib/bucket.mjs';
import {scrub} from '../lib/context.mjs';
import {addDays, cell, dayRange, eventCell} from '../lib/rules.mjs';
import {
  INSTALLS_SLUG,
  loadReport,
  num,
  requireColumns,
  rowsByDate,
  SESSIONS_SLUG,
  versionLine,
} from '../lib/asc-reports.mjs';

export const name = 'stores';
export const required = false;
export const DAYS = 30;
export const TOP = 5;
export const PLAY_API =
  'https://playdeveloperreporting.googleapis.com/v1beta1/apps';
const PART_STATUSES = ['ok', 'pending', 'not_configured', 'error'];

export const DEFINITIONS = {
  android:
    'Play Developer Reporting API, crashRateMetricSet distinctUsers by versionCode, DAILY: users who used the app on the day and share usage and diagnostics data with Google. ' +
    'Days are Play days (America/Los_Angeles), as Play dates each row. v1 = versionCode < 1257, v2 = 1257 and up; a line adds its versionCodes (a user who updated that day counts twice). ' +
    'Play rounds the values and publishes no row for a cohort under its privacy threshold (about 50 users): null = no row (under the threshold when the day is on or before publishedThrough; not published yet when after). topVersionCodes: the 5 largest versionCodes of the day.',
  ios:
    'App Store Connect analytics reports. "App Sessions Standard" (DAILY): Sessions and Unique Devices for each Date and App Version, opted-in devices only (users who share analytics with developers); v1 = app version < 3.1.0. ' +
    'Devices add the report rows (version x device x OS x territory x source), so a device that changed version or OS that day counts twice. For each Date the rows of the newest report instance are used (Apple: never add two instances). ' +
    'Dates are as Apple gives them. null = no row for the day. installs = Install events except Manual update; firstTimeInstalls = First-time download; manualUpdates = Manual update; deletions = Delete events ("App Store Installation and Deletion Standard", Counts).',
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const laDate = {$ref: '#/$defs/laDate'};
const laDateOrNull = {anyOf: [laDate, {type: 'null'}]};
const cellOrNull = {$ref: '#/$defs/cellOrNull'};
const eventOrNull = {anyOf: [{$ref: '#/$defs/eventCell'}, {type: 'null'}]};
const perDay = items => ({
  type: 'array',
  items,
  minItems: DAYS,
  maxItems: DAYS,
});
const topList = props => ({
  type: 'array',
  maxItems: TOP,
  items: {
    type: 'object',
    required: Object.keys(props),
    additionalProperties: false,
    properties: props,
  },
});

const androidSchema = {
  type: 'object',
  required: ['status'],
  additionalProperties: false,
  properties: {
    status: {enum: PART_STATUSES},
    note: {type: 'string'},
    timeZone: {type: 'string'},
    publishedThrough: laDateOrNull,
    dataThrough: laDateOrNull,
    days: perDay(laDate),
    v1Users: perDay(cellOrNull),
    v2Users: perDay(cellOrNull),
    topVersionCodes: perDay(
      topList({
        versionCode: {type: 'integer', minimum: 0},
        users: {$ref: '#/$defs/cell'},
      }),
    ),
  },
  if: {properties: {status: {const: 'ok'}}},
  then: {
    required: [
      'timeZone',
      'publishedThrough',
      'dataThrough',
      'days',
      'v1Users',
      'v2Users',
      'topVersionCodes',
    ],
  },
};

const iosSchema = {
  type: 'object',
  required: ['status'],
  additionalProperties: false,
  properties: {
    status: {enum: PART_STATUSES},
    note: {type: 'string'},
    dataThrough: laDateOrNull,
    newestProcessingDate: laDateOrNull,
    days: perDay(laDate),
    v1Devices: perDay(cellOrNull),
    v2Devices: perDay(cellOrNull),
    v1Sessions: perDay(eventOrNull),
    v2Sessions: perDay(eventOrNull),
    topVersions: perDay(
      topList({
        version: {type: 'string', maxLength: 20},
        devices: {$ref: '#/$defs/cell'},
        sessions: {$ref: '#/$defs/eventCell'},
      }),
    ),
    installsStatus: {enum: PART_STATUSES},
    installsNote: {type: 'string'},
    installs: perDay(cellOrNull),
    firstTimeInstalls: perDay(cellOrNull),
    manualUpdates: perDay(cellOrNull),
    deletions: perDay(cellOrNull),
  },
  if: {properties: {status: {const: 'ok'}}},
  then: {
    required: [
      'dataThrough',
      'days',
      'v1Devices',
      'v2Devices',
      'v1Sessions',
      'v2Sessions',
      'topVersions',
      'installsStatus',
    ],
  },
};

export const schema = {
  type: 'object',
  required: ['definitions', 'android', 'ios'],
  additionalProperties: false,
  properties: {
    definitions: {
      type: 'object',
      required: ['android', 'ios'],
      additionalProperties: false,
      properties: {android: {type: 'string'}, ios: {type: 'string'}},
    },
    android: androidSchema,
    ios: iosSchema,
  },
};

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

const FRESHNESS_RE = /current freshness (\d{4})-(\d{2})-(\d{2})/;
const ymd = d => {
  const [year, month, day] = d.split('-').map(Number);
  return {year, month, day};
};
export const isoOf = t =>
  `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

/** The body of one Play query: DAILY rows for [from, endExclusive). */
export function playQueryBody(from, endExclusive, pageToken) {
  return {
    timelineSpec: {
      aggregationPeriod: 'DAILY',
      startTime: ymd(from),
      endTime: ymd(endExclusive),
    },
    dimensions: ['versionCode'],
    metrics: ['distinctUsers'],
    pageSize: 10000,
    ...(pageToken ? {pageToken} : {}),
  };
}

/**
 * Play rows for the LA days from..to. Returns
 * {rows: [{date, versionCode, users}], timeZone, publishedThrough}.
 * Play rejects an end past its freshness date, so the window is clamped to
 * the freshness that Play states (the metric set, or the error text).
 */
export async function fetchPlayDaily({
  token,
  from,
  to,
  pkg = ANDROID_PACKAGE_NAME,
  fetchImpl = fetch,
}) {
  const headers = {Authorization: `Bearer ${token}`};
  const base = `${PLAY_API}/${pkg}/crashRateMetricSet`;
  let endExcl = addDays(to, 1);
  try {
    const meta = await (await fetchImpl(base, {headers})).json();
    const f = meta?.freshnessInfo?.freshnesses?.find(
      x => x.aggregationPeriod === 'DAILY',
    )?.latestEndTime;
    if (f && isoOf(f) < endExcl) endExcl = isoOf(f);
  } catch {
    /* the query clamps on the freshness error */
  }

  const post = async (end, pageToken) =>
    (
      await fetchImpl(`${base}:query`, {
        method: 'POST',
        headers: {...headers, 'Content-Type': 'application/json'},
        body: JSON.stringify(playQueryBody(from, end, pageToken)),
      })
    ).json();

  const rows = [];
  let timeZone = null;
  let pageToken;
  for (let page = 0; page < 20 && endExcl > from; page++) {
    let out = await post(endExcl, pageToken);
    const m = out?.error?.message?.match(FRESHNESS_RE);
    if (m && !pageToken) {
      endExcl = `${m[1]}-${m[2]}-${m[3]}`;
      if (endExcl <= from) break;
      out = await post(endExcl);
    }
    if (out?.error)
      throw new Error(
        `Play query: ${String(out.error.message || out.error.status).slice(0, 120)}`,
      );
    for (const r of out.rows || []) {
      const dim =
        r.dimensions?.find(x => x.dimension === 'versionCode') ||
        r.dimensions?.[0];
      const code = Number(dim?.int64Value ?? dim?.stringValue);
      const met = r.metrics?.find(x => x.metric === 'distinctUsers');
      const users = Number(met?.decimalValue?.value ?? met?.decimalValue);
      if (!r.startTime || !Number.isFinite(code) || !Number.isFinite(users))
        continue;
      timeZone ||= r.startTime.timeZone?.id || null;
      rows.push({date: isoOf(r.startTime), versionCode: code, users});
    }
    pageToken = out.nextPageToken;
    if (!pageToken) break;
  }
  return {
    rows,
    timeZone,
    publishedThrough: endExcl > from ? addDays(endExcl, -1) : null,
  };
}

/** Play rows → the Android part (status ok). */
export function shapeAndroid(
  {rows, timeZone, publishedThrough},
  to,
  days = DAYS,
) {
  const dates = dayRange(addDays(to, -(days - 1)), to);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const byDay = dates.map(() => new Map());
  let dataThrough = null;
  for (const r of rows) {
    const i = idx.get(r.date);
    if (i === undefined) continue;
    byDay[i].set(r.versionCode, (byDay[i].get(r.versionCode) || 0) + r.users);
    if (!dataThrough || r.date > dataThrough) dataThrough = r.date;
  }
  const line = (m, isV1) => {
    let sum = 0;
    let any = false;
    for (const [code, users] of m)
      if (code < V2_MIN_VERSION_CODE === isV1) {
        sum += users;
        any = true;
      }
    return any ? cell(sum) : null;
  };
  return {
    status: 'ok',
    timeZone: timeZone || 'unknown',
    publishedThrough,
    dataThrough,
    days: dates,
    v1Users: byDay.map(m => line(m, true)),
    v2Users: byDay.map(m => line(m, false)),
    topVersionCodes: byDay.map(m =>
      [...m]
        .sort((a, b) => b[1] - a[1] || b[0] - a[0])
        .slice(0, TOP)
        .map(([versionCode, users]) => ({versionCode, users: cell(users)})),
    ),
  };
}

export async function androidPart(ctx, {fetchImpl} = {}) {
  let token;
  try {
    token = await ctx.playToken();
  } catch (e) {
    if (e?.code === 'no-service-account')
      return {
        status: 'not_configured',
        note: 'no Play service account: set GOOGLE_PLAY_SA_JSON (JSON text) or GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (a path)',
      };
    return {
      status: 'error',
      note: scrub(`Play token: ${e?.code || ''} ${e?.message || e}`, ctx.env),
    };
  }
  const to = ctx.dataThrough;
  const from = addDays(to, -(DAYS - 1));
  const got = await fetchPlayDaily({token, from, to, fetchImpl});
  if (!got.rows.length)
    return {
      status: 'pending',
      note: `Play returned no row for ${from}..${got.publishedThrough || to} (published through ${got.publishedThrough || 'unknown'})`,
    };
  return shapeAndroid(got, to);
}

// ---------------------------------------------------------------------------
// iOS
// ---------------------------------------------------------------------------

const SESSION_COLS = ['date', 'app version', 'sessions', 'unique devices'];
const INSTALL_COLS = ['date', 'event', 'counts'];

/** Session instances → the per-day session fields (status ok). */
export function shapeSessions(instances, to, days = DAYS) {
  const dates = dayRange(addDays(to, -(days - 1)), to);
  const byDate = rowsByDate(instances);
  let dataThrough = null;
  let unknownRows = 0;
  const out = {
    v1Devices: [],
    v2Devices: [],
    v1Sessions: [],
    v2Sessions: [],
    topVersions: [],
  };
  for (const d of dates) {
    const rows = byDate.get(d);
    if (!rows) {
      for (const k of ['v1Devices', 'v2Devices', 'v1Sessions', 'v2Sessions'])
        out[k].push(null);
      out.topVersions.push([]);
      continue;
    }
    if (!dataThrough || d > dataThrough) dataThrough = d;
    const lines = {v1: {s: 0, d: 0}, v2: {s: 0, d: 0}};
    const versions = new Map();
    for (const r of rows) {
      const s = num(r.sessions);
      const dev = num(r['unique devices']);
      const v = String(r['app version'] || '').trim();
      const l = versionLine(v);
      if (!l) unknownRows++;
      else {
        lines[l].s += s;
        lines[l].d += dev;
      }
      const cur = versions.get(v) || {s: 0, d: 0};
      cur.s += s;
      cur.d += dev;
      versions.set(v, cur);
    }
    out.v1Devices.push(cell(lines.v1.d));
    out.v2Devices.push(cell(lines.v2.d));
    out.v1Sessions.push(eventCell(lines.v1.s, lines.v1.d));
    out.v2Sessions.push(eventCell(lines.v2.s, lines.v2.d));
    out.topVersions.push(
      [...versions]
        .filter(([v]) => versionLine(v))
        .sort(
          (a, b) =>
            b[1].d - a[1].d || b[1].s - a[1].s || a[0].localeCompare(b[0]),
        )
        .slice(0, TOP)
        .map(([version, x]) => ({
          version: version.slice(0, 20),
          devices: cell(x.d),
          sessions: eventCell(x.s, x.d),
        })),
    );
  }
  return {days: dates, dataThrough, unknownRows, ...out};
}

/** Installation instances → installs, firstTimeInstalls, manualUpdates, deletions per day. */
export function shapeInstalls(instances, to, days = DAYS) {
  const dates = dayRange(addDays(to, -(days - 1)), to);
  const byDate = rowsByDate(instances);
  const out = {
    installs: [],
    firstTimeInstalls: [],
    manualUpdates: [],
    deletions: [],
  };
  for (const d of dates) {
    const rows = byDate.get(d);
    if (!rows) {
      for (const k of Object.keys(out)) out[k].push(null);
      continue;
    }
    const t = {
      installs: 0,
      firstTimeInstalls: 0,
      manualUpdates: 0,
      deletions: 0,
    };
    for (const r of rows) {
      const ev = String(r.event || '')
        .trim()
        .toLowerCase();
      const type = String(r['download type'] || '')
        .trim()
        .toLowerCase();
      const n = num(r.counts);
      if (ev === 'install') {
        if (type === 'manual update') t.manualUpdates += n;
        else t.installs += n;
        if (type === 'first-time download') t.firstTimeInstalls += n;
      } else if (ev === 'delete') t.deletions += n;
    }
    for (const k of Object.keys(out)) out[k].push(cell(t[k]));
  }
  return out;
}

export async function iosPart(ctx) {
  const bucket = await ctx.bucket();
  if (!bucket) {
    const missing = missingBucketEnv(ctx.env);
    return {
      status: 'not_configured',
      note: `the signals bucket is not configured: set ${missing.join(', ') || 'SIGNALS_R2_*'}`,
    };
  }
  const to = ctx.dataThrough;
  const from = addDays(to, -(DAYS - 1));
  const sessions = await loadReport(bucket, SESSIONS_SLUG, {from, to});
  if (!sessions.keys)
    return {
      status: 'pending',
      note: 'no "App Sessions Standard" report in the signals bucket yet (Phase 0 copies them daily; Apple publishes the first one 1 to 2 days after the request)',
    };
  if (!sessions.instances.length)
    return {
      status: 'error',
      newestProcessingDate: sessions.newestProcessingDate,
      note: `no "App Sessions Standard" instance processed on or after ${from} (newest: ${sessions.newestProcessingDate}); check the Phase 0 copy (scripts/signals/asc-reports-copy.mjs)`,
    };
  if (sessions.headers)
    requireColumns('App Sessions Standard', sessions.headers, SESSION_COLS);
  const s = shapeSessions(sessions.instances, to);
  const part = {
    status: 'ok',
    ...(s.unknownRows
      ? {
          note: `${s.unknownRows} row(s) with an app version that is not a number are in no line`,
        }
      : {}),
    dataThrough: s.dataThrough,
    newestProcessingDate: sessions.newestProcessingDate,
    days: s.days,
    v1Devices: s.v1Devices,
    v2Devices: s.v2Devices,
    v1Sessions: s.v1Sessions,
    v2Sessions: s.v2Sessions,
    topVersions: s.topVersions,
  };

  try {
    const inst = await loadReport(bucket, INSTALLS_SLUG, {from, to});
    if (!inst.keys) {
      part.installsStatus = 'pending';
      part.installsNote =
        'no "App Store Installation and Deletion Standard" report in the signals bucket yet';
    } else {
      if (inst.headers)
        requireColumns(
          'App Store Installation and Deletion Standard',
          inst.headers,
          INSTALL_COLS,
        );
      Object.assign(
        part,
        {installsStatus: 'ok'},
        shapeInstalls(inst.instances, to),
      );
    }
  } catch (e) {
    part.installsStatus = 'error';
    part.installsNote = scrub(e?.message || e, ctx.env);
  }
  return part;
}

// ---------------------------------------------------------------------------

/** The section status from the two parts. */
export function combine(android, ios) {
  const parts = {Android: android, iOS: ios};
  const working = Object.values(parts).filter(p => p.status === 'ok').length;
  const notes = Object.entries(parts)
    .filter(([, p]) => p.status !== 'ok')
    .map(([k, p]) => `${k}: ${p.status}${p.note ? ` (${p.note})` : ''}`);
  for (const [k, p] of Object.entries(parts))
    if (p.status === 'ok' && p.installsStatus && p.installsStatus !== 'ok')
      notes.push(
        `${k} installs: ${p.installsStatus}${p.installsNote ? ` (${p.installsNote})` : ''}`,
      );
  let status;
  if (working === 2) status = 'ok';
  else if (working === 1) status = 'partial';
  else if (Object.values(parts).some(p => p.status === 'error'))
    status = 'error';
  else if (Object.values(parts).some(p => p.status === 'pending'))
    status = 'pending';
  else status = 'not_configured';
  return {
    status,
    notes,
    ...(status === 'error' ? {error: notes.join('; ').slice(0, 300)} : {}),
    data: {definitions: DEFINITIONS, android, ios},
  };
}

const failed = (e, env) => ({
  status: 'error',
  note: scrub(e?.message || e, env),
});

export async function collect(ctx) {
  const [android, ios] = await Promise.all([
    androidPart(ctx).catch(e => failed(e, ctx.env)),
    iosPart(ctx).catch(e => failed(e, ctx.env)),
  ]);
  return {
    source:
      'Play Developer Reporting API; App Store Connect analytics reports in the signals bucket',
    ...combine(android, ios),
  };
}
