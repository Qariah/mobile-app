#!/usr/bin/env node
// @ai
//
// scripts/daily-card.mjs
// ----------------------
// The one-screen rollout card: how many real people are using the release, how
// far they get, and what is failing them. Built to be COPY-PASTED INTO WHATSAPP
// — narrow enough not to wrap on a phone, wrapped in a ``` block so the column
// alignment survives.
//
// WHY THIS EXISTS. The daily loop's report grew into several screens of prose,
// which is a format nobody reads on a phone and which buried the two questions
// that actually matter during a ramp: how many people, and did it work for them.
// This prints those first and everything else only when it is not fine.
//
// THE LAYOUT (owner, 2026-10-11; the ANR block changed 2026-10-20): header
// (date, what is counted, rollout), people and the journey, ACTIVE, USE,
// FAILURES, FREEZES (ANR), the ops sections, NEEDS YOU last.
// scripts/lib/card-layout.mjs explains what each block counts. FREEZES (ANR)
// replaces the three ANR sections and the A/B section: one line of users who
// froze per platform with a verdict, and Google's score
// (scripts/lib/anr-card.mjs, planning/signals-anr-listens-design.md). The A/B
// section prints only with --ab; while the rollout is active, a blocking stop
// condition that FAILS puts one ⛔ line at the top of FREEZES (ANR).
//
// WHAT IT IS NOT. `rollout-engagement.mjs` stays the diagnostic instrument —
// cohorts, activation, retention, per-OS splits, threshold alerts. This is the
// headline. When they disagree, engagement is the one to debug.
//
//   node scripts/daily-card.mjs                      # since launch
//   node scripts/daily-card.mjs --since=14d
//   node scripts/daily-card.mjs --ios='20% ▲ rising' --android='50%'
//   node scripts/daily-card.mjs --json
//   node scripts/daily-card.mjs --anr                # the FREEZES (ANR) block only
//   node scripts/daily-card.mjs --no-anr             # the card without it
//   node scripts/daily-card.mjs --ab                 # the A/B section only, with
//                                                    # its BLOCKING lines
//                                                    # (scripts/lib/ab-card.mjs)
//   node scripts/daily-card.mjs --no-ab              # accepted; does nothing (G-C8)
//   node scripts/daily-card.mjs --release-watch      # the RELEASE WATCH section only
//   node scripts/daily-card.mjs --no-owner           # the card without NEEDS YOU
//                                                    # (scripts/owner-actions.mjs)
//   node scripts/daily-card.mjs --sections=triage    # the card without SHIPPED (the
//                                                    # cloud routine; SHIPPED reads a local file)
//   node scripts/daily-card.mjs --sections=triage --post-issue='Daily card'
//        # also post the card as a comment on the open `ops` issue with that exact
//        # title (created and pinned when missing). Shadow mode posts only to
//        # 'Daily card (shadow)'.
//
// In a cloud session (CLAUDE_CODE_REMOTE=true) the card reads no local file
// under build/, and GitHub is read over REST only (scripts/lib/triage-common.mjs).
//
// Env: POSTHOG_PERSONAL_API_TOKEN + POSTHOG_PROJECT_ID (required)
//      SENTRY_READ_TOKEN + SENTRY_ORG + SENTRY_PROJECT (optional — without them
//      the crash half of the failure section is omitted rather than guessed at)
//      Play service account + APP_STORE_CONNECT_API_KEY_ID (optional — the ANR
//      section prints `unavailable` for a source it cannot reach)

