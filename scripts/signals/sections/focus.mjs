// @ai
//
// Signals snapshot section `focus`: the measures that the brief's focus names
// (docs/operations/brief-focus.json), computed for each build. Numbers only:
// the verdict is Phase 2.
//
// Four kinds of focus:
//
//   metric      one metric against a limit (planning/signals-anr-listens-
//               design.md, section 2). Today only playAnrRate on Android:
//               Play's user-perceived ANR rate for the production
//               versionCodes pooled (active-rollout.json card.builds): the
//               last day, the 7-day and 28-day rates, the daily rates of the
//               last 28 Play days and Play's data date (one Play request,
//               scripts/lib/anr-card.mjs fetchPlayAnr); our users who froze
//               this week and last week on Android (the card section's
//               anr.sentry.week); and ended = Play data no older than 7 days, and the 28-day rate, rounded to 4
//               decimals, is below the limit. data.metric holds it; data.measures is empty.
//   rollout     versionCodes (+ releases): one entry per build for
//     playAnrRate      Play user-perceived ANR rate: day, user-weighted 7d and
//                      28d, and the daily rate (scripts/play-vitals.mjs --json)
//     playUsers        Play distinct users, daily and on Play's last day
//     sentryAnrUsers   Sentry users with ApplicationNotResponding, and session
//                      users, daily and over 7 days, for each release
//     posthogActive7d  PostHog installs active on each LA day (dau) and in the
//                      7 LA days that end on it (wau), lab excluded
//   incident    sentryIssue: users and events of that Sentry issue per day
//   experiment  the card's A/B block: the arms and their ANR shares
//
// DAYS. PostHog and Play use the 14 LA days that end at dataThrough (Play
// aggregates DAILY in America/Los_Angeles). Play publishes with a lag of 2 to 5
// days: a day it has not published is null, not 0, and `dataThrough` of the
// measure names Play's last day. Sentry buckets are UTC days, and a distinct
// user count cannot be re-cut into LA days, so the Sentry measures carry their
// own `days`: 14 complete UTC days that end at dataThrough at the latest.
// PostHog counts only the events received by ctx.asOf (data.asOf), so a rerun
// of a date gives the same numbers. data.measuredAt = when the section ran.
//
// Play gives its rates without a numerator, so they stay plain numbers (0 to
// 1). Play does not publish a slice below its own privacy floor (about 50
// users a day). The 7d and 28d rates weight each day by its users, as Play
// defines userPerceivedAnrRate7dUserWeighted; a window needs half its days
// published (pooledRate in scripts/lib/anr-card.mjs).

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fetchPlayAnr, pooledRate} from '../../lib/anr-card.mjs';
import {cardBuilds} from '../../lib/card-layout.mjs';
import {labExclusionSQL, sqlList} from '../../lib/lab-exclusion.mjs';
import {
  addDays,
  cell,
  dayRange,
  daysBetween,
  eventCell,
  laDaySQL,
  laDaysWhere,
  rate,
} from '../lib/rules.mjs';

// A thrown text that is safe to keep in the data (a fixed text of this file).
const fixedError = msg => Object.assign(new Error(msg), {fixedText: true});

export const name = 'focus';
export const required = false;
// The experiment kind reads the card's A/B block.
export const after = ['card'];
export const FOCUS_FILE = 'docs/operations/brief-focus.json';
export const DAYS = 14;
export const MEASURES = {
  rollout: ['playAnrRate', 'playUsers', 'sentryAnrUsers', 'posthogActive7d'],
  incident: ['sentryIssueDaily'],
  experiment: ['abArms'],
  // A metric focus names no measures: `metric` names the one metric.
  metric: [],
};
export const KINDS = Object.keys(MEASURES);
// The metrics that a metric focus can name, and the platform of each.
export const METRICS = {playAnrRate: {platform: 'Android'}};
// The daily rates of the metric focus: the newest Play days.
export const METRIC_DAYS = 28;
export const PLAY_ARGS = [
  'scripts/play-vitals.mjs',
  'rates',
  '--dims=versionCode',
  '--metric=anr',
  '--days=35',
  '--json',
];

