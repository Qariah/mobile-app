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
// WHAT IT IS NOT. `rollout-engagement.mjs` stays the diagnostic instrument —
// cohorts, activation, retention, per-OS splits, threshold alerts. This is the
// headline. When they disagree, engagement is the one to debug.
//
//   node scripts/daily-card.mjs                      # since launch
//   node scripts/daily-card.mjs --since=14d
//   node scripts/daily-card.mjs --ios='20% ▲ rising' --android='50%'
//   node scripts/daily-card.mjs --json
//   node scripts/daily-card.mjs --anr                # the ANR section only
//   node scripts/daily-card.mjs --no-anr             # the card without it
//
// Env: POSTHOG_PERSONAL_API_TOKEN + POSTHOG_PROJECT_ID (required)
//      SENTRY_READ_TOKEN + SENTRY_ORG + SENTRY_PROJECT (optional — without them
//      the crash half of the failure section is omitted rather than guessed at)
//      Play service account + APP_STORE_CONNECT_API_KEY_ID (optional — the ANR
//      section prints `unavailable` for a source it cannot reach)

import {existsSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {
  fetchAscHang,
  fetchPlayAnr,
  fetchSentryAnr,
  renderAnrCard,
} from './lib/anr-card.mjs';
import {labExclusionSQL, sqlList} from './lib/lab-exclusion.mjs';

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

const PH_TOKEN = process.env.POSTHOG_PERSONAL_API_TOKEN;
const PH_PROJECT = process.env.POSTHOG_PROJECT_ID;
const PH_HOST = (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(
  /\/$/,
  '',
);

const SENTRY_TOKEN = process.env.SENTRY_READ_TOKEN;
const SENTRY_ORG = process.env.SENTRY_ORG || 'qariah';
const SENTRY_HOST = (
  process.env.SENTRY_REGION_HOST || 'https://sentry.io'
).replace(/\/$/, '');

async function hogql(query) {
  const res = await fetch(`${PH_HOST}/api/projects/${PH_PROJECT}/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({query: {kind: 'HogQLQuery', query}}),
    // eslint-disable-next-line no-undef -- Node 18+ global; the shared ESLint env is the RN app's
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new Error(
      `PostHog ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const rows = (await res.json()).results || [];
  if (rows.length >= ROW_CAP)
    throw new Error('hit ROW_CAP — refusing to report truncated data');
  return rows;
}

// --- the journey -------------------------------------------------------------
//
// Ordered, and each step is the UNION of its events (a user who skipped
// onboarding is as "set up" as one who completed it). Labels are deliberately
// plain English: this card gets forwarded to people who do not know what a
// `meaningful_listen` is.
//
// "Installed" is the honest ceiling of what PostHog can see, and it is NOT the
// store download count: `Application Installed` fires on FIRST LAUNCH, so anyone
// who downloaded and never opened the app is invisible here. True downloads need
// App Store Connect (Sales & Trends, needs a vendor number) or the Play reports
// bucket. The Installed→Opened gap below is real and IS worth watching.
const STEPS = [
  {
    key: 'installed',
    label: 'Installed',
    events: ['Application Installed', 'Application Updated'],
  },
  {key: 'opened', label: 'Opened it', events: ['cold_start_began']},
  {key: 'past_loading', label: 'Past loading', events: ['splash_hidden']},
  {
    key: 'set_up',
    label: 'Set up',
    events: ['onboarding_completed', 'onboarding_skipped'],
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

async function collect(cfg) {
  const release = (cfg && cfg.release) || '3.2.0';
  const win = windowClause(cfg);
  const scope = `properties.$app_version = '${release}' AND ${labExclusionSQL()}`;

  // EVERY number here is derived from a PER-USER subquery, never from grouping
  // raw events. Bucketing per event double-counts anyone whose events disagree:
  // $os_name is not set on every event, so the same person lands in both the
  // iPhone and Android groups and the platform columns sum to MORE than the
  // population. That is how a 329-person release first printed as "340 people ·
  // iPhone 219 · Android 121". Resolve identity once per person (any() for
  // platform, the LATEST build they were seen on), then aggregate.
  const perUserCols = STEPS.map(
    s => `countIf(event IN (${sqlList(s.events)})) AS ${s.key}`,
  ).join(',\n         ');
  const reachCols = STEPS.map(s => `countIf(${s.key} > 0) AS ${s.key}`).join(
    ',\n       ',
  );

  const PER_USER = `SELECT person_id,
         multiIf(any(properties.$os_name) = 'iOS', 'iPhone', 'Android') AS platform,
         argMax(properties.$app_build, timestamp) AS build,
         ${perUserCols}
       FROM events WHERE ${win.sql} AND ${scope}
       GROUP BY person_id`;

  // Volume, unlike the journey, is a straight event count — grouping raw events
  // is CORRECT here (we want every occurrence) and the $os_name double-count that
  // ruins the per-user aggregates cannot bite, because we never split by platform.
  const usageQuery = `SELECT event, count() AS n, uniq(person_id) AS people
     FROM events
     WHERE ${win.sql} AND ${scope}
       AND event IN (${sqlList(USAGE.flatMap(u => u.events))})
     GROUP BY event LIMIT ${ROW_CAP}`;

  // Active users. DELIBERATELY NOT scoped to `release`, unlike everything else on
  // this card. Scoping DAU to one $app_version measures rollout ADOPTION, not
  // activity: a user who is active every day but still on 3.1.8 is a real active
  // user and would vanish, and DAU would then dip whenever a new version starts
  // rolling rather than when people stop showing up. Lab/simulator traffic is
  // still excluded, so this stays comparable with the rest of the card.
  //
  // Unfiltered by version is only SAFE because this PostHog project receives v2
  // traffic exclusively — verified 2026-08-30, where a 7-day scan of every
  // $app_version returned 3.2.0, 3.2.1 and 3.1.8 and nothing else. v1 Flutter
  // (3.0.1 / vc35) never shipped PostHog, so it cannot land here. IF v1 OR ANY
  // OTHER APP EVER REPORTS TO THIS PROJECT, these two numbers silently stop
  // meaning "v2 active users" and a version filter becomes mandatory.
  //
  // Trailing windows, not calendar days — "DAU" here is the last 24h and "WAU"
  // the last 7x24h, both relative to run time. Read from the same 7-day scan so
  // it costs one query, and so DAU is always a strict subset of WAU. Counting is
  // per person, so someone who upgrades mid-week is one user, not two.
  const activeQuery = `SELECT
       uniqIf(person_id, timestamp > now() - INTERVAL 1 DAY) AS dau,
       uniq(person_id) AS wau
     FROM events
     WHERE timestamp > now() - INTERVAL 7 DAY AND ${labExclusionSQL()}`;

  const [byPlatform, byBuild, usageRows, activeRows] = await Promise.all([
    hogql(`SELECT platform, count() AS total,
       ${reachCols}
     FROM (${PER_USER}) GROUP BY platform ORDER BY total DESC LIMIT ${ROW_CAP}`),
    hogql(`SELECT build, platform, count() AS total,
       ${reachCols}
     FROM (${PER_USER}) GROUP BY build, platform ORDER BY total DESC LIMIT ${ROW_CAP}`),
    hogql(usageQuery),
    hogql(activeQuery),
  ]);

  // Absent row ⇒ null, never 0: nobody active and "the query returned nothing"
  // are different claims, and the renderer prints them differently.
  let active = null;
  if (activeRows && activeRows.length) {
    active = {dau: Number(activeRows[0][0]), wau: Number(activeRows[0][1])};
  }

  // Absent event ⇒ 0, never undefined: a metric that never fired must print as a
  // real zero, not vanish from the block (an absent line reads as "not checked").
  const usageByEvent = Object.fromEntries(
    usageRows.map(r => [String(r[0]), {n: Number(r[1]), people: Number(r[2])}]),
  );
  const usage = USAGE.map(u => {
    const hits = u.events.map(e => usageByEvent[e]).filter(Boolean);
    return {
      label: u.label,
      key: u.key,
      n: hits.reduce((a, h) => a + h.n, 0),
      people: Math.max(0, ...hits.map(h => h.people), 0),
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
         multiIf(any(properties.$os_name) = 'iOS', 'iPhone', 'Android') AS platform,
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

  return {release, win, byPlatform, byBuild, stuck, usage, active};
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
];

function humanizeCrash(raw) {
  const s = String(raw).replace(/\s+/g, ' ').trim();
  for (const [re, phrase] of CRASH_PHRASES) if (re.test(s)) return phrase;
  const head = s.split(/(?<=[.!?])\s|:\s/)[0];
  if (head.length <= 30) return head;
  return `${head.slice(0, 29).replace(/\s+\S*$/, '')}…`;
}

async function sentryFailures(release, builds, cfg) {
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
      `release:com.qariah.app@${release}+${b} is:unresolved`,
    );
    url.searchParams.set('statsPeriod', '14d');
    url.searchParams.set('limit', '25');
    let issues;
    try {
      const res = await fetch(url, {
        headers: {Authorization: `Bearer ${SENTRY_TOKEN}`},
      });
      if (!res.ok) continue;
      issues = await res.json();
    } catch {
      continue;
    }
    if (!Array.isArray(issues)) continue;

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
          builds: [b],
        });
      } else {
        seen.get(i.shortId).builds.push(b);
      }
    }
  }

  return [...seen.values()].sort((a, b) => b.users - a.users).slice(0, 5);
}

// --- ANR -----------------------------------------------------------------------
//
// Sentry sessions carry no OS, so each release's platform comes from PostHog:
// the OS its cold starts report. A build number seen on both platforms (the
// internal builds share numbers) gets no platform and is left out of the ANR
// rates entirely, which also keeps the simulators and emulators out.
async function collectAnr() {
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
  const [play, sentry, appStore] = await Promise.all([
    fetchPlayAnr(),
    fetchSentryAnr({
      token: SENTRY_TOKEN,
      org: SENTRY_ORG,
      host: SENTRY_HOST,
      platformOfBuild,
    }),
    fetchAscHang(),
  ]);
  return {play, sentry, appStore};
}

// --- ops sections (feedback graph) -------------------------------------------
//
// Four sections the daily auto-sprint and the fix loop hand the owner. Each
// source is optional and independent: a missing file or an offline `gh` prints
// `unavailable`, never a fabricated zero. `--no-ops` skips the block entirely
// (the PostHog-only card the 1pm loop pastes when it has no shipping news).
//
//   SHIPPED       build/auto-sprint-last.json  — written by post-sprint Step 14b/16
//   HELD          `needs-decision` issues       — the owner's queue (design / copy / product)
//   REPLY DRAFTS  `reply-draft` issues          — store-review replies awaiting the owner's numbers
//   CI FOLLOW-UP  remediation-drafted drafts blocked by a red check OR a base
//                 conflict — the loop's Step 3.5 queue

const GH_REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';
const BUILD_DIR = process.env.QARIAH_BUILD_DIR || 'build';

function gh(args) {
  return JSON.parse(
    execFileSync('gh', [...args, '-R', GH_REPO], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30000,
    }),
  );
}

function shippedLines() {
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
    const rows = gh([
      'issue',
      'list',
      '--state',
      'open',
      '--label',
      'needs-decision',
      '--limit',
      '20',
      '--json',
      'number,title',
    ]);
    if (!rows.length) return ['none'];
    return rows.map(r => `#${r.number} ${r.title.slice(0, 70)}`);
  } catch {
    return ['unavailable (gh offline or unauthenticated)'];
  }
}

