// @ai
//
// Signals snapshot section `funnel`: how far each install got, over its whole
// life to dataThrough. Two populations, each in total and by platform:
//
//   all     every install from the first organic event to dataThrough
//   aged30  installs first seen at least 30 days before the end of
//           dataThrough: day 0 (the LA day of the first organic event) <=
//           dataThrough - 30. For them the 30-day window below does not hold
//           day 0, so "still monthly active" means they came back.
//
// The steps (an install counts in a step when it EVER sent the event):
//
//   installed          Application Installed
//   opened             cold_start_began
//   pastLoading        splash_hidden or screen_content_rendered (the Daily card's
//                      "past_loading" condition)
//   loggedIn           sign_in_succeeded
//   loggedInCardRule   extra: the Daily card's rule, sign_in_succeeded or
//                      onboarding_completed with signed_in = true
//   started            extra: playback_started or mushaf_page_opened
//   reallyUsed         extra: any of meaningful_listen, mushaf_page_read,
//                      playback_completed; the three also as their own rows
//   mau                any event in the 30 LA days that end on dataThrough
//                      ("still monthly active")
//   churned            no event in those 30 days (installs - mau)
//
// The step events are the reference definitions of 2026-10-18
// (engagement-mockup research, posthog.json funnel.definitions), except
// pastLoading, which since 2026-10-20 is the Daily card's "past_loading"
// condition (a first screen rendered). It and the extras
// loggedInCardRule, started and reallyUsed use the Daily card's journey
// conditions (scripts/daily-card.mjs STEPS); the test checks that they stay
// the same. An event that came later than an install is missing for that
// install: `definitions` gives each step event's first organic day (the
// instrumentation start).
//
// One install = one person_id; its platform is its first non-null $os_name by
// timestamp (iPadOS counts as iOS; none = unknown). All versions, lab devices
// excluded, events received by ctx.asOf.

import {labExclusionSQL, sqlList} from '../../lib/lab-exclusion.mjs';
import {addDays, cell, laDaySQL, laDaysWhere} from '../lib/rules.mjs';

export const name = 'funnel';
export const required = false;

// The PostHog project holds no event before 2026-05-07 UTC (checked
// 2026-10-18), so a scan from this date sees every install.
export const SCAN_FROM = '2026-05-01';
export const AGED_DAYS = 30;
export const MAU_DAYS = 30;
export const PLATFORMS = ['iOS', 'Android', 'unknown'];
export const POPULATIONS = ['all', 'aged30'];
const SIGNED_IN_ONBOARDING =
  "(event = 'onboarding_completed' AND properties.signed_in = true)";
const CORE = ['meaningful_listen', 'mushaf_page_read', 'playback_completed'];

/**
 * The event steps, in the owner's order. `card` names the Daily card step
 * (scripts/daily-card.mjs STEPS) whose condition this step reuses exactly.
 */
export const EVENT_STEPS = [
  {key: 'installed', label: 'Installed', events: ['Application Installed']},
  {key: 'opened', label: 'Opened', events: ['cold_start_began']},
  {
    key: 'pastLoading',
    label: 'Past loading',
    card: 'past_loading',
    events: ['splash_hidden', 'screen_content_rendered'],
  },
  {key: 'loggedIn', label: 'Logged in', events: ['sign_in_succeeded']},
  {
    key: 'loggedInCardRule',
    label: 'Logged in (card rule)',
    extra: true,
    card: 'logged_in',
    events: ['sign_in_succeeded'],
    or: SIGNED_IN_ONBOARDING,
  },
  {
    key: 'started',
    label: 'Started',
    extra: true,
    card: 'started',
    events: ['playback_started', 'mushaf_page_opened'],
  },
  {
    key: 'reallyUsed',
    label: 'Really used',
    extra: true,
    card: 'used_it',
    events: CORE,
  },
  {
    key: 'meaningfulListen',
    label: 'Really used: listened',
    extra: true,
    events: ['meaningful_listen'],
  },
  {
    key: 'mushafPageRead',
    label: 'Really used: read a page',
    extra: true,
    events: ['mushaf_page_read'],
  },
  {
    key: 'playbackCompleted',
    label: 'Really used: finished a recitation',
    extra: true,
    events: ['playback_completed'],
  },
];
export const stepCond = s =>
  [`event IN (${sqlList(s.events)})`, s.or].filter(Boolean).join(' OR ');