export const DEFINITIONS = {
  playAnrRate:
    "Google Play userPerceivedAnrRate for each versionCode (Play Developer Reporting API through play-vitals.mjs --json): day = the rate on Play's last published day; d7 and d28 = the daily rates of the 7 and 28 days that end on it, weighted by distinct users (null when fewer than half the days are published); dailyRate = the rate on each LA day of `days` (null = not published)",
  playUsers:
    "Google Play distinct users of each versionCode: users = on Play's last published day (Play rounds distinct users); dailyUsers = on each LA day of `days` (null = not published)",
  sentryAnrUsers:
    'Sentry, environment production, for each release: anrUsers = distinct users with error.type ApplicationNotResponding on each UTC day of the measure `days`; sessionUsers = distinct session users on that day; weekAnrUsers and weekSessionUsers = distinct users over the last 7 of those days; weekAnrShare = weekAnrUsers / weekSessionUsers',
  posthogActive7d:
    'PostHog installs (person_id, lab excluded) with any event on the build: dau = on each LA day of `days`; wau = in the 7 LA days that end on that day',
  sentryIssueDaily:
    'Sentry, all environments: users = distinct users of the issue on each UTC day of the measure `days`; events = its events on that day',
  abArms:
    'the card section A/B block: the arms count enrolled devices only; anrShare = anrDevices / devices of the arm',
  metric:
    "kind metric, playAnrRate: Google Play userPerceivedAnrRate for the production versionCodes (active-rollout.json card.builds, Android) pooled into one rate by Play (Play Developer Reporting API, filter versionCode = A OR versionCode = B): day = the rate on Play's last published day (dataThrough); d7 and d28 = Play's userPerceivedAnrRate7dUserWeighted and 28dUserWeighted on that day; daily = the rate on each of the 28 days that end at dataThrough (null = not published). frozeWeek = the card section's anr.sentry.week for Android (users who froze in the last 7 complete UTC days and the 7 days before, with the card's verdict; null when it is missing or unavailable). ended = Play's data date is no more than 7 days before the run date, and d28 rounded to 4 decimals is below the limit (false while d28 is null)",
};

// ---------------------------------------------------------------------------
// The focus file
// ---------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SHORT_ID = /^[A-Z0-9]+-[A-Z0-9]+$/;

/** Check a focus file. Returns a list of problems (empty = valid). */
export function focusProblems(f) {
  const p = [];
  if (!f || typeof f !== 'object')
    return ['the focus file is not a JSON object'];
  if (!MEASURES[f.kind]) p.push(`kind must be one of ${KINDS.join(', ')}`);
  for (const k of ['title', 'endCondition', 'setBy'])
    if (typeof f[k] !== 'string' || !f[k].trim()) p.push(`${k} must be a text`);
  if (!ISO.test(String(f.setAt || ''))) p.push('setAt must be YYYY-MM-DD');
  if (f.kind === 'metric') {
    const m = METRICS[f.metric];
    if (!m) p.push(`metric must be one of ${Object.keys(METRICS).join(', ')}`);
    else if (f.platform !== m.platform)
      p.push(`platform of ${f.metric} must be ${m.platform}`);
    if (!(typeof f.limit === 'number' && f.limit > 0 && f.limit < 1))
      p.push('limit must be a share between 0 and 1, e.g. 0.0047');
    return p;
  }
  if (!Array.isArray(f.measures) || !f.measures.length)
    p.push('measures must be a non-empty list');
  else
    for (const m of f.measures)
      if (!m || !(MEASURES[f.kind] || []).includes(m.id))
        p.push(
          `measure ${m?.id} is not a ${f.kind} measure (${(MEASURES[f.kind] || []).join(', ')})`,
        );
  if (f.kind === 'rollout') {
    const vc = f.versionCodes;
    if (!Array.isArray(vc) || !vc.length || !vc.every(Number.isInteger))
      p.push('versionCodes must be a non-empty list of integers');
  }
  if (f.kind === 'incident' && !SHORT_ID.test(String(f.sentryIssue || '')))
    p.push('sentryIssue must be a Sentry short id, e.g. QARIAHV2-20');
  return p;
}

// ---------------------------------------------------------------------------
// PostHog: installs active per build
// ---------------------------------------------------------------------------

/**
 * asOfWhere = ctx.asOfSQL, the ingestion cut-off (lib/rules.mjs): a rerun of
 * the same date gives the same numbers.
 */
