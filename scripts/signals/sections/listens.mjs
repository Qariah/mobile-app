// @ai
//
// Signals snapshot section `listens`: cumulative listens since launch, v1 and
// v2, for the first chart of the Overview page
// (planning/signals-anr-listens-design.md, section 3, and its "Decisions from
// the test-plan review (2026-10-20)", which replace the text above them).
//
// A LISTEN = a recitation started:
//   v1  one play report: a `recitationstatistics` document in the v1 database
//       (one document with play_count 1 for each play since March 2026)
//   v2  one `playback_started` event in PostHog, lab excluded
// v1 has no event like v2's "heard properly" (meaningful_listen), so both
// sides count starts.
//
// THE DATA
//   v1Before    {plays, through}: the v1 plays with no date in the series. An
//               estimate: the v1 lifetime counter (the sum of
//               recitations.play_count) minus every dated play from the first
//               dated record (on or after 2026-03-01) to run time, both read in
//               the same run. New plays add to both, so a rerun keeps it about
//               the same. The 2022 documents count inside it. through = the day
//               before the first dated day.
//   days        LA calendar days from the first dated v1 record (2026-03-10)
//               to dataThrough
//   total       {v1: [plays per day], v2: [plays per day]}
//   cumulative  {v1: [...], v2: [...]}: the exact running totals of `total`,
//               computed here from the exact daily counts (the page draws
//               these; v1Before is the base below them)
//   splits      platform, maker, model, os, version (v2 only) and country (v1
//               and v2): {keys, v2: {<key>: [...]}, cumulative: {v2: {...}}}
//               (+ v1 for country). The top 12 keys by total plays keep their
//               key, in that order; `other` is always the last key.
// Every array has the length of `days` (v2 is 0 before its first event).
//
// SUPPRESSION. The cell rule: a count from 1 to 4 is "<5", for a daily count
// and for each cumulative value (decision G-L4, G-L10).
//
// PRIVACY. Counts only. The v1 queries group by the LA day and requestCountry
// only: they never read, group by or return clientIp, so no IP address
// leaves the database. Country is computed here; the page and its API hide it
// until the privacy policy covers location and IP (decision D6, G-D6).
//
// SOURCES, read-only: PostHog HogQL with the ingestion cut-off ctx.asOfSQL
// (from 2026-05-01, V2_FROM; two queries for each chunk of 16 days, one after
// the other: the key totals that rank the splits, then the daily counts);
// the v1 database through V1_DB_RO_URL and the guard in lib/v1-db.mjs (two
// aggregations, each with maxTimeMS 60 s). Without V1_DB_RO_URL, or when the
// guard refuses the login, the v1 parts are null and the status is partial.

import {labExclusionSQL, sqlList} from '../../lib/lab-exclusion.mjs';
import {scrub} from '../lib/context.mjs';
import {
  addDays,
  cell,
  dayRange,
  laDaySQL,
  laDaysWhere,
  OWNER_TZ,
} from '../lib/rules.mjs';
import {
  connectV1,
  laMidnightUtc,
  openGuardedDb,
  scrubDb,
} from '../lib/v1-db.mjs';
import {makerLabel, SCAN_FROM} from './weekly.mjs';

export const name = 'listens';
export const required = false;
/** Added after the first snapshots: optional in the schema, so older files stay valid. */
export const addedAt = '2026-10-20';
// The v1 aggregation reads the documents from this LA day on. The first one
// is on 2026-03-10 (checked 2026-10-19); FIRST_V1_DAY is the start of `days`
// when the v1 database cannot be read.
export const START = '2026-03-01';
export const FIRST_V1_DAY = '2026-03-10';
export const TOP_N = 12;
export const DIMS = ['platform', 'maker', 'model', 'os', 'version', 'country'];
export const MAX_TIME_MS = 60_000;
export const RANK_LIMIT = 20_000;
export const DAILY_LIMIT = 50_000;
export const SOURCE =
  'PostHog HogQL (playback_started) + v1 database (MongoDB qariah-prod), read-only login';