function replyDraftLines() {
  try {
    const rows = gh([
      'issue',
      'list',
      '--state',
      'open',
      '--label',
      'reply-draft',
      '--limit',
      '20',
      '--json',
      'number,title',
    ]);
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
    const all = gh([
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '60',
      '--json',
      'number,title,headRefName,labels,statusCheckRollup,mergeable',
    ]);
    // A loop draft = label OR branch pattern (the label sat on the issues only until
    // 2026-09-07, so a label-only query saw nothing). ops/* and repro-* are not fixes.
    const isLoop = r =>
      ((r.labels || []).some(l => l.name === 'remediation-drafted') ||
        /^qariah\/(fix|triage)-/.test(r.headRefName || '')) &&
      !/^(ops\/|qariah\/repro-)/.test(r.headRefName || '');
    const rows = all.filter(isLoop);
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

function opsBlock() {
  const L = [];
  const section = (title, lines) => {
    L.push('');
    L.push(title);
    for (const l of lines) L.push(`  ${l}`);
  };
  section('SHIPPED', shippedLines());
  section('HELD (needs your decision)', heldLines());
  section('REPLY DRAFTS', replyDraftLines());
  section('CI FOLLOW-UP', ciFollowUpLines());
  return L;
}

// --- render ------------------------------------------------------------------

const bar = (v, width = 8) =>
  '▓'.repeat(Math.round(v * width)).padEnd(width, ' ');

function render(
  {release, win, byPlatform, usage, active},
  idx,
  failures,
  crashes,
  cfg,
  anr,
) {
  const L = [];
  const platforms = byPlatform.map(r => ({
    name: r[0],
    total: Number(r[1]),
    steps: Object.fromEntries(STEPS.map(s => [s.key, Number(r[idx[s.key]])])),
  }));

  const grand = STEPS.map(s => ({
    label: s.label,
    n: platforms.reduce((a, p) => a + p.steps[s.key], 0),
  }));
  const people = platforms.reduce((a, p) => a + p.total, 0);
  const top = grand[0].n || 1;

  // Local date, not toISOString() — the loop runs in the evening Pacific, which
  // is already tomorrow in UTC, and a card stamped with tomorrow's date reads as
  // stale data from the future.
  const today = new Date().toLocaleDateString('en-CA');
  L.push(`QARIAH ${release} · ${today}`);
  L.push(win.label);
  L.push('');
  L.push(
    `${people} people · ${platforms.map(p => `${p.name} ${p.total}`).join(' · ')}`,
  );
  L.push('');
  for (const s of grand) {
    L.push(
      `${s.label.padEnd(13)}${String(s.n).padStart(4)}  ${bar(s.n / top)}${String(Math.round((s.n / top) * 100)).padStart(4)}%`,
    );
  }

  // Volume. The funnel above says how many people got in; this says how hard they
  // are using it, which no reach percentage can show. Per-day is over calendar
  // days in the window, so it is a plain average and dips on the day it is read.
  if (usage && usage.length) {
    const days = win.days || 1;
    L.push('');
    L.push(
      `${'HOW MUCH'.padEnd(15)}${'total'.padStart(6)}${'/day'.padStart(7)}`,
    );
    for (const u of usage) {
      L.push(
        `${u.label.padEnd(15)}${String(u.n).padStart(6)}${String(Math.round(u.n / days)).padStart(7)}`,
      );
    }
  }

  // Active users. Sits apart from the two blocks above on purpose: the journey is
  // cumulative since launch and the volume block is an average over that window,
  // so neither says whether anyone came back THIS WEEK. These are the only two
  // numbers on the card that move down when people leave.
  if (active) {
    L.push('');
    L.push(`${'ACTIVE'.padEnd(15)}${'people'.padStart(6)}`);
    L.push(`${'Today (24h)'.padEnd(15)}${String(active.dau).padStart(6)}`);
    L.push(`${'This week (7d)'.padEnd(15)}${String(active.wau).padStart(6)}`);
    L.push('all versions, lab excluded');
  }

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
      L.push(
        `${String(c.users).padStart(3)} ${c.title} (b${c.builds.join('/')})`,
      );
    }
  }

  const ios = ARGS.ios || (cfg && cfg._cardIos);
  const android = ARGS.android || (cfg && cfg._cardAndroid);
  if (ios || android) {
    L.push('');
    if (ios) L.push(`iPhone  ${ios}`);
    if (android) L.push(`Android ${android}`);
  }
  if (anr) L.push('', ...renderAnrCard(anr, today));
  if (!ARGS['no-ops']) L.push(...opsBlock());
  return L.join('\n');
}