export function posthogActiveQuery(
  builds,
  to,
  asOfWhere = 'true',
  days = DAYS,
) {
  const from = addDays(to, -(days - 1));
  return `SELECT build, d, uniqIf(person_id, day = d) AS dau, uniq(person_id) AS wau
     FROM (
       SELECT person_id, toString(properties.$app_build) AS build, ${laDaySQL()} AS day
       FROM events
       WHERE ${laDaysWhere(addDays(from, -6), to)} AND ${asOfWhere}
         AND properties.$app_build IN (${sqlList(builds)}) AND ${labExclusionSQL()}
       GROUP BY person_id, build, day
     )
     ARRAY JOIN arrayMap(i -> toDate('${to}') - i, range(${days})) AS d
     WHERE day <= d AND day > d - 7
     GROUP BY build, d
     ORDER BY build, d`;
}

/** Rows [build, d, dau, wau] → perBuild with series aligned to `dates`. */
export function shapePosthog(rows, builds, dates) {
  const idx = new Map(dates.map((d, i) => [d, i]));
  const per = new Map(
    builds.map(b => [
      b,
      {build: b, dau: dates.map(() => 0), wau: dates.map(() => 0)},
    ]),
  );
  for (const [build, d, dau, wau] of rows) {
    const e = per.get(String(build));
    const i = idx.get(String(d).slice(0, 10));
    if (!e || i === undefined) continue;
    e.dau[i] = Number(dau) || 0;
    e.wau[i] = Number(wau) || 0;
  }
  return builds.map(b => {
    const e = per.get(b);
    return {build: b, dau: e.dau.map(cell), wau: e.wau.map(cell)};
  });
}

// ---------------------------------------------------------------------------
// Play: rate and users per versionCode
// ---------------------------------------------------------------------------

/**
 * play-vitals.mjs rates --json → {dataThrough, rate: perBuild, users: perBuild}.
 * Throws when the ANR set is missing or failed.
 */
export function shapePlay(out, builds, dates) {
  const set = (out?.sets || []).find(s => s.kind === 'anr');
  if (!set) throw fixedError('play-vitals sent no anr set');
  if (set.error) throw fixedError('the Play request failed');
  const rows = set.rows || [];
  const last = rows.reduce((a, r) => (r.date > a ? r.date : a), '');
  const by = new Map(builds.map(b => [b, new Map()]));
  for (const r of rows) {
    const m = by.get(String(r.dims?.versionCode));
    if (m) m.set(r.date, {rate: r.rate, users: r.users});
  }
  const window28 = last ? dayRange(addDays(last, -27), last) : [];
  const rateOut = [];
  const usersOut = [];
  for (const b of builds) {
    const m = by.get(b);
    const at = d => m.get(d) || null;
    const days = window28.map(d => {
      const v = at(d);
      const ok = !!v && v.rate !== null && Number(v.users) > 0;
      return {
        date: d,
        hit: ok ? v.rate * v.users : 0,
        active: ok ? Number(v.users) : 0,
        observed: ok,
      };
    });
    const lastRow = last ? at(last) : null;
    rateOut.push({
      build: b,
      day: lastRow?.rate ?? null,
      d7: window28.length ? pooledRate(days, 7) : null,
      d28: window28.length ? pooledRate(days, 28) : null,
      dailyRate: dates.map(d => at(d)?.rate ?? null),
    });
    usersOut.push({
      build: b,
      users: lastRow?.users == null ? null : cell(lastRow.users),
      dailyUsers: dates.map(d =>
        at(d)?.users == null ? null : cell(at(d).users),
      ),
    });
  }
  return {dataThrough: last || null, rate: rateOut, users: usersOut};
}

// ---------------------------------------------------------------------------
// Sentry
// ---------------------------------------------------------------------------

/** The last complete UTC day, but never after dataThrough. */
export function sentryEnd(dataThrough, now = new Date()) {
  const utcYesterday = addDays(now.toISOString().slice(0, 10), -1);
  return utcYesterday < dataThrough ? utcYesterday : dataThrough;
}

/** events-stats {data: [[ts, [{count}]]]} → Map(date → count). */
export const statsByDate = j =>
  new Map(
    (j?.data || []).map(([t, v]) => [
      new Date(Number(t) * 1000).toISOString().slice(0, 10),
      Number(v?.[0]?.count) || 0,
    ]),
  );