export const DEFINITIONS = {
  listen:
    'a recitation started: a v1 play report (one recitationstatistics document, play_count 1, since March 2026) or a v2 playback_started event (lab excluded). v1 has no event like the v2 "heard properly" (meaningful_listen)',
  v1Before:
    'an estimate of the v1 plays that have no date in the series: the sum of recitations.play_count (the v1 lifetime counter) minus the play_count of every recitationstatistics document from the first dated record (on or after 2026-03-01 LA) to run time, both read in the same run (new plays add to both). The 2022 documents count inside it. through = the day before the first dated day. The page shows it as one block "v1 before March 2026 (no dates)"',
  days: 'LA calendar days from the first dated v1 record (2026-03-10) to dataThrough. Every array has this length. v2 is 0 before its first organic event (the v2 queries start at 2026-05-01; PostHog holds no earlier event)',
  total:
    'plays per day. v1 = the play_count of the recitationstatistics documents by the LA day of created_at; v2 = playback_started events by the LA day of the event, all versions, lab excluded, events received by asOf',
  cumulative:
    'the exact running totals of the daily plays, computed by the snapshot from the exact counts (the cell rule then applies to each value). The chart stacks v1Before.plays, cumulative.v1 and cumulative.v2',
  splits: `each split keeps the top ${TOP_N} keys by total plays (v1 + v2 together for country) in that order, then "other" (always the last key) for the rest. A missing value is "unknown", a key like any other. Each event counts under its own properties. v1 has no device or version data, so only country has a v1 part`,
  platform: '$os_name: iOS (iPadOS included), Android, unknown',
  maker: '$device_manufacturer, case folded, without a "Mobile Limited" suffix',
  model:
    '$device_name: the device model (for example "iPhone 15 Pro"); lab devices are excluded',
  os: '$os_name and the major part of $os_version ("iOS 26", "iPadOS 18", "Android 16")',
  version: '$app_version of the event; v2 only',
  country:
    'v1 = requestCountry of the play report; v2 = $geoip_country_name (PostHog GeoIP). The page and its API hide it until the privacy policy covers location and IP (D6). No IP address leaves the v1 database',
  suppression:
    'the cell rule: a daily count or a cumulative value from 1 to 4 is "<5"; 0 stays 0',
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const C = {$ref: '#/$defs/cell'};
const series = {type: 'array', items: C};
const seriesOrNull = {anyOf: [series, {type: 'null'}]};
const byKey = {type: 'object', additionalProperties: series};
const byKeyOrNull = {anyOf: [byKey, {type: 'null'}]};
const obj = (props, req = Object.keys(props)) => ({
  type: 'object',
  required: req,
  additionalProperties: false,
  properties: props,
});
const keys = {
  type: 'array',
  items: {type: 'string'},
  minItems: 1,
  maxItems: TOP_N + 1,
};
const laDate = {$ref: '#/$defs/laDate'};
const splitV2 = obj({keys, v2: byKey, cumulative: obj({v2: byKey})});
const sums = obj({v1: seriesOrNull, v2: series});

export const schema = obj({
  definitions: obj(
    Object.fromEntries(
      Object.keys(DEFINITIONS).map(k => [k, {type: 'string'}]),
    ),
  ),
  v1Before: obj({plays: {anyOf: [C, {type: 'null'}]}, through: laDate}),
  days: {type: 'array', items: laDate, minItems: 1},
  total: sums,
  cumulative: sums,
  splits: obj({
    platform: splitV2,
    maker: splitV2,
    model: splitV2,
    os: splitV2,
    version: splitV2,
    country: obj({
      keys,
      v1: byKeyOrNull,
      v2: byKey,
      cumulative: obj({v1: byKeyOrNull, v2: byKey}),
    }),
  }),
});

// ---------------------------------------------------------------------------
// v2: PostHog
// ---------------------------------------------------------------------------

const P = k => `properties.${k}`;
const str = c => `ifNull(${c}, '')`;

/**
 * The raw columns of one install on one LA day, with its plays. Each event
 * keeps its own properties. Grouping the events first keeps the string work
 * (the maker regex, the OS major) off the per-event path: it runs on these
 * rows only.
 */
export function v2Inner(from, to, asOfWhere = 'true') {
  return `SELECT ${laDaySQL()} AS day, person_id,
         ${str(P('$os_name'))} AS os, ${str(P('$os_version'))} AS osv,
         ${str(P('$device_manufacturer'))} AS maker, ${str(P('$device_name'))} AS model,
         ${str(P('$app_version'))} AS ver, ${str(P('$geoip_country_name'))} AS geo,
         count() AS n
       FROM events
       WHERE event = 'playback_started' AND ${laDaysWhere(from, to)}
         AND ${asOfWhere} AND ${labExclusionSQL()}
       GROUP BY day, person_id, os, osv, maker, model, ver, geo`;
}

const known = c => `if(notEmpty(${c}), ${c}, 'unknown')`;

/** The HogQL expression of each split key, on the columns of v2Inner. */
export const KEY_SQL = {
  platform: `multiIf(os IN ('iOS', 'iPadOS'), 'iOS', os = 'Android', 'Android', 'unknown')`,
  maker: `if(notEmpty(maker), replaceRegexpOne(lower(trim(maker)), ' +((mobile|mobility) +)?limited$', ''), 'unknown')`,
  model: known('model'),
  os: `if(notEmpty(os) AND notEmpty(osv), concat(os, ' ', splitByChar('.', osv)[1]), 'unknown')`,
  version: known('ver'),
  country: known('geo'),
};

const keyed = (from, to, asOfWhere) =>
  `SELECT day, n,
         ${DIMS.map(d => `${KEY_SQL[d]} AS k_${d}`).join(',\n         ')}
       FROM (${v2Inner(from, to, asOfWhere)})`;

/**
 * The LA days from..to in chunks of CHUNK_DAYS. One query over all the days
 * hit the PostHog execution limit (HTTP 504 after about 10 s on 2026-10-19:
 * the cut-off on created_at makes the scan slow); a 31-day chunk took 2 to
 * 12 s. A day is in one chunk only, so the plays add up exactly.
 */
export const CHUNK_DAYS = 16;
export function chunks(from, to, size = CHUNK_DAYS) {
  const out = [];
  for (let a = from; a <= to; a = addDays(a, size)) {
    const b = addDays(a, size - 1);
    out.push({from: a, to: b < to ? b : to});
  }
  return out;
}

/**
 * The first day the v2 queries scan. The PostHog project holds no event
 * before 2026-05-07 UTC (weekly.mjs SCAN_FROM), so the v2 days before it are
 * 0 without a query.
 */
export const V2_FROM = SCAN_FROM > START ? SCAN_FROM : START;

/** HogQL: total plays of each key of each split, LA days from..to. */
export function rankQuery(from, to, asOfWhere = 'true') {
  return `SELECT dim, key, sum(n) AS plays
     FROM (${keyed(from, to, asOfWhere)})
     ARRAY JOIN [${DIMS.map(d => `'${d}'`).join(', ')}] AS dim,
                [${DIMS.map(d => `k_${d}`).join(', ')}] AS key
     GROUP BY dim, key
     ORDER BY dim, plays DESC, key`;
}

// A key that goes back into a query as a literal. A key with a backslash or a
// control character is never kept (it goes to "other"), so no escape but the
// quote (sqlList) is needed.
// eslint-disable-next-line no-control-regex -- the control characters are the point
const SAFE_KEY = /^[^\\\u0000-\u001f]*$/;

/**
 * HogQL: plays per LA day (from..to) for `total` and for each kept key of
 * each split; every other key of a split counts as `other`.
 * kept: {<dim>: [keys]} (for maker: the case-folded key, as KEY_SQL).
 */
export function dailyQuery(from, to, asOfWhere, kept) {
  const branch = d => {
    const ks = (kept[d] || []).filter(k => SAFE_KEY.test(k));
    return `dim = '${d}', ${ks.length ? `if(key IN (${sqlList(ks)}), key, 'other')` : "'other'"}`;
  };
  return `SELECT dim, multiIf(dim = 'total', 'total', ${DIMS.map(branch).join(', ')}, 'other') AS k,
       toString(day) AS d, sum(n) AS plays
     FROM (${keyed(from, to, asOfWhere)})
     ARRAY JOIN ['total', ${DIMS.map(d => `'${d}'`).join(', ')}] AS dim,
                ['total', ${DIMS.map(d => `k_${d}`).join(', ')}] AS key
     GROUP BY dim, k, d
     ORDER BY dim, k, d`;
}

// ---------------------------------------------------------------------------
// v1: the v1 database (aggregate only; clientIp is never named)
// ---------------------------------------------------------------------------

/** The v1 lifetime counter: the sum of recitations.play_count. */
export const v1LifetimePipeline = () => [
  {$group: {_id: null, plays: {$sum: '$play_count'}}},
];

/**
 * Dated plays from `start` (a UTC instant) to run time, by the LA day of
 * created_at and requestCountry. Only these two fields and play_count are
 * read.
 */
export const v1DailyPipeline = start => [
  {$match: {created_at: {$gte: start}}},
  {
    $group: {
      _id: {
        day: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$created_at',
            timezone: OWNER_TZ,
          },
        },
        country: {$ifNull: ['$requestCountry', '']},
      },
      plays: {$sum: '$play_count'},
    },
  },
];

