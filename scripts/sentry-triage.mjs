#!/usr/bin/env node
// @ai
//
// scripts/sentry-triage.mjs
// -------------------------
// Daily Sentry → GitHub issue triage bot for Qariah v2.
//
// Monitors the Sentry project for NEW, REAL, production crash-class issues AND
// purpose-built *user-impacting* non-crash signals (silent cold-start hangs,
// OEM-killed background audio, dropped deep links — see MESSAGE_ALLOWLIST),
// triages them (category + severity + device/OS/release breakdown + a
// correlation note seeded from CLAUDE.md / TECH_DEBT / the user-feedback
// findings), and files a deduplicated GitHub issue for each (non-crash signals
// also get a `user-impacting` label).
//
// The risky parts — filtering noise, deduping against already-filed issues,
// and capping volume so a first run can't flood the tracker — are
// DETERMINISTIC on purpose. Triage prose comes from a built-in knowledge
// map; an optional Claude-enrichment step (see .github/workflows/
// diagnostics-watch.yml) can add deeper root-cause analysis on top.
//
// Runs both in CI (see the workflow) and locally:
//   set -a && source .env.local && set +a   # provides SENTRY_READ_TOKEN
//   node scripts/sentry-triage.mjs --dry-run        # preview, files nothing
//   node scripts/sentry-triage.mjs                  # file issues
//
// Required env:
//   SENTRY_READ_TOKEN   Sentry auth token with org:read + project:read + event:read
// Optional env (sensible defaults for this repo):
//   SENTRY_ORG          default "qariah"
//   SENTRY_PROJECT      default "qariahv2"
//   SENTRY_REGION_HOST  default "https://de.sentry.io"  (EU region)
//   GH_REPO             default "omar-zarka/qariah-v2"
//   GH_TOKEN            GitHub token for `gh` (CI: secrets.GITHUB_TOKEN)
//
// Flags:
//   --dry-run             query + triage + print, but DO NOT create issues
//   --window=24h          Sentry stats window (free plan allows "", 24h, 14d)
//   --max=10              max issues to file in one run (rest are reported, not dropped silently)
//   --include-warnings    also consider level=warning (default: error+fatal only)
//   --emit-candidates=F   also write the triaged candidate set to file F (JSON)
//   --help
//
// SIGNAL-LEVEL COLLAPSE (the 2026-06-14 expert review's #9 + #1-SRE). Sentry
// splits ONE logical message into N shortIds (QARIAHV2-G/N/11 = three
// "slow-cold-start"; J/V/T/14 = four "diagnostic-js-stall"), and the bot filed
// each at a different severity for the SAME hang. This run now collapses fresh
// issues by a normalized SIGNAL TOKEN, files ONE issue per token (the
// highest-reach representative listing the member shortIds), and computes
// severity on the COLLAPSED reach (summed users) so fragmented clusters aren't
// under-rated. A stable signature hash (sha1 of normalized title+culprit+type)
// is embedded as a second dedup marker so a re-split of the same signal under a
// new shortId folds instead of re-filing. `fatal` is floored at `high`.
//
// SURFACED TAGS. The app already collects rich init/OOM context
// (`slow_init_service`, `boot_step`, `device_tier`, `is_low_ram`, `app_memory`
// PSS) but the bot never showed it. These now render in the issue body for the
// cold-start / init / OOM categories, so the cold-start answer (Tafseer DB) and
// the OOM memory state aren't buried.

import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
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
      'Usage: node scripts/sentry-triage.mjs [--dry-run] [--window=24h] [--max=10]',
      '                                      [--include-warnings] [--emit-candidates=FILE]',
      '',
      'Env: SENTRY_READ_TOKEN (required), SENTRY_ORG, SENTRY_PROJECT,',
      '     SENTRY_REGION_HOST, GH_REPO, GH_TOKEN',
    ].join('\n'),
  );
  process.exit(0);
}

const TOKEN = process.env.SENTRY_READ_TOKEN;
const ORG = process.env.SENTRY_ORG || 'qariah';
const PROJECT = process.env.SENTRY_PROJECT || 'qariahv2';
const HOST = (process.env.SENTRY_REGION_HOST || 'https://de.sentry.io').replace(
  /\/$/,
  '',
);
const GH_REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

