// @ai
//
// Signals snapshot section `restore`: the v1 → v2 user-data restore, the
// primary signal of the migration (docs/operations/active-rollout.json →
// watch.primary). The restore runs only after a QF sign-in, so the sign-in
// funnel goes with it.
//
//   daily    for each LA day, 30 days to dataThrough: distinct installs that
//            sent each event
//   totals   from 2026-08-12 (the first organic restore) to dataThrough, in
//            total and by platform: installs and event counts for each event,
//            and two checks on v1_restore_merged:
//              mergesWithCandidates  merges with candidate_total > 0 (the
//                                    user had v1 data to restore)
//              mergesWithSkips       merges with a non-zero
//                                    recitations_skipped_* counter (a v1
//                                    recitation that the merge could not keep:
//                                    the silent loss that the watch hunts)
//
// Events: v1_restore_checked, v1_restore_merged, v1_restore_skipped,
// sign_in_started, sign_in_succeeded, sign_in_failed, sign_in_abandoned.
// "Merges" are v1_restore_merged events, so they go through eventCell() with
// the installs behind them. The platform of an install is its first non-null
// $os_name by timestamp over its whole history (iPadOS = iOS; none = unknown).
// All versions, lab devices excluded, events received by ctx.asOf.

import {labExclusionSQL, sqlList} from '../../lib/lab-exclusion.mjs';
import {
  addDays,
  cell,
  dayRange,
  eventCell,
  laDaySQL,
  laDaysWhere,
} from '../lib/rules.mjs';

export const name = 'restore';
export const required = false;
export const DAYS = 30;
export const SINCE = '2026-08-12';
// The PostHog project holds no event before 2026-05-07 UTC (checked
// 2026-10-18); the platform of an install looks at its whole history.
export const SCAN_FROM = '2026-05-01';
export const PLATFORMS = ['iOS', 'Android', 'unknown'];
export const EVENTS = [
  'v1_restore_checked',
  'v1_restore_merged',
  'v1_restore_skipped',
  'sign_in_started',
  'sign_in_succeeded',
  'sign_in_failed',
  'sign_in_abandoned',
];
// The skip counters of v1_restore_merged (active-rollout.json →
// watch.primary.instrumentationGap; the names seen in PostHog on 2026-10-18).
export const SKIP_COUNTERS = [
  'recitations_skipped_no_slug',
  'recitations_skipped_no_reciter',
  'recitations_skipped_no_rewayat',
  'recitations_skipped_no_surah',
];
const CHECKS = ['mergesWithCandidates', 'mergesWithSkips'];

const byEvent = item => ({
  type: 'object',
  required: EVENTS,
  additionalProperties: false,
  properties: Object.fromEntries(EVENTS.map(e => [e, item])),
});
const pair = {
  type: 'object',
  required: ['installs', 'events'],
  additionalProperties: false,
  properties: {
    installs: {$ref: '#/$defs/cell'},
    events: {$ref: '#/$defs/eventCell'},
  },
};
const totals = {
  type: 'object',
  required: ['installs', 'events', ...CHECKS],
  additionalProperties: false,
  properties: {
    installs: {$ref: '#/$defs/cell'},
    events: byEvent(pair),
    ...Object.fromEntries(CHECKS.map(c => [c, pair])),
  },
};

export const schema = {
  type: 'object',
  required: ['days', 'since', 'through', 'definitions', 'daily', 'totals'],
  additionalProperties: false,
  properties: {
    days: {
      type: 'array',
      items: {$ref: '#/$defs/laDate'},
      minItems: DAYS,
      maxItems: DAYS,
    },
    since: {$ref: '#/$defs/laDate'},
    through: {$ref: '#/$defs/laDate'},
    definitions: {type: 'object', additionalProperties: {type: 'string'}},
    daily: byEvent({
      type: 'object',
      required: ['installs'],
      additionalProperties: false,
      properties: {
        installs: {
          type: 'array',
          items: {$ref: '#/$defs/cell'},
          minItems: DAYS,
          maxItems: DAYS,
        },
      },
    }),
    totals: {
      type: 'object',
      required: ['total', ...PLATFORMS],
      additionalProperties: false,
      properties: Object.fromEntries(
        ['total', ...PLATFORMS].map(p => [p, totals]),
      ),
    },
  },
};

/** Daily: one row per (LA day, event) with the distinct installs. */
export function dailyQuery(to, asOfWhere = 'true') {
  return `SELECT toString(${laDaySQL()}) AS day, event, uniqExact(person_id) AS installs
     FROM events
     WHERE ${laDaysWhere(addDays(to, -(DAYS - 1)), to)} AND ${asOfWhere}
       AND event IN (${sqlList(EVENTS)}) AND ${labExclusionSQL()}
     GROUP BY day, event
     ORDER BY day, event`;
}

const OS = 'properties.$os_name';
const positive = p => `ifNull(toFloat(properties.${p}), 0) > 0`;

