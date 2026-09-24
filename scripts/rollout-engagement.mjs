#!/usr/bin/env node
// @ai
//
// scripts/rollout-engagement.mjs
// -----------------------------
// Engagement watch for an in-flight staged rollout — the deterministic half of
// the daily triage loop's "did anyone actually USE it?" check
// (qariah-triage-loop SKILL.md, Step 1.5 item 2.5).
//
// WHY THIS EXISTS. On 2026-08-08 the 3.2.0 ramp reported "100% crash-free" and
// looked healthy. It was 24 people. Six of them ever reached a listen. And a
// 12-user day-cohort had ZERO playback of any kind — invisible to every
// aggregate, because the other 12 users on the same build played fine and the
// mean washed it out. None of that moves a crash metric, so nothing would ever
// have escalated it. Crash-free % without a denominator, and without knowing
// whether the app did its job, is a number that flatters a bad rollout.
//
// WHAT IT CHECKS
//   1. Denominator + volume sanity   users on the rolling builds, vs
//                                    rolloutFraction × expected daily base
//   2. Activation funnel             per-USER reach at each step (never
//                                    event-count ratios — the #149 artifact)
//   3. Core-value events             the three "app did its job" signals,
//                                    reported IN PARALLEL, never collapsed
//   4. Cohort split                  first-seen day × OS version; a cohort with
//                                    zero value across ALL THREE is the alert
//   5. Retention                     maturity-gated (users must be old enough
//                                    to HAVE a day 2 before they count against it)
//   6. Instrumentation presence      "instrumented and zero" vs "not in this
//                                    build" — never conflate the two
//
// LAB TRAFFIC IS EXCLUDED (added 2026-09-20). Until then this file measured our
// own boot-gate hardware, CI emulators and dev simulators as if they were users,
// while scripts/daily-card.mjs excluded them correctly — the two tools disagreed
// about who counted as a person for the whole 3.2.0 rollout. On 2026-09-18 that
// cost three false alerts in a single run: build 1901 reported "LOW ACTIVATION
// — 12% of 25 matured users" when all 25 were 16 iOS simulators, 6 Android
// emulators and 3 OnePlus 8 Pro, and builds 1769 and 1930 raised ZERO-VALUE
// COHORT on cohorts that were 11-of-13 and 16-of-18 lab.
//
// The reading is THREE-WAY, not two-way:
//   organic > 0   → every metric is computed over organic users; alerts fire.
//   organic == 0  → `not measurable — N lab-only users`. No percentage, no
//                   alert, no warn. A rate over an empty organic population is
//                   a division by nothing, not a measurement.
//   lab users     → always counted and shown SEPARATELY, never folded into a
//                   funnel or a cohort. Automation has no intent, so a flow
//                   exiting after onboarding is not a product failure.
// The definition lives in scripts/lib/lab-exclusion.mjs, shared with the card.
//
// ROLLOUT STATE IS NOT A GATE ON MEASUREMENT (fixed 2026-09-07).
// Every check above measures BUILDS — `engagement.buildsToWatch` — not a ladder,
// so all of it is meaningful whether or not a staged rollout is in flight.
// Exactly ONE check here is ladder-dependent: the volume sanity note, which
// compares observed Android users against `rolloutFraction × expectedVolume`
// and has nothing to compare against once there is no fraction. So the gate is
// now "does the INSTRUMENTATION exist" (an `engagement` block), and `active` is
// read in one place only — to skip the volume check.
//
// This script used to exit early on `active: false`. That flag went false on
// 2026-09-04 when the 3.2.0/3.2.1 rollout completed, correctly — and it silently
// took the v1→v2 restore measurement down with it. That is the PRIMARY signal of
// the entire migration (`watch.primary` in the config), and a completed rollout
// is precisely when you still want it: the population is at its largest and the
// restore/sign-in instrumentation is finally on every build people run. The
// daily digest then reported the signal as "not measured", which is not a
// reading — it is the same "unobserved is not zero" error this script exists to
// enforce one level down, committed one level up.
//
// Report-only and read-only. It never files, never fixes, never touches a
// rollout percentage. Engagement is interpretation-heavy (a zero-playback
// cohort has more than one honest explanation), so this produces numbers and
// verdicts; a human decides what they mean.
//
//   node scripts/rollout-engagement.mjs             # human summary
//   node scripts/rollout-engagement.mjs --json      # machine-readable
//   node scripts/rollout-engagement.mjs --days=30   # lookback (default 30)
//   node scripts/rollout-engagement.mjs --builds=1712,1713   # override config
//   node scripts/rollout-engagement.mjs --fraction=0.15      # live Android
//        rollout fraction, for the volume sanity note. Pass what
//        `asc-phased-release.mjs status` just reported — it is the live truth
//        and drifts, so it is deliberately NOT hand-maintained in the JSON.
//        Omitted → the volume check is skipped rather than guessed.
//
// Always exits 0 (advisory tool) — the verdict is in the output, never the exit
// code, so a `set -e` caller cannot be tripped by a bad engagement reading.
//
// Env: POSTHOG_PROJECT_ID, POSTHOG_PERSONAL_API_TOKEN, POSTHOG_HOST
//      (default https://us.posthog.com). Config: docs/operations/active-rollout.json.

