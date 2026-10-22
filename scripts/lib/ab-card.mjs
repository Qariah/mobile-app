// @ai
//
// scripts/lib/ab-card.mjs
// -----------------------
// The A/B section of the daily card: the staged Android build and the boot
// splash A/B that rides it (docs/operations/active-rollout.json → `abTest`).
//
// WHAT IT ANSWERS. How many organic users run the build, how they split into
// treatment, control and NOT ENROLLED, and for each group how many devices hit
// an ANR or another boot problem — each count beside its denominator.
//
// THE TRAP IT EXISTS FOR. `boot_splash_mode = 'control'` is the default on
// EVERY device that the flag does not target, so counting arms over all users
// reports the whole population as "control". On 2026-10-06 a run printed
// "56 control, 1 treatment"; the truth was 5 enrolled devices (1 treatment,
// 4 control) and about 60 that were not enrolled. Arms here count ONLY devices
// with a `boot_risk_enrolled` event; the rest go on their own line.
//
// Definitions follow planning/anr-hotfix-v2-plan.md section 5 (on
// hotfix/3.2.0-anr-splash). Pure functions are exported for
// scripts/__tests__/ab-card.test.mjs.

import {labExclusionSQL, sqlList} from './lab-exclusion.mjs';
import {isQueryTimeout} from './posthog-window.mjs';

// PostHog returns 100 rows when a query has no LIMIT, with no warning. The
// per-device query has one row per device, so it needs an explicit cap.
export const AB_ROW_CAP = 100_000;

export const ARMS = ['treatment', 'control'];

// Below this many enrolled devices the arms are a handful of phones, and a
// single device moves any comparison. Config can override it.
export const MIN_ENROLLED_TO_JUDGE = 30;

const W = 44; // the card's phone width

/**
 * The A/B to report, or null when the section must not print: the rollout is
 * not active, or the JSON does not name both the build and the flag.
 */
export function abConfig(cfg) {
  if (!cfg || cfg.active !== true) return null;
  const ab = cfg.abTest;
  const build = cfg.build;
  if (!ab || !ab.flag || build === undefined || build === null) return null;
  return {
    build: String(build),
    flag: String(ab.flag),
    flagId: ab.posthogFlagId ?? null,
    sentryRelease: cfg.sentryRelease || null,
    // The commits that the build's diff runs between: the production base the
    // hotfix was cut from, and the build itself. judgeFirstSeen() reads the
    // files that changed between them.
    baseSha: ab.baseSha || null,
    buildSha: cfg.sha || null,
    minEnrolled: Number(ab.minEnrolledToJudge) || MIN_ENROLLED_TO_JUDGE,
    // The launch date the card's other sections count from (`startedAt`, the
    // same value daily-card.mjs's windowClause() reads). The A/B queries start
    // there; see abQueries().
    since: cfg.startedAt || null,
    // Issues the owner ruled are not 2027's (abTest.ownerCleared); see
    // clearByOwner().
    cleared: Array.isArray(ab.ownerCleared) ? ab.ownerCleared : [],
  };
}

// An ISO calendar date, YYYY-MM-DD: the only shape abQueries() puts into SQL.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * HogQL for the section. Both queries are organic only (lab-exclusion.mjs) and
 * scoped to the build, over the build's whole life: from `since` (the rollout's
 * `startedAt`, an ISO date) onward.
 *
 * THE TIME BOUND IS LOAD-BEARING. Without it PostHog scans the project's whole
 * event history for the build filter and hits its max execution time: on
 * 2026-10-16 perDevice answered HTTP 504 after 19.5 s, and the three BLOCKING
 * conditions printed NO DATA. With `timestamp >= 2026-09-28` the same query ran
 * in about 7 s. It loses no data: build 2027's only events before 2026-09-29
 * are lab traffic (checked 2026-10-16), which the lab exclusion drops anyway.
 * A missing or malformed `since` leaves the query unbounded rather than guess.
 *
 *  perDevice — one row for each device: enrolled?, last assigned arm, and the
 *    problem flags. The arm is the newest `treatment`/`control` value from
 *    `boot_splash_flag_resolved` (raw JSON: `properties.value` reads
 *    'treatment' as null, plan Q3) or `$feature_flag_called`.
 *  perProcessArm — plan Q1 and Q2: devices with an ANR exit, and devices with a
 *    known previous process, grouped by the arm of the process that died. A
 *    device can count under both arms; that is correct for this metric. The
 *    ANR devices also split by `prev_reached_reveal`: before the reveal the
 *    splash of that arm was still running; after it, the boot was done. A
 *    missing value counts as before the reveal (it cannot clear the arm).
 */