/** Totals: one row per platform ('total' included), per install first. */
export function totalsQuery(to, asOfWhere = 'true') {
  const inWindow = `${laDaySQL()} >= toDate('${SINCE}')`;
  const merged = `event = 'v1_restore_merged' AND ${inWindow}`;
  const perEvent = EVENTS.map(
    (e, i) => `countIf(event = '${e}' AND ${inWindow}) AS e${i}`,
  ).join(',\n                ');
  const outCols = EVENTS.map((e, i) => `countIf(e${i} > 0), sum(e${i})`).join(
    ',\n       ',
  );
  return `SELECT plat, count() AS installs,
       ${outCols},
       countIf(cand > 0), sum(cand),
       countIf(skip > 0), sum(skip)
     FROM (
       SELECT *, arrayJoin(['total', multiIf(os0 IN ('iOS', 'iPadOS'), 'iOS', os0 = 'Android', 'Android', 'unknown')]) AS plat
       FROM (
         SELECT person_id,
                argMinIf(${OS}, timestamp, notEmpty(ifNull(${OS}, ''))) AS os0,
                ${perEvent},
                countIf(${merged} AND ${positive('candidate_total')}) AS cand,
                countIf(${merged} AND (${SKIP_COUNTERS.map(positive).join(' OR ')})) AS skip,
                countIf(event IN (${sqlList(EVENTS)}) AND ${inWindow}) AS any_restore
         FROM events
         WHERE ${laDaysWhere(SCAN_FROM, to)} AND ${asOfWhere} AND ${labExclusionSQL()}
         GROUP BY person_id
         HAVING any_restore > 0
       )
     )
     GROUP BY plat
     ORDER BY plat`;
}

const num = v => Number(v) || 0;

/**
 * daily: [day, event, installs]; totalRows: [plat, installs, (installs,
 * events) per EVENTS, cand installs, cand merges, skip installs, skip merges].
 */
export function shape(daily, totalRows, to) {
  const days = dayRange(addDays(to, -(DAYS - 1)), to);
  const idx = new Map(days.map((d, i) => [d, i]));
  const raw = Object.fromEntries(EVENTS.map(e => [e, days.map(() => 0)]));
  for (const [day, event, installs] of daily) {
    const i = idx.get(String(day).slice(0, 10));
    if (i !== undefined && raw[event]) raw[event][i] = num(installs);
  }

  const pairOf = (installs, events) => ({
    installs: cell(installs),
    events: eventCell(events, installs),
  });
  const empty = () => ({
    installs: 0,
    events: Object.fromEntries(EVENTS.map(e => [e, [0, 0]])),
    cand: [0, 0],
    skip: [0, 0],
  });
  const acc = Object.fromEntries(
    ['total', ...PLATFORMS].map(p => [p, empty()]),
  );
  for (const r of totalRows) {
    const a = acc[r[0]] || acc.unknown;
    const v = r.slice(1).map(num);
    a.installs += v[0];
    EVENTS.forEach((e, i) => {
      a.events[e][0] += v[1 + 2 * i];
      a.events[e][1] += v[2 + 2 * i];
    });
    const k = 1 + 2 * EVENTS.length;
    a.cand = [a.cand[0] + v[k], a.cand[1] + v[k + 1]];
    a.skip = [a.skip[0] + v[k + 2], a.skip[1] + v[k + 3]];
  }
  const totalsOut = a => ({
    installs: cell(a.installs),
    events: Object.fromEntries(EVENTS.map(e => [e, pairOf(...a.events[e])])),
    mergesWithCandidates: pairOf(...a.cand),
    mergesWithSkips: pairOf(...a.skip),
  });

  return {
    days,
    since: SINCE,
    through: to,
    definitions: {
      daily: 'for each LA day: distinct installs that sent the event that day',
      totals: `from ${SINCE} (the first organic restore) to through: installs = distinct installs that sent any of the events; events.<name> = distinct installs and the event count`,
      mergesWithCandidates:
        'v1_restore_merged events with candidate_total > 0 (events) and the installs that sent them',
      mergesWithSkips: `v1_restore_merged events with any of ${SKIP_COUNTERS.join(', ')} > 0 (events) and the installs that sent them`,
      platform:
        'the first non-null $os_name of the install by timestamp over its whole history; iPadOS counts as iOS; no $os_name = unknown',
      scope:
        'all versions, lab excluded, events received by asOf; the restore runs only after a QF sign-in',
    },
    daily: Object.fromEntries(
      EVENTS.map(e => [e, {installs: raw[e].map(cell)}]),
    ),
    totals: Object.fromEntries(
      Object.entries(acc).map(([p, a]) => [p, totalsOut(a)]),
    ),
  };
}

export async function collect(ctx) {
  const daily = await ctx.hogql(dailyQuery(ctx.dataThrough, ctx.asOfSQL), {
    limit: DAYS * EVENTS.length + 10,
  });
  const totalRows = await ctx.hogql(totalsQuery(ctx.dataThrough, ctx.asOfSQL), {
    limit: 100,
  });
  return {
    status: 'ok',
    source: 'PostHog HogQL',
    data: shape(daily, totalRows, ctx.dataThrough),
  };
}