import {existsSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {classifyIntake, INTAKE_WINDOW_HOURS} from './lib/intake.mjs';
import {shallowWatchBuilds} from './lib/release-watch.mjs';
import {cardSection, evaluateOwnerActions} from './lib/owner-actions.mjs';
import {
  fixedInLabelled,
  loadOwnerActions,
  loadOwnerActionsWithReplies,
  makeFacts,
  noFixBuildsOf,
} from './lib/owner-actions-facts.mjs';
import {ownerDate} from './lib/run-health.mjs';
import {
  commentOnIssue,
  findOrCreateIssue,
  ghApi,
  isCloudSession,
  isShadowRun,
  listIssues,
  listOpenPulls,
  SHADOW_CARD_TITLE,
} from './lib/triage-common.mjs';
import {
  fetchAscHang,
  fetchPlayAnr,
  fetchSentryAnr,
  fetchSentryWeek,
  freezeOptions,
  renderAnrCard,
} from './lib/anr-card.mjs';
import {labExclusionSQL, sqlList} from './lib/lab-exclusion.mjs';
import {createPosthogClient, posthogConfig} from './lib/posthog-client.mjs';
import {
  abConfig,
  blockingStopConditions,
  collectAbModel,
  renderAbCard,
} from './lib/ab-card.mjs';
import {
  cardBuilds,
  renderActive,
  renderHeader,
  renderJourney,
  renderUse,
  wrap,
} from './lib/card-layout.mjs';
import {
  fixedInLabelOf,
  parseTriageState,
  resolveFixedIn,
} from './lib/triage-taxonomy.mjs';

const CONFIG_PATH = 'docs/operations/active-rollout.json';

// PostHog silently truncates at 100 rows when a query omits LIMIT — the bug that
// understated this rollout for its whole life (see rollout-engagement.mjs).
// Every query here is aggregate-shaped and tiny, but pass a cap regardless.
const ROW_CAP = 100_000;

// NON-PEOPLE. The production PostHog project carries our own traffic (boot-gate
// hardware, CI emulators, dev simulators) — roughly 13% of all 3.2.0 users.
// The definition now lives in scripts/lib/lab-exclusion.mjs so this card and
// rollout-engagement.mjs cannot disagree about what counts as a person; they
// did disagree for the life of the 3.2.0 rollout, and only this file filtered.

const ARGS = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const PH = posthogConfig();
const {token: PH_TOKEN, project: PH_PROJECT} = PH;

const SENTRY_TOKEN = process.env.SENTRY_READ_TOKEN;
const SENTRY_ORG = process.env.SENTRY_ORG || 'qariah';
const SENTRY_HOST = (
  process.env.SENTRY_REGION_HOST || 'https://sentry.io'
).replace(/\/$/, '');

const posthog = createPosthogClient({...PH, timeoutMs: 90_000});

// Every query here carries its own LIMIT ROW_CAP. A result that holds ROW_CAP
// rows might be cut off, so it throws instead of returning a number.
const hogql = query =>
  posthog.hogql(query, {
    cap: ROW_CAP,
    capMessage: () => 'hit ROW_CAP — refusing to report truncated data',
  });

// --- the journey -------------------------------------------------------------
//
// Ordered, and each step is the UNION of its events (a user who skipped
// onboarding is as "set up" as one who completed it). Labels are deliberately
// plain English: this card gets forwarded to people who do not know what a
// `meaningful_listen` is.
//
// "Installed" is NOT the store download count, and it is NOT a journey step:
// `Application Installed` / `Application Updated` fire once, on the first
// launch after an install or an update. A person who updated before the window
// opens the app every day and never sends one in it, so "installed" can be far
// below "opened" (2598 vs 4656 on 2026-10-11). The card prints it as its own
// line under the people count (card-layout.mjs renderJourney); the journey
// starts at Opened. True downloads need App Store Connect (Sales & Trends) or
// the Play reports bucket.
//
// "Logged in" counts the people who signed in on a counted build. PostHog does
// not know who is ALREADY signed in: the app never calls identify() and sends
// no signed-in property, so a person who signed in on an older build and
// stayed signed in does not count. The number is a floor until the app reports
// its signed-in state on each launch.
const STEPS = [
  {
    key: 'installed',
    label: 'Installed',
    events: ['Application Installed', 'Application Updated'],
  },
  {key: 'opened', label: 'Opened', events: ['cold_start_began']},
  // Past loading = a first screen rendered: splash_hidden OR
  // screen_content_rendered, the cold-start completion that ColdStartBeganProps
  // (services/analytics/qariahEvents.ts) defines. scripts/lib/ab-card.mjs and
  // the engagement funnel (active-rollout.json) use the same two events.
  {
    key: 'past_loading',
    label: 'Past loading',
    events: ['splash_hidden', 'screen_content_rendered'],
  },
  {
    key: 'logged_in',
    label: 'Logged in',
    events: ['sign_in_succeeded'],
    or: "(event = 'onboarding_completed' AND properties.signed_in = true)",
  },
  {
    key: 'started',
    label: 'Started',
    events: ['playback_started', 'mushaf_page_opened'],
  },
  {
    key: 'used_it',
    label: 'Really used',
    events: ['meaningful_listen', 'mushaf_page_read', 'playback_completed'],
  },
];
const stepCond = s =>
  [`event IN (${sqlList(s.events)})`, s.or].filter(Boolean).join(' OR ');

// --- how much it is being used -----------------------------------------------
//
// The journey above counts PEOPLE and answers "did it work for them". It cannot
// answer "how much is it being used", because a person who played one ayah and a
// person who played four hundred are the same single tick in "Really used". This
// block is the volume half: raw event counts, not reach.
//
// `playback_started` is the honest recitation-start count. It fires ONCE per
// track — ExpoAudioProvider guards it with hasFiredStartedRef and only clears
// that when the track id changes — so pausing and resuming the same recitation
// does NOT re-count, and the number cannot be inflated by a user scrubbing.
// User uploads are excluded at the emit site, so this is catalog listening only.
//
// The other three are the depth behind that headline:
//   • meaningful_listen  — fired at 10% of the track or 30s, whichever is SMALLER
//   • playback_completed — played through to the end
//   • mushaf_page_opened — the reading side, which the play count is blind to
const USAGE = [
  {key: 'plays', label: 'Recitations', events: ['playback_started']},
  {key: 'heard', label: 'Heard properly', events: ['meaningful_listen']},
  {key: 'finished', label: 'Finished', events: ['playback_completed']},
  {key: 'pages', label: 'Mushaf pages', events: ['mushaf_page_opened']},
];

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function windowClause(cfg) {
  const since = String(ARGS.since || 'launch');
  if (since === 'launch') {
    const start = (cfg && cfg.startedAt) || '2026-01-01';
    // Calendar days elapsed, floored at 1 — it is only ever the divisor for the
    // per-day rates, and a zero here would print Infinity on launch day itself.
    const days = Math.max(
      1,
      Math.ceil(
        (Date.now() - new Date(`${start}T00:00:00`).getTime()) / 86_400_000,
      ),
    );
    return {
      sql: `timestamp >= toDateTime('${start} 00:00:00')`,
      label: `since launch (${start})`,
      days,
    };
  }
  const m = since.match(/^(\d+)d$/);
  if (!m) throw new Error(`--since must be "launch" or "<N>d", got "${since}"`);
  return {
    sql: `timestamp > now() - INTERVAL ${m[1]} DAY`,
    label: `last ${m[1]} days`,
    days: Number(m[1]),
  };
}

// The three trailing windows of ACTIVE and USE, ending now, one day ago and
// two days ago. Trailing windows, not calendar days: "Today" is the last 24 h
// before the run, so it is a full day at any hour.
const ACTIVE_ROWS = [
  {label: 'Today', shift: 0},
  {label: 'Yesterday', shift: 1},
  {label: 'Day before', shift: 2},
];
const trailing = (days, shift = 0) =>
  `timestamp > now() - INTERVAL ${days + shift} DAY` +
  (shift ? ` AND timestamp <= now() - INTERVAL ${shift} DAY` : '');

async function collect(cfg) {
  const builds = cardBuilds(cfg);
  if (!builds.length)
    throw new Error(
      'active-rollout.json names no production build (card.builds, sentryRelease)',
    );
  const win = windowClause(cfg);
  const scope = `properties.$app_build IN (${sqlList(builds.map(b => b.build))}) AND ${labExclusionSQL()}`;

  // EVERY number here is derived from a PER-USER subquery, never from grouping
  // raw events. Bucketing per event double-counts anyone whose events disagree:
  // $os_name is not set on every event, so the same person lands in both the
  // iOS and Android groups and the platform columns sum to MORE than the
  // population. That is how a 329-person release first printed as "340 people ·
  // iPhone 219 · Android 121". Resolve identity once per person, then
  // aggregate. iPadOS is iOS: before 2026-10-11 an iPad counted as Android.
  const perUserCols = STEPS.map(
    s => `countIf(${stepCond(s)}) AS ${s.key}`,
  ).join(',\n         ');
  const reachCols = STEPS.map(s => `countIf(${s.key} > 0) AS ${s.key}`).join(
    ',\n       ',
  );
  const PER_USER = `SELECT person_id,
         multiIf(any(properties.$os_name) IN ('iOS', 'iPadOS'), 'iOS', 'Android') AS platform,
         ${perUserCols}
       FROM events WHERE ${win.sql} AND ${scope}
       GROUP BY person_id`;

  // ACTIVE and USE count EVERY version, unlike the rest of the card. Scoping
  // them to the counted builds would measure rollout ADOPTION, not activity: a
  // person active every day on an older build is a real active user, and the
  // numbers would dip whenever a new build starts rolling. Lab traffic is still
  // excluded. Safe only because this PostHog project receives v2 traffic only
  // (verified 2026-08-30: 3.2.0, 3.2.1, 3.1.8 and nothing else; v1 Flutter
  // never shipped PostHog). IF ANOTHER APP EVER REPORTS HERE, a version filter
  // becomes mandatory. One 32-day scan answers all nine ACTIVE numbers, and
  // one 30-day scan all twelve USE numbers.
  const activeCols = ACTIVE_ROWS.flatMap(({shift}) =>
    [1, 7, 30].map(d => `uniqIf(person_id, ${trailing(d, shift)})`),
  ).join(',\n       ');
  const activeQuery = `SELECT ${activeCols}
     FROM events
     WHERE timestamp > now() - INTERVAL 32 DAY AND ${labExclusionSQL()}`;

  // USE is a straight event count, so grouping raw events is CORRECT here (we
  // want every occurrence).
  const usageQuery = `SELECT event,
       countIf(${trailing(1)}), countIf(${trailing(7)}), count()
     FROM events
     WHERE timestamp > now() - INTERVAL 30 DAY AND ${labExclusionSQL()}
       AND event IN (${sqlList(USAGE.flatMap(u => u.events))})
     GROUP BY event LIMIT ${ROW_CAP}`;

  const [byPlatform, usageRows, activeRows] = await Promise.all([
    hogql(`SELECT platform, count() AS total,
       ${reachCols}
     FROM (${PER_USER}) GROUP BY platform ORDER BY total DESC LIMIT ${ROW_CAP}`),
    hogql(usageQuery),
    hogql(activeQuery),
  ]);

  // Absent row ⇒ null, never 0: nobody active and "the query returned nothing"
  // are different claims, and the renderer prints them differently.
  let active = null;
  if (activeRows && activeRows.length) {
    const v = activeRows[0].map(Number);
    active = ACTIVE_ROWS.map(({label}, i) => ({
      label,
      dau: v[i * 3],
      wau: v[i * 3 + 1],
      mau: v[i * 3 + 2],
    }));
  }

  // Absent event ⇒ 0, never undefined: a metric that never fired must print as a
  // real zero, not vanish from the block (an absent line reads as "not checked").
  const usageByEvent = Object.fromEntries(
    usageRows.map(r => [String(r[0]), r.slice(1).map(Number)]),
  );
  const usage = USAGE.map(u => {
    const hits = u.events.map(e => usageByEvent[e]).filter(Boolean);
    const sum = i => hits.reduce((a, h) => a + h[i], 0);
    return {
      label: u.label,
      key: u.key,
      day: sum(0),
      week: sum(1),
      month: sum(2),
    };
  });

  // Journey failures are computed PER USER, not by subtracting two aggregates.
  // `installed - opened` silently assumes opened ⊆ installed, and says nothing
  // about which individuals fell out — so it cannot apply the two tests below
  // that separate a real failure from an artifact:
  //
  //   • screen_content_rendered fired ⇒ the screen came up. Whatever else
  //     happened, that user was NOT stuck on a loading spinner. This is exactly
  //     what useContentReadyWatchdog was built to tell us; use it.
  //   • the whole session lasted < MIN_HUMAN_SESSION_MS ⇒ nobody was there.
  //     Both "stuck" users on 2026-08-15 installed, rendered and backgrounded
  //     inside ~150ms, which is store/scanner install-verification at machine
  //     speed, not a person failing to get in.
  const MIN_HUMAN_SESSION_MS = 2000;
  const stuck = await hogql(`SELECT build, platform, kind, count() AS n FROM (
       SELECT any(properties.$app_build) AS build,
         multiIf(any(properties.$os_name) IN ('iOS', 'iPadOS'), 'iOS', 'Android') AS platform,
         person_id,
         countIf(event IN ('Application Installed','Application Updated')) AS installed,
         countIf(event = 'cold_start_began') AS opened,
         countIf(event = 'splash_hidden') AS past,
         countIf(event = 'screen_content_rendered') AS rendered,
         dateDiff('millisecond', min(timestamp), max(timestamp)) AS span_ms,
         multiIf(
           countIf(event = 'cold_start_began') = 0, 'never got in',
           'stuck on loading') AS kind
       FROM events WHERE ${win.sql} AND ${scope}
       GROUP BY person_id
       HAVING installed > 0
          AND span_ms >= ${MIN_HUMAN_SESSION_MS}
          AND rendered = 0
          AND (opened = 0 OR past = 0)
     ) GROUP BY build, platform, kind ORDER BY n DESC LIMIT ${ROW_CAP}`);

  return {builds, win, byPlatform, stuck, usage, active};
}

// --- failures ----------------------------------------------------------------
//
// Two independent sources, because they catch different things:
//   1. JOURNEY failures (PostHog) — people who fell out of the funnel. These are
//      silent: nobody crashes, nobody files anything, the user just never gets in.
//   2. CRASH failures (Sentry) — error/fatal issues on this release.
// A clean card must mean BOTH are clean, or it teaches the reader to ignore it.

function journeyFailures(stuck) {
  return stuck
    .map(([build, platform, kind, n]) => ({
      n: Number(n),
      platform,
      build,
      what: kind,
    }))
    .filter(f => f.n > 0)
    .sort((a, b) => b.n - a.n);
}

// Sentry titles are developer strings — full of `Error Domain=NSCocoaErrorDomain
// Code=640`, URLs and UserInfo dictionaries. This card gets forwarded to people
// who do not read stack traces, and a title chopped mid-word ("Failed to write
// value.Erro") reads as a broken tool rather than a real finding. Map the shapes
// we actually see to plain language, and otherwise cut on a word boundary.
const CRASH_PHRASES = [
  [/out of space|Code=640|No space left/i, 'phone storage full'],
  [/Unable to open URL/i, "couldn't open a link"],
  [/Network request failed/i, 'network request failed'],
  [/WatchdogTermination/i, 'app froze, OS killed it'],
  [/OutOfMemoryError/i, 'ran out of memory'],
  // QF API errors carry the URL and the server's JSON in the title.
  [/^QF \S+ failed: 5\d\d/, 'QF server error'],
  [/^QF \S+ failed/, 'QF request failed'],
];

function humanizeCrash(raw) {
  const s = String(raw).replace(/\s+/g, ' ').trim();
  for (const [re, phrase] of CRASH_PHRASES) if (re.test(s)) return phrase;
  const head = s.split(/(?<=[.!?])\s|:\s/)[0];
  if (head.length <= 30) return head;
  // Cut on a word boundary, unless that leaves only a stub ("QF…").
  const cut = head.slice(0, 29).replace(/\s+\S*$/, '');
  return `${cut.length >= 15 ? cut : head.slice(0, 29)}…`;
}

// Sentry requests that failed in sentryFailures(). The card still prints the
// rows it got; `--json` reports the count (crashesFailedRequests), so the
// signals snapshot can mark its card section partial instead of trusting a
// short list (planning/signals-phase1-design.md, gap 19).
let sentryFailedRequests = 0;

async function sentryFailures(builds, cfg) {
  if (!SENTRY_TOKEN) return null;

  // Sentry releases carry the BUILD suffix (com.qariah.app@3.2.0+1713), so a
  // query for the bare version matches nothing at all — and returns 200 with an
  // empty list, i.e. it looks exactly like "no crashes". Query per build and
  // merge. Sentry rejects OR in this search, so it is one request per build.
  const suppress = new Set(
    ((cfg && cfg.card && cfg.card.suppressIssues) || []).map(s => s.id || s),
  );
  const seen = new Map();

  for (const b of builds) {
    const url = new URL(
      `${SENTRY_HOST}/api/0/organizations/${SENTRY_ORG}/issues/`,
    );
    url.searchParams.set(
      'query',
      `release:com.qariah.app@${b.version}+${b.build} is:unresolved`,
    );
    url.searchParams.set('statsPeriod', '14d');
    url.searchParams.set('limit', '25');
    let issues;
    try {
      const res = await fetch(url, {
        headers: {Authorization: `Bearer ${SENTRY_TOKEN}`},
      });
      if (!res.ok) {
        sentryFailedRequests++;
        continue;
      }
      issues = await res.json();
    } catch {
      sentryFailedRequests++;
      continue;
    }
    if (!Array.isArray(issues)) {
      sentryFailedRequests++;
      continue;
    }

    for (const i of issues) {
      // Warnings are the memory probe and assorted lint-grade noise — not
      // "failures a person hit". Only error/fatal earns a line on this card.
      if (i.level !== 'error' && i.level !== 'fatal') continue;
      if (suppress.has(i.shortId)) continue;
      if (!seen.has(i.shortId)) {
        seen.set(i.shortId, {
          id: i.shortId,
          level: i.level,
          // NOTE: userCount is the WHOLE-ISSUE count across every release, not
          // this build's share. Shown as an upper bound; never quote it as
          // "N users on this build".
          users: Number(i.userCount) || 0,
          title: humanizeCrash(
            (i.metadata && i.metadata.value) || i.title || '',
          ),
          builds: [b.build],
        });
      } else {
        seen.get(i.shortId).builds.push(b.build);
      }
    }
  }

  return [...seen.values()].sort((a, b) => b.users - a.users).slice(0, 5);
}

// --- ANR -----------------------------------------------------------------------
//
// The card prints sentry.week (users who froze in the last 7 complete UTC
// days, the production builds of card.builds) and Play's 7-day rate, pooled
// over the production versionCodes of card.builds (decision G-G4; before
// 2026-10-20 the card pooled every v2 versionCode that Play had data for). The
// JSON also keeps the daily Sentry rates and the App Store hang rate.
//
// The daily Sentry rates: Sentry sessions carry no OS, so each release's
// platform comes from PostHog: the OS its cold starts report. A build number
// seen on both platforms (the internal builds share numbers) gets no platform
// and is left out of those rates entirely, which also keeps the simulators and
// emulators out. sentry.week needs no such map: card.builds names the
// platform of each production build.
async function collectAnr(cfg) {
  const rows = await hogql(`SELECT properties.$app_build AS build,
       countIf(properties.$os IN ('iOS', 'iPadOS')) AS ios,
       countIf(properties.$os = 'Android') AS android
     FROM events
     WHERE event = 'cold_start_began' AND timestamp > now() - INTERVAL 35 DAY
     GROUP BY build LIMIT ${ROW_CAP}`);
  const platformOfBuild = new Map();
  for (const [build, ios, android] of rows) {
    const total = Number(ios) + Number(android);
    if (!build || !total) continue;
    if (Number(ios) / total >= 0.9)
      platformOfBuild.set(String(build), 'iPhone');
    else if (Number(android) / total >= 0.9) {
      platformOfBuild.set(String(build), 'Android');
    }
  }
  const builds = cardBuilds(cfg);
  const androidCodes = builds
    .filter(b => b.platform === 'Android')
    .map(b => Number(b.build));
  const [play, sentry, appStore, week] = await Promise.all([
    // No Android production build: no Play line (null), not every v2 code.
    androidCodes.length ? fetchPlayAnr({codes: androidCodes}) : null,
    fetchSentryAnr({
      token: SENTRY_TOKEN,
      org: SENTRY_ORG,
      host: SENTRY_HOST,
      platformOfBuild,
    }),
    fetchAscHang(),
    fetchSentryWeek({
      token: SENTRY_TOKEN,
      org: SENTRY_ORG,
      host: SENTRY_HOST,
      builds,
    }),
  ]);
  // Additive: anr.sentry.week sits beside the daily rates. It is kept when
  // the daily rates failed ({error, week}), because it does not depend on them.
  return {play, sentry: sentry ? {...sentry, week} : null, appStore};
}

// The FREEZES (ANR) block options: a staged rollout runs while `active` is
// true and two Android production builds serve users; while active, a
// blocking A/B stop condition that FAILS is one ⛔ line, and NO DATA is the
// line `A/B check: no data` (ab is null when no rollout is active).
const anrOptions = (cfg, ab) =>
  freezeOptions({
    active: !!(cfg && cfg.active === true),
    builds: cardBuilds(cfg),
    abConditions: ab ? blockingStopConditions(ab) : [],
  });

// --- A/B -----------------------------------------------------------------------
//
// The staged build's A/B (active-rollout.json → abTest). Null — and no section —
// when no rollout is active or the JSON does not name the flag.
function collectAb(cfg) {
  const ab = abConfig(cfg);
  if (!ab) return null;
  return collectAbModel(ab, {
    hogql,
    sentry: {token: SENTRY_TOKEN, org: SENTRY_ORG, host: SENTRY_HOST},
    // The files the build changed (GitHub REST compare; the cloud clone is
    // shallow, so git cannot answer). Null when the JSON names no base.
    changedFiles: ({baseSha, buildSha}) => {
      if (!baseSha || !buildSha) return null;
      const r = ghApi(`repos/${GH_REPO}/compare/${baseSha}...${buildSha}`);
      return r && Array.isArray(r.files) ? r.files.map(f => f.filename) : null;
    },
  });
}

// --- ops sections (feedback graph) -------------------------------------------
//
// Five sections the daily auto-sprint and the fix loop hand the owner. Each
// source is optional and independent: a missing file or an offline `gh` prints
// `unavailable`, never a fabricated zero. `--no-ops` skips the block entirely
// (the PostHog-only card the 1pm loop pastes when it has no shipping news).
//
//   SHIPPED       build/auto-sprint-last.json  — written by post-sprint Step 14b/16
//   HELD          `needs-decision` issues       — the owner's queue (design / copy / product)
//   REPLY DRAFTS  `reply-draft` issues          — store-review replies awaiting the owner's numbers
//   CI FOLLOW-UP  remediation-drafted drafts blocked by a red check OR a base
//                 conflict — the loop's Step 3.5 queue
//   RELEASE WATCH issues whose fix is built but not in production, and each new
//                 build that no issue names as its fix build (releaseWatchLines)

const GH_REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';
const BUILD_DIR = process.env.QARIAH_BUILD_DIR || 'build';

function shippedLines() {
  if (isCloudSession())
    return ['not available in a cloud session (build/ is a local file)'];
  const f = `${BUILD_DIR}/auto-sprint-last.json`;
  if (!existsSync(f)) return ['none today (no build/auto-sprint-last.json)'];
  let a;
  try {
    a = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return ['unreadable build/auto-sprint-last.json'];
  }
  const today = new Date().toLocaleDateString('en-CA');
  if (a.date !== today)
    return [`none today (last: ${a.date || '?'} · ${a.branch || '?'})`];
  if (a.skipped) return [`skipped — ${a.skipped}`];
  const L = [];
  L.push(
    `${a.branch || '?'} → PR #${a.sprintPr || '?'} · merged: ${a.merged ? 'yes' : `no — ${a.mergeBlockedBy || 'gates not all green'}`}`,
  );
  const b = a.builds || {};
  L.push(
    `iOS ${b.ios || '?'} (${a.deliveryUuid || 'no delivery uuid'}) · Android ${b.android || '?'} (${a.playTrack || 'no track'})`,
  );
  L.push(
    `fixed: ${(a.fixed || []).length ? (a.fixed || []).map(n => `#${n}`).join(' ') : 'none'} · adopted drafts: ${(a.adopted || []).length}`,
  );
  return L;
}

function heldLines() {
  try {
    const rows = listIssues({
      state: 'open',
      labels: 'needs-decision',
      limit: 20,
    });
    if (!rows.length) return ['none'];
    return rows.map(r => `#${r.number} ${r.title.slice(0, 70)}`);
  } catch {
    return ['unavailable (gh offline or unauthenticated)'];
  }
}

function replyDraftLines() {
  try {
    const rows = listIssues({state: 'open', labels: 'reply-draft', limit: 20});
    if (!rows.length) return ['none'];
    return rows
      .map(
        (r, i) =>
          `${String(i + 1).padStart(2)}. #${r.number} ${r.title.slice(0, 64)}`,
      )
      .concat([
        'to post: say "post replies <numbers>" → node scripts/review-reply.mjs post --issue=<n>',
      ]);
  } catch {
    return ['unavailable (gh offline or unauthenticated)'];
  }
}

function ciFollowUpLines() {
  try {
    // A loop draft = label OR branch pattern (the label sat on the issues only until
    // 2026-09-07, so a label-only query saw nothing). ops/* and repro-* are not fixes.
    const isLoop = r =>
      ((r.labels || []).some(l => l.name === 'remediation-drafted') ||
        /^qariah\/(fix|triage)-/.test(r.headRefName || '')) &&
      !/^(ops\/|qariah\/repro-)/.test(r.headRefName || '');
    // REST: the checks and `mergeable` are read only for the loop drafts.
    const rows = listOpenPulls({limit: 60, filter: isLoop});
    // A draft is blocked by a red check OR by a conflict with the base. The
    // auto-sprint adopts neither, so reporting only checks called a CONFLICTING
    // draft "green" and parked it silently (observed on #331, 2026-09-08).
    const redCheck = r =>
      (r.statusCheckRollup || []).some(c =>
        /FAIL|ERROR|TIMED_OUT|CANCELLED/i.test(c.conclusion || c.state || ''),
      );
    const conflicting = r => r.mergeable === 'CONFLICTING';
    const blocked = rows.filter(r => redCheck(r) || conflicting(r));
    if (!rows.length) return ['no open loop drafts'];
    if (!blocked.length) return [`all ${rows.length} loop drafts green`];
    return blocked.map(r => {
      const why = [
        redCheck(r) ? 'red check' : null,
        conflicting(r) ? 'CONFLICTING with base' : null,
      ]
        .filter(Boolean)
        .join(' + ');
      return `PR #${r.number} ${r.title.slice(0, 60)} — ${why}`;
    });
  } catch {
    return ['unavailable (gh offline or unauthenticated)'];
  }
}

// RELEASE WATCH. Two deterministic lines.
//   1. How many open issues wait for a release: a build carries the fix
//      (`fixed-in:<build>` label or a triage-state ledger row), but production
//      does not yet. These are NOT open work — the digest leaves them out too.
//   2. Each new build in `engagement.buildsToWatch` that no issue names as its
//      fix build. A hand-made build (hotfix, manual publish) skips post-sprint
//      Step 14b, so nothing records what it fixes unless someone runs
//      scripts/stamp-fixed-in.mjs. Build 1975 (PR #451) was the first miss.
// Cost: one listing of the open issues + one REST call per new build.

const RECENT_DAYS = 14;

// When did each build join buildsToWatch? From the git history of the rollout
// file. Returns null when the history is missing (a shallow CI or cloud
// checkout); the caller then uses shallowWatchBuilds().
function buildAddedDates() {
  try {
    if (
      execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true'
    )
      return null;
    const log = execFileSync(
      'git',
      ['log', '-p', '--reverse', '--format=@@COMMIT %cI', '--', CONFIG_PATH],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64e6},
    );
    const added = new Map();
    let date = null;
    for (const line of log.split('\n')) {
      const c = line.match(/^@@COMMIT (\S+)/);
      if (c) date = new Date(c[1]);
      const b = line.match(/^\+\s*"(\d{3,5})",?\s*$/);
      if (b && date && !added.has(b[1])) added.set(b[1], date);
    }
    return added.size ? added : null;
  } catch {
    return null;
  }
}