export function abQueries({build, flag, since}) {
  const bound =
    since && ISO_DATE.test(String(since))
      ? ` AND timestamp >= toDateTime('${since} 00:00:00')`
      : '';
  const scope = `properties.$app_build = ${sqlList([build])}${bound} AND ${labExclusionSQL()}`;
  const assigned = `multiIf(
      event = 'boot_splash_flag_resolved', JSONExtractString(properties, 'value'),
      event = '$feature_flag_called' AND properties.$feature_flag = ${sqlList([flag])},
        toString(properties.$feature_flag_response),
      '')`;
  // past_splash = a first screen rendered: splash_hidden OR
  // screen_content_rendered, the cold-start completion that ColdStartBeganProps
  // (services/analytics/qariahEvents.ts) defines. splash_hidden alone counted
  // short onboarding bounces as splash hangs (7 devices on build 2027).
  const perDevice = `SELECT distinct_id,
       max(event = 'boot_risk_enrolled') AS enrolled,
       argMaxIf(${assigned}, timestamp, ${assigned} IN ('treatment', 'control')) AS arm,
       max(event = 'cold_start_began' AND properties.prev_exit_reason = 'anr') AS anr,
       max(properties.boot_splash_mode = 'fallback'
           OR properties.prev_process_boot_splash_mode = 'fallback') AS fallback,
       max(event = 'splash_stalled') AS stalled,
       max(event = 'cold_start_began') AS opened,
       max(event IN ('splash_hidden', 'screen_content_rendered')) AS past_splash
     FROM events
     WHERE ${scope}
     GROUP BY distinct_id
     LIMIT ${AB_ROW_CAP}`;
  const perProcessArm = `SELECT properties.prev_process_boot_splash_mode AS arm,
       uniqIf(distinct_id, properties.prev_exit_reason = 'anr') AS anr_devices,
       uniqIf(distinct_id, properties.prev_process_known = true) AS ran_devices,
       uniqIf(uuid, properties.prev_process_known = true) AS exits,
       uniqIf(distinct_id, properties.prev_exit_reason = 'anr'
         AND NOT ifNull(properties.prev_reached_reveal = true, false)) AS anr_in_splash,
       uniqIf(distinct_id, properties.prev_exit_reason = 'anr'
         AND ifNull(properties.prev_reached_reveal = true, false)) AS anr_after_splash
     FROM events
     WHERE event = 'cold_start_began' AND properties.boot_risk = true AND ${scope}
     GROUP BY arm
     LIMIT ${AB_ROW_CAP}`;
  return {perDevice, perProcessArm};
}

const truthy = v => v === true || v === 1 || v === '1' || v === 'true';

const emptyGroup = () => ({
  devices: 0,
  anr: 0,
  fallback: 0,
  stalled: 0,
  noBoot: 0,
});

/**
 * Fold the per-device rows into groups. An arm counts ONLY when the device
 * enrolled; a non-enrolled device goes to `notEnrolled` whatever its arm value
 * says. An enrolled device with no treatment/control value goes to `noArm`.
 *
 * rows: [distinct_id, enrolled, arm, anr, fallback, stalled, opened, past_splash]
 * processRows: [arm, anr_devices, ran_devices, exits, anr_in_splash,
 *   anr_after_splash]
 */
export function buildAbModel(rows, processRows = []) {
  const groups = {
    treatment: emptyGroup(),
    control: emptyGroup(),
    noArm: emptyGroup(),
    notEnrolled: emptyGroup(),
  };
  for (const [, enrolled, arm, anr, fallback, stalled, opened, past] of rows) {
    const key = !truthy(enrolled)
      ? 'notEnrolled'
      : ARMS.includes(arm)
        ? arm
        : 'noArm';
    const g = groups[key];
    g.devices += 1;
    if (truthy(anr)) g.anr += 1;
    if (truthy(fallback)) g.fallback += 1;
    if (truthy(stalled)) g.stalled += 1;
    if (truthy(opened) && !truthy(past)) g.noBoot += 1;
  }
  const byProcessArm = {};
  for (const [
    arm,
    anrDevices,
    ranDevices,
    exits,
    inSplash,
    afterSplash,
  ] of processRows) {
    const anr = Number(anrDevices) || 0;
    byProcessArm[arm || 'none'] = {
      anr,
      ran: Number(ranDevices) || 0,
      exits: Number(exits) || 0,
      // A row without the split counts every ANR as in the splash.
      anrInSplash: inSplash === undefined ? anr : Number(inSplash) || 0,
      anrAfterSplash: Number(afterSplash) || 0,
    };
  }
  const enrolled =
    groups.treatment.devices + groups.control.devices + groups.noArm.devices;
  return {
    users: enrolled + groups.notEnrolled.devices,
    enrolled,
    groups,
    byProcessArm,
  };
}