const DRY_RUN = flag('dry-run');
// Sentry's free plan only accepts these stats periods. Clamp anything else
// (e.g. a PostHog-style "7d" fat-fingered into the shared workflow input) to
// 24h with a warning, rather than hard-failing with a 400 mid-run.
const SENTRY_WINDOWS = ['', '24h', '14d'];
const WINDOW_RAW = opt('window', '24h');
const WINDOW = SENTRY_WINDOWS.includes(WINDOW_RAW) ? WINDOW_RAW : '24h';
if (WINDOW !== WINDOW_RAW) {
  console.warn(
    `  ⚠ invalid --window="${WINDOW_RAW}" for Sentry (allowed: '', 24h, 14d); using 24h`,
  );
}
const MAX = parseInt(opt('max', '10'), 10);
const INCLUDE_WARNINGS = flag('include-warnings');
const EMIT = opt('emit-candidates', '');

if (!TOKEN) {
  console.error(
    '❌ SENTRY_READ_TOKEN is not set. Source .env.local or set the secret.',
  );
  process.exit(2);
}

const LEVELS = INCLUDE_WARNINGS
  ? ['fatal', 'error', 'warning']
  : ['fatal', 'error'];

// Narrow allow-list for purpose-built REPORT-ONLY *user-impacting* signals the
// app emits as level=`warning`/`info` — nothing threw, but the user still hit a
// failure: a silent cold-start hang, OEM-killed background audio, a dropped deep
// link. The default fatal/error gate would drop them, so let THESE SPECIFIC
// culprits through regardless of --include-warnings, WITHOUT broadening the
// global warning filter (the firehose of generic warnings stays out). Every entry
// here is a known user-facing failure we WANT filed (and gets a `user-impacting`
// label at file time). Matched against title/culprit/value/type.
//   cold-start hang  : slow-cold-start, boot-not-completed, splash-hide-timeout,
//                      app-init-service-timeout, reciter-profile-surahs-stalled
//   background audio : playback-killed-in-background, playback-stopped-in-background
//   navigation       : deeplink-dropped
//   diagnostics      : diagnostic-js-stall (JS-thread freeze, diagnostic builds only)
const MESSAGE_ALLOWLIST =
  /reciter-profile-surahs-stalled|splash-hide-timeout|boot-not-completed|slow-cold-start|app-init-service-timeout|playback-(killed|stopped)-in-background|deeplink-dropped|diagnostic-js-stall/i;

// Substrings that mark an issue as known noise (best-effort sync, dev-only,
// synthetic). Matched case-insensitively against title + culprit + value +
// type. Keep this list curated; everything here is excluded from filing.
const IGNORE_PATTERNS = [
  'postsRestore', // QF notes/reflections best-effort restore — non-fatal
  '/posts/feed', // community reflections feed (QfApiError 403/502 noise)
  '/posts/my-posts',
  'quran-reflect/v1/posts',
  'QfApiError', // QF user-state API errors are best-effort, non-blocking
  'Unable to download asset', // Metro dev-server asset fetch (local dev)
  'TEST - Sentry Client Crash', // synthetic crash test
  'synthetic crash', // synthetic crash test (Sprint 8)
  "CommunityReflectionsSheet doesn't exist", // resolved dev-only path
];