// The repo's eslint config is React-Native-oriented and declares no Node
// globals; AbortSignal is a Node 18+ builtin used here for request timeouts.
/* global AbortSignal */

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// The one definition of "this event is our own traffic, not a user", shared with
// scripts/daily-card.mjs. Before 2026-09-20 this file excluded NOTHING and the
// card excluded correctly, so the two disagreed about who counted as a person
// for the whole of the 3.2.0 rollout. See that file's header for the incidents.
import {isLabDevice, sqlList} from './lib/lab-exclusion.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'docs/operations/active-rollout.json');

const HOST = (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(
  /\/$/,
  '',
);
const PROJECT = process.env.POSTHOG_PROJECT_ID;
const TOKEN = process.env.POSTHOG_PERSONAL_API_TOKEN;

function parseArgs(argv) {
  const args = {json: false, days: 30, builds: null, fraction: null};
  for (const a of argv.slice(2)) {
    if (a === '--json') args.json = true;
    else if (a.startsWith('--days=')) args.days = Number(a.slice(7)) || 30;
    else if (a.startsWith('--builds='))
      args.builds = a
        .slice(9)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    else if (a.startsWith('--fraction=')) {
      const f = Number(a.slice(11));
      // Accept either 0.15 or 15 — the ASC script prints percent, the Play API
      // speaks fractions, and a silent 100× error here would fake a shortfall.
      args.fraction = Number.isFinite(f) ? (f > 1 ? f / 100 : f) : null;
    }
  }
  return args;
}

const ARGS = parseArgs(process.argv);

// --- PostHog -----------------------------------------------------------------

// PostHog applies a DEFAULT `LIMIT 100` to any HogQL query that does not carry
// one of its own, and it truncates SILENTLY — no error, no flag in the response.
// That is not a theoretical footgun: it silently corrupted every funnel, cohort,
// activation and retention figure this script printed once the watched population
// grew past 100 users. On 2026-08-18 the per-user query returned 100 rows against
// a real population of 611, so build 1713 reported "9% got value" where the true
// figure was 59%, and 1717 reported 0% where the truth was 39%. A rollout that was
// healthy read as broken. The bug was invisible for as long as it was harmless
// (fewer than 100 users total) and became wrong exactly when the numbers started
// to matter.
//
// What let this survive in plain sight (worth remembering, from PR #315): the
// headline "N users" comes from a SEPARATE `GROUP BY build` query that was never
// truncated, while the funnel came from the capped per-user matrix. So the report
// printed impossible pairs — "1713 — 202 users" directly above "launched: 65" —
// when every user fires cold_start_began and those two numbers cannot both be
// true. The contradiction WAS the bug, visible on every run for the life of the
// 3.2.0 ramp, and nobody read the two lines against each other.
//
// So: ALWAYS send an explicit LIMIT, and treat a full result set as a failure
// rather than a number. If a query ever comes back holding exactly `limit` rows
// we cannot tell a complete answer from a truncated one, so we refuse to report
// instead of quietly under-counting.
const ROW_LIMIT = 100_000;

async function hogql(query, {limit = ROW_LIMIT} = {}) {
  // Appending unconditionally is safe: every call site here builds its own query
  // text and none of them set a LIMIT. If one ever does, this throws rather than
  // producing a query with two LIMIT clauses.
  if (/\blimit\s+\d/i.test(query)) {
    throw new Error(
      'hogql(): query already carries a LIMIT — pass {limit} instead so the ' +
        'truncation guard can see it.',
    );
  }
  const res = await fetch(`${HOST}/api/projects/${PROJECT}/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: {kind: 'HogQLQuery', query: `${query}\nLIMIT ${limit}`},
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new Error(
      `PostHog ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const rows = (await res.json()).results || [];
  if (rows.length >= limit) {
    throw new Error(
      `PostHog returned ${rows.length} rows at the ${limit}-row cap — the result ` +
        'is truncated and every per-user figure derived from it would under-count. ' +
        'Raise ROW_LIMIT or narrow the window; do NOT report these numbers.',
    );
  }
  return rows;
}

// --- helpers -----------------------------------------------------------------

const pct = (n, d) => (d > 0 ? n / d : null);
const fpct = v =>
  v === null ? ' —  ' : `${(v * 100).toFixed(0).padStart(3)}%`;
const hoursSince = ts => (Date.now() - new Date(ts).getTime()) / 36e5;

function loadConfig() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
  // Gate on INSTRUMENTATION, not on rollout state: no `engagement` block means
  // there is nothing configured to measure, which is the only honest reason to
  // refuse. `raw.active` is deliberately NOT consulted here — it is read exactly
  // once, in the volume check, which is the sole ladder-dependent thing in this
  // file. See the header note for why gating the whole script on it was wrong.
  if (!raw.engagement) return null;
  return raw;
}

// --- checks ------------------------------------------------------------------

async function collect(cfg) {
  const eng = cfg.engagement;
  const builds = ARGS.builds || eng.buildsToWatch || [];
  const B = `properties.$app_build IN (${sqlList(builds)})`;
  const WINDOW = `timestamp > now() - INTERVAL ${ARGS.days} DAY`;

  // Every event we care about, in one pass: per-user reach is derivable from
  // this, and one query beats seven round-trips.
  const funnelEvents = [...new Set(eng.funnel.flatMap(s => s.events))];
  const coreEvents = eng.coreValueEvents;
  const allEvents = [...new Set([...funnelEvents, ...coreEvents])];

  // ONE per-user matrix drives everything: funnel reach, core-value, cohorts,
  // activation, retention. Deriving reach from per-user counts gives an EXACT
  // union across a step's events — a separate per-event reach query could only
  // be max()'d, which silently under-counts any step with two alternatives
  // (e.g. Installed-vs-Updated, or listen-vs-read).
  const COLS = allEvents
    .map((e, i) => `countIf(event='${e.replace(/'/g, "''")}') AS e_${i}`)
    .join(', ');
  const idx = new Map(allEvents.map((e, i) => [e, i]));
  // First event column offset in each per-user row. The fixed prefix is
  // build, person_id, first_seen, active_days, os, os_version, device_name.
  // It was 6 until device_name was added on 2026-09-20 — if you add another
  // fixed column, move it too, because an off-by-one here reads an event count
  // out of an OS-version string and every funnel figure silently becomes zero.
  const BASE = 7;

  const [perBuild, perUser, everSeen] = await Promise.all([
    hogql(
      `SELECT properties.$app_build AS build, count(DISTINCT person_id) AS users,
              count() AS events, min(timestamp) AS first_seen, max(timestamp) AS last_seen
       FROM events WHERE ${WINDOW} AND ${B}
       GROUP BY build ORDER BY users DESC`,
    ),
    // `device_name` carries the organic/lab split. It is fetched rather than
    // filtered in SQL on purpose: both lanes are counted and reported, because
    // "0 organic · 25 lab" and "0 users" are different readings and only one of
    // them is true. `analyse()` does the split with `isLabDevice`.
    hogql(
      `SELECT properties.$app_build AS build, person_id,
              min(timestamp) AS first_seen,
              count(DISTINCT toDate(timestamp)) AS active_days,
              any(properties.$os) AS os, any(properties.$os_version) AS os_version,
              any(properties.$device_name) AS device_name,
              ${COLS}
       FROM events WHERE ${WINDOW} AND ${B}
       GROUP BY build, person_id`,
    ),
    // Instrumentation presence: has this event EVER appeared on this build, over
    // all time? A zero in the window means nothing if the answer here is "never"
    // — that is "not shipped in this binary", not "users never did it".
    //
    // DELIBERATELY NOT lab-excluded. The question is "does this event exist in
    // this binary", and a boot-gate run firing it answers that as well as a
    // person does — better, on an internal build no person ever ran. Filtering
    // here would relabel shipped instrumentation as missing.
    hogql(
      `SELECT properties.$app_build AS build, event, count() AS n
       FROM events WHERE ${B} AND event IN (${sqlList(allEvents)})
       GROUP BY build, event`,
    ),
  ]);

  // GUARD THE OFFSET. An off-by-one in BASE is silent: it reads an event count
  // out of an OS-version string, every countIf() lands one column late, and the
  // whole report becomes zeros with no error and no warning. The row width is
  // knowable — the fixed prefix plus one column per event — so check it rather
  // than trusting the constant to stay in step with the SELECT above.
  const expectedWidth = BASE + allEvents.length;
  if (perUser.length > 0 && perUser[0].length !== expectedWidth) {
    throw new Error(
      `rollout-engagement: per-user row width is ${perUser[0].length}, expected ` +
        `${expectedWidth} (BASE=${BASE} fixed columns + ${allEvents.length} events). ` +
        'A fixed column was added or removed without moving BASE. Refusing to ' +
        'report rather than printing zeros for every funnel figure.',
    );
  }

  return {builds, perBuild, perUser, everSeen, coreEvents, idx, BASE};
}

function analyse(cfg, data) {
  const eng = cfg.engagement;
  const T = eng.thresholds;
  const {perBuild, perUser, everSeen, coreEvents, idx, BASE} = data;

  const seenMap = new Map(
    everSeen.map(([b, e, n]) => [`${b}|${e}`, Number(n)]),
  );
  // Did this user fire event `ev` at all?
  const did = (row, ev) => Number(row[BASE + idx.get(ev)] || 0) > 0;
  const didAny = (row, evs) => evs.some(e => did(row, e));

  const alerts = [];
  const warns = [];
  const builds = [];

  // `perBuild.users` is deliberately NOT destructured. It counts every person_id
  // on the build, lab included, and it was the headline "N users" that sat above
  // a lab-only funnel and made it read as a product failure. The user counts now
  // come from `perUser` — one source of truth, already split by lane.
  for (const [build, , events, firstSeen, lastSeen] of perBuild) {
    const rows = perUser.filter(r => r[0] === build);
    const organic = rows.filter(r => !isLabDevice(r[6]));
    const lab = rows.filter(r => isLabDevice(r[6]));
    const totalUsers = organic.length;
    const labUsers = lab.length;

    // THE THIRD STATE. No organic users is not "0% got value" — it is nothing to
    // measure. A rate over an empty organic population is a division by nothing,
    // so every metric, alert and warn below is skipped rather than computed on a
    // denominator that does not describe people. On 2026-09-18 the opposite
    // behaviour raised three alerts in one run, all of them our own CI: build
    // 1901 read "LOW ACTIVATION — 12% of 25 matured users" over 16 iOS
    // simulators, 6 Android emulators and 3 OnePlus 8 Pro. Build health for a
    // lab-only build comes from the boot gate and the .maestro suites, which
    // measure it directly; automation has no intent, so a Maestro flow exiting
    // after onboarding is not a product signal at all.
    if (organic.length === 0) {
      builds.push({
        build,
        notMeasurable: true,
        users: 0,
        labUsers,
        events: Number(events),
        firstSeen,
        lastSeen,
      });
      continue;
    }

    // --- funnel: EXACT per-user reach (union across each step's events) ------
    const steps = eng.funnel.map(s => {
      const u = organic.filter(r => didAny(r, s.events)).length;
      const instrumented = s.events.some(
        e => (seenMap.get(`${build}|${e}`) || 0) > 0,
      );
      return {step: s.step, users: u, pct: pct(u, totalUsers), instrumented};
    });

    // --- core-value events, IN PARALLEL (never collapsed) --------------------
    // Three different intents with very different base rates: audio, reading,
    // and completion. Averaging them into one "engagement %" would hide exactly
    // the thing we built this to see.
    const core = coreEvents.map(e => {
      const u = organic.filter(r => did(r, e)).length;
      const n = organic.reduce(
        (a, r) => a + Number(r[BASE + idx.get(e)] || 0),
        0,
      );
      return {
        event: e,
        users: u,
        events: n,
        pct: pct(u, totalUsers),
        instrumented: (seenMap.get(`${build}|${e}`) || 0) > 0,
      };
    });
    const hasValue = r => didAny(r, coreEvents);
    const anyValueUsers = organic.filter(hasValue).length;

    // --- cohort split --------------------------------------------------------
    // Alerting happens at the DAY level, diagnosis at day × OS version. This
    // split is load-bearing: on 2026-08-05 the 12-user zero-playback cluster
    // fragmented into a 3-user and a 9-user OS slice, and a per-OS threshold
    // sailed straight past the very thing this check exists to catch.
    const dayKey = r => String(r[2]).slice(0, 10);
    const byDay = new Map();
    for (const r of organic) {
      const d = dayKey(r);
      const c = byDay.get(d) || {
        day: d,
        users: 0,
        valueUsers: 0,
        matured: 0,
        maturedValue: 0,
        returned: 0,
        osVersions: new Map(),
      };
      c.users++;
      if (hasValue(r)) c.valueUsers++;
      if (hoursSince(r[2]) >= T.cohortMaturityHours) {
        c.matured++;
        if (hasValue(r)) c.maturedValue++;
      }
      if (hoursSince(r[2]) >= T.retentionMaturityHours && Number(r[3]) >= 2)
        c.returned++;
      const osv = r[5] ?? '—';
      const o = c.osVersions.get(osv) || {users: 0, valueUsers: 0};
      o.users++;
      if (hasValue(r)) o.valueUsers++;
      c.osVersions.set(osv, o);
      byDay.set(d, c);
    }
    const cohortList = [...byDay.values()].sort((a, b) =>
      a.day.localeCompare(b.day),
    );

    // Build-wide matured value rate — the reference a cohort is judged against.
    const buildMatured = organic.filter(
      r => hoursSince(r[2]) >= T.cohortMaturityHours,
    );
    const buildValueRate = pct(
      buildMatured.filter(hasValue).length,
      buildMatured.length,
    );

    for (const c of cohortList) {
      if (c.matured < T.zeroValueCohortMinUsers) continue;
      const rate = pct(c.maturedValue, c.matured);
      // Compare against the OTHER cohorts, not the build average — a bad cohort
      // large enough to matter also drags the build average down toward itself,
      // so a build-wide reference lets the worst cohort define its own norm and
      // escape. On 2026-08-05 that cohort was 12 of 18 matured users.
      const others = cohortList.filter(o => o !== c && o.matured > 0);
      const oMatured = others.reduce((a, o) => a + o.matured, 0);
      const refRate = pct(
        others.reduce((a, o) => a + o.maturedValue, 0),
        oMatured,
      );
      if (c.maturedValue === 0) {
        // The pure silent-failure shape: enough people, old enough to have
        // acted, and not one of them got any value from the app.
        c.flag = 'zero';
        alerts.push(
          `ZERO-VALUE COHORT — build ${build}, ${c.day}: ${c.matured} matured users, ` +
            `not one reached ${coreEvents.join(' / ')}`,
        );
      } else if (
        refRate &&
        oMatured >= T.zeroValueCohortMinUsers &&
        T.cohortValueRatioFloor &&
        rate < refRate * T.cohortValueRatioFloor
      ) {
        // Not zero, but far below every OTHER cohort — the same shape one day
        // later, once a single straggler converts and a strict ==0 test goes
        // quiet while nothing has actually improved.
        c.flag = 'low';
        warns.push(
          `LOW-VALUE COHORT — build ${build}, ${c.day}: ${(rate * 100).toFixed(
            0,
          )}% of ` +
            `${c.matured} matured users got value, vs ${(refRate * 100).toFixed(
              0,
            )}% ` +
            `across the other ${oMatured} matured users on this build`,
        );
      }
    }

    // --- activation ----------------------------------------------------------
    const maturedForActivation = buildMatured;
    let activation = null;
    if (maturedForActivation.length >= T.activationMinUsers) {
      activation = buildValueRate;
      if (activation < T.activationFloor) {
        warns.push(
          `LOW ACTIVATION — build ${build}: ${(activation * 100).toFixed(
            0,
          )}% of ` +
            `${maturedForActivation.length} matured users reached a core-value event ` +
            `(floor ${(T.activationFloor * 100).toFixed(0)}%)`,
        );
      }
    }

    // --- splash reach: the cold-start hang, as population data ---------------
    const launched = steps.find(s => s.step === 'launched');
    const splash = steps.find(s => s.step === 'past_splash');
    let splashReach = null;
    if (splash?.instrumented && launched && launched.users > 0) {
      splashReach = pct(splash.users, launched.users);
      if (splashReach < T.splashReachFloor) {
        alerts.push(
          `SPLASH REACH — build ${build}: only ${(splashReach * 100).toFixed(
            0,
          )}% of ` +
            `${launched.users} launchers reached splash_hidden ` +
            `(floor ${(T.splashReachFloor * 100).toFixed(
              0,
            )}%) — the cold-start-hang shape`,
        );
      }
    }

    // --- retention, maturity-gated ------------------------------------------
    // Only users old enough to HAVE had a day 2 count. Without this gate the
    // number is dominated by people who installed this morning and reads as a
    // retention collapse (2026-08-08: "23 of 24 one-day-only" was mostly that).
    const matured = organic.filter(
      r => hoursSince(r[2]) >= T.retentionMaturityHours,
    );
    const retention =
      matured.length >= T.retentionMinMaturedUsers
        ? pct(matured.filter(r => Number(r[3]) >= 2).length, matured.length)
        : null;
    const androidUsers = organic.filter(
      r => String(r[4] || '').toLowerCase() === 'android',
    ).length;

    // --- instrumentation gaps -----------------------------------------------
    const notInstrumented = [...steps, ...core]
      .filter(x => !x.instrumented)
      .map(x => x.step || x.event);

    builds.push({
      build,
      notMeasurable: false,
      // `users` is ORGANIC users, and every rate in this entry is over that
      // denominator. `labUsers` is reported beside it and never folded in.
      users: totalUsers,
      labUsers,
      androidUsers,
      events: Number(events),
      firstSeen,
      lastSeen,
      steps,
      core,
      anyValueUsers,
      anyValuePct: pct(anyValueUsers, totalUsers),
      activation,
      activationSample: maturedForActivation.length,
      splashReach,
      retention,
      retentionSample: matured.length,
      cohorts: cohortList,
      notInstrumented,
    });
  }

  // --- volume sanity — THE ONLY ROLLOUT-LADDER-DEPENDENT CHECK IN THIS FILE ---
  // expected ≈ rolloutFraction × daily base. BOTH halves need a ramp in flight:
  // the fraction is a property of a live ladder and stops existing when the
  // rollout completes. So when there is no rollout this is SKIPPED WITH A STATED
  // REASON rather than computed from a stale or assumed fraction — a shortfall
  // warning derived from a finished rollout is a fabricated alarm. Skipping it
  // costs one advisory note; every other check in this file keeps running.
  const ev = eng.expectedVolume || {};
  const rolloutActive = cfg.active === true;
  const frac = ARGS.fraction; // live, from --fraction; never guessed
  let volume = null;
  let volumeSkipped = null;
  if (!rolloutActive) {
    // A caller written for an in-flight ramp may still pass --fraction (both the
    // triage-loop skill and the scheduled task do). Ignore it LOUDLY rather than
    // honouring a number that no longer describes anything.
    volumeSkipped =
      frac === null
        ? 'no staged rollout in flight (active:false) — no ladder to compare against'
        : 'no staged rollout in flight (active:false) — --fraction IGNORED; a ladder ' +
          'fraction cannot describe a ramp that is already over';
  } else if (!ev.estimate || !frac) {
    volumeSkipped =
      'pass --fraction=<live rollout %> to enable the sanity check';
  } else {
    const expected = ev.estimate * frac;
    // ANDROID ONLY — `--fraction` is the Play staged-rollout fraction, so
    // folding iOS users in would compare a number against a denominator that
    // never governed them (and iOS is currently internal-only anyway).
    // Organic Android users only, and a not-measurable build contributes none
    // — it has no `androidUsers`, and counting its lab devices against a Play
    // staged-rollout fraction would invent a population the ladder never served.
    const actual = builds.reduce((a, b) => a + (b.androidUsers || 0), 0);
    volume = {
      expected: Math.round(expected),
      actual,
      ratio: pct(actual, expected),
      scope: 'android',
    };
    if (volume.ratio !== null && volume.ratio < T.volumeShortfall) {
      warns.push(
        `VOLUME SHORTFALL — ${actual} users vs ~${Math.round(
          expected,
        )} expected ` +
          `(${(frac * 100).toFixed(0)}% × ${
            ev.estimate
          }) — distribution or telemetry may be broken`,
      );
    }
  }

  const verdict = alerts.length ? 'ALERT' : warns.length ? 'WARN' : 'OK';
  return {
    verdict,
    rolloutActive,
    alerts,
    warns,
    builds,
    volume,
    volumeSkipped,
    caveats: eng.caveats || [],
  };
}

// --- output ------------------------------------------------------------------

function render(cfg, res) {
  const L = [];
  L.push(
    `▶ rollout-engagement  release=${cfg.release} builds=[${res.builds
      .map(b => b.build)
      .join(', ')}] ` +
      `window=${ARGS.days}d  rollout=${
        res.rolloutActive ? 'IN FLIGHT' : 'not in flight'
      }  verdict=${res.verdict}`,
  );

  if (!res.rolloutActive) {
    L.push(
      '  (no staged rollout in flight — engagement, funnel, cohort and restore-related',
    );
    L.push(
      '   measurement still runs; only the ladder volume check above is skipped)',
    );
  }

  if (res.volume) {
    const r =
      res.volume.ratio === null
        ? '—'
        : `${(res.volume.ratio * 100).toFixed(0)}%`;
    L.push(
      `  volume: ${res.volume.actual} users vs ~${res.volume.expected} expected (${r} of estimate)`,
    );
  } else {
    L.push(`  volume: skipped — ${res.volumeSkipped}`);
  }

  for (const b of res.builds) {
    L.push('');
    // BOTH LANES, ALWAYS. The header names the organic count first because every
    // percentage beneath it uses that denominator, and the lab count beside it so
    // a reader can see at a glance when a build is our own machines. Printing one
    // blended "N users" over an organic funnel is what made 1901 read as a
    // product failure on 2026-09-18.
    L.push(
      `  ── build ${b.build} — ${b.users} organic · ${
        b.labUsers
      } lab · ${b.events} events · ${String(b.firstSeen).slice(
        0,
        10,
      )} → ${String(b.lastSeen).slice(0, 10)}`,
    );

    if (b.notMeasurable) {
      L.push(
        `     not measurable — ${b.labUsers} lab-only users (boot-gate / CI). ` +
          'Engagement needs real users; build health comes from the boot gate ' +
          'and the .maestro suites.',
      );
      continue;
    }

    L.push('     funnel (per-user reach, organic users only):');
    for (const s of b.steps) {
      const tag = s.instrumented ? '' : '  ⚠ NOT INSTRUMENTED IN THIS BUILD';
      L.push(
        `       ${fpct(s.pct)}  ${String(s.users).padStart(4)}  ${
          s.step
        }${tag}`,
      );
    }

    L.push(
      '     core-value events (organic; parallel — different intents, different base rates):',
    );
    for (const c of b.core) {
      const tag = c.instrumented ? '' : '  ⚠ NOT INSTRUMENTED IN THIS BUILD';
      L.push(
        `       ${fpct(c.pct)}  ${String(c.users).padStart(4)} users  ${String(
          c.events,
        ).padStart(5)} ev  ${c.event}${tag}`,
      );
    }
    L.push(
      `       → ${b.anyValueUsers}/${
        b.users
      } organic users reached AT LEAST ONE (${fpct(b.anyValuePct).trim()})`,
    );

    L.push(
      `     activation: ${
        b.activation === null
          ? `too few matured users to judge (${b.activationSample})`
          : `${(b.activation * 100).toFixed(0)}% of ${
              b.activationSample
            } matured organic users`
      }`,
    );
    L.push(
      `     retention (day-2): ${
        b.retention === null
          ? `too few matured users to judge (${b.retentionSample})`
          : `${(b.retention * 100).toFixed(0)}% of ${
              b.retentionSample
            } matured organic users`
      }`,
    );
    if (b.splashReach !== null) {
      L.push(
        `     past-splash: ${(b.splashReach * 100).toFixed(
          0,
        )}% of organic launchers`,
      );
    }

    L.push(
      '     cohorts by first-seen day, organic (alerting level) — OS split beneath for diagnosis:',
    );
    for (const c of b.cohorts) {
      const flag =
        c.flag === 'zero'
          ? '  ⛔ ZERO VALUE'
          : c.flag === 'low'
            ? '  ⚠ LOW VALUE'
            : '';
      L.push(
        `       ${c.day}  ${String(c.users).padStart(3)} users  ${String(
          c.valueUsers,
        ).padStart(3)} w/ value  ` +
          `(matured ${c.maturedValue}/${c.matured})${flag}`,
      );
      const os = [...c.osVersions.entries()].sort((x, y) =>
        String(x[0]).localeCompare(String(y[0])),
      );
      L.push(
        `           OS ${os
          .map(([v, o]) => `${v}:${o.valueUsers}/${o.users}`)
          .join('  ')}`,
      );
    }

    if (b.notInstrumented.length) {
      L.push(
        `     ⚠ absent from this build (a zero here is "unobserved", NOT "clean"): ${b.notInstrumented.join(
          ', ',
        )}`,
      );
    }
  }

  if (res.alerts.length) {
    L.push('');
    for (const a of res.alerts) L.push(`  ⛔ ${a}`);
  }
  if (res.warns.length) {
    L.push('');
    for (const w of res.warns) L.push(`  ⚠️  ${w}`);
  }

  if (res.caveats.length) {
    L.push('');
    L.push('  Standing caveats (read before interpreting any zero):');
    for (const c of res.caveats) L.push(`    • ${c}`);
  }

  L.push('');
  L.push(
    `▶ done — verdict=${res.verdict}; report-only, nothing filed or changed.`,
  );
  return L.join('\n');
}

// --- main --------------------------------------------------------------------

async function main() {
  const cfg = loadConfig();
  if (!cfg) {
    // NOTE: this is now the ONLY config-shaped reason to skip. It fires when the
    // file is missing/unparseable or carries no `engagement` block — i.e. nothing
    // is configured to measure. It deliberately no longer fires on `active:false`.
    const msg =
      'rollout-engagement: no `engagement` block in docs/operations/active-rollout.json ' +
      '(or the file is missing/unparseable) — nothing configured to measure, skipping.';
    console.log(
      ARGS.json ? JSON.stringify({skipped: true, reason: msg}, null, 2) : msg,
    );
    return;
  }
  if (!PROJECT || !TOKEN) {
    const msg =
      'rollout-engagement: POSTHOG_PROJECT_ID / POSTHOG_PERSONAL_API_TOKEN unset — skipping.';
    console.log(
      ARGS.json ? JSON.stringify({skipped: true, reason: msg}, null, 2) : msg,
    );
    return;
  }

  let res;
  try {
    res = analyse(cfg, await collect(cfg));
  } catch (err) {
    // Advisory tool: a PostHog hiccup must never fail the loop that calls it.
    const msg = `rollout-engagement: query failed — ${err.message}`;
    console.log(
      ARGS.json ? JSON.stringify({skipped: true, reason: msg}, null, 2) : msg,
    );
    return;
  }

  if (ARGS.json) {
    // Cohort osVersions is a Map — JSON.stringify would silently emit `{}` and
    // quietly drop the whole per-OS diagnostic breakdown.
    const out = {
      release: cfg.release,
      ...res,
      // A not-measurable build carries no cohorts at all — mapping over it would
      // throw, and emitting an empty array would read as "measured, found none".
      builds: res.builds.map(b =>
        b.cohorts
          ? {
              ...b,
              cohorts: b.cohorts.map(c => ({
                ...c,
                osVersions: Object.fromEntries(c.osVersions),
              })),
            }
          : b,
      ),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(render(cfg, res));
}

await main();