/** Every row of the section, in order; `extra` rows show in the Use view. */
export const STEPS = [
  ...EVENT_STEPS.map(({key, label, extra = false}) => ({key, label, extra})),
  {key: 'mau', label: 'Still monthly active', extra: false},
  {key: 'churned', label: 'Churned', extra: false},
];
const STEP_KEYS = STEPS.map(s => s.key);

const counts = {
  type: 'object',
  required: ['installs', 'steps'],
  additionalProperties: false,
  properties: {
    installs: {$ref: '#/$defs/cell'},
    steps: {
      type: 'array',
      minItems: STEPS.length,
      maxItems: STEPS.length,
      items: {
        type: 'object',
        required: ['key', 'installs'],
        additionalProperties: false,
        properties: {key: {enum: STEP_KEYS}, installs: {$ref: '#/$defs/cell'}},
      },
    },
  },
};
const population = {
  type: 'object',
  required: ['total', 'byPlatform'],
  additionalProperties: false,
  properties: {
    total: counts,
    byPlatform: {
      type: 'object',
      required: PLATFORMS,
      additionalProperties: false,
      properties: Object.fromEntries(PLATFORMS.map(p => [p, counts])),
    },
  },
};

export const schema = {
  type: 'object',
  required: ['through', 'steps', 'definitions', ...POPULATIONS],
  additionalProperties: false,
  properties: {
    through: {$ref: '#/$defs/laDate'},
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label', 'extra'],
        additionalProperties: false,
        properties: {
          key: {enum: STEP_KEYS},
          label: {type: 'string'},
          extra: {type: 'boolean'},
        },
      },
    },
    definitions: {type: 'object', additionalProperties: {type: 'string'}},
    all: population,
    aged30: population,
  },
};

const OS = 'properties.$os_name';

/** The HogQL query: one row per (population, platform), platform 'total' included. */
export function funnelQuery(to, asOfWhere = 'true') {
  const agedCut = addDays(to, -AGED_DAYS);
  const mauFrom = addDays(to, -(MAU_DAYS - 1));
  const cols = EVENT_STEPS.map(s => `countIf(${stepCond(s)}) AS ${s.key}`).join(
    ',\n                ',
  );
  const reach = EVENT_STEPS.map(s => `countIf(${s.key} > 0) AS ${s.key}`).join(
    ',\n       ',
  );
  return `SELECT pop, plat, count() AS installs,
       ${reach},
       countIf(last_day >= toDate('${mauFrom}')) AS mau
     FROM (
       SELECT *, arrayJoin(if(day0 <= toDate('${agedCut}'), ['all', 'aged30'], ['all'])) AS pop,
              arrayJoin(['total', multiIf(os0 IN ('iOS', 'iPadOS'), 'iOS', os0 = 'Android', 'Android', 'unknown')]) AS plat
       FROM (
         SELECT person_id, min(${laDaySQL()}) AS day0, max(${laDaySQL()}) AS last_day,
                argMinIf(${OS}, timestamp, notEmpty(ifNull(${OS}, ''))) AS os0,
                ${cols}
         FROM events
         WHERE ${laDaysWhere(SCAN_FROM, to)} AND ${asOfWhere} AND ${labExclusionSQL()}
         GROUP BY person_id
       )
     )
     GROUP BY pop, plat
     ORDER BY pop, plat`;
}

/** The first organic LA day of each step event (the instrumentation start, for the definitions). */
export function firstSeenQuery(to, asOfWhere = 'true') {
  const events = [
    ...new Set([...EVENT_STEPS.flatMap(s => s.events), 'onboarding_completed']),
  ];
  return `SELECT ev, toString(min(day)) AS first_day
     FROM (
       SELECT ${laDaySQL()} AS day,
              if(event = 'onboarding_completed', if(properties.signed_in = true, 'onboarding_completed:signed_in', ''), event) AS ev
       FROM events
       WHERE ${laDaysWhere(SCAN_FROM, to)} AND ${asOfWhere} AND event IN (${sqlList(events)}) AND ${labExclusionSQL()}
     )
     WHERE ev != ''
     GROUP BY ev`;
}

