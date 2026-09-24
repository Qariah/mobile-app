#!/usr/bin/env node
// @ai
//
// scripts/posthog-triage.mjs
// --------------------------
// Twice-daily PostHog -> GitHub issue triage bot for Qariah v2.
//
// The companion to scripts/sentry-triage.mjs. Sentry catches CRASHES; this
// catches PRODUCT-HEALTH REGRESSIONS that never throw -- a feature that
// silently stops working on a new build (audio init dies, boot hangs so
// app_opened craters, a funnel collapses). PostHog here holds the product
// analytics emitted by services/analytics/AnalyticsService.ts; the diagnostic
// PERF signals (heartbeat overruns, network hangs) go to SENTRY, not here.
//
// HONEST SCOPE NOTE (grounded in a 2026-06-07 live data audit):
// at current beta DAU the per-build event volume is too low for reliable
// build-over-build RATIO regression detection -- ratios swing widely from
// small samples alone. So the signals here are deliberately conservative:
//
//   1. FLAG SANITY   -- diagnostics_mode disabled / rolled to 0% => telemetry
//                       is not collecting. Volume-independent. Always checked.
//   2. ZERO-TRIPWIRE -- a key downstream event craters to ~0 on a version that
//                       DOES have meaningful app_opened. Robust even at low
//                       volume; this is the #53 (boot hang -> app_opened drops)
//                       and #54 (audio stop -> playback_* drops) shape.
//   3. RATIO-DROP    -- a health ratio drops past --drop vs the baseline
//                       version, gated behind --min-opens so it only fires once
//                       a version has enough sample. Below the gate => "watching,
//                       insufficient volume" (reported, never filed).
//
// PostHog issues are INVESTIGATIONS, not auto-fixable bugs (no stack trace).
// They are labelled `posthog` + `investigate` so the remediation routine treats
// them as human/device investigations, not draft-a-code-fix candidates.
//
// Runs in CI (see .github/workflows/diagnostics-watch.yml) and locally:
//   set -a && source .env.local && set +a   # POSTHOG_PERSONAL_API_TOKEN + _PROJECT_ID
//   node scripts/posthog-triage.mjs --dry-run     # preview, files nothing
//   node scripts/posthog-triage.mjs               # file issues
//
// Required env:
//   POSTHOG_PERSONAL_API_TOKEN   personal API token (read scope) for the query API
//   POSTHOG_PROJECT_ID           numeric project id
// Optional env (sensible defaults for this repo):
//   POSTHOG_HOST                 default "https://us.posthog.com"
//   DIAGNOSTICS_FLAG_KEY         default "diagnostics_mode"
//   DIAGNOSTICS_FLAG_ID          default "706025"
//   GH_REPO                      default "omar-zarka/qariah-v2"
//   GH_TOKEN                     GitHub token for `gh` (CI: secrets.GITHUB_TOKEN)
//
// Flags:
//   --dry-run             query + analyse + print, but DO NOT create issues
//   --window=7d           HogQL lookback (e.g. 3d, 7d, 14d)
//   --min-opens=40        min app_opened USERS on a version before RATIO checks run
//   --min-baseline-users=30  min distinct app_opened users on the BASELINE before
//                            a comparison is trusted (skips the 11-user-baseline trap)
//   --tripwire-opens=25   min app_opened users on a version before the ZERO tripwire runs
//   --cohort-maturity-days=0  only count users first-seen on the build >= N days ago
//   --drop=0.4            relative per-user-conversion drop that counts as a regression
//   --max=8               max issues to file in one run
//   --emit-candidates=F   also write the analysed signal set to file F (JSON)
//   --help
//
// PER-USER FUNNELS (the 2026-06-14 expert review's #5 / Growth rec). The ratio
// engine was structurally miscalibrated: count(event)/count(app_opened) treats
// `app_opened` as a session-RESUME counter (it fires on every AppState 'active'),
// so a fresh-install wave deflates the ratio mechanically — three "measurement
// artifact" false alarms in a row (#149 / #163 / #174). This run replaces the
// count-ratios with PER-USER conversion: count(DISTINCT person WHERE event) /
// count(DISTINCT person WHERE app_opened). Per-user, 3.1.8 vs 3.1.6 activation
// is flat at ~41% (the #174 −41% drop would NOT fire). Plus a
// --min-baseline-users floor (kills the 11-user-baseline trap) and an optional
// cohort-maturity window. The zero-floor discrete-fault tripwire (splash_stalled
// / boot_not_completed) is KEPT intact — it is correct and denominator-immune.