/** sessions {intervals, groups} → Map(release → Map(date → users)) and totals. */
export function sessionsByRelease(j) {
  const dates = (j?.intervals || []).map(t => String(t).slice(0, 10));
  const daily = new Map();
  const totals = new Map();
  for (const g of j?.groups || []) {
    const rel = g.by?.release;
    if (!rel) continue;
    const s = g.series?.['count_unique(user)'] || [];
    daily.set(rel, new Map(dates.map((d, i) => [d, Number(s[i]) || 0])));
    totals.set(rel, Number(g.totals?.['count_unique(user)']) || 0);
  }
  return {daily, totals};
}

const enc = encodeURIComponent;
const utcStart = d => `${d}T00:00:00`;

async function sentryAnrMeasure(s, focus, end) {
  const days = dayRange(addDays(end, -(DAYS - 1)), end);
  const weekFrom = addDays(end, -6);
  const span = `&start=${utcStart(days[0])}&end=${utcStart(addDays(end, 1))}&interval=1d`;
  const week = `&start=${utcStart(weekFrom)}&end=${utcStart(addDays(end, 1))}`;
  const org = `/organizations/${s.org}`;
  const sess = sessionsByRelease(
    await s.call(
      `${org}/sessions/?field=${enc('count_unique(user)')}&groupBy=release&project=-1&environment=production${span}`,
    ),
  );
  const sessWeek = sessionsByRelease(
    await s.call(
      `${org}/sessions/?field=${enc('count_unique(user)')}&groupBy=release&project=-1&environment=production${week}&interval=1d`,
    ),
  );
  const perBuild = [];
  for (const vc of focus.versionCodes.map(String)) {
    const release = focus.releases?.[vc];
    if (!release) {
      perBuild.push({
        build: vc,
        release: null,
        anrUsers: days.map(() => null),
        sessionUsers: days.map(() => null),
        weekAnrUsers: null,
        weekSessionUsers: null,
        weekAnrShare: null,
      });
      continue;
    }
    const q = enc(
      `environment:production error.type:ApplicationNotResponding release:"${release}"`,
    );
    const anr = statsByDate(
      await s.call(
        `${org}/events-stats/?yAxis=${enc('count_unique(user)')}&dataset=errors&project=-1&query=${q}${span}`,
      ),
    );
    const weekJ = await s.call(
      `${org}/events/?field=${enc('count_unique(user)')}&dataset=errors&project=-1&query=${q}${week}`,
    );
    const weekAnr = Number(weekJ?.data?.[0]?.['count_unique(user)']) || 0;
    const sd = sess.daily.get(release) || new Map();
    const weekSess = sessWeek.totals.get(release) ?? 0;
    perBuild.push({
      build: vc,
      release,
      anrUsers: days.map(d => (anr.has(d) ? cell(anr.get(d)) : null)),
      sessionUsers: days.map(d => (sd.has(d) ? cell(sd.get(d)) : null)),
      weekAnrUsers: cell(weekAnr),
      weekSessionUsers: cell(weekSess),
      weekAnrShare: rate(weekAnr, weekSess),
    });
  }
  return {days, perBuild};
}

async function sentryIssueMeasure(s, issue, end) {
  const days = dayRange(addDays(end, -(DAYS - 1)), end);
  const span = `&start=${utcStart(days[0])}&end=${utcStart(addDays(end, 1))}&interval=1d`;
  const q = enc(`issue:${issue}`);
  const org = `/organizations/${s.org}`;
  const users = statsByDate(
    await s.call(
      `${org}/events-stats/?yAxis=${enc('count_unique(user)')}&dataset=errors&project=-1&query=${q}${span}`,
    ),
  );
  const events = statsByDate(
    await s.call(
      `${org}/events-stats/?yAxis=${enc('count()')}&dataset=errors&project=-1&query=${q}${span}`,
    ),
  );
  return shapeIssue(days, users, events);
}

export function shapeIssue(days, users, events) {
  return {
    days,
    users: days.map(d => (users.has(d) ? cell(users.get(d)) : null)),
    events: days.map(d =>
      events.has(d) ? eventCell(events.get(d), users.get(d) ?? 0) : null,
    ),
  };
}