function openIssueLabels() {
  return listIssues({state: 'open'}).map(i => [
    i.number,
    i.labels.map(l => l.name),
  ]);
}

function releaseWatchLines(cfg) {
  const L = [];
  let ledger = new Map();
  try {
    ledger = parseTriageState(
      readFileSync('docs/operations/triage-state.md', 'utf8'),
    ).fixedInBuild;
  } catch {
    /* no ledger — the labels alone still count */
  }

  try {
    let waiting = 0;
    let behindFlag = 0;
    for (const [num, labels] of openIssueLabels()) {
      if (!resolveFixedIn(fixedInLabelOf(labels), ledger.get(num) || null))
        continue;
      waiting++;
      if (labels.some(l => l.startsWith('behind-flag:'))) behindFlag++;
    }
    L.push(
      `Waiting for a release: ${waiting} issues (fix built, not yet in production)` +
        (behindFlag ? `, ${behindFlag} of them also wait for a flag` : ''),
    );
  } catch {
    L.push(
      'Waiting for a release: unavailable (gh offline or unauthenticated)',
    );
  }

  const builds = (cfg && cfg.engagement && cfg.engagement.buildsToWatch) || [];
  const prod = Number(cfg && cfg.build) || 0;
  const dates = buildAddedDates();
  const since = Date.now() - RECENT_DAYS * 86_400_000;
  // No git history (a shallow clone, as in Claude Cloud): the rollout file
  // decides (scripts/lib/release-watch.mjs). When it cannot, list no builds.
  const recent = dates
    ? builds.filter(b =>
        dates.has(String(b))
          ? dates.get(String(b)).getTime() >= since
          : Number(b) > prod,
      )
    : shallowWatchBuilds(cfg) || [];
  const ledgerBuilds = new Set([...ledger.values()].map(String));
  // A build recorded in noFixBuilds (owner-actions.json, triage-loop Step 1.6).
  let noFix = new Set();
  try {
    noFix = new Set(noFixBuildsOf(loadOwnerActions()));
  } catch {
    /* a broken list file: the NEEDS YOU section says so */
  }
  for (const b of recent) {
    if (ledgerBuilds.has(String(b)) || noFix.has(String(b))) continue;
    let n;
    try {
      n = fixedInLabelled(b);
    } catch {
      L.push(`Build ${b}: could not check its fixed-in label (gh offline)`);
      continue;
    }
    if (!n)
      L.push(
        `Build ${b} has no fix record yet. The Mac loop records it itself (Step 1.6).`,
      );
  }
  return L;
}