import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = (name, def) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

if (flag('help')) {
  console.log(
    [
      'Usage: node scripts/posthog-triage.mjs [--dry-run] [--window=7d] [--min-opens=40]',
      '                                       [--tripwire-opens=25] [--drop=0.4] [--max=8]',
      '                                       [--emit-candidates=FILE]',
      '',
      'Env: POSTHOG_PERSONAL_API_TOKEN (required), POSTHOG_PROJECT_ID (required),',
      '     POSTHOG_HOST, DIAGNOSTICS_FLAG_KEY, DIAGNOSTICS_FLAG_ID, GH_REPO, GH_TOKEN',
    ].join('\n'),
  );
  process.exit(0);
}

const TOKEN = process.env.POSTHOG_PERSONAL_API_TOKEN;
const PROJECT = process.env.POSTHOG_PROJECT_ID;
const HOST = (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(
  /\/$/,
  '',
);
const FLAG_KEY = process.env.DIAGNOSTICS_FLAG_KEY || 'diagnostics_mode';
const FLAG_ID = process.env.DIAGNOSTICS_FLAG_ID || '706025';
const GH_REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

const DRY_RUN = flag('dry-run');
const WINDOW = opt('window', '7d');
const MIN_OPENS = parseInt(opt('min-opens', '40'), 10);
const MIN_BASELINE_USERS = parseInt(opt('min-baseline-users', '30'), 10);
const TRIPWIRE_OPENS = parseInt(opt('tripwire-opens', '25'), 10);
const COHORT_MATURITY_DAYS =
  parseInt(opt('cohort-maturity-days', '0'), 10) || 0;
const DROP = parseFloat(opt('drop', '0.4'));
const MAX = parseInt(opt('max', '8'), 10);
const EMIT = opt('emit-candidates', '');

// Window may be "7d" / "24h" / "2w". Parse the unit EXPLICITLY — a bare
// parseInt('24h') strips the suffix and yields 24, which would silently become
// "INTERVAL 24 DAY" (24 days, not 24 hours) in the HogQL below.
const WINDOW_PARSED = (() => {
  const m = String(WINDOW).match(/^(\d+)\s*([dhw]?)$/i);
  if (!m) {
    console.warn(`  ⚠ unparseable --window="${WINDOW}", defaulting to 7 DAY`);
    return {n: 7, unit: 'DAY'};
  }
  const unit = {d: 'DAY', h: 'HOUR', w: 'WEEK', '': 'DAY'}[m[2].toLowerCase()];
  return {n: parseInt(m[1], 10) || 7, unit};
})();

if (!TOKEN || !PROJECT) {
  console.error(
    '❌ POSTHOG_PERSONAL_API_TOKEN and POSTHOG_PROJECT_ID must be set. Source .env.local or set the secrets.',
  );
  process.exit(2);
}

// The events we track for health. app_opened is the denominator/anchor; the
// rest are downstream features whose disappearance means something broke.
const ANCHOR = 'app_opened';
const KEY_EVENTS = [
  'app_opened',
  'playback_started',
  'playback_completed',
  'playback_skipped',
  'meaningful_listen',
  'mushaf_page_opened',
];

// Health ratios: name -> { num, den, dir }. dir='down' means a DROP is bad
// (the feature is being used less); dir='up' means a RISE is bad.
const RATIOS = [
  {
    key: 'listen_start_rate',
    label: 'playback_started / app_opened',
    num: 'playback_started',
    den: 'app_opened',
    dir: 'down',
    hint: 'Fewer sessions reach playback. Audio init, catalog load, or the Listen tab may be failing on this build.',
  },
  {
    key: 'listen_complete_rate',
    label: 'playback_completed / playback_started',
    num: 'playback_completed',
    den: 'playback_started',
    dir: 'down',
    hint: 'Sessions start but do not complete. Correlates with the #54 "recitation stops mid-ayah" class (Android foreground-service kill / audio drop).',
  },
  {
    key: 'meaningful_listen_rate',
    label: 'meaningful_listen / app_opened',
    num: 'meaningful_listen',
    den: 'app_opened',
    dir: 'down',
    hint: 'Core engagement (a real listen) dropped. Broad regression signal.',
  },
  {
    key: 'mushaf_open_rate',
    label: 'mushaf_page_opened / app_opened',
    num: 'mushaf_page_opened',
    den: 'app_opened',
    dir: 'down',
    hint: 'Mushaf usage dropped. Skia/SQLite preload or navigation into the Mushaf tab may be failing.',
  },
  // RETIRED 2026-06-13 (issue #163): skip_rate = playback_skipped / playback_started
  // was structurally misleading. `playback_skipped` is ALSO emitted by auto-advance
  // (skipToNext is called from handleTrackEnd on didJustFinish — services/player/store/
  // playerStore.ts:225 ← ExpoAudioProvider.tsx:536), so every naturally-completed track
  // in a queue fires playback_skipped(direction='next'). The ratio therefore tracks
  // LISTENING VOLUME, not skip behavior, and false-alarms on every volume swing (#163:
  // 17.6%→39.6% was a cohort/volume artifact — per-user median skip/start = 0 in both
  // builds; same class as the #149 mushaf_open_rate artifact). This bot counts by event
  // NAME only and can't filter `direction`, so a meaningful "user-initiated skip rate"
  // (direction='prev', or next-skips with low listened_ms) needs property-level counting
  // — add that as a HogQL ratio if the signal is wanted, don't restore the raw ratio.
];

// ARTIFACT-CLASS SUPPRESSION SET. These ratio shapes have been confirmed
// measurement artifacts MULTIPLE times (#149 mushaf_open_rate, #174
// meaningful_listen_rate — both flat per-user once the denominator was fixed),
// so even with the per-user funnel rewrite they stay OFF the ratio-regression
// path to prevent the recurring false-alarm class. A genuine COLLAPSE of either
// feature is still caught by the zero/near-zero per-user tripwire (Signal 2),
// which only fires when the event reaches ~0 users — not on a noisy swing.
// Remove a key here only after a deliberate per-user re-validation.
const SUPPRESSED_RATIOS = new Set([
  'meaningful_listen_rate',
  'mushaf_open_rate',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function ph(path, {method = 'GET', body} = {}) {
  const url = `${HOST}/api/projects/${PROJECT}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PostHog ${res.status} on ${path}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

async function hogql(query) {
  const out = await ph('/query/', {
    method: 'POST',
    body: {query: {kind: 'HogQLQuery', query}},
  });
  return out.results || [];
}

function gh(args, {input} = {}) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      input,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    throw new Error(`gh ${args.join(' ')} failed: ${msg.slice(0, 400)}`);
  }
}

// "3.1.8" > "3.1.6". Returns >0 if a>b, <0 if a<b, 0 if equal/unparseable.
function semverCmp(a, b) {
  const pa = String(a)
    .split('.')
    .map(n => parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

const pct = x => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const ratio = (counts, num, den) => {
  const d = counts[den] || 0;
  if (!d) return null;
  return (counts[num] || 0) / d;
};

const MARKER_PREFIX = 'posthog-triage-id:';
const LABEL = 'posthog';

function ensureLabels(labels) {
  if (DRY_RUN) return;
  const palette = {
    posthog: '1d4aff',
    investigate: '0e8a16',
    regression: 'b60205',
    'severity:critical': 'b60205',
    'severity:high': 'd93f0b',
    'severity:medium': 'fbca04',
    'severity:low': 'c2e0c6',
  };
  for (const l of labels) {
    try {
      gh([
        'label',
        'create',
        l,
        '--repo',
        GH_REPO,
        '--color',
        palette[l] || 'ededed',
        '--force',
      ]);
    } catch {
      /* exists / race — fine */
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(
    `▶ posthog-triage  project=${PROJECT} window=${WINDOW} ` +
      `min-opens=${MIN_OPENS} tripwire-opens=${TRIPWIRE_OPENS} drop=${DROP}${DRY_RUN ? '  (DRY RUN)' : ''}`,
  );

  const signals = []; // {key, severity, kind, title, body}

  // -------------------------------------------------------------------------
  // SIGNAL 1 — flag sanity. Volume-independent: if telemetry is off, nothing
  // else here means anything.
  // -------------------------------------------------------------------------
  let flagState = null;
  try {
    flagState = await ph(`/feature_flags/${FLAG_ID}/`);
  } catch {
    try {
      const list = await ph(
        `/feature_flags/?search=${encodeURIComponent(FLAG_KEY)}`,
      );
      flagState = (list.results || []).find(f => f.key === FLAG_KEY) || null;
    } catch (e) {
      console.warn(`  ⚠ could not read feature flag: ${e.message}`);
    }
  }
  if (flagState) {
    const rollout = flagState?.filters?.groups?.[0]?.rollout_percentage;
    const active = !!flagState.active;
    console.log(
      `  flag ${FLAG_KEY}: active=${active} rollout=${rollout ?? '—'}%`,
    );
    if (!active || rollout === 0) {
      signals.push({
        key: `flag-off:${FLAG_KEY}`,
        severity: 'medium',
        kind: 'investigate',
        title: `[PostHog] diagnostics telemetry flag "${FLAG_KEY}" is ${active ? 'at 0% rollout' : 'disabled'}`,
        body:
          `> Filed automatically by \`scripts/posthog-triage.mjs\`.\n\n` +
          `## Diagnostics flag is not collecting\n\n` +
          `The \`${FLAG_KEY}\` feature flag is **${active ? 'active but rolled out to 0%' : 'disabled'}**. ` +
          `While it stays this way, the on-error replay + heartbeat/network/nav diagnostics do not run, so ` +
          `the boot-hang (#53) and audio-stop (#54) telemetry has no coverage.\n\n` +
          `- **active:** \`${active}\`\n- **rollout:** \`${rollout ?? '—'}%\`\n\n` +
          `### Checklist\n` +
          `- [ ] Confirm this was intentional (e.g. you dialled it down)\n` +
          `- [ ] If not, re-enable / restore the ~20% rollout in the PostHog dashboard\n` +
          `- [ ] See \`docs/operations/diagnostics-and-release-health.md\`\n`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Pull PER-USER (distinct person) per-version event reach in one HogQL query.
  // We analyse on `users` (distinct persons), NOT raw event `n` — that is the
  // whole point: app_opened fires on every AppState 'active' resume, so raw
  // counts mechanically deflate a fresh-install wave. Cohort-maturity (optional)
  // restricts to persons whose FIRST-EVER event is >= N days old, so a build's
  // brand-new installers (who haven't had time to convert) don't drag the rate.
  // -------------------------------------------------------------------------
  const evList = KEY_EVENTS.map(e => `'${e}'`).join(',');
  const maturityClause =
    COHORT_MATURITY_DAYS > 0
      ? `AND person_id IN (
           SELECT person_id FROM events
           GROUP BY person_id
           HAVING min(timestamp) < now() - INTERVAL ${COHORT_MATURITY_DAYS} DAY
         )`
      : '';
  const rows = await hogql(
    `SELECT properties.$app_version AS ver, event, count(DISTINCT person_id) AS users
     FROM events
     WHERE timestamp > now() - INTERVAL ${WINDOW_PARSED.n} ${WINDOW_PARSED.unit}
       AND event IN (${evList})
       AND properties.$app_version IS NOT NULL
       ${maturityClause}
     GROUP BY ver, event`,
  );

  // Fold into { version -> { event -> users } } — per-user reach.
  const byVer = {};
  for (const [ver, event, users] of rows) {
    if (!ver) continue;
    (byVer[ver] ||= {})[event] = Number(users) || 0;
  }
  // `counts(v)` now returns the per-USER reach per event; `opensOf` = distinct
  // app_opened USERS (the per-user funnel denominator).
  const counts = v => ({...(byVer[v] || {})});
  const opensOf = v => byVer[v]?.[ANCHOR] || 0;

  const versions = Object.keys(byVer).sort(semverCmp); // ascending
  if (versions.length === 0) {
    console.log('  no versioned events in window — nothing to analyse.');
  } else {
    // CANDIDATE = the newest version by semver (the rollout we care about).
    const candidate = versions[versions.length - 1];
    // BASELINE = the version (other than candidate) with the most app_opened
    // USERS — the established, well-sampled stable build to compare against.
    const baseline = versions
      .filter(v => v !== candidate)
      .sort((a, b) => opensOf(b) - opensOf(a))[0];

    const cOpens = opensOf(candidate); // distinct users
    const cCounts = counts(candidate);
    const bOpens = baseline ? opensOf(baseline) : 0;
    console.log(
      `  candidate=${candidate} (app_opened users=${cOpens})  baseline=${baseline || '—'} (users=${bOpens})` +
        (COHORT_MATURITY_DAYS
          ? `  [cohort-maturity ${COHORT_MATURITY_DAYS}d]`
          : ''),
    );

    if (cOpens < TRIPWIRE_OPENS) {
      console.log(
        `  ⏳ candidate ${candidate} has ${cOpens} < ${TRIPWIRE_OPENS} app_opened users — insufficient volume; watching, filing nothing.`,
      );
    } else {
      // SIGNAL 2 — zero tripwire (PER-USER). A downstream key event reaches ~0%
      // of users on a build with real traffic, vs a baseline where it did.
      const bCounts = baseline ? counts(baseline) : {};
      const baselineTrusted = baseline && bOpens >= MIN_BASELINE_USERS;
      for (const ev of KEY_EVENTS) {
        if (ev === ANCHOR) continue;
        const cRate = ratio(cCounts, ev, ANCHOR); // per-user conversion
        const bRate = baseline ? ratio(bCounts, ev, ANCHOR) : null;
        const cN = cCounts[ev] || 0;
        // Only trip vs-baseline when the baseline is trusted (>= min users);
        // the absolute-zero arm needs no baseline trust (it's denominator-free).
        const baselineHadIt = baselineTrusted && bRate != null && bRate > 0.05;
        const crateredVsBaseline =
          baselineHadIt && (cRate == null || cRate <= bRate * 0.1);
        const crateredAbsolute =
          cN === 0 && cOpens >= TRIPWIRE_OPENS && baselineHadIt;
        if (crateredVsBaseline || crateredAbsolute) {
          signals.push({
            key: `event-zero:${ev}:${candidate}`,
            severity: 'high',
            kind: 'investigate',
            title: `[PostHog] "${ev}" reaches ~0 users on ${candidate} (${pct(cRate)} vs ${pct(bRate)} baseline, per-user)`,
            body: regressionBody({
              kind: 'Zero/near-zero per-user tripwire',
              candidate,
              baseline,
              cOpens,
              bOpens,
              metric: `distinct users with ${ev} / distinct users with ${ANCHOR}`,
              cRate,
              bRate,
              hint:
                `\`${ev}\` reached essentially NO users on ${candidate} (${cOpens} app_opened users), while the baseline ` +
                `had it at ${pct(bRate)} per-user. A downstream feature appears **broken on launch** for this build — the ` +
                (ev.startsWith('playback')
                  ? '#54 audio-init / catalog class'
                  : ev === 'mushaf_page_opened'
                    ? 'Mushaf preload / navigation class'
                    : 'engagement-collapse class') +
                `. Cross-check Sentry for crashes on build/version ${candidate}.`,
            }),
          });
        }
      }

      // SIGNAL 3 — per-user conversion regression, gated behind BOTH
      // --min-opens (candidate) AND --min-baseline-users (baseline). The
      // baseline-users floor is the fix for the 11-user-baseline trap (#174).
      if (baseline && cOpens >= MIN_OPENS && baselineTrusted) {
        for (const r of RATIOS) {
          if (SUPPRESSED_RATIOS.has(r.key)) {
            console.log(
              `  · ratio ${r.key} suppressed (debunked measurement-artifact class — see RATIOS).`,
            );
            continue;
          }
          const cR = ratio(cCounts, r.num, r.den); // per-user
          const bR = ratio(bCounts, r.num, r.den);
          if (cR == null || bR == null || bR === 0) continue;
          const rel = (cR - bR) / bR; // negative = drop
          const bad = r.dir === 'down' ? rel <= -DROP : rel >= DROP;
          if (bad) {
            signals.push({
              key: `ratio:${r.key}:${candidate}`,
              severity: 'medium',
              kind: 'regression',
              title: `[PostHog] ${r.label} (per-user) ${r.dir === 'down' ? 'dropped' : 'rose'} ${Math.abs(rel * 100).toFixed(0)}% on ${candidate}`,
              body: regressionBody({
                kind: 'Per-user conversion regression',
                candidate,
                baseline,
                cOpens,
                bOpens,
                metric: `${r.label} (per distinct user)`,
                cRate: cR,
                bRate: bR,
                hint: r.hint,
              }),
            });
          }
        }
      } else if (baseline && !baselineTrusted) {
        console.log(
          `  · ratio checks skipped — baseline ${baseline} has ${bOpens} < ${MIN_BASELINE_USERS} users (the 11-user-baseline trap guard).`,
        );
      } else if (baseline) {
        console.log(
          `  · ratio checks skipped — candidate ${candidate} has ${cOpens} < ${MIN_OPENS} app_opened users.`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // SIGNAL 4 — DISCRETE FAULT EVENTS. The silent-hang detectors
  // (planning/observability-gap-samsung-hang-2026-06-08.md) emit dedicated fault
  // events that produce NO downstream event (so ratios can't see them) and NO
  // exception (so Sentry can't see them). They are discrete fault signals, not
  // ratios — a single occurrence on the latest build is a real, reproduced hang.
  // So they get a ZERO-FLOOR, any-occurrence tripwire: no --min-opens /
  // --tripwire-opens gate, no baseline, no ratio. The mere existence of one of
  // these on the newest build is the alarm.
  // -------------------------------------------------------------------------
  const FAULT_EVENTS = [
    {
      event: 'reciter_profile_surahs_stalled',
      sev: 'high',
      label: 'reciter-profile surah list stuck on skeleton',
      hint:
        'The `neighborsReady` gate never lifted (the 2026-06-04 single-tab class, ' +
        'TECH_DEBT #114/#115, or a new Samsung ScrollView quirk). Cross-check ' +
        'Sentry `reciter-profile-surahs-stalled` for the device/rewaya/tabs_count ' +
        'breakdown — tabs_count<=1 on Android => the single-tab useEffect fallback ' +
        'regressed again.',
    },
    {
      event: 'boot_not_completed',
      sev: 'critical',
      label: 'a previous launch never completed boot',
      hint:
        'The boot sentinel found an uncleared `boot:incomplete` flag from a prior ' +
        'launch — a hard splash/cold-start hang (the #1 tester theme, "stuck on ' +
        'the green logo"). This is the only signal that survives a hard hang. ' +
        'Pivot on failed_build; cross-check Sentry `boot-not-completed`.',
    },
    {
      event: 'splash_stalled',
      sev: 'critical',
      label: 'splash never hidden within 12s',
      hint:
        'prepare() may have finished but a gate (fonts/player/mushaf) never ' +
        'flipped, OR a true hang. Cross-check Sentry `splash-hide-timeout` extra ' +
        'for which gate flag (app_is_ready / fonts_loaded / player_ready / ' +
        'mushaf_restore_handled) was still false.',
    },
  ];

  // Latest build by semver among versions that have ANY fault event in the
  // window. Each fault event is queried independently of app_opened volume.
  for (const f of FAULT_EVENTS) {
    let rows;
    try {
      rows = await hogql(
        `SELECT properties.$app_version AS ver, properties.$app_build AS build,
                count() AS n, count(DISTINCT person_id) AS users
           FROM events
          WHERE timestamp > now() - INTERVAL ${WINDOW_PARSED.n} ${WINDOW_PARSED.unit}
            AND event = '${f.event}'
            AND properties.$app_version IS NOT NULL
          GROUP BY ver, build
          ORDER BY ver DESC`,
      );
    } catch (e) {
      console.warn(`  ⚠ fault query for "${f.event}" failed: ${e.message}`);
      continue;
    }
    if (!rows.length) continue;
    // Newest version (by semver) that has this fault in the window.
    const latest = rows
      .map(r => String(r[0]))
      .filter(Boolean)
      .sort(semverCmp)
      .pop();
    if (!latest) continue;
    // Only fire for the newest build(s) so an already-fixed-and-shipped fault on
    // an older build isn't re-litigated.
    const onLatest = rows.filter(([ver]) => semverCmp(ver, latest) >= 0);
    const total = onLatest.reduce((a, [, , n]) => a + Number(n), 0);
    const users = onLatest.reduce((a, [, , , u]) => a + Number(u), 0);
    if (total > 0) {
      signals.push({
        key: `fault:${f.event}:${latest}`,
        severity: f.sev,
        kind: 'investigate',
        title: `[PostHog] ${f.label} — ${total} event(s)/${users} user(s) on ${latest}`,
        body: faultBody({
          event: f.event,
          label: f.label,
          hint: f.hint,
          version: latest,
          total,
          users,
          rows: onLatest,
        }),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Dedup against already-filed GitHub issues (by embedded marker key).
  // -------------------------------------------------------------------------
  if (!DRY_RUN) ensureLabels([LABEL]);
  let filedKeys = new Set();
  try {
    const existing = JSON.parse(
      gh([
        'issue',
        'list',
        '--repo',
        GH_REPO,
        '--label',
        LABEL,
        '--state',
        'all',
        '--limit',
        '500',
        '--json',
        'body',
      ]),
    );
    for (const e of existing) {
      const m = (e.body || '').match(
        new RegExp(`${MARKER_PREFIX}([^\\s>]+)`, 'g'),
      );
      if (m) m.forEach(s => filedKeys.add(s.slice(MARKER_PREFIX.length)));
    }
  } catch (e) {
    console.warn(`  ⚠ could not list existing issues for dedup: ${e.message}`);
    if (!DRY_RUN) {
      console.error('  refusing to file without a working dedup check.');
      process.exit(1);
    }
  }
  const fresh = signals.filter(s => !filedKeys.has(s.key));
  console.log(
    `  signals: ${signals.length} total, ${fresh.length} new  [${filedKeys.size} already filed]`,
  );

  // Cap.
  const sevRank = {critical: 4, high: 3, medium: 2, low: 1};
  fresh.sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0));
  const toFile = fresh.slice(0, MAX);
  const overflow = fresh.length - toFile.length;

  if (EMIT) {
    writeFileSync(EMIT, JSON.stringify(signals, null, 2));
    console.log(`  wrote signals → ${EMIT}`);
  }

  // File.
  let filed = 0;
  const tmp = mkdtempSync(join(tmpdir(), 'posthog-triage-'));
  for (const s of toFile) {
    const labels = [LABEL, s.kind, `severity:${s.severity}`];
    const body = `${s.body}\n\n<!-- ${MARKER_PREFIX}${s.key} -->`;
    if (DRY_RUN) {
      console.log('\n' + '─'.repeat(72));
      console.log(`WOULD FILE: ${s.title}`);
      console.log(`  labels: ${labels.join(', ')}`);
      console.log(
        body
          .split('\n')
          .map(l => '  ' + l)
          .join('\n'),
      );
      filed++;
      continue;
    }
    ensureLabels(labels);
    const bodyFile = join(tmp, `${s.key.replace(/[^a-z0-9]+/gi, '_')}.md`);
    writeFileSync(bodyFile, body);
    const url = gh([
      'issue',
      'create',
      '--repo',
      GH_REPO,
      '--title',
      s.title.slice(0, 140),
      '--body-file',
      bodyFile,
      ...labels.flatMap(l => ['--label', l]),
    ]);
    console.log(`  ✅ filed ${s.key} → ${url}`);
    filed++;
  }

  console.log(
    `\n▶ done — ${signals.length} signal(s), ${fresh.length} new, ` +
      `${DRY_RUN ? 'would file' : 'filed'} ${filed}${overflow > 0 ? ` (+${overflow} deferred)` : ''}.`,
  );
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `filed=${DRY_RUN ? 0 : filed}\nnew=${fresh.length}\ndeferred=${overflow}\n`,
      {flag: 'a'},
    );
  }
}

function regressionBody({
  kind,
  candidate,
  baseline,
  cOpens,
  bOpens,
  metric,
  cRate,
  bRate,
  hint,
}) {
  return `> Filed automatically by \`scripts/posthog-triage.mjs\` (see \`.github/workflows/diagnostics-watch.yml\`).

## PostHog: ${kind}

**${metric}** regressed on \`${candidate}\`.

| | Candidate \`${candidate}\` | Baseline \`${baseline || '—'}\` |
|---|---|---|
| **app_opened** | ${cOpens} | ${bOpens} |
| **${metric}** | ${pct(cRate)} | ${pct(bRate)} |

### What this means
${hint}

> ⚠️ This is an **investigation**, not a crash with a stack trace. PostHog tells
> you *that* something changed, not *why*. Confirm volume is sufficient, then
> reproduce on a device and cross-reference Sentry for crashes on the same build.

### Checklist
- [ ] Confirm the candidate sample is large enough to trust (low DAU = noisy ratios)
- [ ] Cross-check Sentry issues filed for version \`${candidate}\`
- [ ] Reproduce on a device on build \`${candidate}\`
- [ ] If a real regression, open a fix PR; otherwise close with a note
`;
}

// Discrete-fault issue body — a silent-hang fault detector fired (no ratio, no
// baseline; the event's mere existence on the latest build is the signal).
function faultBody({event, label, hint, version, total, users, rows}) {
  const table = rows
    .map(
      ([ver, build, n, u]) =>
        `| \`${ver}\` | \`${build ?? '—'}\` | ${n} | ${u} |`,
    )
    .join('\n');
  return `> Filed automatically by \`scripts/posthog-triage.mjs\` (see \`.github/workflows/diagnostics-watch.yml\`).

## PostHog: discrete fault — ${label}

The silent-hang detector emitted \`${event}\` on \`${version}\`. This is a
**discrete fault event**, not a ratio — it produces no downstream event (so
ratio detectors are blind) and no exception (so Sentry is blind on the app
itself). The mere existence of **${total} occurrence(s) across ${users} user(s)**
on the latest build is the alarm; there is no volume floor.

| version | build | events | users |
|---|---|---|---|
${table}

### What this means
${hint}

> ⚠️ This is an **investigation** of a silent hang reproduced in the field, not a
> crash with a stack trace. See \`planning/observability-gap-samsung-hang-2026-06-08.md\`.

### Checklist
- [ ] Cross-check the matching Sentry warning (\`${event.replace(/_/g, '-')}\` or the §6 allow-list culprit) for device / OS / which-gate-was-false detail
- [ ] Confirm \`release\`/\`dist\` are populated (non-\`None\`) on the affected Android build
- [ ] Reproduce on a device on build \`${version}\` (prefer a Samsung / single-tab reciter for the reciter-profile fault)
- [ ] If a real regression, open a fix PR; otherwise close with a note
`;
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