// ---------------------------------------------------------------------------
// Experiment: the card's A/B block
// ---------------------------------------------------------------------------

export function shapeAbArms(ab) {
  if (!ab)
    throw fixedError('the card section has no A/B block (no active A/B)');
  if (ab.available === false)
    throw fixedError('the A/B query of the card failed');
  const arm = g => ({
    devices: g.devices,
    anrDevices: g.anrDevices,
    stalledDevices: g.stalledDevices,
    noBootDevices: g.noBootDevices,
    anrShare: rate(g.anrDevices, g.devices),
  });
  return {
    build: ab.build,
    flag: ab.flag,
    users: ab.users,
    enrolled: ab.enrolled,
    arms: {treatment: arm(ab.arms.treatment), control: arm(ab.arms.control)},
  };
}

// ---------------------------------------------------------------------------
// Metric: one metric against a limit
// ---------------------------------------------------------------------------

/** The Android production versionCodes of active-rollout.json card.builds. */
export const productionCodes = cfg =>
  [
    ...new Set(
      cardBuilds(cfg)
        .filter(b => b.platform === 'Android')
        .map(b => Number(b.build))
        .filter(Number.isInteger),
    ),
  ].sort((a, b) => a - b);

/**
 * fetchPlayAnr() output (seriesDays 28) → the Play part of data.metric:
 * {dataThrough, day, d7, d28, daily}. daily has one entry for each of the
 * METRIC_DAYS days that end at Play's last day; a day that Play did not
 * publish is null, not 0. Throws a fixed text on a failed request.
 */
export function shapeMetricPlay(play) {
  if (!play || play.error) throw fixedError('the Play request failed');
  const last = String(play.date || '').slice(0, 10);
  if (!ISO.test(last)) throw fixedError('the Play answer has no date');
  const rateOf = new Map(
    (play.series || []).map(s => [String(s.date).slice(0, 10), s.rate]),
  );
  const share = v =>
    v === null || v === undefined || !Number.isFinite(Number(v))
      ? null
      : Number(v);
  return {
    dataThrough: last,
    day: share(play.day),
    d7: share(play.d7),
    d28: share(play.d28),
    daily: dayRange(addDays(last, -(METRIC_DAYS - 1)), last).map(d => ({
      date: d,
      rate: share(rateOf.get(d)),
    })),
  };
}

/** The card section's Android week (already suppressed) → frozeWeek, or null. */
export function frozeWeekOf(cardData) {
  const w = cardData?.anr?.sentry?.week;
  const a = w?.android;
  if (!w || w.available === false || !a || a.unavailable) return null;
  return {
    from: w.from,
    to: w.to,
    prevFrom: w.prevFrom,
    prevTo: w.prevTo,
    users: a.users,
    frozeUsers: a.frozeUsers,
    prevUsers: a.prevUsers,
    prevFrozeUsers: a.prevFrozeUsers,
    verdict: a.verdict,
  };
}

/**
 * The metric focus → {status, notes, metric}. The Play token comes from the
 * context; deps.fetchPlay replaces fetchPlayAnr in tests.
 */