// INTAKE. Does new work still enter the queue? (scripts/lib/intake.mjs)
// Three REST reads: the last Diagnostics Watch runs, the issues updated in the
// window, and the comments that github-actions[bot] wrote in the window.
function intakeLines() {
  try {
    const now = Date.now();
    const since = new Date(now - INTAKE_WINDOW_HOURS * 3_600_000).toISOString();
    const runs =
      (
        ghApi(`repos/${GH_REPO}/actions/workflows/diagnostics-watch.yml/runs`, {
          query: {per_page: 10},
        }) || {}
      ).workflow_runs || [];
    const issues = listIssues({state: 'all', since});
    const botComments = ghApi(`repos/${GH_REPO}/issues/comments`, {
      query: {since, per_page: 100},
      paginate: true,
    })
      .filter(c => c.user && c.user.login === 'github-actions[bot]')
      .map(c => ({issueNumber: Number(c.issue_url.split('/').pop())}));
    return [classifyIntake({now, runs, issues, botComments}).line];
  } catch (e) {
    return [
      `Intake: unknown — could not read GitHub (${String(e.message).slice(0, 80)})`,
    ];
  }
}

// --sections=all (default) | triage. `triage` leaves out SHIPPED: that section
// reads build/auto-sprint-last.json on the Mac, and the 3pm auto-sprint posts
// its own ship card.
const SECTIONS = String(ARGS.sections || 'all');
if (!['all', 'triage'].includes(SECTIONS)) {
  console.error(`❌ --sections=${SECTIONS}: use all or triage`);
  process.exit(2);
}
if (ARGS['post-issue'] === true || ARGS['post-issue'] === '') {
  console.error(
    "❌ --post-issue needs a title, e.g. --post-issue='Daily card'",
  );
  process.exit(2);
}

