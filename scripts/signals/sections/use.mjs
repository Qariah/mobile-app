// @ai
//
// Signals snapshot section `use`: how much the app is used, for each LA
// calendar day, 120 days to dataThrough, and in total for the 30 LA days that
// end on dataThrough.
//
//   events    the count of the event on the day (every occurrence)
//   installs  distinct installs that sent the event on the day
//
// Five events, the same as the card's USE block plus `mushaf_page_read`:
//   playback_started    a recitation starts (once per track)
//   meaningful_listen   10% of the track or 30 s, whichever is smaller   (core)
//   playback_completed  the track played to its end                      (core)
//   mushaf_page_opened  a Mushaf page opens
//   mushaf_page_read    a Mushaf page stays visible for 15 s or more      (core)
//
// `core: true` marks the three "the app did its job" events of
// rollout-engagement.mjs (engagement.coreValueEvents). All versions, lab
// devices excluded, as the card's USE block. The card uses trailing windows at
// run time; this section uses calendar days and only the events that PostHog
// received by ctx.asOf, so a rerun of a date gives the same numbers. A day with
// no event has 0 events and 0 installs.

import {labExclusionSQL, sqlList} from '../../lib/lab-exclusion.mjs';
import {
  addDays,
  cell,
  dayRange,
  eventCell,
  laDaySQL,
  laDaysWhere,
} from '../lib/rules.mjs';

export const name = 'use';
export const required = true;
export const DAYS = 120;
export const TRAILING_DAYS = 30;
export const EVENTS = [
  'playback_started',
  'meaningful_listen',
  'playback_completed',
  'mushaf_page_opened',
  'mushaf_page_read',
];
export const CORE = [
  'meaningful_listen',
  'mushaf_page_read',
  'playback_completed',
];
const TRAILING_KEY = 'last30d';

const daily = {
  type: 'object',
  required: ['events', 'installs'],
  additionalProperties: false,
  properties: {
    events: {
      type: 'array',
      items: {$ref: '#/$defs/eventCell'},
      minItems: DAYS,
      maxItems: DAYS,
    },
    installs: {
      type: 'array',
      items: {$ref: '#/$defs/cell'},
      minItems: DAYS,
      maxItems: DAYS,
    },
  },
};

const total = {
  type: 'object',
  required: ['events', 'installs', 'core'],
  additionalProperties: false,
  properties: {
    events: {$ref: '#/$defs/eventCell'},
    installs: {$ref: '#/$defs/cell'},
    core: {type: 'boolean'},
  },
};

const byEvent = item => ({
  type: 'object',
  required: EVENTS,
  additionalProperties: false,
  properties: Object.fromEntries(EVENTS.map(e => [e, item])),
});

export const schema = {
  type: 'object',
  required: ['days', 'definition', 'daily', 'last30d'],
  additionalProperties: false,
  properties: {
    days: {
      type: 'array',
      items: {$ref: '#/$defs/laDate'},
      minItems: DAYS,
      maxItems: DAYS,
    },
    definition: {type: 'string'},
    daily: byEvent(daily),
    last30d: {
      type: 'object',
      required: ['from', 'to', 'events'],
      additionalProperties: false,
      properties: {
        from: {$ref: '#/$defs/laDate'},
        to: {$ref: '#/$defs/laDate'},
        events: byEvent(total),
      },
    },
  },
};

/**
 * The HogQL query: one row per (event, bucket). A bucket is an LA day
 * ('YYYY-MM-DD'), or 'last30d' for the 30 LA days that end on `to`.
 */
export function usageQuery(to, asOfWhere = 'true', days = DAYS) {
  const from = addDays(to, -(days - 1));
  const from30 = addDays(to, -(TRAILING_DAYS - 1));
  return `SELECT event, bucket, count() AS events, uniqExact(person_id) AS installs
     FROM (
       SELECT event, person_id, ${laDaySQL()} AS day
       FROM events
       WHERE ${laDaysWhere(from, to)} AND ${asOfWhere} AND event IN (${sqlList(EVENTS)}) AND ${labExclusionSQL()}
     )
     ARRAY JOIN if(day >= toDate('${from30}'), [toString(day), '${TRAILING_KEY}'], [toString(day)]) AS bucket
     GROUP BY event, bucket
     ORDER BY event, bucket`;
}

/** Rows [event, bucket, events, installs] → the section data. */
export function shape(rows, to, days = DAYS) {
  const dates = dayRange(addDays(to, -(days - 1)), to);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const raw = Object.fromEntries(
    EVENTS.map(e => [
      e,
      {
        events: dates.map(() => 0),
        installs: dates.map(() => 0),
        total: {events: 0, installs: 0},
      },
    ]),
  );
  for (const [event, bucket, events, installs] of rows) {
    const r = raw[event];
    if (!r) continue;
    if (bucket === TRAILING_KEY) {
      r.total = {events: Number(events), installs: Number(installs)};
      continue;
    }
    const i = idx.get(String(bucket).slice(0, 10));
    if (i === undefined) continue;
    r.events[i] = Number(events);
    r.installs[i] = Number(installs);
  }
  const dailyOut = {};
  const totals = {};
  for (const e of EVENTS) {
    const r = raw[e];
    dailyOut[e] = {
      events: r.events.map((n, i) => eventCell(n, r.installs[i])),
      installs: r.installs.map(cell),
    };
    totals[e] = {
      events: eventCell(r.total.events, r.total.installs),
      installs: cell(r.total.installs),
      core: CORE.includes(e),
    };
  }
  return {
    days: dates,
    definition:
      'for each LA day: the count of each event (events) and the distinct installs that sent it (installs); ' +
      `last30d: the same over the ${TRAILING_DAYS} LA days that end on dataThrough (installs are distinct over the whole window). ` +
      'core = meaningful_listen, mushaf_page_read and playback_completed (rollout-engagement coreValueEvents). ' +
      'All versions, lab excluded, events received by asOf; an event count is "<5" when 1 to 4 installs sent it',
    daily: dailyOut,
    last30d: {from: addDays(to, -(TRAILING_DAYS - 1)), to, events: totals},
  };
}

export async function collect(ctx) {
  const rows = await ctx.hogql(usageQuery(ctx.dataThrough, ctx.asOfSQL), {
    limit: EVENTS.length * (DAYS + 1) + 10,
  });
  return {
    status: 'ok',
    source: 'PostHog HogQL',
    data: shape(rows, ctx.dataThrough),
  };
}