async function collectMetric(ctx, focus, {fetchPlay = fetchPlayAnr} = {}) {
  const notes = [];
  const codes = productionCodes(ctx.cfg);
  const metric = {
    id: focus.metric,
    platform: focus.platform,
    limit: focus.limit,
    versionCodes: codes,
    status: 'ok',
    dataThrough: null,
    day: null,
    d7: null,
    d28: null,
    daily: [],
    frozeWeek: frozeWeekOf(ctx.sections?.card?.data),
    ended: false,
  };
  const fail = (status, note) => {
    metric.status = status;
    metric.note = note;
    notes.push(`metric: ${status} — ${note}`);
  };
  if (!codes.length)
    fail(
      'error',
      'active-rollout.json card.builds names no Android production build',
    );
  else {
    let token = null;
    try {
      token = await ctx.playToken();
    } catch (e) {
      if (/no-service-account/i.test(String(e?.message || '')))
        fail('not_configured', 'no Play service account (GOOGLE_PLAY_SA_JSON)');
      else fail('error', 'the Play token could not be minted');
    }
    if (token)
      try {
        const play = await fetchPlay({
          codes,
          seriesDays: METRIC_DAYS,
          token,
        });
        Object.assign(metric, shapeMetricPlay(play));
        // G-F3: false while d28 is null; true when d28 rounded to 4
        // decimals is below the limit (integer compare: no float error).
        // Freshness: Play data older than 7 days before the run date cannot
        // end the focus (test run 1 note), so a stale rate stays "open".
        const fresh =
          !!metric.dataThrough &&
          daysBetween(metric.dataThrough, ctx.date) <= 7;
        metric.ended =
          fresh &&
          metric.d28 !== null &&
          Math.round(metric.d28 * 1e4) < Math.round(focus.limit * 1e4);
      } catch (e) {
        fail('error', e?.fixedText ? e.message : 'the Play request failed');
      }
  }
  if (!metric.frozeWeek)
    notes.push(
      'metric: frozeWeek is missing (the card section has no anr.sentry.week for Android)',
    );
  return {metric, notes};
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const C = {$ref: '#/$defs/cell'};
const CN = {$ref: '#/$defs/cellOrNull'};
const R = {$ref: '#/$defs/rate'};
const share = {type: ['number', 'null'], minimum: 0};
const obj = (props, req = Object.keys(props)) => ({
  type: 'object',
  required: req,
  additionalProperties: false,
  properties: props,
});
const series = items => ({
  type: 'array',
  items,
  minItems: DAYS,
  maxItems: DAYS,
});
const days = series({$ref: '#/$defs/laDate'});
const head = id => ({
  id: {const: id},
  label: {type: 'string'},
  status: {const: 'ok'},
});
const measureSchemas = [
  obj({
    ...head('playAnrRate'),
    dataThrough: {anyOf: [{$ref: '#/$defs/laDate'}, {type: 'null'}]},
    perBuild: {
      type: 'array',
      items: obj({
        build: {type: 'string'},
        day: share,
        d7: share,
        d28: share,
        dailyRate: series(share),
      }),
    },
  }),
  obj({
    ...head('playUsers'),
    dataThrough: {anyOf: [{$ref: '#/$defs/laDate'}, {type: 'null'}]},
    perBuild: {
      type: 'array',
      items: obj({build: {type: 'string'}, users: CN, dailyUsers: series(CN)}),
    },
  }),
  obj({
    ...head('sentryAnrUsers'),
    days,
    perBuild: {
      type: 'array',
      items: obj({
        build: {type: 'string'},
        release: {type: ['string', 'null']},
        anrUsers: series(CN),
        sessionUsers: series(CN),
        weekAnrUsers: CN,
        weekSessionUsers: CN,
        weekAnrShare: {anyOf: [R, {type: 'null'}]},
      }),
    },
  }),
  obj({
    ...head('posthogActive7d'),
    perBuild: {
      type: 'array',
      items: obj({build: {type: 'string'}, dau: series(C), wau: series(C)}),
    },
  }),
  obj({
    ...head('sentryIssueDaily'),
    issue: {type: 'string'},
    days,
    users: series(CN),
    events: series({anyOf: [{$ref: '#/$defs/eventCell'}, {type: 'null'}]}),
  }),
  obj({
    ...head('abArms'),
    build: {type: 'string'},
    flag: {type: 'string'},
    users: C,
    enrolled: C,
    arms: obj(
      Object.fromEntries(
        ['treatment', 'control'].map(a => [
          a,
          obj({
            devices: C,
            anrDevices: C,
            stalledDevices: C,
            noBootDevices: C,
            anrShare: R,
          }),
        ]),
      ),
    ),
  }),
  // A measure that could not be computed.
  obj({
    id: {type: 'string'},
    label: {type: 'string'},
    status: {enum: ['error', 'not_configured', 'pending']},
    note: {type: 'string'},
  }),
];

const laDateOrNull = {anyOf: [{$ref: '#/$defs/laDate'}, {type: 'null'}]};
const metricSchema = obj(
  {
    id: {enum: Object.keys(METRICS)},
    platform: {type: 'string'},
    limit: {type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1},
    versionCodes: {type: 'array', items: {type: 'integer'}},
    status: {enum: ['ok', 'error', 'not_configured']},
    note: {type: 'string'},
    dataThrough: laDateOrNull,
    day: share,
    d7: share,
    d28: share,
    daily: {
      type: 'array',
      maxItems: METRIC_DAYS,
      items: obj({date: {$ref: '#/$defs/laDate'}, rate: share}),
    },
    frozeWeek: {
      anyOf: [
        {type: 'null'},
        obj({
          from: laDateOrNull,
          to: laDateOrNull,
          prevFrom: laDateOrNull,
          prevTo: laDateOrNull,
          users: C,
          frozeUsers: C,
          prevUsers: C,
          prevFrozeUsers: C,
          verdict: {enum: ['BETTER', 'WORSE', 'SAME', 'TOO FEW', 'NO DATA']},
        }),
      ],
    },
    ended: {type: 'boolean'},
  },
  [
    'id',
    'platform',
    'limit',
    'versionCodes',
    'status',
    'dataThrough',
    'day',
    'd7',
    'd28',
    'daily',
    'frozeWeek',
    'ended',
  ],
);

export const schema = obj(
  {
    // `metric` arrived on 2026-10-20: optional, so older files stay valid.
    definitions: obj(
      Object.fromEntries(
        Object.keys(DEFINITIONS).map(k => [k, {type: 'string'}]),
      ),
      Object.keys(DEFINITIONS).filter(k => k !== 'metric'),
    ),
    measuredAt: {type: 'string'},
    asOf: {type: ['string', 'null']},
    focus: obj(
      {
        kind: {enum: KINDS},
        title: {type: 'string'},
        endCondition: {type: 'string'},
        setBy: {type: 'string'},
        setAt: {$ref: '#/$defs/laDate'},
        builds: {type: 'array', items: {type: 'string'}},
        issue: {type: ['string', 'null']},
        // kind metric only
        metric: {type: 'string'},
        platform: {type: 'string'},
        limit: {type: 'number'},
      },
      ['kind', 'title', 'endCondition', 'setBy', 'setAt', 'builds', 'issue'],
    ),
    days,
    measures: {type: 'array', items: {anyOf: measureSchemas}},
    // kind metric only (planning/signals-anr-listens-design.md, section 2)
    metric: metricSchema,
  },
  ['definitions', 'measuredAt', 'asOf', 'focus', 'days', 'measures'],
);

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

// A measure that failed keeps a fixed text only: an API error, a child
// script's stderr or a key-parse error can quote a request or key material.
const FAIL_TEXT = {
  playAnrRate: 'the Play request failed',
  playUsers: 'the Play request failed',
  sentryAnrUsers: 'the Sentry request failed',
  posthogActive7d: 'the PostHog query failed',
  sentryIssueDaily: 'the Sentry request failed',
  abArms: 'the A/B block could not be read',
};
const failed = (m, status, note) => ({
  id: m.id,
  label: String(m.label || m.id),
  status,
  note,
});
const noteOf = (m, e) =>
  e?.fixedText ? e.message : FAIL_TEXT[m.id] || 'the measure failed';

/** The Play part, shared by playAnrRate and playUsers (one play-vitals run). */
async function runPlay(ctx, builds, dates) {
  let out;
  try {
    out = await ctx.runScript(PLAY_ARGS, {timeoutMs: 180_000});
  } catch (e) {
    // Read stderr for one known shape only; never copy it.
    if (/No service account|no-service-account/i.test(String(e?.stderr || '')))
      return {
        status: 'not_configured',
        note: 'no Play service account (GOOGLE_PLAY_SA_JSON)',
      };
    return {
      status: 'error',
      note: 'the Play request failed (play-vitals.mjs exited with an error)',
    };
  }
  try {
    return {ok: shapePlay(out, builds, dates)};
  } catch (e) {
    return {status: 'error', note: noteOf({id: 'playAnrRate'}, e)};
  }
}

/**
 * @param ctx  the snapshot context
 * @param deps {fetchPlay} for the metric kind; tests pass a fake
 */
export async function collect(ctx, deps = {}) {
  const source = `${FOCUS_FILE} + Play Reporting API, Sentry, PostHog`;
  let focus;
  try {
    focus = JSON.parse(
      readFileSync(resolve(ctx.root || '.', FOCUS_FILE), 'utf8'),
    );
  } catch (e) {
    if (e.code === 'ENOENT')
      return {
        status: 'not_configured',
        source,
        data: null,
        notes: [`${FOCUS_FILE} is missing`],
      };
    return {
      status: 'error',
      source,
      data: null,
      error: `${FOCUS_FILE} is not valid JSON`,
    };
  }
  const problems = focusProblems(focus);
  if (problems.length)
    return {
      status: 'error',
      source,
      data: null,
      error: `${FOCUS_FILE}: ${problems.join('; ')}`,
    };

  const measuredAt = new Date().toISOString();
  const dates = dayRange(
    addDays(ctx.dataThrough, -(DAYS - 1)),
    ctx.dataThrough,
  );
  const focusHead = builds => ({
    kind: focus.kind,
    title: focus.title,
    endCondition: focus.endCondition,
    setBy: focus.setBy,
    setAt: focus.setAt,
    builds,
    issue: focus.kind === 'incident' ? focus.sentryIssue : null,
  });

  if (focus.kind === 'metric') {
    const {metric, notes} = await collectMetric(ctx, focus, deps);
    return {
      status: notes.length ? 'partial' : 'ok',
      source: `${FOCUS_FILE} + Play Reporting API, the card section (Sentry)`,
      data: {
        definitions: DEFINITIONS,
        measuredAt,
        asOf: ctx.asOf || null,
        focus: {
          ...focusHead(metric.versionCodes.map(String)),
          metric: focus.metric,
          platform: focus.platform,
          limit: focus.limit,
        },
        days: dates,
        measures: [],
        metric,
      },
      ...(notes.length ? {notes} : {}),
    };
  }

  const builds = focus.kind === 'rollout' ? focus.versionCodes.map(String) : [];
  const ids = focus.measures.map(m => m.id);
  const sentry = ctx.sentry();
  const end = sentryEnd(ctx.dataThrough, ctx.now || new Date());
  const play =
    ids.includes('playAnrRate') || ids.includes('playUsers')
      ? runPlay(ctx, builds, dates)
      : null;
  const noSentry = m =>
    failed(m, 'not_configured', 'SENTRY_READ_TOKEN is not set');

  const one = async m => {
    const label = String(m.label || m.id);
    try {
      switch (m.id) {
        case 'playAnrRate':
        case 'playUsers': {
          const p = await play;
          if (!p.ok) return failed(m, p.status, p.note);
          return {
            id: m.id,
            label,
            status: 'ok',
            dataThrough: p.ok.dataThrough,
            perBuild: m.id === 'playAnrRate' ? p.ok.rate : p.ok.users,
          };
        }
        case 'sentryAnrUsers': {
          if (!sentry) return noSentry(m);
          return {
            id: m.id,
            label,
            status: 'ok',
            ...(await sentryAnrMeasure(sentry, focus, end)),
          };
        }
        case 'posthogActive7d': {
          const rows = await ctx.hogql(
            posthogActiveQuery(builds, ctx.dataThrough, ctx.asOfSQL || 'true'),
            {limit: builds.length * DAYS + 10},
          );
          return {
            id: m.id,
            label,
            status: 'ok',
            perBuild: shapePosthog(rows, builds, dates),
          };
        }
        case 'sentryIssueDaily': {
          if (!sentry) return noSentry(m);
          return {
            id: m.id,
            label,
            status: 'ok',
            issue: focus.sentryIssue,
            ...(await sentryIssueMeasure(sentry, focus.sentryIssue, end)),
          };
        }
        case 'abArms':
          return {
            id: m.id,
            label,
            status: 'ok',
            ...shapeAbArms(ctx.sections?.card?.data?.ab),
          };
        default:
          return failed(m, 'error', 'unknown measure');
      }
    } catch (e) {
      return failed(m, 'error', noteOf(m, e));
    }
  };

  const measures = await Promise.all(focus.measures.map(one));
  const bad = measures.filter(m => m.status !== 'ok');
  return {
    status: bad.length ? 'partial' : 'ok',
    source,
    data: {
      definitions: DEFINITIONS,
      measuredAt,
      asOf: ctx.asOf || null,
      focus: focusHead(builds),
      days: dates,
      measures,
    },
    ...(bad.length
      ? {notes: bad.map(m => `${m.id}: ${m.status} — ${m.note}`)}
      : {}),
  };
}