const num = v => Number(v) || 0;

/**
 * rows: [pop, plat, installs, ...one count per EVENT_STEPS, mau];
 * first: [event, firstDay].
 */
export function shape(rows, first, to) {
  const firstDay = new Map(
    first.map(([e, d]) => [String(e), String(d).slice(0, 10)]),
  );
  const raw = {};
  for (const r of rows) {
    const [pop, plat] = r;
    const [installs, ...vals] = r.slice(2).map(num);
    const steps = Object.fromEntries(
      EVENT_STEPS.map((s, i) => [s.key, vals[i]]),
    );
    (raw[pop] ||= {})[plat] = {installs, steps, mau: vals[EVENT_STEPS.length]};
  }
  const countsOf = r => {
    const c = r || {installs: 0, steps: {}, mau: 0};
    const value = k =>
      k === 'mau'
        ? c.mau
        : k === 'churned'
          ? c.installs - c.mau
          : c.steps[k] || 0;
    return {
      installs: cell(c.installs),
      steps: STEPS.map(s => ({key: s.key, installs: cell(value(s.key))})),
    };
  };
  const popOut = p => ({
    total: countsOf(raw[p]?.total),
    byPlatform: Object.fromEntries(
      PLATFORMS.map(pl => [pl, countsOf(raw[p]?.[pl])]),
    ),
  });

  // "first organic event: cold_start_began 2026-06-17".
  const since = events =>
    `first organic event: ${events
      .map(
        e =>
          `${e.replace(':signed_in', ' (signed_in)')} ${firstDay.get(e) || 'none yet'}`,
      )
      .join(', ')}`;
  const stepDefs = Object.fromEntries(
    EVENT_STEPS.map(s => {
      const evs = [
        ...s.events,
        ...(s.or ? ['onboarding_completed:signed_in'] : []),
      ];
      const what = `ever sent ${s.events.join(' or ')}${s.or ? ', or onboarding_completed with signed_in = true' : ''}`;
      const extra = s.extra ? 'extra row: ' : '';
      const card = s.card ? ` — the Daily card's "${s.card}" condition` : '';
      return [s.key, `${extra}${what}${card} (${since(evs)})`];
    }),
  );
  stepDefs.loggedIn +=
    ' — a floor: PostHog does not see a sign-in from an older build';
  return {
    through: to,
    steps: STEPS,
    definitions: {
      install:
        'one PostHog person_id (the app never calls identify()); all versions, lab excluded, events received by asOf',
      all: `every install with an organic event from the first organic event to ${to}`,
      aged30: `installs first seen at least 30 days before the end of ${to}: day 0 (the LA day of the first organic event) on or before ${addDays(to, -AGED_DAYS)}`,
      byPlatform:
        'the first non-null $os_name of the install by timestamp; iPadOS counts as iOS; no $os_name = unknown',
      ...stepDefs,
      mau: `still monthly active: any event from ${addDays(to, -(MAU_DAYS - 1))} to ${to} (the 30 LA days that end on through)`,
      churned: 'installs with no event in those 30 days (installs - mau)',
      firstOrganicEvent:
        'the first LA day on which a non-lab install sent the event (the instrumentation start); an install that was active only before that day cannot reach the step',
    },
    all: popOut('all'),
    aged30: popOut('aged30'),
  };
}

export async function collect(ctx) {
  const rows = await ctx.hogql(funnelQuery(ctx.dataThrough, ctx.asOfSQL), {
    limit: 100,
  });
  // The second query only labels the definitions; it runs after the first so
  // that this section holds one PostHog slot at a time.
  const first = await ctx.hogql(firstSeenQuery(ctx.dataThrough, ctx.asOfSQL), {
    limit: 100,
  });
  return {
    status: 'ok',
    source: 'PostHog HogQL',
    data: shape(rows, first, ctx.dataThrough),
  };
}