// Triage knowledge map — seeded from CLAUDE.md, TECH_DEBT, and the
// 2026-06 user-feedback triage. First matching entry wins.
const KNOWLEDGE = [
  {
    // REPORT-ONLY silent-hang detector — reciter-profile skeleton watchdog (§1 of
    // planning/observability-gap-samsung-hang-2026-06-08.md). This is a purpose-
    // built warning message, not an exception (nothing threw). Must rank ABOVE
    // the generic ANR/native rules so it gets its specific correlation note.
    re: /reciter-profile-surahs-stalled/i,
    category: 'reciter-profile render hang (skeleton gate)',
    note:
      'The `neighborsReady` gate in components/reciter-profile/ReciterProfile.tsx never ' +
      'lifted — surah list stuck on the skeleton forever (a silent hang: no throw, no ' +
      'crash). This is the **2026-06-04 single-tab class** (TECH_DEBT #114 boot-gate, ' +
      '#115 recurrence site; see the 2026-06-08 Samsung cold-start hang plan). Read the ' +
      'event `extra` for tabs_count / rewaya_id / platform: **tabs_count<=1 on Android => ' +
      'the single-tab useEffect fallback regressed again**. iOS can NOT reproduce this ' +
      '(UIScrollView always fires onContentSizeChange). Cross-check the PostHog ' +
      '`reciter_profile_surahs_stalled` fault issue for the per-build event/user count.',
  },
  {
    // REPORT-ONLY silent-hang detector — boot sentinel (§2) + splash-hide watchdog
    // (§3). Both are warning messages by design. Rank above the generic ANR rule.
    re: /boot-not-completed|splash-hide-timeout|slow-cold-start|app-init-service-timeout/i,
    category: 'cold-start / splash hang',
    note:
      'A launch did not reach interactive in time (the #1 tester theme — **stuck on the ' +
      'green logo**, Android #4/#5/#8/#9; Sentry QARIAHV2-G is the live cluster). ' +
      '`slow-cold-start` = the 8s boot watchdog fired; on build **1309+** read the ' +
      '**`slow_init_service`** tag + `init_in_flight`/`init_completed` extras (S34.1 probe) — ' +
      'they name the exact init service still running when it tripped, which decomposes this ' +
      'cluster for the first time. `app-init-service-timeout` = the non-critical init batch ' +
      'overran (same `slow_init_service` extra). `boot-not-completed` = the boot sentinel ' +
      'caught a PRIOR wedged launch that never cleared `boot:incomplete` (survives a hard ' +
      'hang). `splash-hide-timeout` = prepare() finished but a splash-hide gate ' +
      '(fonts/player/mushaf) never flipped — check the `extra` for which flag was still ' +
      'false. Prime suspects: catalog network fetch + bundled Tafseer/translation DB imports ' +
      '(the #144 lazy-open lever) + Mushaf Skia/SQLite preload; verify `bundleFirstCatalog` + ' +
      '`deferMushafPreload` are in the build, and the device_tier context (is_low_ram). ' +
      'Field truth: ~95% stall at `boot_step=catalog-ready`. NOTE: if Android `release`/`dist` ' +
      "shows `None`, the build can't be pinned until native manifest tagging lands.",
  },
  {
    // ExpoKeepAwake.deactivate / ExpoSystemUI.setBackgroundColorAsync / etc.
    // all surface as "current activity is no longer available" when the OS
    // destroys the Android Activity out from under a native module call.
    re: /ExpoKeepAwake|keep-?awake|current activity (is )?no longer available|Expo[A-Za-z]+\.[A-Za-z]+' has been rejected/i,
    category: 'android activity lifecycle (often background playback)',
    note:
      'Android Activity destroyed out from under a native module call ("current activity is no longer ' +
      'available") — typically the OS killing the app, most impactful during background audio. Correlates ' +
      'with **Sprint-24 FB-1** (Samsung One UI / OnePlus / Xiaomi aggressively kill the audio foreground ' +
      'service) and the tester "recitation stops mid-ayah" reports. Check the POST_NOTIFICATIONS runtime ' +
      'grant + the `withAndroidNotificationPermission` plugin shipped to the affected build, and the ' +
      "device's battery-optimization setting for the app.",
  },
  {
    // S33.2 background-audio kill telemetry (report-only). OEM battery restriction
    // stops the audio foreground service while backgrounded — the tester "recitation
    // stops mid-ayah" report, device-verified on the A35. Rank above the generic
    // ANR/native rules so it gets its specific correlation note.
    re: /playback-(killed|stopped)-in-background/i,
    category: 'background audio killed (OEM battery restriction)',
    note:
      'Audio stopped while the app was backgrounded (**S33.2**, the tester "recitation stops" ' +
      'report). `playback-killed-in-background` = the reliably-caught process-death variant (the ' +
      'sentinel survives to the next foreground); it trips the one-time battery-unrestrict prompt ' +
      '(`store/backgroundPlaybackStore.ts`). `playback-stopped-in-background` = the silent ' +
      "player-death variant (best-effort — this OEM's restriction-stop disarms the foreground " +
      'detector, so it fires rarely). Read the `extra` for standby-bucket / battery-optimization ' +
      'state + `device.model`. The kill is **non-deterministic per run** even on one device ' +
      '(process-death vs service-stop-survives vs audio-survives). Compare the per-build rate ' +
      'before/after the battery prompt shipped (build **1301+**); "playing→false while backgrounded" ' +
      'is NOT specific to battery restriction (also calls / audio-focus loss).',
  },
  {
    // Diagnostic-build-only heartbeat: the JS thread stalled past the overrun
    // threshold during a session (EXPO_PUBLIC_DIAGNOSTIC_MODE builds + the
    // PostHog `diagnostics_mode` cohort). High-value while a diagnostic build is
    // out with testers — it pinpoints a JS-thread freeze the user felt as a hang.
    re: /diagnostic-js-stall/i,
    category: 'JS-thread stall (diagnostic build)',
    note:
      'The diagnostics heartbeat detected the JS thread frozen past the overrun threshold — a ' +
      'freeze the user experiences as an unresponsive/janky app or a hang. Only emitted by ' +
      'diagnostic builds (`EXPO_PUBLIC_DIAGNOSTIC_MODE`) or the `diagnostics_mode` PostHog cohort, ' +
      'so volume is low by design but every event is a real felt-stall. Read the breadcrumbs + ' +
      'session replay around the timestamp for what ran on the JS thread; cross-check the ' +
      'cold-start cluster (it often co-occurs with `slow-cold-start`).',
  },
  {
    // #107 dropped-deep-link watchdog (report-only).
    re: /deeplink-dropped/i,
    category: 'dropped deep link (navigation)',
    note:
      'A deep link (share-intent / OAuth callback / notification tap) was received but did not ' +
      'navigate — the user landed nowhere or on the wrong screen (instrumented in #107). Read the ' +
      '`extra` for the link shape + the drop reason (router not ready / unmatched route / consumed ' +
      'twice). Correlate with the share-intent + OAuth-callback link shapes; a spike concentrated ' +
      'on one shape or one build is the actionable signal.',
  },
  {
    re: /\bANR\b|ApplicationNotResponding/i,
    category: 'boot / main-thread hang',
    note:
      'Main-thread hang (App Not Responding). Correlates with the **"stuck on logo / won\'t open"** tester ' +
      'cluster (Android #4/#5/#8/#9). Prime suspect is heavy cold-start: catalog network fetch (10s timeout) + ' +
      'Mushaf Skia/SQLite preload + bundled Tafseer/translation DB imports — the exact Sprint 30/31 perf targets. ' +
      'Verify `bundleFirstCatalog` (offline first-launch) is in the build. NOTE: Android `release` tagging may be ' +
      "missing — if so the dist/release is `None` and this can't be tied to a build until that is fixed.",
  },
  {
    re: /DigitalKhatt|typeface|fontMgr|font.?manager/i,
    category: 'mushaf / font load',
    note:
      'Mushaf font-load race (the `useMushafFontMgr` class; see TECH_DEBT). Was loud May 9–11. Watch for ' +
      'recurrence on real devices; the three-layer invisible-fallback architecture (upstream PR #273) should ' +
      'mask it — a spike here means the fallback is not engaging.',
  },
  {
    re: /swift_abortRetainUnowned|RNSTabBar|swift_unknownObjectUnownedLoadStrong/i,
    category: 'iOS native (likely env artifact)',
    note:
      'Known **iOS simulator-only** DerivedData/ABI skew artifact (CLAUDE.md hard-rule #13). If the environment ' +
      'is `development` / device is a simulator, this is NOT a real production bug — purge DerivedData + ' +
      '`pod install`. Only treat as real if it appears on a physical device in production.',
  },
  {
    re: /EXC_BAD_ACCESS|SIGSEGV|SIGABRT|EXC_BREAKPOINT/i,
    category: 'native crash',
    note:
      'Native crash. Capture the device / OS / release breakdown above and read the Sentry stack for the ' +
      'first app/RN/Skia/Reanimated frame. Cross-check `environment` — drop if `development`-only.',
  },
  {
    re: /Network request failed|Bad gateway|50[0-9]\b/i,
    category: 'network / transient',
    note:
      'Network or upstream (5xx) failure. Often transient. Only actionable if it is concentrated on one ' +
      'endpoint, one release, or a sudden spike. Otherwise consider ignoring/fingerprinting as noise.',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function sentry(path) {
  const url = `${HOST}/api/0${path}`;
  const res = await fetch(url, {headers: {Authorization: `Bearer ${TOKEN}`}});
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sentry ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
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

const haystack = i =>
  [i.title, i.culprit, i?.metadata?.value, i?.metadata?.type]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

function isIgnored(i) {
  const h = haystack(i);
  return IGNORE_PATTERNS.find(p => h.includes(p.toLowerCase())) || null;
}

// `collapsedUsers` (optional) is the SUMMED reach across all shortIds that share
// this signal token — so a fragmented cluster (G+N+11 = one slow-cold-start) is
// rated on its true reach, not the largest single fragment.
function classify(i, tags, collapsedUsers) {
  const h = `${i.title} ${i.culprit} ${i?.metadata?.value} ${i?.metadata?.type}`;
  const known = KNOWLEDGE.find(k => k.re.test(h));
  // Severity from level + user reach (collapsed when provided).
  const users = collapsedUsers != null ? collapsedUsers : i.userCount || 0;
  let sev;
  if (users >= 20) sev = 'critical';
  else if (users >= 5) sev = 'high';
  else if (users >= 2) sev = 'medium';
  else sev = 'low';
  // FATAL FLOOR — a fatal is at LEAST high regardless of (small) user count: a
  // single-user fatal on new hardware is still a fatal. A high-reach fatal goes
  // critical via the reach rule above.
  if (i.level === 'fatal' && sev !== 'critical') sev = 'high';
  // Platform from device.family / os tags.
  const platTags =
    `${tags['device.family'] || ''} ${tags['os'] || ''}`.toLowerCase();
  const platforms = [];
  if (/ios|iphone|ipad/.test(platTags)) platforms.push('ios');
  if (/android|pixel|sm-|redmi|moto|samsung/.test(platTags))
    platforms.push('android');
  return {
    category: known?.category || 'uncategorized — needs manual triage',
    note:
      known?.note ||
      'No known correlation. Review the stack + device/release breakdown above.',
    severity: sev,
    platforms,
  };
}

function topTagLine(tags, key) {
  const v = tags[key];
  return v && v.length ? v.map(t => `${t.value} (${t.count})`).join(', ') : '—';
}

// Categories whose init/OOM context tags are worth surfacing.
const SHOW_INIT_TAGS = /cold-start|splash|init|hang|oom|memory|native crash/i;

function fmtIssueBody(i, tags, triage, group) {
  const permalink = i.permalink || `https://${ORG}.sentry.io/issues/${i.id}/`;
  const sig = signature(i);

  // Collapsed-signal summary (when >1 shortId shares this signal).
  const members = group?.members || [i];
  const collapsedBlock =
    members.length > 1
      ? `\n> **Collapsed signal** — Sentry split this one logical signal across ${members.length} issues; ` +
        `filed once here. Summed reach: **${group.users} users / ${group.count} events**.\n> Members: ` +
        members.map(m => `\`${m.shortId}\``).join(', ') +
        '\n'
      : '';

  // Surface the init/OOM context tags for the relevant categories.
  const initTags = SHOW_INIT_TAGS.test(triage.category)
    ? [
        ['Stalled init service', 'slow_init_service'],
        ['Boot step', 'boot_step'],
        ['Device tier', 'device_tier'],
        ['Low RAM', 'is_low_ram'],
        ['App memory (PSS)', 'app_memory'],
      ]
        .map(([label, key]) => {
          const line = topTagLine(tags, key);
          return line === '—' ? null : `- **${label}:** ${line}`;
        })
        .filter(Boolean)
        .join('\n')
    : '';

  return `> Filed automatically by \`scripts/sentry-triage.mjs\` (see \`.github/workflows/diagnostics-watch.yml\`).
${collapsedBlock}
## Sentry: [${i.shortId}](${permalink})

**${i.metadata?.type ? i.metadata.type + ': ' : ''}${i.metadata?.value || i.title}**

| | |
|---|---|
| **Level** | \`${i.level}\` |
| **Events / Users (this issue)** | ${i.count} / ${i.userCount} |${members.length > 1 ? `\n| **Events / Users (signal)** | ${group.count} / ${group.users} |` : ''}
| **First seen** | ${i.firstSeen} |
| **Last seen** | ${i.lastSeen} |
| **Culprit** | \`${i.culprit || '—'}\` |

### Affected (last ${WINDOW})
- **Environment:** ${topTagLine(tags, 'environment')}
- **Release:** ${topTagLine(tags, 'release')}
- **OS:** ${topTagLine(tags, 'os')}
- **Device:** ${topTagLine(tags, 'device')}
${initTags ? `\n### Init / memory context (app probe)\n${initTags}\n` : ''}
### Triage
- **Category:** ${triage.category}
- **Severity:** ${triage.severity}
- **Platform:** ${triage.platforms.join(' + ') || 'unknown'}
- **Correlation:** ${triage.note}

### Checklist
- [ ] Confirm this is a real production bug (not dev/simulator noise)
- [ ] Reproduce or identify the affected build/device
- [ ] Link any matching tester feedback (\`planning/user-feedback-triage-2026-06.md\`)
- [ ] Fix, then mark the Sentry issue **Resolved in <build>**

<!-- ${MARKER_PREFIX}${i.shortId} -->
<!-- ${SIG_PREFIX}${sig} -->`;
}

const MARKER_PREFIX = 'sentry-triage-id:';
const SIG_PREFIX = 'sentry-triage-sig:'; // stable signal signature (2nd dedup layer)
const LABEL = 'sentry';

// Canonical SIGNAL TOKEN for collapsing the N-shortIds-for-one-message split.
// The purpose-built warning signals (MESSAGE_ALLOWLIST) and a handful of crash
// families have a stable name we can group on; otherwise fall back to a
// normalized message head. Two issues with the same token are ONE logical
// signal — file once, list the members.
const SIGNAL_TOKENS = [
  'reciter-profile-surahs-stalled',
  'splash-hide-timeout',
  'boot-not-completed',
  'slow-cold-start',
  'app-init-service-timeout',
  'playback-killed-in-background',
  'playback-stopped-in-background',
  'deeplink-dropped',
  'diagnostic-js-stall',
];
function signalToken(i) {
  const h = haystack(i);
  for (const t of SIGNAL_TOKENS) if (h.includes(t)) return t;
  // Crash families: collapse by the exception type if present, else a
  // normalized message head (strip addresses/numbers so split shortIds for the
  // same crash share a token).
  if (i.metadata?.type) return `type:${i.metadata.type}`;
  const head = `${i.metadata?.value || i.title || ''}`
    .replace(/0x[0-9a-f]+/gi, '0x_')
    .replace(/\b\d{4,}\b/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80);
  return `msg:${head}`;
}
// Stable signature hash (second dedup marker) — survives a Sentry re-split that
// assigns a new shortId to the same logical signal.
function signature(i) {
  return crypto
    .createHash('sha1')
    .update(signalToken(i))
    .digest('hex')
    .slice(0, 16);
}

function ensureLabels(labels) {
  if (DRY_RUN) return;
  const palette = {
    sentry: '5319e7',
    bug: 'd73a4a',
    'severity:critical': 'b60205',
    'severity:high': 'd93f0b',
    'severity:medium': 'fbca04',
    'severity:low': 'c2e0c6',
    android: '3ddc84',
    ios: 'a2d2ff',
    'user-impacting': 'e11d21',
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
      /* label exists / race — fine */
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(
    `▶ sentry-triage  org=${ORG} project=${PROJECT} window=${WINDOW} ` +
      `levels=[${LEVELS.join(',')}] max=${MAX}${DRY_RUN ? '  (DRY RUN)' : ''}`,
  );

  // 1. Pull unresolved, production issues in the window.
  const q = encodeURIComponent('is:unresolved');
  const issues = await sentry(
    `/projects/${ORG}/${PROJECT}/issues/?statsPeriod=${WINDOW}&query=${q}&environment=production&sort=freq&limit=100`,
  );
  console.log(`  scanned: ${issues.length} unresolved production issue(s)`);

  // 2. Deterministic filter: level + ignore-list.
  const filtered = [];
  for (const i of issues) {
    // Keep the default fatal/error gate, but never drop the purpose-built
    // silent-hang warning signals (MESSAGE_ALLOWLIST) — they are level=warning
    // by design (nothing threw).
    if (!LEVELS.includes(i.level) && !MESSAGE_ALLOWLIST.test(haystack(i)))
      continue;
    const ig = isIgnored(i);
    if (ig) {
      console.log(`  · skip ${i.shortId} (noise: "${ig}")`);
      continue;
    }
    filtered.push(i);
  }
  console.log(`  after level+noise filter: ${filtered.length}`);

  // 3. Dedup against already-filed GitHub issues (by embedded marker / shortId).
  // Ensure the `sentry` label exists first, so the `--label` filter below
  // works on the very first run (when no issue has created it yet).
  if (!DRY_RUN)
    ensureLabels([
      LABEL,
      'bug',
      'severity:critical',
      'severity:high',
      'severity:medium',
      'severity:low',
      'android',
      'ios',
      'user-impacting',
    ]);
  let alreadyFiled = new Set(); // shortIds
  let alreadyFiledSigs = new Set(); // signal signatures
  let alreadyFiledTokens = new Set(); // signal tokens (from filed-issue bodies)
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
        'title,body',
      ]),
    );
    for (const e of existing) {
      const blob = `${e.title}\n${e.body || ''}`;
      const m = blob.match(/QARIAHV2-[A-Z0-9]+/g);
      if (m) m.forEach(id => alreadyFiled.add(id));
      const ms = blob.match(new RegExp(`${SIG_PREFIX}([^\\s>]+)`, 'g'));
      if (ms) ms.forEach(s => alreadyFiledSigs.add(s.slice(SIG_PREFIX.length)));
    }
  } catch (e) {
    console.warn(
      `  ⚠ could not list existing GitHub issues for dedup: ${e.message}`,
    );
    if (!DRY_RUN) {
      console.error('  refusing to file without a working dedup check.');
      process.exit(1);
    }
  }
  // A filed issue's signature covers any not-yet-seen shortId of the same signal.
  for (const sig of alreadyFiledSigs) alreadyFiledTokens.add(sig);

  // 3b. SIGNAL-TOKEN COLLAPSE — fold the N-shortIds-for-one-message split into
  //     ONE logical signal. Group fresh issues by signalToken, keep the
  //     highest-reach representative, sum the reach, and remember the members.
  const freshRaw = filtered.filter(
    i => !alreadyFiled.has(i.shortId) && !alreadyFiledSigs.has(signature(i)),
  );
  const byToken = new Map();
  for (const i of freshRaw) {
    const tok = signalToken(i);
    const g = byToken.get(tok);
    if (!g)
      byToken.set(tok, {
        rep: i,
        members: [i],
        users: i.userCount || 0,
        count: i.count || 0,
      });
    else {
      g.members.push(i);
      g.users += i.userCount || 0;
      g.count += i.count || 0;
      if ((i.userCount || 0) > (g.rep.userCount || 0)) g.rep = i;
    }
  }
  // Drop any group whose signature is already filed (a re-split of a known signal).
  const groups = [...byToken.values()].filter(
    g => !alreadyFiledSigs.has(signature(g.rep)),
  );
  const collapsedCount = freshRaw.length - groups.length;
  if (collapsedCount > 0)
    console.log(
      `  collapsed ${collapsedCount} split shortId(s) into their signal representative`,
    );
  console.log(
    `  new logical signal(s): ${groups.length}  ` +
      `[${alreadyFiled.size} shortIds / ${alreadyFiledSigs.size} signatures known]`,
  );

  // 4. Cap — sort by collapsed severity-ish (fatal first, then summed reach).
  const rank = g =>
    (g.rep.level === 'fatal' ? 1e9 : 0) + g.users * 1000 + g.count;
  groups.sort((a, b) => rank(b) - rank(a));
  const toFileGroups = groups.slice(0, MAX);
  const overflow = groups.length - toFileGroups.length;
  if (overflow > 0) {
    console.log(
      `  ⚠ capping at --max=${MAX}; ${overflow} more new signal(s) will be filed on the next run:`,
    );
    groups
      .slice(MAX)
      .forEach(g =>
        console.log(
          `      ${g.rep.shortId} ${g.rep.title} (×${g.members.length})`,
        ),
      );
  }
  // The per-issue pipeline below operates on the representative, carrying the
  // collapsed reach + member list.
  const toFile = toFileGroups.map(g => g.rep);
  const groupByRep = new Map(toFileGroups.map(g => [g.rep.shortId, g]));

  // 5. Enrich survivors with tag breakdowns + triage, then file.
  //    The init/OOM context the app already collects (slow_init_service =
  //    WHICH service stalled cold-start [Tafseer DB per the S34.1 probe];
  //    boot_step, device_tier, is_low_ram, app_memory PSS) is now pulled and
  //    surfaced for the cold-start / init / OOM categories.
  const TAG_KEYS = [
    'environment',
    'release',
    'os',
    'device',
    'device.family',
    'slow_init_service',
    'boot_step',
    'device_tier',
    'is_low_ram',
    'app_memory',
  ];
  const candidates = [];
  for (const i of toFile) {
    const tags = {};
    for (const key of TAG_KEYS) {
      try {
        const t = await sentry(
          `/organizations/${ORG}/issues/${i.id}/tags/${encodeURIComponent(key)}/?statsPeriod=${WINDOW}`,
        );
        tags[key] = (t.topValues || [])
          .slice(0, 5)
          .map(v => ({value: v.value, count: v.count}));
      } catch {
        tags[key] = [];
      }
    }
    const group = groupByRep.get(i.shortId);
    const triage = classify(
      i,
      {
        'device.family': tags['device.family']?.map(t => t.value).join(' '),
        os: tags['os']?.map(t => t.value).join(' '),
      },
      group?.users,
    );
    candidates.push({issue: i, tags, triage, group});
  }

  if (EMIT) {
    writeFileSync(
      EMIT,
      JSON.stringify(
        candidates.map(c => ({
          shortId: c.issue.shortId,
          title: c.issue.title,
          level: c.issue.level,
          users: c.issue.userCount,
          permalink: c.issue.permalink,
          triage: c.triage,
          tags: c.tags,
        })),
        null,
        2,
      ),
    );
    console.log(`  wrote candidates → ${EMIT}`);
  }

  // 6. File.
  let filed = 0;
  const tmp = mkdtempSync(join(tmpdir(), 'sentry-triage-'));
  for (const {issue: i, tags, triage, group} of candidates) {
    // A collapsed signal can span platforms — union them across members.
    const memberPlat = new Set(triage.platforms);
    for (const m of group?.members || []) {
      const h = haystack(m);
      if (/ios|iphone|ipad/.test(h)) memberPlat.add('ios');
      if (/android|pixel|sm-|redmi|moto|samsung/.test(h))
        memberPlat.add('android');
    }
    const labels = [
      LABEL,
      'bug',
      `severity:${triage.severity}`,
      ...memberPlat,
      // Purpose-built non-crash signals (silent hang / OEM-killed audio / dropped
      // deep link) get a `user-impacting` label so they're filterable apart from crashes.
      ...(MESSAGE_ALLOWLIST.test(haystack(i)) ? ['user-impacting'] : []),
    ];
    const titleText =
      `${i.metadata?.type ? i.metadata.type + ': ' : ''}${i.metadata?.value || i.title}`
        .replace(/\s+/g, ' ') // GitHub titles can't contain newlines
        .trim()
        .slice(0, 140);
    const title = `[Sentry ${i.shortId}] ${titleText}`;
    const body = fmtIssueBody(i, tags, triage, group);

    if (DRY_RUN) {
      console.log('\n' + '─'.repeat(72));
      console.log(`WOULD FILE: ${title}`);
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
    const bodyFile = join(tmp, `${i.shortId}.md`);
    writeFileSync(bodyFile, body);
    const url = gh([
      'issue',
      'create',
      '--repo',
      GH_REPO,
      '--title',
      title,
      '--body-file',
      bodyFile,
      ...labels.flatMap(l => ['--label', l]),
    ]);
    console.log(`  ✅ filed ${i.shortId} → ${url}`);
    filed++;
  }

  // 7. Summary + CI output.
  console.log(
    `\n▶ done — scanned ${issues.length}, ${groups.length} new signal(s), ` +
      `${DRY_RUN ? 'would file' : 'filed'} ${filed}${overflow > 0 ? ` (+${overflow} deferred)` : ''}.`,
  );
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      // In --dry-run nothing was actually filed, so report 0 (keeps the
      // optional claude-enrich job from triggering on a side-effect-free run).
      `filed=${DRY_RUN ? 0 : filed}\nnew=${groups.length}\ndeferred=${overflow}\n`,
      {flag: 'a'},
    );
  }
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
