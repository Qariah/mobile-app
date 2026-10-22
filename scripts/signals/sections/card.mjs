// @ai
//
// Signals snapshot section `card`: the numbers of the Daily card, from
// `scripts/daily-card.mjs --json --sections=triage --no-owner`. This section is
// the anchor of the card match (scripts/signals/check.mjs): it keeps each
// number exactly as the card prints it. Only the small-cell rule changes them
// (a people count of 1 to 4 is "<5"; the card prints "4 Android · never got
// in", the snapshot prints "<5").
//
//   header    the date of the run, measuredAt (when the card script ran: its
//             trailing windows end then), the card window, the production builds
//   people    distinct installs on the production builds in the window
//   journey   Opened, Past loading, Logged in, Started, Really used
//   active    DAU / WAU / MAU in trailing windows at run time (all versions)
//   usage     event totals in the trailing day / week / month (all versions)
//   failures  journey failures (PostHog) and crashes (Sentry)
//   anr       Play ANR rates, Sentry ANR counts, App Store hangs, and
//             anr.sentry.week: the users who froze in the last 7 complete UTC
//             days and the 7 days before, with the card's verdict (the
//             FREEZES (ANR) block; planning/signals-anr-listens-design.md)
//   ab        the staged build's A/B arms (active-rollout.json abTest)
//
// The section uses the card's trailing windows: they end at run time
// (header.measuredAt), not at dataThrough, and the card applies no ingestion
// cut-off (ctx.asOf). Lab devices are excluded inside daily-card.mjs
// (scripts/lib/lab-exclusion.mjs). The card's ops sections and NEEDS YOU are
// not in the JSON, so the section never reads GitHub issues.

import {freezeVerdict, UNAVAILABLE} from '../../lib/anr-card.mjs';
import {cell, eventCell, rate} from '../lib/rules.mjs';

export const name = 'card';
export const required = true;
export const SCRIPT = [
  'scripts/daily-card.mjs',
  '--json',
  '--sections=triage',
  '--no-owner',
];

// daily-card.mjs `byPlatform` rows: the platform, the person count, then one
// column for each of its STEPS in order. The card prints the steps after
// `installed` as the journey.
export const COLUMNS = [
  'platform',
  'total',
  'installed',
  'opened',
  'past_loading',
  'logged_in',
  'started',
  'used_it',
];
export const JOURNEY = [
  {key: 'opened', label: 'Opened'},
  {key: 'past_loading', label: 'Past loading'},
  {key: 'logged_in', label: 'Logged in'},
  {key: 'started', label: 'Started'},
  {key: 'used_it', label: 'Really used'},
];
export const ACTIVE_LABELS = ['Today', 'Yesterday', 'Day before'];
export const USAGE_KEYS = ['plays', 'heard', 'finished', 'pages'];
export const PLATFORMS = ['iOS', 'Android'];

