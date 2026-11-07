// @ai
//
// Signals snapshot section `active`: DAU, WAU and MAU for each LA calendar day,
// 120 days to dataThrough, for all installs and for each platform.
//
//   dau  distinct installs with any event on the day
//   wau  distinct installs with any event in the 7 days that end on the day
//   mau  distinct installs with any event in the 30 days that end on the day
//
// All versions, lab devices excluded, as the card's ACTIVE block. The card uses
// trailing 24-hour windows at run time; this section uses calendar days and the
// ingestion cut-off ctx.asOf, so a rerun of a date gives the same numbers.
// iPadOS counts as iOS. The platform of an install on a day is min($os_name) of
// its events that day (deterministic; NULL is skipped). An install whose events
// that day carry no $os_name counts in `total` only.

import {labExclusionSQL} from '../../lib/lab-exclusion.mjs';
import {addDays, cell, dayRange, laDaySQL, laDaysWhere} from '../lib/rules.mjs';

export const name = 'active';
export const required = true;
export const DAYS = 120;
export const PLATFORMS = ['total', 'iOS', 'Android'];

const series = {
  type: 'object',
  required: ['dau', 'wau', 'mau'],
  additionalProperties: false,
  properties: Object.fromEntries(
    ['dau', 'wau', 'mau'].map(k => [
      k,
      {
        type: 'array',
        items: {$ref: '#/$defs/cell'},
        minItems: DAYS,
        maxItems: DAYS,
      },
    ]),
  ),
};

export const schema = {
  type: 'object',
  required: ['days', 'definition', ...PLATFORMS],
  additionalProperties: false,
  properties: {
    days: {
      type: 'array',
      items: {$ref: '#/$defs/laDate'},
      minItems: DAYS,
      maxItems: DAYS,
    },
    definition: {type: 'string'},
    total: series,
    iOS: series,
    Android: series,
  },
};

/** The HogQL query: one row per (day, platform), platform 'total' included. */
export function activeQuery(to, asOfWhere = 'true', days = DAYS) {
  const from = addDays(to, -(days - 1));
  const scanFrom = addDays(from, -29); // MAU looks back 30 days
  return `SELECT d, platform,
       uniqIf(person_id, day = d) AS dau,
       uniqIf(person_id, day > d - 7) AS wau,
       uniq(person_id) AS mau
     FROM (
       SELECT person_id, day, arrayJoin(['total', os]) AS platform
       FROM (
         SELECT person_id, ${laDaySQL()} AS day,
                multiIf(min(properties.$os_name) IN ('iOS', 'iPadOS'), 'iOS',
                        min(properties.$os_name) = 'Android', 'Android', 'unknown') AS os
         FROM events
         WHERE ${laDaysWhere(scanFrom, to)} AND ${asOfWhere} AND ${labExclusionSQL()}
         GROUP BY person_id, day
       )
     )
     ARRAY JOIN arrayMap(i -> toDate('${to}') - i, range(${days})) AS d
     WHERE day <= d AND day > d - 30
     GROUP BY d, platform
     ORDER BY d, platform`;
}

/** Rows [d, platform, dau, wau, mau] → the section data. */
export function shape(rows, to, days = DAYS) {
  const dates = dayRange(addDays(to, -(days - 1)), to);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const empty = () => ({
    dau: dates.map(() => 0),
    wau: dates.map(() => 0),
    mau: dates.map(() => 0),
  });
  const out = {total: empty(), iOS: empty(), Android: empty()};
  for (const [d, platform, dau, wau, mau] of rows) {
    const i = idx.get(String(d).slice(0, 10));
    const s = out[platform];
    if (i === undefined || !s) continue; // 'unknown' counts in total only
    s.dau[i] = Number(dau);
    s.wau[i] = Number(wau);
    s.mau[i] = Number(mau);
  }
  for (const p of PLATFORMS)
    for (const k of ['dau', 'wau', 'mau']) out[p][k] = out[p][k].map(cell);
  return {
    days: dates,
    definition:
      'distinct installs with any event on the LA day (dau), in the 7 LA days ending that day (wau), in the 30 LA days ending that day (mau); rolling windows; any event counts; all versions, lab excluded, events received by asOf; platform = min($os_name) that day, iPadOS = iOS; an install with no $os_name that day counts in total only',
    ...out,
  };
}

export async function collect(ctx) {
  const rows = await ctx.hogql(activeQuery(ctx.dataThrough, ctx.asOfSQL), {
    limit: DAYS * 4 + 10,
  });
  return {
    status: 'ok',
    source: 'PostHog HogQL',
    data: shape(rows, ctx.dataThrough),
  };
}
