#!/usr/bin/env node
// @ai
//
// scripts/play-vitals-triage.mjs
// ------------------------------
// Twice-daily Google Play vitals → GitHub issue triage bot for Qariah v2.
//
// The third detector alongside scripts/sentry-triage.mjs (crashes from the
// Sentry SDK) and scripts/posthog-triage.mjs (product-health regressions).
// THIS one pulls Android vitals — ANRs (App Not Responding) and native CRASHES
// — straight from the **Google Play Developer Reporting API**, which sees a
// class Sentry can't: kernel-level / pre-JS-bridge / OEM-killed hangs that
// never reach the in-app crash reporter (the "stuck on the green logo" cluster).
//
// It triages each aggregated error issue (type + cause@location + distinct
// users + report count + the device/OEM spread + the main-thread head of a
// sample thread dump), seeds a correlation note from a built-in KNOWLEDGE map,
// and files a deduplicated GitHub issue per error issue. Like the other two,
// the risky parts — noise filtering, dedup against already-filed issues, and a
// volume cap so a first run can't flood the tracker — are DETERMINISTIC.
//
// Runs in CI (see .github/workflows/diagnostics-watch.yml) and locally:
//   GOOGLE_PLAY_SA_JSON=$(cat ~/.android/play-service-account.json) \
//     node scripts/play-vitals-triage.mjs --dry-run     # preview, files nothing
//   node scripts/play-vitals-triage.mjs                  # file issues
//
// Auth (in order of precedence):
//   GOOGLE_PLAY_SA_JSON                  full service-account JSON STRING (how CI passes it)
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON     path to the JSON file (local override)
//   ~/.android/play-service-account.json default local path
// The SA needs Play Developer Reporting read access. A JWT is signed locally
// with RS256 (Node `crypto`, no deps) and exchanged for an OAuth token scoped to
// https://www.googleapis.com/auth/playdeveloperreporting. The private key and
// the token are NEVER logged.
//
// Optional env (sensible defaults for this repo):
//   PLAY_PACKAGE        default "com.qariah.app"
//   GH_REPO             default "omar-zarka/qariah-v2"
//   GH_TOKEN            GitHub token for `gh` (CI: secrets.GITHUB_TOKEN)
//
// Flags:
//   --dry-run             query + triage + print, but DO NOT create issues
//   --days=28             lookback window in days (Play aggregates daily; default 28)
//   --version-codes=A,B   restrict to these versionCode(s) (default: all recent)
//   --page-size=40        max error issues to pull from the API
//   --max=10              max issues to file in one run (rest reported, not dropped silently)
//   --no-rates            skip the crash/ANR rate-metric-set query (offline / quota)
//   --emit-candidates=F   also write the triaged candidate set to file F (JSON)
//   --help
//
// RATE-AWARENESS (the 2026-06-14 expert review's #4 Android rec). Each run also
// pulls the per-versionCode userPerceivedCrashRate + userPerceivedAnrRate from
// the Play `crashRateMetricSet` / `anrRateMetricSet` (modeled on play-vitals.mjs)
// and stamps every filed/updated issue with the affected build's actual rate +
// "Xx Google's bar". A CONFIRMED v2 build (frame-classified — NOT versionCode
// based, because v1 vc1255 ≥ 500) over a bar auto-escalates the issue to
// severity:critical — this surfaces the otherwise-invisible prod-crash-rate fact
// (vc1255 ran ~7% user-perceived crash, ~6.5x the 1.09% bad-behavior bar, seen
// by no tool before). Issues classified 'unknown' (no lineage-specific frames)
// are flagged but NOT auto-escalated to critical.
//
// STABLE-SIGNATURE DEDUP. The Play `errorIssueId` is UNSTABLE across windows —
// one OOM class carried 3 different ids across closed/open issues, which is the
// mechanical cause of the re-file flood. So we ALSO dedup on a stable signature
// hash = sha1(normalize(cause)+'|'+normalize(location)+'|'+type), embedded as a
// second marker, checked across --state all. A new errorIssueId for a signature
// we've already filed is folded, not re-filed.

import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
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
      'Usage: node scripts/play-vitals-triage.mjs [--dry-run] [--days=28] [--max=10]',
      '                                           [--version-codes=A,B] [--page-size=40]',
      '                                           [--emit-candidates=FILE]',
      '',
      'Auth: GOOGLE_PLAY_SA_JSON (JSON string) OR GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (path)',
      '      OR ~/.android/play-service-account.json',
      'Env:  PLAY_PACKAGE, GH_REPO, GH_TOKEN',
    ].join('\n'),
  );
  process.exit(0);
}

const PACKAGE = process.env.PLAY_PACKAGE || 'com.qariah.app';
const GH_REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