export const DEFINITIONS = {
  people:
    'distinct installs (PostHog person_id) with any event on a production build of active-rollout.json card.builds, from the window start (startedAt) to run time; lab excluded; iPadOS = iOS; an install with no $os_name counts as Android, as the card does. installed = those of them with Application Installed or Application Updated in the window (not store downloads)',
  journey:
    'installs on the production builds that reached each step in the window (the union of the step events): Opened = cold_start_began; Past loading = splash_hidden or screen_content_rendered; Logged in = sign_in_succeeded, or onboarding_completed with signed_in = true (a floor: PostHog does not know who is already signed in); Started = playback_started or mushaf_page_opened; Really used = meaningful_listen, mushaf_page_read or playback_completed',
  active:
    'distinct installs with any event, all versions, lab excluded, in the trailing 24 hours (dau), 7 days (wau) and 30 days (mau) that end at run time (Today), 1 day before (Yesterday) and 2 days before (Day before)',
  usage:
    'event totals, all versions, lab excluded, in the trailing day, week and month at run time: plays = playback_started, heard = meaningful_listen, finished = playback_completed, pages = mushaf_page_opened. Plain integers, not eventCell: each total sums the events of thousands of installs, and the card does not report the installs behind a total',
  failures:
    'installs on the production builds with an install or update event, a session of 2 s or more and no screen_content_rendered: "never got in" = no cold_start_began; "stuck on loading" = no splash_hidden',
  crashes:
    'the 5 unresolved Sentry issues of level error or fatal with the most users on the production releases (14 days), less active-rollout.json card.suppressIssues. users = the Sentry userCount of the whole issue, all releases: an upper bound for these builds',
  anr: 'play: Google Play user-perceived ANR rate for the production versionCodes of active-rollout.json card.builds pooled by Play (codes; day, user-weighted 7d and 28d; before 2026-10-20 every v2 versionCode), as Play publishes it; the card prints d7 with two decimals as "Google\'s score" against the 0.47% limit (OVER when d7 rounded to 4 decimals is above 0.0047, else UNDER); dailyUsers = Play distinct users on that day (Play rounds it). sentry: for Android (ApplicationNotResponding), iOS hangs (App Hanging) and iOS killed (WatchdogTermination), on the last complete UTC day: activeUsers = session users, affectedUsers = users with the error, day = their rate (7d and 28d shares have no numerator in the card JSON, so they stay out). sentry.week: the FREEZES (ANR) block of the card. For each platform, users = distinct session users of the production releases (active-rollout.json card.builds) in the 7 complete UTC days from..to, frozeUsers = distinct users with a freeze in them (Android: ApplicationNotResponding; iOS: App Hanging or WatchdogTermination), prevUsers and prevFrozeUsers = the same for prevFrom..prevTo; byBuild = this week for each production build, newest first; verdict = with a of b this week and c of d the week before, BETTER when 5ad <= 4cb, WORSE when 5ad >= 6cb, else SAME, TOO FEW when a < 5 and c < 5 (computed from the exact counts); a platform is {unavailable: true, reason} when a Sentry request failed, Sentry missed a day of the two weeks, or a week had no session users. appStore: the App Store hang rate of the newest v2 version (s/h). A source that the card prints as "unavailable" (no key) is null; a source that failed is {available: false}; the error text stays out of the data',
  ab: 'the staged build (active-rollout.json build) and its A/B flag, organic devices since startedAt: users = all devices on the build; enrolled = devices with boot_risk_enrolled; the arms count enrolled devices only. byProcessArm counts devices by the arm of the process that died (a device can count under both arms)',
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const C = {$ref: '#/$defs/cell'};
const CN = {$ref: '#/$defs/cellOrNull'};
const share = {type: ['number', 'null'], minimum: 0};
const obj = (props, req = Object.keys(props)) => ({
  type: 'object',
  required: req,
  additionalProperties: false,
  properties: props,
});
// A source that failed. Its error text never enters the data: an API error
// can quote a request, and a key-parse error can quote key material.
const err = obj({available: {const: false}});
const sentryKind = obj({
  activeUsers: C,
  affectedUsers: CN,
  day: {anyOf: [{$ref: '#/$defs/rate'}, {type: 'null'}]},
});
// The FREEZES (ANR) verdicts (scripts/lib/anr-card.mjs freezeVerdict).
export const VERDICTS = ['BETTER', 'WORSE', 'SAME', 'TOO FEW', 'NO DATA'];
const weekPlatform = {
  anyOf: [
    {type: 'null'},
    // A request failed, Sentry missed a day, or a week had no session users.
    obj({
      unavailable: {const: true},
      reason: {enum: Object.values(UNAVAILABLE)},
    }),
    obj({
      users: C,
      frozeUsers: C,
      prevUsers: C,
      prevFrozeUsers: C,
      verdict: {enum: VERDICTS},
      byBuild: {
        type: 'array',
        items: obj({build: {type: 'string'}, users: C, frozeUsers: C}),
      },
    }),
  ],
};
const laDate = {$ref: '#/$defs/laDate'};
export const weekSchema = {
  anyOf: [
    {type: 'null'},
    err,
    obj({
      from: laDate,
      to: laDate,
      prevFrom: laDate,
      prevTo: laDate,
      android: weekPlatform,
      ios: weekPlatform,
    }),
  ],
};
const abGroup = obj({
  devices: C,
  anrDevices: C,
  fallbackDevices: C,
  stalledDevices: C,
  noBootDevices: C,
});
const abProcess = obj({
  anrDevices: C,
  ranDevices: C,
  exits: {$ref: '#/$defs/eventCell'},
  anrInSplashDevices: C,
  anrAfterSplashDevices: C,
});

export const schema = obj({
  definitions: obj(
    Object.fromEntries(
      Object.keys(DEFINITIONS).map(k => [k, {type: 'string'}]),
    ),
  ),
  header: obj({
    date: {$ref: '#/$defs/laDate'},
    measuredAt: {type: 'string'},
    windowLabel: {type: 'string'},
    windowStart: {anyOf: [{$ref: '#/$defs/laDate'}, {type: 'null'}]},
    windowDays: {type: ['integer', 'null'], minimum: 0},
    builds: {
      type: 'array',
      items: obj({
        platform: {enum: PLATFORMS},
        version: {type: 'string'},
        build: {type: 'string'},
      }),
    },
  }),
  people: obj({total: C, iOS: C, Android: C, installed: C}),
  journey: {
    type: 'array',
    minItems: JOURNEY.length,
    maxItems: JOURNEY.length,
    items: obj({key: {type: 'string'}, label: {type: 'string'}, installs: C}),
  },
  active: {
    anyOf: [
      {type: 'null'},
      {
        type: 'array',
        items: obj({label: {enum: ACTIVE_LABELS}, dau: C, wau: C, mau: C}),
      },
    ],
  },
  usage: {
    anyOf: [
      {type: 'null'},
      {
        type: 'array',
        items: obj({
          label: {type: 'string'},
          key: {type: 'string'},
          day: {type: 'integer', minimum: 0},
          week: {type: 'integer', minimum: 0},
          month: {type: 'integer', minimum: 0},
        }),
      },
    ],
  },
  failures: {
    type: 'array',
    items: obj({
      installs: C,
      platform: {type: 'string'},
      build: {type: 'string'},
      what: {type: 'string'},
    }),
  },
  crashes: {
    anyOf: [
      {type: 'null'},
      {
        type: 'array',
        items: obj({
          id: {type: 'string', pattern: '^[A-Z0-9]+-[A-Z0-9]+$'},
          level: {type: 'string'},
          title: {type: 'string', maxLength: 60},
          users: C,
          builds: {type: 'array', items: {type: 'string'}},
        }),
      },
    ],
  },
  anr: obj({
    play: {
      anyOf: [
        {type: 'null'},
        err,
        obj({
          codes: {type: 'array', items: {type: 'integer'}},
          date: {$ref: '#/$defs/laDate'},
          day: share,
          d7: share,
          d28: share,
          dailyUsers: CN,
          series: {
            type: 'array',
            items: obj({date: {$ref: '#/$defs/laDate'}, rate: share}),
          },
        }),
      ],
    },
    sentry: {
      anyOf: [
        {type: 'null'},
        // The daily rates failed; the week can still hold numbers.
        // `week` arrived on 2026-10-20: optional, so older files stay valid.
        obj({available: {const: false}, week: weekSchema}, ['available']),
        obj(
          {
            date: {anyOf: [{$ref: '#/$defs/laDate'}, {type: 'null'}]},
            observedDays28: {type: 'integer', minimum: 0},
            android: sentryKind,
            hangs: sentryKind,
            killed: sentryKind,
            week: weekSchema,
          },
          ['date', 'observedDays28', 'android', 'hangs', 'killed'],
        ),
      ],
    },
    appStore: {
      anyOf: [
        {type: 'null'},
        err,
        obj({none: {const: true}}),
        obj(
          {
            version: {type: 'string'},
            p50: {type: ['number', 'null']},
            p90: {type: ['number', 'null']},
          },
          ['version'],
        ),
      ],
    },
  }),
  ab: {
    anyOf: [
      {type: 'null'},
      obj({
        build: {type: 'string'},
        flag: {type: 'string'},
        available: {const: false},
      }),
      obj({
        build: {type: 'string'},
        flag: {type: 'string'},
        users: C,
        enrolled: C,
        arms: obj({treatment: abGroup, control: abGroup}),
        noArm: abGroup,
        notEnrolled: abGroup,
        byProcessArm: obj({treatment: abProcess, control: abProcess}),
      }),
    ],
  },
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const share01 = v => {
  const n = num(v);
  return n === null || !Number.isFinite(n) ? null : n;
};
const isoDate = v =>
  /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null;
const FAILED = {available: false};

/** byPlatform rows → people and journey. Throws on a row of the wrong width. */
export function shapePeople(byPlatform) {
  const sums = Object.fromEntries(COLUMNS.slice(1).map(k => [k, 0]));
  const byOs = {iOS: 0, Android: 0};
  for (const row of byPlatform || []) {
    if (!Array.isArray(row) || row.length !== COLUMNS.length)
      throw new Error(
        `daily-card byPlatform row has ${Array.isArray(row) ? row.length : '?'} columns, expected ${COLUMNS.length} (${COLUMNS.join(', ')}): the card's STEPS changed`,
      );
    const r = Object.fromEntries(COLUMNS.map((k, i) => [k, row[i]]));
    for (const k of COLUMNS.slice(1)) sums[k] += Number(r[k]) || 0;
    if (r.platform in byOs) byOs[r.platform] += Number(r.total) || 0;
  }
  return {
    people: {
      total: cell(sums.total),
      iOS: cell(byOs.iOS),
      Android: cell(byOs.Android),
      installed: cell(sums.installed),
    },
    journey: JOURNEY.map(s => ({
      key: s.key,
      label: s.label,
      installs: cell(sums[s.key]),
    })),
  };
}

function shapeSentryKind(k) {
  const active = Number(k?.active) || 0;
  const day = share01(k?.day);
  const affected = day === null ? null : Math.round(day * active);
  return {
    activeUsers: cell(active),
    affectedUsers: affected === null ? null : cell(affected),
    day: affected === null ? null : rate(affected, active),
  };
}

const count = v => cell(Math.max(0, Number(v) || 0));

/**
 * The card's anr.sentry.week → the snapshot week: cell() on every count, and
 * the verdict computed again from the exact counts (scripts/lib/anr-card.mjs
 * freezeVerdict), so the page shows the card's verdict also when a count is
 * "<5". null = absent (no key, or an older card); a platform that is
 * {unavailable: true} keeps one of the fixed reasons of UNAVAILABLE only (no
 * error text); an older card that failed as a whole ({error}) is
 * {available: false}.
 */
export function shapeWeek(w) {
  if (!w) return null;
  if (w.error) return FAILED;
  const reasonOf = r =>
    Object.values(UNAVAILABLE).find(x => String(r || '').startsWith(x)) ||
    UNAVAILABLE.failed;
  const platform = p => {
    if (!p) return null;
    if (p.unavailable) return {unavailable: true, reason: reasonOf(p.reason)};
    return {
      users: count(p.users),
      frozeUsers: count(p.frozeUsers),
      prevUsers: count(p.prevUsers),
      prevFrozeUsers: count(p.prevFrozeUsers),
      verdict: freezeVerdict(p),
      byBuild: (p.byBuild || []).map(b => ({
        build: String(b.build),
        users: count(b.users),
        frozeUsers: count(b.frozeUsers),
      })),
    };
  };
  return {
    from: isoDate(w.from),
    to: isoDate(w.to),
    prevFrom: isoDate(w.prevFrom),
    prevTo: isoDate(w.prevTo),
    android: platform(w.android),
    ios: platform(w.ios),
  };
}

/**
 * The card's ANR block. null = the card prints "unavailable" (no key);
 * {available: false} = the source failed. No error text is kept.
 */
export function shapeAnr(anr) {
  const a = anr || {};
  let play = null;
  if (a.play?.error) play = FAILED;
  else if (a.play)
    play = {
      codes: (a.play.codes || []).map(Number),
      date: isoDate(a.play.date),
      day: share01(a.play.day),
      d7: share01(a.play.d7),
      d28: share01(a.play.d28),
      dailyUsers: Number.isFinite(num(a.play.users))
        ? cell(num(a.play.users))
        : null,
      series: (a.play.series || []).map(s => ({
        date: isoDate(s.date),
        rate: share01(s.rate),
      })),
    };
  let sentry = null;
  if (a.sentry?.error) sentry = {...FAILED, week: shapeWeek(a.sentry.week)};
  else if (a.sentry)
    sentry = {
      date: isoDate(a.sentry.date),
      observedDays28: Number(a.sentry.observed28) || 0,
      android: shapeSentryKind(a.sentry.android),
      hangs: shapeSentryKind(a.sentry.hangs),
      killed: shapeSentryKind(a.sentry.killed),
      week: shapeWeek(a.sentry.week),
    };
  let appStore = null;
  if (a.appStore?.error) appStore = FAILED;
  else if (a.appStore?.none) appStore = {none: true};
  else if (a.appStore?.version)
    appStore = {
      version: String(a.appStore.version),
      p50: share01(a.appStore.p50),
      p90: share01(a.appStore.p90),
    };
  return {play, sentry, appStore};
}

const abGroupOf = g => ({
  devices: cell(Number(g?.devices) || 0),
  anrDevices: cell(Number(g?.anr) || 0),
  fallbackDevices: cell(Number(g?.fallback) || 0),
  stalledDevices: cell(Number(g?.stalled) || 0),
  noBootDevices: cell(Number(g?.noBoot) || 0),
});
const abProcessOf = p => {
  const ran = Number(p?.ran) || 0;
  return {
    anrDevices: cell(Number(p?.anr) || 0),
    ranDevices: cell(ran),
    exits: eventCell(Number(p?.exits) || 0, ran),
    anrInSplashDevices: cell(Number(p?.anrInSplash) || 0),
    anrAfterSplashDevices: cell(Number(p?.anrAfterSplash) || 0),
  };
};

export function shapeAb(ab) {
  if (!ab) return null;
  const build = String(ab.ab?.build ?? '');
  const flag = String(ab.ab?.flag ?? '');
  if (ab.error) return {build, flag, available: false};
  const g = ab.groups || {};
  const p = ab.byProcessArm || {};
  return {
    build,
    flag,
    users: cell(Number(ab.users) || 0),
    enrolled: cell(Number(ab.enrolled) || 0),
    arms: {treatment: abGroupOf(g.treatment), control: abGroupOf(g.control)},
    noArm: abGroupOf(g.noArm),
    notEnrolled: abGroupOf(g.notEnrolled),
    byProcessArm: {
      treatment: abProcessOf(p.treatment),
      control: abProcessOf(p.control),
    },
  };
}

/**
 * The daily-card JSON → the section data.
 * @param {object} card the parsed stdout of daily-card.mjs --json
 * @param {{date:string, measuredAt:string}} o date = the LA date of the run;
 *   measuredAt = when the card script ran (its trailing windows end then)
 */
export function shape(card, {date, measuredAt}) {
  const win = card.win || {};
  const start = String(win.sql || win.label || '').match(/(\d{4}-\d{2}-\d{2})/);
  const {people, journey} = shapePeople(card.byPlatform);
  return {
    definitions: DEFINITIONS,
    header: {
      date,
      measuredAt: String(measuredAt),
      windowLabel: String(win.label || ''),
      windowStart: start ? start[1] : null,
      windowDays: Number.isInteger(win.days) ? win.days : null,
      builds: (card.builds || []).map(b => ({
        platform: b.platform,
        version: String(b.version),
        build: String(b.build),
      })),
    },
    people,
    journey,
    active: Array.isArray(card.active)
      ? card.active.map(r => ({
          label: r.label,
          dau: cell(r.dau),
          wau: cell(r.wau),
          mau: cell(r.mau),
        }))
      : null,
    usage: Array.isArray(card.usage)
      ? card.usage.map(u => ({
          label: String(u.label),
          key: String(u.key),
          day: Math.round(Number(u.day) || 0),
          week: Math.round(Number(u.week) || 0),
          month: Math.round(Number(u.month) || 0),
        }))
      : null,
    failures: (card.failures || []).map(f => ({
      installs: cell(Number(f.n) || 0),
      platform: String(f.platform),
      build: String(f.build ?? ''),
      what: String(f.what),
    })),
    // Not an array (null or absent): the card checked no crash.
    crashes: Array.isArray(card.crashes)
      ? card.crashes.map(c => ({
          id: String(c.id),
          level: String(c.level || ''),
          title: String(c.title || '').slice(0, 60),
          users: cell(Number(c.users) || 0),
          builds: (c.builds || []).map(String),
        }))
      : null,
    anr: shapeAnr(card.anr),
    ab: shapeAb(card.ab),
  };
}

/** Failed requests that the card hides in its text (daily-card.mjs --json counts them). */
export function requestGaps(card) {
  const n = Number(card?.crashesFailedRequests) || 0;
  return n > 0
    ? [
        `crashes: ${n} Sentry request(s) failed; the crash rows may be incomplete`,
      ]
    : [];
}

/** The parts that did not answer, as fixed texts. An empty list = status ok. */
export function gaps(data) {
  const out = [];
  if (!data.active) out.push('active: the card printed it as unavailable');
  if (!data.usage) out.push('usage: the card printed it as unavailable');
  if (data.crashes === null)
    out.push(
      'crashes: not checked (no SENTRY_READ_TOKEN); the Sentry half of FAILURES is missing',
    );
  const {play, sentry, appStore} = data.anr;
  const part = (x, key, missing) => {
    if (!x) out.push(`anr.${key}: unavailable (${missing})`);
    else if (x.available === false) out.push(`anr.${key}: the request failed`);
  };
  part(play, 'play', 'no Play service account');
  part(sentry, 'sentry', 'no SENTRY_READ_TOKEN');
  if (sentry) {
    const w = sentry.week;
    if (!w) out.push('anr.sentry.week: missing from the card JSON');
    else if (w.available === false)
      out.push('anr.sentry.week: the request failed');
    else
      for (const p of ['android', 'ios'])
        if (w[p]?.unavailable)
          out.push(`anr.sentry.week.${p}: unavailable (${w[p].reason})`);
  }
  part(appStore, 'appStore', 'no APP_STORE_CONNECT_API_KEY_ID');
  if (data.ab?.available === false) out.push('ab: the A/B query failed');
  return out;
}

export async function collect(ctx) {
  const measuredAt = new Date().toISOString();
  const card = await ctx.runScript(SCRIPT);
  const data = shape(card, {date: ctx.date, measuredAt});
  const notes = [...gaps(data), ...requestGaps(card)];
  return {
    status: notes.length ? 'partial' : 'ok',
    source: 'scripts/daily-card.mjs --json --sections=triage --no-owner',
    data,
    ...(notes.length ? {notes} : {}),
  };
}