const countryKey = c => {
  const s = String(c ?? '').trim();
  return s || 'unknown';
};

/**
 * Run the two v1 aggregations through the read-only door (readOnlyDb).
 * → {lifetime, dated, after, before, firstDay, byDay: Map(day → Map(country
 *   → plays))}. firstDay = the LA day of the first dated record on or after
 *   START; dated = its plays to dataThrough; after = the plays after
 *   dataThrough (today so far); before = lifetime − dated − after.
 */
export async function measureV1(db, dataThrough) {
  // The lifetime counter first: a play reported between the two reads then
  // makes `before` at most 1 too small, never too large.
  const [life] = await db.aggregate('recitations', v1LifetimePipeline());
  const rows = await db.aggregate(
    'recitationstatistics',
    v1DailyPipeline(laMidnightUtc(START)),
  );
  const byDay = new Map();
  let dated = 0;
  let after = 0;
  let firstDay = null;
  for (const r of rows) {
    const day = String(r?._id?.day || '');
    const n = Number(r?.plays) || 0;
    if (day < START) continue; // not possible with the $match; ignore
    if (!firstDay || day < firstDay) firstDay = day;
    if (day > dataThrough) {
      after += n;
      continue;
    }
    dated += n;
    const m = byDay.get(day) || new Map();
    const c = countryKey(r._id.country);
    m.set(c, (m.get(c) || 0) + n);
    byDay.set(day, m);
  }
  const lifetime = Number(life?.plays) || 0;
  return {
    lifetime,
    dated,
    after,
    before: lifetime - dated - after,
    firstDay,
    byDay,
  };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * The kept keys of each split: the top TOP_N by total plays (for country, v2
 * and v1 together), ties by key. rankRows: [dim, key, plays].
 * → {<dim>: [raw keys in rank order]}
 */
export function topKeys(rankRows, v1 = null) {
  const totals = Object.fromEntries(DIMS.map(d => [d, new Map()]));
  for (const [dim, key, plays] of rankRows || []) {
    const m = totals[dim];
    if (!m) continue;
    m.set(String(key), (m.get(String(key)) || 0) + (Number(plays) || 0));
  }
  if (v1)
    for (const day of v1.byDay.values())
      for (const [c, n] of day)
        totals.country.set(c, (totals.country.get(c) || 0) + n);
  return Object.fromEntries(
    DIMS.map(d => [
      d,
      [...totals[d].entries()]
        .filter(([k, n]) => n > 0 && k !== 'other' && SAFE_KEY.test(k))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP_N)
        .map(([k]) => k),
    ]),
  );
}