// Every line fits the phone width (44): a prose line wraps, and a HELD issue
// title is cut, because its number is what Omar acts on.
const cutTo = (l, w = 44) => (l.length > w ? `${l.slice(0, w - 1)}…` : l);

function opsBlock(cfg) {
  const L = [];
  const section = (title, lines, {cut = false} = {}) => {
    L.push('');
    L.push(title);
    for (const l of lines)
      L.push(...(cut ? [cutTo(`  ${l}`)] : wrap(`  ${l}`, 44, '    ')));
  };
  if (SECTIONS === 'all') section('SHIPPED', shippedLines());
  // The lines start with "Intake:", which the title already says.
  section(
    'INTAKE',
    intakeLines().map(l => l.replace(/^Intake: /, '')),
  );
  section('HELD (needs your decision)', heldLines(), {cut: true});
  section('REPLY DRAFTS', replyDraftLines());
  section('CI FOLLOW-UP', ciFollowUpLines());
  section('RELEASE WATCH', releaseWatchLines(cfg));
  return L;
}

// --post-issue=<title>. One comment for each run, on the open `ops` issue with
// that title. The first line is the marker that scripts/run-health.mjs reads.
const OWNER_TZ = process.env.QARIAH_TZ || 'America/Los_Angeles';
const FENCE = '`'.repeat(3);
function postCard(text) {
  const title = String(ARGS['post-issue']);
  if (isShadowRun() && title !== SHADOW_CARD_TITLE) {
    throw new Error(
      `shadow mode posts the card only to "${SHADOW_CARD_TITLE}", not to "${title}"`,
    );
  }
  const opts = {allowInShadow: title === SHADOW_CARD_TITLE};
  const issue = findOrCreateIssue(
    {
      title,
      label: 'ops',
      body:
        'One comment for each scheduled run: the daily card (`scripts/daily-card.mjs --post-issue`) ' +
        'and the `run-health` lines (`scripts/run-end.sh`). `scripts/run-health.mjs` reads them. ' +
        'See planning/claude-cloud-migration-plan.md §8 and §11.',
    },
    opts,
  );
  if (issue.created)
    console.error(
      `daily-card: created issue #${issue.number} "${title}"${issue.pinned ? ' (pinned)' : ' (could not pin it; pin it by hand)'}`,
    );
  const date = new Date().toLocaleDateString('en-CA', {timeZone: OWNER_TZ});
  const host = isCloudSession() ? 'cloud' : 'mac';
  const body = [
    `<!-- daily-card date=${date} sections=${SECTIONS} host=${host} -->`,
    `**Daily card** · ${date} · ${SECTIONS} · ${host}`,
    '',
    `${FENCE}text`,
    text.split(FENCE).join("'''"),
    FENCE,
  ].join('\n');
  const url = commentOnIssue(issue.number, body, opts);
  console.error(`daily-card: posted on ${url}`);
}