const num = (n, w) => String(n).padStart(w);

/**
 * The card's `ANRs 2027` section: printed only while the staged build's A/B
 * runs (until the build is at 100%). Three parts, each count beside its
 * denominator and no percentage:
 *   BLOCKING             — the three stop conditions that can halt the ramp
 *   CONTROL vs TREATMENT — plan Q1 over Q2, by the arm of the process that died
 *   OTHER                — what is worth knowing but never blocks
 * `model` is buildAbModel()'s output plus `ab` (abConfig) and `sentry`
 * (fetchAbSentry). `model.error` prints one unavailable line and the BLOCKING
 * block with every condition not judged.
 */
export function renderAbCard(model) {
  const {ab} = model;
  const L = [`⚠️ ANRs ${ab.build} · until ${ab.build} is at 100%`];
  if (model.error) L.push(`  A/B unavailable (${model.error})`.slice(0, W));
  L.push(...renderBlocking(blockingStopConditions(model)));
  if (model.error) return L;

  const {groups: g} = model;
  L.push('CONTROL vs TREATMENT · lab excluded');
  // Arms count enrolled devices only: `control` is also the default of
  // every device that never enrolled (the 2026-10-06 "56 control" mistake).
  L.push(
    `  ${model.users} on ${ab.build} · ${model.enrolled} enrolled · ${g.notEnrolled.devices} not`,
  );
  L.push(
    `  enrolled arms: treatment ${g.treatment.devices} · control ${g.control.devices}`,
  );
  if (model.enrolled < ab.minEnrolled)
    L.push(`  too few to judge: need ${ab.minEnrolled} enrolled`);
  L.push(
    `${''.padEnd(13)}${'ANR devices'.padStart(13)}${'launches'.padStart(10)}`,
  );
  for (const arm of ARMS) {
    const p = model.byProcessArm[arm] || {anr: 0, ran: 0, exits: 0};
    L.push(
      `${`  ${arm}`.padEnd(13)}${`${p.anr} of ${p.ran}`.padStart(13)}${num(p.exits, 10)}`,
    );
  }
  L.push('  by the arm of the process that froze');

  L.push('OTHER · does not block');
  const t = treatmentRow(model);
  L.push(
    `  treatment ANR after the splash: ${t.anrAfterSplash} of ${t.ran}`.slice(
      0,
      W,
    ),
  );
  const noBoot = Object.values(g).reduce((n, x) => n + x.noBoot, 0);
  if (noBoot) L.push(`  no first screen rendered: ${noBoot} devices`);
  L.push(...renderAbSentry(model.sentry));
  L.push('  crash-free rate, past-splash: see report');
  return L;
}

// --- the blocking stop conditions (owner decision, 2026-10-11) -------------
//
// Only a sign that 2027 itself is broken blocks the ramp:
//   1. treatment-anr: an ANR exit in a process that ran the treatment arm
//      (the non-blocking splash), before that process reached the reveal:
//      the treatment was still running. A later ANR in the same process is
//      reported on its own line and does not block (QARIAHV2-3J on
//      2026-10-11: a background ANR 35 min after the reveal). An ANR in a
//      control process runs the same boot as 1717, so it does not block,
//      also on a device that enrolled in treatment later (QARIAHV2-52 on
//      2026-10-05: the ANR came 24 s before the device enrolled).
//   2. a new defect from 2027:
//      - new-crash-class-on-2027: a Sentry fatal or ANR issue first seen on
//        2027 with an in-app frame in a file that 2027 changed
//        (abTest.baseSha...sha), or an issue with no in-app frame that
//        REPEAT_USERS or more users hit. A crash in a file that 2027 did not
//        change is an old bug that a 2027 user hit first (QARIAHV2-58 on
//        2026-10-08: BrowseReciters.tsx, the same on 1717). An ANR with no
//        frame in a changed file is judged by treatment-anr, not here.
//      - crash-guard-fallback-launches: the crash guard saw the treatment boot
//        fail on a device and switched it back to the blocking splash.
// crash-free-gate and past-splash-rate-vs-1717 are report only
// (docs/operations/active-rollout.json → stopConditions). Sentry events carry
// no splash-mode tag, so a Sentry issue cannot be split by arm.

