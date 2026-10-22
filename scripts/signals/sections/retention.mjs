// @ai
//
// Signals snapshot section `retention`: weekly install cohorts and how many of
// each cohort came back (planning/signals-phase1-design.md, "Retention
// definitions").
//
// Day 0 is the LA day of an install's first organic event. A cohort is the
// installs whose day 0 falls in one LA week (Monday start).
//
//   d2              active on day 1.
//   d7              active on any of days 6, 7 or 8.
//   d28             active on any of days 27, 28 or 29.
//   cameBack2ndDay  active on 2 or more distinct days in days 0 to 29 (the old
//                   "day-2 retention" of rollout-engagement.mjs).
//
// Maturity is measured at the END of dataThrough (the LA midnight after it),
// never at run time:
//   d2              the install was first seen 48 hours or more before that
//                   instant
//   d7              day 8 <= dataThrough
//   d28, cameBack2ndDay   day 29 <= dataThrough
// A cohort shows a share only when ALL its members are mature (its last
// first-seen time, or its last day 0, passes the test); else the measure is
// null. Each share is a rate(): num = retained installs, den = the cohort.
//
// "Active" = any organic event on the LA day. All versions, lab devices
// excluded, events received by ctx.asOf; activity after dataThrough does not
// count, so a rerun of a date gives the same numbers.

import {labExclusionSQL} from '../../lib/lab-exclusion.mjs';
import {
  addDays,
  cell,
  laDaySQL,
  laDaysWhere,
  laWallToUtc,
  rate,
} from '../lib/rules.mjs';

export const name = 'retention';
export const required = false;

// The PostHog project holds no event before 2026-05-07 UTC (checked
// 2026-10-18), so a scan from this date sees every install's day 0.
export const SCAN_FROM = '2026-05-01';
export const D2_HOURS = 48;
/** The last day (from day 0) that must be complete for d7, d28 and cameBack2ndDay. */
export const MATURE_DAY = {d7: 8, d28: 29, cameBack2ndDay: 29};
export const MEASURES = ['d2', 'd7', 'd28', 'cameBack2ndDay'];

const rateOrNull = {anyOf: [{$ref: '#/$defs/rate'}, {type: 'null'}]};

export const schema = {
  type: 'object',
  required: ['through', 'definitions', 'cohorts'],
  additionalProperties: false,
  properties: {
    through: {$ref: '#/$defs/laDate'},
    definitions: {type: 'object', additionalProperties: {type: 'string'}},
    cohorts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['week', 'cohort', ...MEASURES],
        additionalProperties: false,
        properties: {
          week: {$ref: '#/$defs/laDate'},
          cohort: {$ref: '#/$defs/cell'},
          ...Object.fromEntries(MEASURES.map(m => [m, rateOrNull])),
        },
      },
    },
  },
};

/**
 * The HogQL query: one row per cohort week, with the retained counts, the last
 * first-seen time and the last day 0 of the cohort (for maturity).
 */
export function retentionQuery(to, asOfWhere = 'true') {
  return `SELECT toString(week) AS cohort_week, count() AS cohort,
       countIf(has(offs, 1)) AS d2,
       countIf(arrayExists(x -> x >= 6 AND x <= 8, offs)) AS d7,
       countIf(arrayExists(x -> x >= 27 AND x <= 29, offs)) AS d28,
       countIf(arrayCount(x -> x <= 29, offs) >= 2) AS came_back,
       max(first_ts) AS last_first_seen,
       toString(max(day0)) AS last_day0
     FROM (
       SELECT toMonday(day0) AS week, day0, first_ts,
              arrayMap(d -> dateDiff('day', day0, d), days) AS offs
       FROM (
         SELECT person_id, min(day) AS day0, min(ts) AS first_ts, groupUniqArray(day) AS days
         FROM (
           SELECT person_id, ${laDaySQL()} AS day, min(timestamp) AS ts
           FROM events
           WHERE ${laDaysWhere(SCAN_FROM, to)} AND ${asOfWhere} AND ${labExclusionSQL()}
           GROUP BY person_id, day
         )
         GROUP BY person_id
       )
     )
     GROUP BY week
     ORDER BY week`;
}

/** The end of dataThrough: the LA midnight after it, in ms. */
export const endOfDay = to => laWallToUtc(addDays(to, 1), 0).getTime();

// HogQL prints a DateTime as ISO with microseconds; keep milliseconds.
const parseTs = v => Date.parse(String(v).replace(/(\.\d{3})\d+/, '$1'));

/** Are all members of a cohort mature for a measure? */
export function isMature(measure, {lastFirstSeen, lastDay0}, to) {
  if (measure === 'd2') {
    const t = parseTs(lastFirstSeen);
    return Number.isFinite(t) && t <= endOfDay(to) - D2_HOURS * 3_600_000;
  }
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(String(lastDay0)) &&
    addDays(lastDay0, MATURE_DAY[measure]) <= to
  );
}

/** Rows [week, cohort, d2, d7, d28, came_back, last_first_seen, last_day0] → the section data. */
export function shape(rows, to) {
  const cohorts = rows
    .map(r => ({
      week: String(r[0]).slice(0, 10),
      size: Number(r[1]) || 0,
      retained: {
        d2: Number(r[2]) || 0,
        d7: Number(r[3]) || 0,
        d28: Number(r[4]) || 0,
        cameBack2ndDay: Number(r[5]) || 0,
      },
      lastFirstSeen: r[6],
      lastDay0: String(r[7] ?? '').slice(0, 10),
    }))
    .filter(c => c.week <= to)
    .sort((a, b) => a.week.localeCompare(b.week))
    .map(c => ({
      week: c.week,
      cohort: cell(c.size),
      ...Object.fromEntries(
        MEASURES.map(m => [
          m,
          isMature(m, c, to) ? rate(c.retained[m], c.size) : null,
        ]),
      ),
    }));
  return {
    through: to,
    definitions: {
      cohort:
        'installs whose day 0 (the LA day of the first organic event) falls in the LA week (Monday start)',
      d2: 'active on day 1; mature when the install was first seen 48 hours or more before the end of `through` (the LA midnight after it)',
      d7: 'active on any of days 6, 7 or 8; mature when day 8 <= through',
      d28: 'active on any of days 27, 28 or 29; mature when day 29 <= through',
      cameBack2ndDay:
        'active on 2 or more distinct LA days in days 0 to 29; mature when day 29 <= through',
      maturity:
        'measured at the end of `through`, never at run time; a share is null until EVERY member of the cohort is mature',
      rate: 'num = retained installs, den = the cohort; active = any organic event on the LA day; all versions, lab excluded, events received by asOf; activity after `through` does not count',
    },
    cohorts,
  };
}

export async function collect(ctx) {
  const rows = await ctx.hogql(retentionQuery(ctx.dataThrough, ctx.asOfSQL), {
    limit: 1000,
  });
  return {
    status: 'ok',
    source: 'PostHog HogQL',
    data: shape(rows, ctx.dataThrough),
  };
}