// NEEDS YOU. The owner's next steps of the Claude Cloud migration
// (docs/operations/owner-actions.json, scripts/owner-actions.mjs). Each check
// reads live state, so a prompt appears only on the days Omar must act, and
// it goes away by itself when the step is done. REST reads only.
function ownerActions() {
  try {
    // Omar's `owner-reply:` comments on the card issue apply first
    // (scripts/lib/owner-replies.mjs), so an answered step does not come back.
    const {list, repliesError} = loadOwnerActionsWithReplies();
    if (!list) return {error: 'docs/operations/owner-actions.json is missing'};
    return {
      results: evaluateOwnerActions(list, {
        today: ownerDate(Date.now()),
        cloud: isCloudSession(),
        facts: makeFacts(list),
      }),
      repliesError,
    };
  } catch (e) {
    return {error: String(e.message || e).slice(0, 120)};
  }
}

function ownerLines(owner) {
  if (!owner) return [];
  // 42 + the 2-space indent the caller adds = the card's 44.
  if (owner.error) return wrap(`unavailable (${owner.error})`, 42);
  const lines = cardSection(owner.results, 42).flatMap(l =>
    l.length > 42 ? wrap(l, 42, '   ') : [l],
  );
  if (owner.repliesError)
    lines.push(...wrap(`owner replies not read (${owner.repliesError})`, 42));
  return lines;
}