// An issue with no in-app frame cannot be placed. One user is a single event
// to watch; this many users is a repeat, and a repeat blocks.
export const REPEAT_USERS = 2;

const norm = f =>
  String(f || '')
    .replace(/^app:\/\/\//, '')
    .replace(/^[~.]?\//, '');
const base = f => norm(f).split('/').pop();
// A frame in the JS bundle itself (no source map) names no source file, so it
// cannot place the issue: index.android.bundle, main.jsbundle.
const BUNDLE = /\.(js)?bundle$/i;

/**
 * The verdict for one issue first seen on the build.
 * issue: {anr, background, inAppFiles: string[]}
 * changedFiles: repo paths changed between baseSha and the build, or null.
 * → {fromBuild: true | false | null, tag, reason}
 *   true = 2027 caused it; false = it did not, or treatment-anr judges it;
 *   null = the rules cannot place it.
 */
export function judgeFirstSeen(issue, changedFiles) {
  if (!Array.isArray(changedFiles))
    return {fromBuild: null, tag: 'unknown', reason: 'build diff unavailable'};
  const named = (issue.inAppFiles || []).map(norm).filter(Boolean);
  const files = named.filter(f => !BUNDLE.test(base(f)));
  const hit = files.find(f =>
    f.includes('/')
      ? changedFiles.some(c => c === f || c.endsWith(`/${f}`))
      : changedFiles.some(c => base(c) === f),
  );
  if (hit)
    return {fromBuild: true, tag: '2027', reason: `changed ${base(hit)}`};
  if (issue.anr)
    return {
      fromBuild: false,
      tag: 'ANR',
      reason: issue.background
        ? 'background, see treatment ANR'
        : 'see treatment ANR',
    };
  if (files.length)
    return {
      fromBuild: false,
      tag: 'not 2027',
      reason: `unchanged ${base(files[0])}`,
    };
  return {
    fromBuild: null,
    tag: 'unknown',
    reason: named.length ? 'bundle frame only' : 'no app frame',
  };
}

/**
 * The owner's ruling on one judged issue (active-rollout.json →
 * abTest.ownerCleared: [{id, users, date, reason}]). A cleared issue is
 * `clear` while no more than `users` users hit it; when it spreads past that,
 * the rules judge it again and the reason says so.
 * Origin: 2026-10-17, QARIAHV2-5K (a libhwui render-thread abort with no app
 * frame, one device model, two Sentry user ids within 3 min) read as a
 * `repeat` FAIL every day; the owner ruled it does not block.
 */
export function clearByOwner(issue, cleared) {
  const c = (cleared || []).find(x => x && x.id === issue.id);
  if (!c || !issue.verdict) return issue.verdict;
  const users = Number(issue.users) || 0;
  const cap = Number(c.users) || 0;
  if (users <= cap)
    return {
      fromBuild: false,
      tag: 'cleared',
      reason: `owner ${c.date || ''}: ${c.reason || 'does not block'}`.trim(),
    };
  return {
    ...issue.verdict,
    reason: `${issue.verdict.reason} (cleared at ${cap} users, now ${users})`,
  };
}

// Where one judged issue stands for new-crash-class-on-2027.
//   against — 2027 caused it, or it is unplaced and REPEAT_USERS+ users hit it
//   watch   — unplaced, fewer than REPEAT_USERS users: name it, do not block
//   nodata  — not judged, or unplaced only because the build diff is missing
//   clear   — not 2027 (old code), or an ANR that treatment-anr judges
export function issueKind(i) {
  const v = i.verdict;
  if (!v || v.reason === 'build diff unavailable') return 'nodata';
  if (v.fromBuild === true) return 'against';
  if (v.fromBuild === null)
    return (Number(i.users) || 0) >= REPEAT_USERS ? 'against' : 'watch';
  return 'clear';
}

/**
 * The state of new-crash-class-on-2027 from the judged first-seen issues:
 * FAIL when one is against 2027, else NO DATA when one is not judged, else
 * PASS.
 */
export function stopVerdict(firstSeen) {
  const kinds = firstSeen.map(issueKind);
  const n = k => kinds.filter(x => x === k).length;
  return {
    state: n('against') ? 'FAIL' : n('nodata') ? 'NO DATA' : 'PASS',
    against: n('against'),
    watch: n('watch'),
    total: firstSeen.length,
  };
}

const treatmentRow = model => ({
  anr: 0,
  ran: 0,
  anrInSplash: 0,
  anrAfterSplash: 0,
  ...((model.byProcessArm || {}).treatment || {}),
});

/**
 * The three blocking stop conditions, each {id, label, state, detail}.
 * state: PASS | FAIL | TOO FEW | NO DATA. Every detail has its denominator.
 */
export function blockingStopConditions(model) {
  const {ab} = model;
  const noData = detail => ({state: 'NO DATA', detail});
  const out = [];

  let anr;
  if (model.error) anr = noData('no A/B data');
  else {
    const p = treatmentRow(model);
    anr =
      p.anrInSplash > 0
        ? {state: 'FAIL', detail: `${p.anrInSplash} of ${p.ran} devices`}
        : p.ran === 0
          ? {state: 'TOO FEW', detail: 'none ran it yet'}
          : {state: 'PASS', detail: `0 of ${p.ran} devices`};
  }
  out.push({id: 'treatment-anr', label: 'treatment ANR', ...anr});

  const s = model.sentry;
  let crash;
  if (model.error) crash = noData('no A/B data');
  else if (!s) crash = noData('no Sentry token');
  else if (s.error) crash = noData('Sentry error');
  else {
    const v = stopVerdict(s.firstSeen);
    crash = {state: v.state, detail: `${v.against} of ${v.total} issues`};
  }
  out.push({
    id: 'new-crash-class-on-2027',
    label: `crash from ${ab.build}`,
    ...crash,
  });

  let fb;
  if (model.error) fb = noData('no A/B data');
  else {
    const n = Object.values(model.groups).reduce((a, g) => a + g.fallback, 0);
    fb =
      model.users === 0
        ? {state: 'TOO FEW', detail: 'none yet'}
        : n > 0
          ? {state: 'FAIL', detail: `${n} of ${model.users} devices`}
          : {state: 'PASS', detail: `0 of ${model.users} devices`};
  }
  out.push({
    id: 'crash-guard-fallback-launches',
    label: 'fallback launch',
    ...fb,
  });
  return out;
}

/** The BLOCKING lines: the totals, then one row for each condition. */
export function renderBlocking(conds) {
  const n = st => conds.filter(c => c.state === st).length;
  const pass = n('PASS');
  const fail = n('FAIL');
  const L = [
    `BLOCKING · ${pass} pass · ${fail} fail · ${conds.length - pass - fail} not judged`,
  ];
  for (const c of conds)
    L.push(
      `  ${c.label.padEnd(15)} ${c.state.padEnd(7)} ${c.detail}`.slice(0, W),
    );
  return L;
}

// The Sentry issues first seen on the build, each with its tag. An issue
// tagged `2027` or `repeat` is also the reason for a crash FAIL above.
function renderAbSentry(sentry) {
  if (!sentry) return ['  Sentry: unavailable (no SENTRY_READ_TOKEN)'];
  if (sentry.error)
    return [`  Sentry: unavailable (${sentry.error})`.slice(0, W)];
  if (!sentry.firstSeen.length) return ['  new Sentry issues: none'];
  const L = [];
  for (const i of sentry.firstSeen) {
    const users = `${i.users} user${i.users === 1 ? '' : 's'}`;
    if (!i.verdict) {
      L.push(`  ${i.id} · ${users}`.slice(0, W));
      continue;
    }
    // An unplaced issue shows whether it blocks: `repeat` (REPEAT_USERS+
    // users) blocks, `watch` (one user) does not.
    const k = issueKind(i);
    const tag =
      i.verdict.fromBuild === null && k !== 'nodata'
        ? k === 'against'
          ? 'repeat'
          : 'watch'
        : i.verdict.tag || 'unknown';
    L.push(`  ${i.id} · ${users} · ${tag}`.slice(0, W));
    L.push(`    ${i.verdict.reason}`.slice(0, W));
  }
  return L;
}

/**
 * Sentry fatal issues (crashes and ANRs) on the release, production only, and
 * the subset first seen on it. userCount is the whole issue's count: exact for
 * an issue first seen on this build, an upper bound otherwise, so it prints
 * only for the first-seen ones.
 */
export async function fetchAbSentry({token, org, host, release}) {
  if (!token || !release) return null;
  const list = async query => {
    const url = new URL(`${host}/api/0/organizations/${org}/issues/`);
    url.searchParams.set(
      'query',
      `${query} level:fatal environment:production`,
    );
    url.searchParams.set('statsPeriod', '90d');
    url.searchParams.set('limit', '100');
    const res = await fetch(url, {
      headers: {Authorization: `Bearer ${token}`},
      // eslint-disable-next-line no-undef -- Node 18+ global; the shared ESLint env is the RN app's
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Sentry ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error('Sentry: not a list');
    return body.map(i => ({
      id: i.shortId,
      groupId: i.id,
      title: i.title || '',
      users: Number(i.userCount) || 0,
    }));
  };
  // The newest event of an issue: whether it is an ANR (and a background
  // one), and the files of its in-app frames.
  const details = async issue => {
    const url = `${host}/api/0/organizations/${org}/issues/${issue.groupId}/events/latest/`;
    const res = await fetch(url, {
      headers: {Authorization: `Bearer ${token}`},
      // eslint-disable-next-line no-undef -- Node 18+ global; the shared ESLint env is the RN app's
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Sentry ${res.status}`);
    return eventFacts(await res.json(), issue.title);
  };
  try {
    const [onBuild, firstSeen] = await Promise.all([
      list(`release:${release}`),
      list(`firstRelease:${release}`),
    ]);
    for (const i of firstSeen) Object.assign(i, await details(i));
    return {onBuild, firstSeen};
  } catch (e) {
    return {error: String(e.message || e).slice(0, 60)};
  }
}

/**
 * The facts judgeFirstSeen() needs, from one Sentry event.
 * → {anr, background, inAppFiles}
 */
export function eventFacts(event, title = '') {
  const values =
    ((event.entries || []).find(e => e.type === 'exception') || {}).data
      ?.values || [];
  const text = [title, ...values.map(v => `${v.type} ${v.value}`)].join(' ');
  const inAppFiles = [];
  for (const v of values)
    for (const f of (v.stacktrace && v.stacktrace.frames) || [])
      if (f.inApp && (f.filename || f.absPath))
        inAppFiles.push(f.filename || f.absPath);
  return {
    anr: /ApplicationNotResponding|\bANR\b/i.test(text),
    background: /background ANR/i.test(text),
    inAppFiles: [...new Set(inAppFiles)],
  };
}

// PostHog answers 504 (max execution time) or 503 (too busy) under load. On
// 2026-10-08 the 20:10 UTC cloud run printed `unavailable (PostHog 504…)` and a
// rerun a few minutes later worked, so each query gets one retry after a pause.
export const isPostHogBusy = err =>
  isQueryTimeout(err) ||
  /\bPostHog 503\b/.test(String(err && (err.message || err)));

export async function retryBusy(run, {waitMs = 30_000, sleep} = {}) {
  try {
    return await run();
  } catch (e) {
    if (!isPostHogBusy(e)) throw e;
    await (sleep || (ms => new Promise(r => setTimeout(r, ms))))(waitMs);
    return run();
  }
}

/** Run both HogQL queries and Sentry; never throws. */
export async function collectAbModel(
  ab,
  {hogql, sentry, changedFiles, retry = {}},
) {
  try {
    const q = abQueries(ab);
    const [rows, processRows, s, changed] = await Promise.all([
      retryBusy(() => hogql(q.perDevice), retry),
      retryBusy(() => hogql(q.perProcessArm), retry),
      fetchAbSentry({...sentry, release: ab.sentryRelease}),
      changedFiles
        ? Promise.resolve()
            .then(() => changedFiles(ab))
            .catch(() => null)
        : null,
    ]);
    if (s && s.firstSeen)
      for (const i of s.firstSeen) {
        i.verdict = judgeFirstSeen(i, Array.isArray(changed) ? changed : null);
        i.verdict = clearByOwner(i, ab.cleared);
      }
    return {ab, ...buildAbModel(rows, processRows), sentry: s};
  } catch (e) {
    return {ab, error: String(e.message || e).slice(0, 60)};
  }
}