async function main() {
  if (!PH_TOKEN || !PH_PROJECT) {
    console.error(
      '❌ POSTHOG_PERSONAL_API_TOKEN + POSTHOG_PROJECT_ID required. Source .env.local.',
    );
    process.exit(1);
  }
  const cfg = loadConfig();

  if (ARGS.anr) {
    const anr = await collectAnr();
    if (ARGS.json) console.log(JSON.stringify(anr, null, 2));
    else {
      console.log(
        renderAnrCard(anr, new Date().toLocaleDateString('en-CA')).join('\n'),
      );
    }
    return;
  }

  const [data, anr] = await Promise.all([
    collect(cfg),
    ARGS['no-anr'] ? null : collectAnr(),
  ]);

  // Column offsets: byPlatform is [platform, total, ...steps];
  // byBuild is [build, platform, total, ...steps].
  const idx = Object.fromEntries(STEPS.map((s, i) => [s.key, i + 2]));

  const failures = journeyFailures(data.stuck);
  const builds = [...new Set(data.byBuild.map(r => String(r[0])))].filter(
    Boolean,
  );
  const crashes = await sentryFailures(data.release, builds, cfg);

  if (ARGS.json) {
    console.log(JSON.stringify({...data, failures, crashes, anr}, null, 2));
    return;
  }
  console.log(render(data, idx, failures, crashes, cfg, anr));
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