// --- render ------------------------------------------------------------------

// The owner's layout (2026-10-11; FREEZES (ANR) since 2026-10-20), top to
// bottom: the header, people and the journey, ACTIVE, USE, FAILURES, FREEZES
// (ANR), the ops sections, NEEDS YOU.
function render(
  {builds, win, byPlatform, usage, active},
  failures,
  crashes,
  cfg,
  anr,
  owner,
  ab,
) {
  const L = [];
  const platforms = byPlatform.map(r => ({
    name: String(r[0]),
    total: Number(r[1]),
    steps: Object.fromEntries(STEPS.map((s, i) => [s.key, Number(r[i + 2])])),
  }));

  // The owner's date, not toISOString(): the loop runs in the evening Pacific,
  // which is already tomorrow in UTC, and a card stamped with tomorrow's date
  // reads as stale data from the future.
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', {timeZone: OWNER_TZ});
  const weekday = now.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: OWNER_TZ,
  });
  L.push(
    ...renderHeader({
      date: today,
      weekday,
      windowLabel: win.label,
      builds,
      ios: ARGS.ios || (cfg && cfg._cardIos),
      android: ARGS.android || (cfg && cfg._cardAndroid),
    }),
  );

  L.push('');
  L.push(
    ...renderJourney({
      total: platforms.reduce((a, p) => a + p.total, 0),
      byPlatform: Object.fromEntries(platforms.map(p => [p.name, p.total])),
      installed: platforms.reduce((a, p) => a + p.steps.installed, 0),
      steps: STEPS.filter(s => s.key !== 'installed').map(s => ({
        label: s.label,
        n: platforms.reduce((a, p) => a + p.steps[s.key], 0),
      })),
    }),
  );
  L.push('', ...renderActive(active));
  L.push('', ...renderUse(usage));

  // Failures: enumerated when present, one clean line when not. The shape of this
  // block is deliberately allowed to change day to day — a fixed empty table is
  // something the eye learns to skip.
  L.push('');
  const hasAny = failures.length > 0 || (crashes && crashes.length > 0);
  if (!hasAny) {
    L.push('✅ No failures');
  } else {
    L.push('⚠️ FAILURES');
    for (const f of failures) {
      L.push(
        `${String(f.n).padStart(3)} ${f.platform} · ${f.what} (b${f.build})`,
      );
    }
    for (const c of crashes || []) {
      // The title gives way, so the builds always fit the phone width.
      const tail = ` (b${c.builds.join('/')})`;
      const room = 44 - 4 - tail.length;
      const title =
        c.title.length > room ? `${c.title.slice(0, room - 1)}…` : c.title;
      L.push(`${String(c.users).padStart(3)} ${title}${tail}`);
    }
  }

  // The A/B section no longer prints here (--ab prints it); a blocking FAIL
  // shows as the ⛔ line at the top of FREEZES (ANR).
  if (anr) L.push('', ...renderAnrCard(anr, anrOptions(cfg, ab)));
  if (!ARGS['no-ops']) L.push(...opsBlock(cfg));
  // NEEDS YOU comes last (owner, 2026-10-11).
  if (owner) {
    L.push('', 'NEEDS YOU');
    for (const l of ownerLines(owner)) L.push(`  ${l}`);
  }
  return L.join('\n');
}