const DRY_RUN = flag('dry-run');
const DAYS = Math.max(1, parseInt(opt('days', '28'), 10) || 28);
const PAGE_SIZE = Math.max(
  1,
  Math.min(100, parseInt(opt('page-size', '40'), 10) || 40),
);
const VERSION_CODES = opt('version-codes', '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const MAX = parseInt(opt('max', '10'), 10);
const EMIT = opt('emit-candidates', '');
const NO_RATES = flag('no-rates');

// Number of report-text head lines to embed (the readable main-thread head).
const REPORT_HEAD_LINES = 30;

const MARKER_PREFIX = 'play-vitals-id:'; // unstable upstream errorIssueId (legacy)
const SIG_PREFIX = 'play-vitals-sig:'; // stable signature hash (preferred dedup)
const LABEL = 'play-store';

// Google's "bad behavior" thresholds (Play Console core-vitals bars). A confirmed
// v2 build over either bar is a release-quality alarm — auto-escalate to critical.
const CRASH_RATE_BAR = 0.0109; // 1.09% user-perceived crash rate
const ANR_RATE_BAR = 0.0047; // 0.47% user-perceived ANR rate

// Stable crash signature — normalize the cause+location+type so the SAME logical
// crash hashes identically even when Play rotates the errorIssueId or tweaks the
// leaf frame. Strips hex addresses, line/column numbers, build-variant prefixes,
// and the @<n>@<n> dynamite version noise, then sha1s.
function normalizeSig(s) {
  return String(s || '')
    .replace(/0x[0-9a-f]+/gi, '0x_')
    .replace(/@\d+@\d+/g, '@_@_') // gms dynamite @251962060@25.19.62
    .replace(/\b\d{4,}\b/g, '_') // long numbers (versions, offsets)
    .replace(/split_config\.[a-z0-9_]+\.apk!/gi, '') // ABI-split prefix
    .replace(/:\d+:\d+/g, '') // :line:col
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
function signature(issue) {
  const raw = `${normalizeSig(issue.cause)}|${normalizeSig(issue.location)}|${issue.type || ''}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

// Coarse exception-class family for grouping native crashes (the OOM media3
// cluster is ONE root cause across many leaf frames). Drives the family note +
// (when --group-family) a single rollup.
function exceptionFamily(issue) {
  const h = `${issue.cause || ''} ${issue.location || ''}`;
  if (/OutOfMemoryError/i.test(h)) return 'java.lang.OutOfMemoryError';
  if (issue.type === 'APPLICATION_NOT_RESPONDING') {
    if (/nativePollOnce|No focused window|Input dispatching timed out/i.test(h))
      return 'ANR:idle-main-thread';
    return 'ANR:blocked-main-thread';
  }
  const sig = (issue.location || issue.cause || '').match(/SIG[A-Z]+/);
  if (sig) return `signal:${sig[0]}`;
  return 'other';
}

// ---------------------------------------------------------------------------
// App-lineage classifier — frame-based, NOT versionCode-based.
//
// Qariah ships TWO apps under the SAME package `com.qariah.app`:
//   v1 — Flutter / Dart (2022), versionCode ≤ ~35 on the original line BUT
//        reached vc1255 on a later build, so v1 and v2 versionCodes OVERLAP.
//        vc >= 500 is true for BOTH → versionCode alone cannot discriminate.
//   v2 — React Native / Expo / Hermes (current, vc ~812–1361+).
//
// The ONLY reliable discriminator is FRAME CONTENT:
//   v1 frames (libflutter.so / io.flutter / dart: / FlutterRenderer /
//              com.ryanheise / just_audio) are *physically impossible* in v2.
//   v2 frames (com.facebook.react / hermes / libjsi / libfbjni / libreact /
//              com.swmansion / expo) are specific to the RN/Expo stack.
//
// Returns 'v1' | 'v2' | 'unknown'.
//   'unknown' = ambiguous frames (bare libc abort, generic OOM with no
//               lineage-specific frame) — common to both builds.
//
// versionCode is used ONLY as a tiebreaker for 'unknown': v2 has never shipped
// below vc812, so a confirmed-low vc is a weak v1 signal. Never use it as the
// primary discriminator.
//
// The caller (classify / rate-escalation) must treat 'unknown' conservatively:
//   - do NOT auto-escalate as v2-critical
//   - flag for human attribution ("unverified lineage")
// ---------------------------------------------------------------------------

// Frame signatures that are physically impossible in the RN/Expo/Hermes app.
const V1_FRAME_PATTERNS = [
  /libflutter\.so/i,
  /io\.flutter/i,
  /dart:/i,
  /FlutterRenderer/i,
  /flutter_runner/i,
  /com\.ryanheise/i, // just_audio_background (Flutter plugin)
  /just_audio/i,
];

// Frame signatures specific to the RN / Expo / Hermes stack (v2 only).
const V2_FRAME_PATTERNS = [
  /com\.facebook\.(react|jni|hermes|flipper)/i,
  /libhermes\.so/i,
  /libreact_nativemodule_core/i,
  /libjsi\.so/i,
  /libfbjni\.so/i,
  /libfolly/i,
  /com\.swmansion\./i, // react-native-screens, reanimated
  /com\.horcrux\.svg|com\.th3rdwave\.safeareacontext|com\.zoontek\.rnpermissions/i,
  /expo\.(modules|av|keep_awake|image|media_library|file_system|constants)/i,
  /com\.expo\./i,
  /RNReanimated|libreanimated/i,
  /RNSkia|libskia/i,
];

// The lowest versionCode ever shipped by v2. Used ONLY as a weak tiebreaker
// for issues where no lineage-specific frames are present. Do NOT use as the
// primary v1/v2 discriminator — the vc overlap (v1 reached vc1255) makes that
// approach unsound. Declared BEFORE classifyAppLineage to avoid a const TDZ
// (a test that invokes the function at import time would otherwise throw).
const MIN_V2_VERSION_CODE_TIEBREAKER = 812;

/**
 * Classify an error issue as 'v1' (Flutter), 'v2' (React Native/Expo),
 * or 'unknown' (no lineage-specific frames) by inspecting the frame content.
 *
 * @param {object} issue       - Play vitals aggregated error issue object.
 * @param {string} [reportHead] - The main-thread head text from a sample report.
 * @returns {'v1'|'v2'|'unknown'}
 */
export function classifyAppLineage(issue, reportHead) {
  const haystack = [issue.cause || '', issue.location || '', reportHead || '']
    .join(' ')
    .toLowerCase();

  // v1 check first — these frames are impossible in the RN app; if any match,
  // it's definitively v1 regardless of versionCode.
  for (const re of V1_FRAME_PATTERNS) {
    if (re.test(haystack)) return 'v1';
  }

  // v2 check — RN/Expo/Hermes-specific frames.
  for (const re of V2_FRAME_PATTERNS) {
    if (re.test(haystack)) return 'v2';
  }

  // No lineage-specific frames found — ambiguous. Use versionCode as a weak
  // tiebreaker ONLY: v2 has never shipped below vc812, so a known-low vc is
  // a soft v1 signal; a high vc (≥ MIN_V2_VERSION_CODE) tilts toward v2.
  // Never promote 'unknown' to 'v2' on vc alone — the vc1255 overlap burns.
  const newestVC = Number(
    issue.lastAppVersion?.versionCode ?? issue.firstAppVersion?.versionCode,
  );
  if (Number.isFinite(newestVC) && newestVC < MIN_V2_VERSION_CODE_TIEBREAKER) {
    // Low vc AND no v2 frames → probably v1, but not definitive enough to
    // assert 'v1'. Return 'unknown' (conservative) so it gets flagged rather
    // than silently mislabeled.
    return 'unknown';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Service-account credentials — load WITHOUT logging any secret material.
// ---------------------------------------------------------------------------
function loadServiceAccount() {
  const raw = process.env.GOOGLE_PLAY_SA_JSON;
  if (raw && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      // Never echo the raw value (it contains the private key).
      throw new Error(
        `GOOGLE_PLAY_SA_JSON is set but is not valid JSON: ${e.message}`,
      );
    }
  }
  const path =
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ||
    join(homedir(), '.android', 'play-service-account.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(
      `No service account: set GOOGLE_PLAY_SA_JSON (JSON string) or ` +
        `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (path), or place the file at ${path}. (${e.message})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Noise filter — substrings/regex marking an error issue as known noise.
// Matched case-insensitively against cause + location + the reportText head.
// Keep this list curated; everything here is excluded from filing.
// ---------------------------------------------------------------------------
const IGNORE_PATTERNS = [
  'TEST - Sentry Client Crash', // synthetic crash test
  'synthetic crash', // synthetic crash test (Sprint 8)
  // Legacy Qariah **v1** (Flutter) crashes. v1 shipped on the SAME package id
  // (com.qariah.app) and users who never updated still run it, so its
  // io.flutter / libflutter.so ANRs+crashes leak into v2's Play vitals.
  // The v2 RN codebase can't action them. classifyAppLineage() is the PRIMARY
  // filter; these strings are a belt-and-suspenders backstop inside the
  // isIgnored() check (which runs post-fetch). libflutter.so / io.flutter
  // are RN-IMPOSSIBLE frames (only Flutter produces them). (#85/#96/#97.)
  // IMPORTANT: versionCode alone is NOT a reliable v1 discriminator — v1
  // reached vc1255 (overlapping v2's range) due to Play-floor leapfrogging.
  'libflutter.so',
  'io.flutter',
];

// Legacy frame packages that are *probably* v1 but NOT impossible on v2 — the
// just_audio_background foreground service `com.ryanheise.audioservice` appears
// in v1 ANR component names AND has leaked into some v2 versionCode metadata,
// so it is only treated as noise when the build is legacy (below the floor) or
// has NO usable versionCode. Never drops a confirmed v2-build report (that is
// the known expo-audio deadlock prize on vc1251/1255). See the main loop.
const LEGACY_FRAME_PACKAGES = ['com.ryanheise', 'flutter'];

// REMOVED: MIN_VERSION_CODE = 500 was the old (wrong) v1/v2 discriminator.
// versionCode alone cannot distinguish v1 from v2 because v1 reached vc1255
// (overlapping v2's range of ~812–1361). Use classifyAppLineage() instead.
// The --min-version-code flag is preserved for backward compat but no longer
// drives the critical rate-escalation path.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MIN_VERSION_CODE = Number(opt('min-version-code', '500')) || 500; // legacy; not used for classification

// ---------------------------------------------------------------------------
// Triage knowledge map — seeded from CLAUDE.md, TECH_DEBT, the 2026-06-08
// Samsung cold-start hang plan, and the 2026-06 user-feedback triage. First
// matching entry wins. Matched against cause + location + reportText head.
// ---------------------------------------------------------------------------
const KNOWLEDGE = [
  {
    // media3/ExoPlayer OOM family — the LARGEST v2 crash class and the dominant
    // driver of vc1255's ~7% user-perceived crash. EVERY java.lang.OutOfMemoryError
    // is ONE root cause regardless of the leaf frame (shouldContinueLoading /
    // MediaCodec.getBuffer / Pair.create / CircularIntArray / HashMap$Values /
    // MiuiStub are just where the last allocation happened to fail). Must rank
    // FIRST so a media3 OOM never falls through to the generic native-crash rule.
    re: /OutOfMemoryError/i,
    category: 'memory / OutOfMemory (media3 ExoPlayer)',
    note:
      'OutOfMemory in the **media3/ExoPlayer allocator family** — all ' +
      '`java.lang.OutOfMemoryError` reports here are ONE root cause (the leaf frame just names ' +
      'where the last allocation failed). The largest v2 crash family and the dominant driver of ' +
      "the current prod build's ~7% user-perceived crash. **NOT a low-RAM story** — it inversely " +
      'correlates with RAM (worst on 6-8 GB Samsung / Android 16; 3-4 GB devices crash far less). ' +
      '`largeHeap` is already enabled and does not help. Root-cause the media3 `LoadControl` / ' +
      'allocator buffer caps + image/Skia bitmap retention, NOT the device tier. Off the JS bridge ' +
      'so **Sentry never sees this** — Play vitals is the only source. Read the `app_memory` PSS ' +
      'context the `memoryWatch` instrumentation attaches to any companion Sentry SIGABRT.',
  },
  {
    // The dominant shape we already diagnosed: an ANR whose main thread is idle
    // in MessageQueue.nativePollOnce with an "Input dispatching timed out / No
    // focused window" location = a JS-thread cold-start / splash hang (Bug B),
    // multi-OEM. The native dump CANNOT name the JS culprit (main thread is
    // idle by the time the trace is captured) — point at the boot sentinel +
    // splash watchdog telemetry instead. Must rank FIRST so the specific note
    // wins over the generic ANR rule below.
    re: /nativePollOnce|No focused window|Input dispatching timed out|MessageQueue\.next/i,
    category: 'cold-start / splash hang (JS-thread, Bug B)',
    note:
      'Main thread idle in `MessageQueue.nativePollOnce` / "No focused window" — the **JS-thread ' +
      'cold-start / splash hang (Bug B)**, multi-OEM (the #1 tester theme, "stuck on the green ' +
      'logo"). The native thread dump **cannot name the JS culprit** — by the time Android captures ' +
      'the trace the main thread is back to idle (Play\'s own "Main thread idle" insight says these ' +
      'are not actionable from the stack alone). Do NOT chase the native frames. Instead pivot on the ' +
      'JS-side telemetry: the **boot sentinel** (`boot-not-completed` / `boot_not_completed`) and the ' +
      '**splash-hide watchdog** (`splash-hide-timeout` / `splash_stalled`) in Sentry + PostHog, which ' +
      'fire from the JS thread when a launch never reaches interactive. Cross-ref ' +
      '`planning/observability-gap-samsung-hang-2026-06-08.md`, **TECH_DEBT #53** (Android ' +
      "`release`/`dist` tagging missing → build can't be pinned), and **GitHub issue #67**. Prime " +
      'cold-start suspects: catalog network fetch (10s timeout) + Mushaf Skia/SQLite preload + bundled ' +
      'Tafseer/translation DB imports; confirm `bundleFirstCatalog` + `deferMushafPreload` are in the ' +
      'affected build and check the device_tier (is_low_ram).',
  },
  {
    // Generic ANR — main thread blocked somewhere we don't have a specific note
    // for. Still the boot/main-thread-hang class.
    re: /\bANR\b|APPLICATION_NOT_RESPONDING|ApplicationNotResponding|Application Not Responding/i,
    category: 'main-thread hang (ANR)',
    note:
      'Main-thread hang (App Not Responding) whose blocking frame is named in the dump (NOT the idle ' +
      'nativePollOnce class). Read the main-thread head below for the on-CPU frame. Correlates with the ' +
      '**"stuck on logo / won\'t open"** tester cluster. Heavy cold-start is the prime suspect: catalog ' +
      'network fetch + Mushaf Skia/SQLite preload + bundled DB imports (Sprint 30/31 perf targets). ' +
      'Cross-check the Sentry ANR signal + the PostHog `boot_not_completed` / `splash_stalled` faults ' +
      'for the same versionCode. NOTE: Android `release`/`dist` tagging may be missing (TECH_DEBT #53).',
  },
  {
    // Android Activity destroyed under a native module — background-playback class.
    re: /ExpoKeepAwake|keep-?awake|current activity (is )?no longer available|foreground ?service/i,
    category: 'android activity lifecycle (often background playback)',
    note:
      'Android Activity / foreground service torn down under the app — typically the OS killing the ' +
      'app, most impactful during background audio. Correlates with **Sprint-24 FB-1** (Samsung One UI ' +
      '/ OnePlus / Xiaomi aggressively kill the audio foreground service) and the tester "recitation ' +
      'stops mid-ayah" reports. Check the POST_NOTIFICATIONS runtime grant + the ' +
      '`withAndroidNotificationPermission` plugin in the affected build, and the device battery-' +
      'optimization setting.',
  },
  {
    re: /DigitalKhatt|typeface|fontMgr|font.?manager/i,
    category: 'mushaf / font load',
    note:
      'Mushaf font-load race (the `useMushafFontMgr` class; see TECH_DEBT). The three-layer invisible-' +
      'fallback architecture (upstream PR #273) should mask it — a spike here means the fallback is not ' +
      'engaging on real devices.',
  },
  {
    re: /libhermes|libreact|libfbjni|libjsi|com\.facebook\.(react|jni)|libfolly/i,
    category: 'native crash (RN/Hermes bridge)',
    note:
      'Native crash with a React Native / Hermes / JNI frame. Read the main-thread head below for the ' +
      'first app/RN/Skia/Reanimated frame. Confirm it is on a production build (real device, prod env) ' +
      'before treating as real — and capture the device/OEM + API-level spread above.',
  },
  {
    re: /libskia|Skia|RNSkia|libreanimated|worklet/i,
    category: 'native crash (Skia / Reanimated)',
    note:
      'Native crash in Skia or Reanimated. The Mushaf render path (Skia) and animated transitions are ' +
      'the usual sites. Capture the device / API-level breakdown; cross-check whether it concentrates ' +
      'on one OEM or one versionCode.',
  },
  {
    re: /SIGSEGV|SIGABRT|SIGILL|SIGBUS|abort\b|tombstone/i,
    category: 'native crash',
    note:
      'Native crash (signal-level). Capture the device / OS-API / versionCode breakdown above and read ' +
      'the main-thread head for the first app/RN/Skia/Reanimated frame. Cross-check the Sentry native ' +
      'crash signal for the same fingerprint.',
  },
];

// ---------------------------------------------------------------------------
// OAuth — mint a token from the SA via RS256 JWT.
// ---------------------------------------------------------------------------
/* global Buffer */ // Buffer is a Node.js built-in; eslint env lacks node:true
const b64u = o =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString(
    'base64url',
  );

async function mintToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64u({alg: 'RS256', typ: 'JWT'}) +
    '.' +
    b64u({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/playdeveloperreporting',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    });
  const sig = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(sa.private_key)
    .toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const tok = await res.json().catch(() => null);
  if (!tok || !tok.access_token) {
    // Surface ONLY the non-secret error fields — never the token payload.
    const why =
      tok && (tok.error_description || tok.error)
        ? `${tok.error || ''} ${tok.error_description || ''}`.trim()
        : `HTTP ${res.status}`;
    throw new Error(
      `Failed to mint Play Reporting token (${why}). Check the service-account permissions.`,
    );
  }
  return tok.access_token;
}

// ---------------------------------------------------------------------------
// Play Developer Reporting API
// ---------------------------------------------------------------------------
const API_BASE = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${PACKAGE}`;

// Google's Reporting API returns 429/5xx as ordinary weather — on 2026-08-18 a
// single `503 The service is currently unavailable` on /errorIssues:search failed
// this collector, which (before the workflow guard landed) skipped the correlate,
// lifecycle, release-health AND digest jobs downstream. A transient upstream blip
// must not read as a broken CI gate, so: retry with backoff, and mark whatever
// survives as `transient` so main() can exit 0 instead of red. Codes chosen
// deliberately — 429 rate-limit and 500/502/503/504 availability are retryable;
// 4xx auth/permission errors are NOT and must still fail loudly.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function playFetch(path, init) {
  let last;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(API_BASE + path, init);
    } catch (e) {
      // Network-layer failure (DNS, socket) is transient by nature.
      last = Object.assign(
        new Error(`Play Reporting network error on ${path.split('?')[0]}: ${e.message}`),
        {transient: true},
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      throw last;
    }
    const json = await res.json().catch(() => null);
    if (res.ok) return json;

    const msg = json?.error?.message || `HTTP ${res.status}`;
    const retryable = RETRYABLE.has(res.status);
    last = Object.assign(
      new Error(
        `Play Reporting ${res.status} on ${path.split('?')[0]}: ${String(msg).slice(0, 300)}`,
      ),
      {transient: retryable, status: res.status},
    );
    if (!retryable || attempt === MAX_ATTEMPTS) throw last;
    const wait = 500 * 2 ** (attempt - 1);
    console.error(
      `  ⏳ ${res.status} on ${path.split('?')[0]} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait}ms`,
    );
    await sleep(wait);
  }
  throw last;
}

async function playGet(token, path) {
  return playFetch(path, {headers: {Authorization: `Bearer ${token}`}});
}

async function playPost(token, path, body) {
  return playFetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

// Pull per-versionCode userPerceivedCrashRate + userPerceivedAnrRate over the
// window (modeled on scripts/play-vitals.mjs). Returns { [versionCode]:
// { crashRate, anrRate, crashUsers, anrUsers } } using the MOST RECENT non-null
// daily value per build (Play suppresses small cohorts; an absent row means
// "too small to report", not zero). Best-effort: a query failure returns {}.
//
// The metric sets lag — DAILY data is fresh only through ~yesterday, and the API
// 400s if endTime > the metric set's freshness. So we read each metric set's
// `freshnessInfo` and CLAMP the window end to its DAILY `latestEndTime`.
async function fetchRates(token) {
  const out = {};
  const pull = async (metricSet, rateMetric) => {
    // 1. Get freshness so we never request past the available end date.
    let endYmd;
    try {
      const desc = await playGet(token, `/${metricSet}`);
      const daily = (desc.freshnessInfo?.freshnesses || []).find(
        f => f.aggregationPeriod === 'DAILY',
      );
      const e = daily?.latestEndTime;
      if (e?.year) endYmd = {year: e.year, month: e.month, day: e.day};
    } catch {
      /* fall through to a conservative default */
    }
    if (!endYmd) {
      // Conservative default: two days ago (covers the typical lag).
      const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      endYmd = {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
      };
    }
    const endDate = new Date(
      Date.UTC(endYmd.year, endYmd.month - 1, endYmd.day),
    );
    const startDate = new Date(endDate.getTime() - DAYS * 24 * 60 * 60 * 1000);
    const startYmd = {
      year: startDate.getUTCFullYear(),
      month: startDate.getUTCMonth() + 1,
      day: startDate.getUTCDate(),
    };
    let data;
    try {
      data = await playPost(token, `/${metricSet}:query`, {
        timelineSpec: {
          aggregationPeriod: 'DAILY',
          startTime: startYmd,
          endTime: endYmd,
        },
        dimensions: ['versionCode'],
        metrics: [rateMetric, 'distinctUsers'],
        pageSize: 1000,
      });
    } catch (e) {
      console.warn(
        `  ⚠ ${metricSet} unavailable (${e.message.slice(0, 90)}) — rate context skipped for this metric.`,
      );
      return;
    }
    // Rows arrive per (versionCode × day); keep the value from the LATEST day per
    // build (track the row's startTime to pick the most recent non-null).
    const latestDayFor = {};
    for (const row of data.rows || []) {
      const vcDim = (row.dimensions || []).find(
        d => d.dimension === 'versionCode',
      );
      const vc = vcDim ? String(vcDim.int64Value ?? vcDim.stringValue) : null;
      if (!vc) continue;
      const mets = Object.fromEntries(
        (row.metrics || []).map(m => [
          m.metric,
          Number(m.decimalValue?.value ?? m.decimalValue ?? NaN),
        ]),
      );
      const rate = mets[rateMetric];
      if (!Number.isFinite(rate)) continue;
      const st = row.startTime || {};
      const dayKey =
        (st.year || 0) * 10000 + (st.month || 0) * 100 + (st.day || 0);
      if (latestDayFor[vc] != null && dayKey < latestDayFor[vc]) continue;
      latestDayFor[vc] = dayKey;
      out[vc] ||= {};
      const isCrash = rateMetric === 'userPerceivedCrashRate';
      out[vc][isCrash ? 'crashRate' : 'anrRate'] = rate;
      out[vc][isCrash ? 'crashUsers' : 'anrUsers'] = mets.distinctUsers || 0;
    }
  };
  await pull('crashRateMetricSet', 'userPerceivedCrashRate');
  await pull('anrRateMetricSet', 'userPerceivedAnrRate');
  return out;
}

// Build the issues:search filter. Filterable dimensions: versionCode,
// errorIssueType (ANR|CRASH), deviceModel, apiLevel. We always pull both ANR +
// CRASH; optionally restrict to specific versionCode(s).
function issuesFilter() {
  const clauses = [];
  if (VERSION_CODES.length) {
    clauses.push(
      '(' + VERSION_CODES.map(v => `versionCode = ${v}`).join(' OR ') + ')',
    );
  }
  return clauses.join(' AND ');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

const issueId = issue =>
  String(issue.name || '')
    .split('/')
    .pop();
const num = v => Number(v) || 0;

function isIgnored(issue, reportHead) {
  const h =
    `${issue.cause || ''} ${issue.location || ''} ${reportHead || ''}`.toLowerCase();
  return IGNORE_PATTERNS.find(p => h.includes(p.toLowerCase())) || null;
}

// reportText is one long thread dump. Take the head of the MAIN thread only
// (everything up to the first blank line that separates the "main" thread from
// the next thread), capped to REPORT_HEAD_LINES.
function mainThreadHead(reportText) {
  if (!reportText) return '';
  const lines = String(reportText).split('\n');
  const out = [];
  for (const line of lines) {
    // The dump separates threads with a blank line; stop at the first blank
    // line AFTER we've collected at least the "main" header.
    if (out.length > 0 && line.trim() === '') break;
    out.push(line);
    if (out.length >= REPORT_HEAD_LINES) break;
  }
  return out.join('\n');
}

function deviceLabel(dm) {
  if (!dm) return '?';
  const brand = dm.deviceId?.buildBrand;
  const mkt = dm.marketingName;
  if (mkt && brand && !mkt.toLowerCase().includes(String(brand).toLowerCase()))
    return `${brand} ${mkt}`;
  return mkt || brand || dm.deviceId?.buildDevice || '?';
}

function classify(issue, reportHead, rateInfo) {
  const h = `${issue.cause || ''} ${issue.location || ''} ${issue.type || ''} ${reportHead || ''}`;
  const known = KNOWLEDGE.find(k => k.re.test(h));
  const users = num(issue.distinctUsers);
  const isCrash = issue.type === 'CRASH';
  // Severity: crashes skew higher (fatal-ish); ANRs one notch lower at the same
  // reach. Scaled by distinct users.
  let sev;
  if (isCrash) {
    if (users >= 10) sev = 'critical';
    else if (users >= 3) sev = 'high';
    else sev = 'medium';
  } else {
    // ANR
    if (users >= 20) sev = 'high';
    else if (users >= 5) sev = 'medium';
    else sev = 'low';
  }
  // RATE ESCALATION — only for CONFIRMED v2 builds (classified by frame content,
  // NOT versionCode — v1 vc1255 >= 500, so the old floor caused false v2-critical
  // escalation for Flutter/v1 OOM/SIGABRT reports).
  //
  // 'v1' issues are never escalated as v2-critical.
  // 'unknown' issues (no lineage-specific frames) are NOT auto-escalated to
  //   critical — they need human attribution.
  // 'v2' issues get the full rate-escalation treatment.
  const lineage = classifyAppLineage(issue, reportHead);
  let rateEscalated = false;
  if (lineage === 'v2' && rateInfo) {
    const r = isCrash ? rateInfo.crashRate : rateInfo.anrRate;
    const bar = isCrash ? CRASH_RATE_BAR : ANR_RATE_BAR;
    if (Number.isFinite(r) && r > bar) {
      sev = 'critical';
      rateEscalated = true;
    }
  }
  return {
    category: known?.category || 'uncategorized — needs manual triage',
    note:
      known?.note ||
      'No known correlation. Read the main-thread head + the device/OEM/API spread above, and cross-' +
        'check the Sentry + PostHog signals for the same versionCode.',
    severity: sev,
    kind: isCrash ? 'crash' : 'anr',
    rateEscalated,
    lineage, // 'v1' | 'v2' | 'unknown' — for body annotation
  };
}

// Render the build's user-perceived rate vs Google's bar, for the body stamp.
function rateLine(isCrash, rateInfo) {
  if (!rateInfo) return '';
  const r = isCrash ? rateInfo.crashRate : rateInfo.anrRate;
  const bar = isCrash ? CRASH_RATE_BAR : ANR_RATE_BAR;
  const label = isCrash
    ? 'user-perceived crash rate'
    : 'user-perceived ANR rate';
  if (!Number.isFinite(r)) {
    return `_${label} for vc${rateInfo.versionCode}: not reported (cohort below Play's privacy threshold)._`;
  }
  const x = (r / bar).toFixed(1);
  const over =
    r > bar
      ? ` — **${x}× Google's ${(bar * 100).toFixed(2)}% bar** ⚠️`
      : ` (${x}× the ${(bar * 100).toFixed(2)}% bar)`;
  return `**${label} (vc${rateInfo.versionCode}, last ${DAYS}d): ${(r * 100).toFixed(2)}%**${over}`;
}

function fmtIssueBody(
  issue,
  triage,
  sample,
  rateInfo,
  family,
  sig,
  familyFrames,
) {
  const id = issueId(issue);
  const type = issue.type === 'CRASH' ? 'Crash' : 'ANR';
  const reports = num(issue.errorReportCount);
  const users = num(issue.distinctUsers);
  const usersPct = issue.distinctUsersPercent?.value
    ? ` (${Number(issue.distinctUsersPercent.value).toFixed(1)}% of affected)`
    : '';
  const verRange =
    issue.firstAppVersion?.versionCode === issue.lastAppVersion?.versionCode
      ? `\`${issue.firstAppVersion?.versionCode || '?'}\``
      : `\`${issue.firstAppVersion?.versionCode || '?'}\` → \`${issue.lastAppVersion?.versionCode || '?'}\``;
  const apiRange =
    issue.firstOsVersion?.apiLevel === issue.lastOsVersion?.apiLevel
      ? `API \`${issue.firstOsVersion?.apiLevel || '?'}\``
      : `API \`${issue.firstOsVersion?.apiLevel || '?'}\` → \`${issue.lastOsVersion?.apiLevel || '?'}\``;

  const devices = sample.devices.length ? sample.devices.join(', ') : '—';
  const consoleLink = issue.issueUri
    ? `[Play Console](${issue.issueUri})`
    : 'Play Console → Android vitals → Crashes & ANRs';

  // Play's own "Main thread idle" insight (if present) is worth surfacing.
  const insight = (issue.annotations || [])
    .map(a => `> **${a.title}** — ${String(a.body || '').split('\n')[0]}`)
    .join('\n');

  const head = sample.head
    ? '```\n' + sample.head + '\n```'
    : '_(no sample report text available)_';

  const rateStamp = rateLine(issue.type === 'CRASH', rateInfo);
  const familyLine =
    family && family !== 'other'
      ? `\n> **Exception family:** \`${family}\` — group with every other issue sharing this family (one root cause, many leaf frames).`
      : '';
  const framesBlock =
    familyFrames && familyFrames.length > 1
      ? `\n### Leaf frames in this family (${familyFrames.length})\nAll ONE root cause — the leaf frame just names where the last allocation/abort happened:\n${familyFrames
          .map(f => `- ${f}`)
          .join('\n')}\n`
      : '';

  return `> Filed automatically by \`scripts/play-vitals-triage.mjs\` (see \`.github/workflows/diagnostics-watch.yml\`).
${familyLine}

## Play vitals: ${type} — ${consoleLink}

**${issue.cause || '(no cause)'}**
@ \`${issue.location || '?'}\`

${rateStamp ? `${rateStamp}\n` : ''}
| | |
|---|---|
| **Type** | \`${issue.type}\` |
| **Distinct users** | ${users}${usersPct} |
| **Reports** | ${reports} |
| **Last seen** | ${issue.lastErrorReportTime || '—'} |
| **versionCode** | ${verRange} |
| **OS** | ${apiRange} |
| **Signature** | \`${sig}\` |
${triage.rateEscalated ? "\n> ⚠️ **Severity auto-escalated to `critical`** — the affected v2 build is over Google's user-perceived rate bar.\n" : ''}${triage.lineage === 'v1' ? "\n> ⚠️ **Lineage: v1 (Flutter)** — frame signatures (`libflutter.so` / `io.flutter` / `dart:` / `com.ryanheise` etc.) are impossible in the v2 RN app. This is a legacy v1 Qariah issue; the v2 codebase cannot action it. Consider routing to a 'promote v2 to prod' disposition to supersede v1 on the affected devices.\n" : ''}${triage.lineage === 'unknown' ? '\n> ⚠️ **Lineage unverified** — no v1 (Flutter) or v2 (React Native/Hermes) frame signatures found in the available stack. Confirm the app generation from the versionCode and/or a full tombstone before treating as v2-actionable.\n' : ''}
### Device / OEM spread (sample report)
${devices}
${framesBlock}
### Main-thread head (sample report)
${head}
${insight ? `\n### Play insight\n${insight}\n` : ''}
### Triage
- **Category:** ${triage.category}
- **Severity:** ${triage.severity}
- **Platform:** android
- **Correlation:** ${triage.note}

### Checklist
- [ ] Confirm this is a real production hang/crash (not dev/synthetic noise)
- [ ] Pin the affected build — verify Android \`release\`/\`dist\` tagging (TECH_DEBT #53) so the versionCode maps to a commit
- [ ] Cross-check the Sentry + PostHog signals for the same versionCode (boot sentinel / splash watchdog for an idle-main-thread ANR)
- [ ] Reproduce on a device (prefer the OEM(s) above), then mark resolved in \`<build>\`

<!-- ${MARKER_PREFIX}${id} -->
<!-- ${SIG_PREFIX}${sig} -->`;
}

function ensureLabels(labels) {
  if (DRY_RUN) return;
  const palette = {
    'play-store': '34a853', // Google green
    anr: 'd93f0b',
    crash: 'b60205',
    investigate: '0e8a16',
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
      /* label exists / race — fine */
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(
    `▶ play-vitals-triage  package=${PACKAGE} days=${DAYS} ` +
      `versionCodes=[${VERSION_CODES.join(',') || 'all'}] max=${MAX}${DRY_RUN ? '  (DRY RUN)' : ''}`,
  );

  const sa = loadServiceAccount();
  const token = await mintToken(sa);
  console.log('  ✓ token acquired (scope=playdeveloperreporting)');

  // 0. Per-versionCode crash/ANR RATES (best-effort; skipped with --no-rates).
  //    These are the build-quality alarm that surfaces the invisible prod crash
  //    rate and drive the rate-escalation in classify().
  const rates = NO_RATES ? {} : await fetchRates(token);
  if (!NO_RATES) {
    // Note: we can't do frame-based lineage classification at the rates-summary
    // stage (we have only versionCodes, not per-issue frames yet). Use the known
    // v2 floor as a coarse pre-filter for the summary log ONLY — this is NOT the
    // rate-escalation path (that uses classifyAppLineage per-issue in classify()).
    const overBar = Object.entries(rates).filter(
      ([vc, r]) =>
        Number(vc) >= MIN_V2_VERSION_CODE_TIEBREAKER &&
        ((Number.isFinite(r.crashRate) && r.crashRate > CRASH_RATE_BAR) ||
          (Number.isFinite(r.anrRate) && r.anrRate > ANR_RATE_BAR)),
    );
    console.log(
      `  ✓ rates for ${Object.keys(rates).length} build(s)` +
        (overBar.length
          ? ` — ⚠ OVER BAR: ${overBar
              .map(
                ([vc, r]) =>
                  `vc${vc}(${[Number.isFinite(r.crashRate) ? `crash ${(r.crashRate * 100).toFixed(2)}%` : null, Number.isFinite(r.anrRate) ? `anr ${(r.anrRate * 100).toFixed(2)}%` : null].filter(Boolean).join('/')})`,
              )
              .join(', ')}`
          : ''),
    );
  }
  const rateFor = issue => {
    const vc = Number(
      issue.lastAppVersion?.versionCode ?? issue.firstAppVersion?.versionCode,
    );
    if (!Number.isFinite(vc)) return null;
    return {versionCode: vc, ...(rates[String(vc)] || {})};
  };

  // 1. Pull aggregated ANR + CRASH error issues. The API returns both types by
  //    default; we only optionally restrict the versionCode(s).
  const filt = issuesFilter();
  const qs = `?pageSize=${PAGE_SIZE}${filt ? `&filter=${encodeURIComponent(filt)}` : ''}`;
  const data = await playGet(token, `/errorIssues:search${qs}`);
  const issues = data.errorIssues || [];
  console.log(`  scanned: ${issues.length} aggregated error issue(s)`);

  // 2. Per issue: pull ONE sample report for a device list + the main-thread
  //    head, then deterministic noise filter.
  const enriched = [];
  for (const issue of issues) {
    const id = issueId(issue);
    // Pre-fetch v1 fast-path: classify from cause+location alone (no sample
    // report yet). If the CAUSE/LOCATION already contains definitive v1 frame
    // signatures (libflutter.so / io.flutter / dart: etc.) we can skip the
    // costly per-issue sample-report fetch entirely.
    // NOTE: classifyAppLineage returns 'v1' only on strong frame evidence, so
    // this does NOT over-filter — 'unknown' issues proceed to the full fetch.
    const preFetchLineage = classifyAppLineage(issue, '');
    if (preFetchLineage === 'v1') {
      console.log(
        `  · skip ${id} (v1 Flutter lineage from cause/location frames — not actionable in v2 RN codebase)`,
      );
      continue;
    }
    const newestVC = Number(
      issue.lastAppVersion?.versionCode ?? issue.firstAppVersion?.versionCode,
    );
    // Secondary vc-floor pre-filter: v2 has NEVER shipped below vc812 (the
    // lowest actual v2 release). A newestVC below this floor AND no v2 frames
    // in cause/location → almost certainly a v1 issue. Keep issues with no vc
    // metadata (never silently drop a real v2 issue with missing vc).
    if (
      Number.isFinite(newestVC) &&
      newestVC < MIN_V2_VERSION_CODE_TIEBREAKER
    ) {
      console.log(
        `  · skip ${id} (newestVC ${newestVC} < ${MIN_V2_VERSION_CODE_TIEBREAKER} — below v2 floor and no v2 frames in cause/location)`,
      );
      continue;
    }
    // Legacy frame-package backstop — drop a v1-only frame package (Flutter
    // audio-service / engine) when no versionCode metadata is available.
    // A confirmed v2-build report with a ryanheise frame is kept (it is
    // the known expo-audio deadlock prize), so this never over-filters v2.
    const sigHay = `${issue.cause || ''} ${issue.location || ''}`.toLowerCase();
    const legacyPkg = LEGACY_FRAME_PACKAGES.find(p => sigHay.includes(p));
    if (legacyPkg && !Number.isFinite(newestVC)) {
      console.log(
        `  · skip ${id} (legacy frame pkg "${legacyPkg}", no versionCode metadata)`,
      );
      continue;
    }
    let sample = {head: '', devices: []};
    try {
      const repFilt = encodeURIComponent(`errorIssueId = ${id}`);
      const rep = await playGet(
        token,
        `/errorReports:search?pageSize=3&filter=${repFilt}`,
      );
      const reports = rep.errorReports || [];
      if (reports.length) {
        sample.head = mainThreadHead(reports[0].reportText);
        const seen = new Set();
        for (const r of reports) {
          const label = `${deviceLabel(r.deviceModel)} (API ${r.osVersion?.apiLevel || '?'})`;
          if (!seen.has(label)) {
            seen.add(label);
            sample.devices.push(label);
          }
        }
      }
    } catch (e) {
      console.warn(`  ⚠ could not pull sample report for ${id}: ${e.message}`);
    }

    const ig = isIgnored(issue, sample.head);
    if (ig) {
      console.log(`  · skip ${id} (noise: "${ig}")`);
      continue;
    }
    const rateInfo = rateFor(issue);
    const triage = classify(issue, sample.head, rateInfo);
    const sig = signature(issue);
    const family = exceptionFamily(issue);
    enriched.push({issue, id, sample, triage, rateInfo, sig, family});
  }
  console.log(`  after noise filter: ${enriched.length}`);

  // 3. Dedup against already-filed GitHub issues — BY BOTH the (legacy) unstable
  //    errorIssueId marker AND the STABLE signature hash. The Play errorIssueId
  //    rotates across windows (one OOM class carried 3 ids → the re-file flood),
  //    so the signature is the durable key: if a signature we've filed before
  //    shows up under a new id, fold it instead of re-filing.
  if (!DRY_RUN) ensureLabels([LABEL]);
  let alreadyFiledIds = new Set();
  let alreadyFiledSigs = new Set();
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
      const mi = (e.body || '').match(
        new RegExp(`${MARKER_PREFIX}([^\\s>]+)`, 'g'),
      );
      if (mi)
        mi.forEach(s => alreadyFiledIds.add(s.slice(MARKER_PREFIX.length)));
      const ms = (e.body || '').match(
        new RegExp(`${SIG_PREFIX}([^\\s>]+)`, 'g'),
      );
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
  // Collapse WITHIN this run, two levels:
  //   (1) identical signature → keep the highest-reach member (Play sometimes
  //       lists the same crash twice across windows with different ids).
  //   (2) GROUPED FAMILIES (OOM, signal aborts) → all members are ONE root cause
  //       across many leaf frames, so file ONE family issue with a frame list +
  //       summed reach, keyed by a stable family signature, instead of N tickets.
  //       ANR families are NOT collapsed (each blocking frame may be a different
  //       bug; the idle-ANR family is already one KNOWLEDGE note).
  const GROUPED_FAMILIES = new Set(['java.lang.OutOfMemoryError']);
  // 1. signature collapse
  const bySigInRun = new Map();
  for (const c of enriched) {
    const prev = bySigInRun.get(c.sig);
    if (!prev || num(c.issue.distinctUsers) > num(prev.issue.distinctUsers))
      bySigInRun.set(c.sig, c);
  }
  let level1 = [...bySigInRun.values()];
  // 2. family collapse for the grouped families
  const familyGroups = new Map();
  const passthrough = [];
  for (const c of level1) {
    if (GROUPED_FAMILIES.has(c.family)) {
      if (!familyGroups.has(c.family)) familyGroups.set(c.family, []);
      familyGroups.get(c.family).push(c);
    } else {
      passthrough.push(c);
    }
  }
  const collapsed = [...passthrough];
  for (const [family, members] of familyGroups) {
    if (members.length === 1) {
      collapsed.push(members[0]);
      continue;
    }
    // Build a synthetic family representative: highest-reach member as the base,
    // summed users/reports, a frame list, and a STABLE family signature.
    members.sort(
      (a, b) => num(b.issue.distinctUsers) - num(a.issue.distinctUsers),
    );
    const rep = members[0];
    const totalUsers = members.reduce(
      (a, m) => a + num(m.issue.distinctUsers),
      0,
    );
    const totalReports = members.reduce(
      (a, m) => a + num(m.issue.errorReportCount),
      0,
    );
    const frames = members.map(
      m =>
        `\`${m.issue.cause || '?'}\` @ \`${m.issue.location || '?'}\` — ${num(m.issue.distinctUsers)}u`,
    );
    const familySig = crypto
      .createHash('sha1')
      .update(`family:${family}`)
      .digest('hex')
      .slice(0, 16);
    // Re-classify the family rep with the SUMMED reach so severity reflects the
    // whole cluster, not just the largest leaf.
    const famIssue = {
      ...rep.issue,
      distinctUsers: totalUsers,
      errorReportCount: totalReports,
    };
    const famTriage = classify(famIssue, rep.sample.head, rep.rateInfo);
    collapsed.push({
      ...rep,
      issue: famIssue,
      sig: familySig,
      triage: famTriage,
      familyFrames: frames,
      familyMemberCount: members.length,
    });
    console.log(
      `  grouped ${members.length} '${family}' leaf-frame issue(s) into ONE family issue (${totalUsers} users total)`,
    );
  }
  const collapsedCount = enriched.length - collapsed.length;
  if (collapsedCount > 0)
    console.log(
      `  collapsed ${collapsedCount} issue(s) total via signature + family grouping`,
    );

  const fresh = collapsed.filter(
    c => !alreadyFiledIds.has(c.id) && !alreadyFiledSigs.has(c.sig),
  );
  console.log(
    `  new (not already filed by id or signature): ${fresh.length}  ` +
      `[${alreadyFiledIds.size} id / ${alreadyFiledSigs.size} sig known]`,
  );

  // 4. Cap — sort by severity then user reach, file top N.
  const sevRank = {critical: 4, high: 3, medium: 2, low: 1};
  const rank = c =>
    (sevRank[c.triage.severity] || 0) * 1e6 +
    num(c.issue.distinctUsers) * 1e3 +
    num(c.issue.errorReportCount);
  fresh.sort((a, b) => rank(b) - rank(a));
  const toFile = fresh.slice(0, MAX);
  const overflow = fresh.length - toFile.length;
  if (overflow > 0) {
    console.log(
      `  ⚠ capping at --max=${MAX}; ${overflow} more new issue(s) will be filed on the next run:`,
    );
    fresh
      .slice(MAX)
      .forEach(c =>
        console.log(`      ${c.id} [${c.issue.type}] ${c.issue.cause || ''}`),
      );
  }

  if (EMIT) {
    writeFileSync(
      EMIT,
      JSON.stringify(
        toFile.map(c => ({
          id: c.id,
          signature: c.sig,
          family: c.family,
          type: c.issue.type,
          cause: c.issue.cause,
          location: c.issue.location,
          distinctUsers: num(c.issue.distinctUsers),
          reports: num(c.issue.errorReportCount),
          versionCode: c.rateInfo?.versionCode,
          crashRate: c.rateInfo?.crashRate,
          anrRate: c.rateInfo?.anrRate,
          triage: c.triage,
          devices: c.sample.devices,
        })),
        null,
        2,
      ),
    );
    console.log(`  wrote candidates → ${EMIT}`);
  }

  // 5. File.
  let filed = 0;
  const tmp = mkdtempSync(join(tmpdir(), 'play-vitals-triage-'));
  for (const {
    issue,
    id,
    sample,
    triage,
    rateInfo,
    sig,
    family,
    familyFrames,
    familyMemberCount,
  } of toFile) {
    const labels = [
      LABEL,
      triage.kind,
      `severity:${triage.severity}`,
      'investigate',
    ];
    const typeWord = issue.type === 'CRASH' ? 'Crash' : 'ANR';
    // A family rollup gets a family title; a single issue keeps its cause@location.
    const title =
      familyMemberCount > 1
        ? `[Play ${typeWord}] ${family} family — ${familyMemberCount} leaf frames`.slice(
            0,
            130,
          )
        : `[Play ${typeWord}] ${`${issue.cause || '(no cause)'} @ ${issue.location || '?'}`.replace(/\s+/g, ' ').trim().slice(0, 110)}`;
    const body = fmtIssueBody(
      issue,
      triage,
      sample,
      rateInfo,
      family,
      sig,
      familyFrames,
    );

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
    const bodyFile = join(tmp, `${id}.md`);
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
    console.log(`  ✅ filed ${id} → ${url}`);
    filed++;
  }

  // 6. Summary + CI output.
  console.log(
    `\n▶ done — scanned ${issues.length}, ${fresh.length} new, ` +
      `${DRY_RUN ? 'would file' : 'filed'} ${filed}${overflow > 0 ? ` (+${overflow} deferred)` : ''}.`,
  );
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      // In --dry-run nothing was actually filed, so report 0 (keeps the optional
      // claude-enrich job from triggering on a side-effect-free run).
      `filed=${DRY_RUN ? 0 : filed}\nnew=${fresh.length}\ndeferred=${overflow}\n`,
      {flag: 'a'},
    );
  }
}

main().catch(e => {
  // A transient upstream outage is not a CI failure: exiting 1 here paints the
  // whole Diagnostics Watch run red and (historically) skipped every downstream
  // job. Report it and exit clean — tomorrow's run picks the data back up.
  if (e.transient) {
    console.error(`⚠️  ${e.message}`);
    console.error(
      '   Transient Play Reporting outage after retries — skipping this collector for today.',
    );
    process.exit(0);
  }
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