const label = (dim, key) => (dim === 'maker' ? makerLabel(key) : key);

/** The running total of an exact daily series. */
export function runningTotal(daily) {
  let s = 0;
  return daily.map(n => (s += Number(n) || 0));
}

/** The first LA day of the series: the first dated v1 record. */
export const firstDayOf = v1 => v1?.firstDay || FIRST_V1_DAY;

/**
 * Everything → the section data.
 * @param o {days, kept, dailyRows: [dim, k, day, plays], v1|null}
 */
export function shape({days, kept, dailyRows, v1}) {
  const idx = new Map(days.map((d, i) => [d, i]));
  const zeros = () => days.map(() => 0);
  // Exact daily plays: v2[dim] = Map(key → [plays per day]).
  const v2 = {
    total: new Map(),
    ...Object.fromEntries(DIMS.map(d => [d, new Map()])),
  };
  for (const [dim, k, day, plays] of dailyRows || []) {
    const i = idx.get(String(day).slice(0, 10));
    const m = v2[dim];
    if (i === undefined || !m) continue;
    const key = String(k);
    if (!m.has(key)) m.set(key, zeros());
    m.get(key)[i] += Number(plays) || 0;
  }

  // v1 per country, mapped to the kept keys.
  const v1Country = new Map();
  const v1Total = zeros();
  if (v1) {
    const keep = new Set(kept.country || []);
    for (const [day, m] of v1.byDay) {
      const i = idx.get(day);
      if (i === undefined) continue;
      for (const [c, n] of m) {
        v1Total[i] += n;
        const key = keep.has(c) ? c : 'other';
        if (!v1Country.has(key)) v1Country.set(key, zeros());
        v1Country.get(key)[i] += n;
      }
    }
  }

  const cells = a => a.map(cell);
  const cumCells = a => runningTotal(a).map(cell);
  const split = dim => {
    const m = v2[dim];
    // `other` is always the last key (G-L7), with zeros when nothing is left.
    const ks = [...(kept[dim] || []), 'other'];
    const exact = k => m.get(k) || zeros();
    const out = {
      keys: ks.map(k => label(dim, k)),
      v2: Object.fromEntries(ks.map(k => [label(dim, k), cells(exact(k))])),
    };
    const cum = {
      v2: Object.fromEntries(ks.map(k => [label(dim, k), cumCells(exact(k))])),
    };
    if (dim !== 'country') return {...out, cumulative: cum};
    const v1Of = k => v1Country.get(k) || zeros();
    return {
      keys: out.keys,
      v1: v1 ? Object.fromEntries(ks.map(k => [k, cells(v1Of(k))])) : null,
      v2: out.v2,
      cumulative: {
        v1: v1 ? Object.fromEntries(ks.map(k => [k, cumCells(v1Of(k))])) : null,
        v2: cum.v2,
      },
    };
  };

  const before = v1 && v1.before >= 0 ? v1.before : null;
  const v2Total = v2.total.get('total') || zeros();
  return {
    definitions: DEFINITIONS,
    v1Before: {
      plays: before === null ? null : cell(before),
      through: addDays(days[0], -1),
    },
    days,
    total: {v1: v1 ? cells(v1Total) : null, v2: cells(v2Total)},
    cumulative: {v1: v1 ? cumCells(v1Total) : null, v2: cumCells(v2Total)},
    splits: Object.fromEntries(DIMS.map(d => [d, split(d)])),
  };
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

/** The v1 part, or null with a note (not configured, refused, or failed). */
async function readV1(ctx, connect, notes) {
  const url = ctx.env?.V1_DB_RO_URL;
  if (!url) {
    notes.push(
      'v1: not configured (set V1_DB_RO_URL, a read-only login to the v1 database); the v1 parts are null',
    );
    return null;
  }
  let opened;
  try {
    // The guard (lib/v1-db.mjs): a login that can write runs no query.
    opened = await openGuardedDb({
      url,
      env: ctx.env,
      connect,
      maxTimeMS: MAX_TIME_MS,
    });
    if (!opened.ok) {
      notes.push(`v1: ${opened.error}; the v1 parts are null`);
      return null;
    }
    notes.push(...opened.notes.map(n => `v1: ${n}`));
    const v1 = await measureV1(opened.db, ctx.dataThrough);
    if (v1.before < 0)
      notes.push(
        'v1: the lifetime counter is below the dated plays; v1Before is null',
      );
    return v1;
  } catch (e) {
    notes.push(
      `v1: the query failed (${scrub(scrubDb(e?.message || e, url), ctx.env).slice(0, 200)}); the v1 parts are null`,
    );
    return null;
  } finally {
    if (opened?.close) await opened.close();
  }
}

/**
 * @param ctx  the snapshot context
 * @param deps {connect(url) → MongoClient-like}; tests pass a fake
 */
export async function collect(ctx, {connect = connectV1} = {}) {
  const to = ctx.dataThrough;
  const notes = [];
  const asOf = ctx.asOfSQL || 'true';
  const parts = chunks(V2_FROM, to);
  // One chunk at a time: the snapshot already runs two sections together,
  // and PostHog limits the queries that run at once.
  const rankAll = async () => {
    const rows = [];
    for (const c of parts)
      rows.push(
        ...(await ctx.hogql(rankQuery(c.from, c.to, asOf), {
          limit: RANK_LIMIT,
        })),
      );
    return rows;
  };
  const [v1, rankRows] = await Promise.all([
    readV1(ctx, connect, notes),
    rankAll(),
  ]);
  const kept = topKeys(rankRows, v1);
  const dailyRows = [];
  for (const c of parts)
    dailyRows.push(
      ...(await ctx.hogql(dailyQuery(c.from, c.to, asOf, kept), {
        limit: DAILY_LIMIT,
      })),
    );
  const days = dayRange(firstDayOf(v1), to);
  // The local-dev override note is a warning, not a gap.
  const gaps = notes.filter(n => !/local-dev override/.test(n));
  return {
    status: gaps.length ? 'partial' : 'ok',
    source: SOURCE,
    data: shape({days, kept, dailyRows, v1}),
    ...(notes.length ? {notes} : {}),
  };
}