function emit(text) {
  console.log(text);
  if (ARGS['post-issue'] && !ARGS.json) postCard(text);
}

async function main() {
  if ((!PH_TOKEN || !PH_PROJECT) && !ARGS['release-watch']) {
    console.error(
      '❌ POSTHOG_PERSONAL_API_TOKEN + POSTHOG_PROJECT_ID required. Source .env.local.',
    );
    process.exit(1);
  }
  const cfg = loadConfig();

  // `--release-watch` prints only that section. It needs gh, not PostHog.
  if (ARGS['release-watch']) {
    emit(['RELEASE WATCH', ...releaseWatchLines(cfg)].join('\n  '));
    return;
  }

  if (ARGS.anr) {
    const [anr, ab] = await Promise.all([
      collectAnr(cfg),
      ARGS.json ? null : collectAb(cfg),
    ]);
    if (ARGS.json) console.log(JSON.stringify(anr, null, 2));
    else {
      emit(renderAnrCard(anr, anrOptions(cfg, ab)).join('\n'));
    }
    return;
  }

  if (ARGS.ab) {
    const ab = await collectAb(cfg);
    if (ARGS.json) console.log(JSON.stringify(ab, null, 2));
    else emit(ab ? renderAbCard(ab).join('\n') : 'A/B · no active A/B');
    return;
  }

  const [data, anr, ab] = await Promise.all([
    collect(cfg),
    ARGS['no-anr'] ? null : collectAnr(cfg),
    collectAb(cfg),
  ]);
  const owner = ARGS['no-owner'] ? null : ownerActions();

  const failures = journeyFailures(data.stuck);
  const crashes = await sentryFailures(data.builds, cfg);

  if (ARGS.json) {
    console.log(
      JSON.stringify(
        {
          ...data,
          failures,
          crashes,
          crashesFailedRequests: sentryFailedRequests,
          anr,
          owner,
          ab,
        },
        null,
        2,
      ),
    );
    return;
  }
  emit(render(data, failures, crashes, cfg, anr, owner, ab));
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
