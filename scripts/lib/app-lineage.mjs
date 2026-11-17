// @ai
//
// scripts/lib/app-lineage.mjs
// ---------------------------
// The v1/v2 app-lineage classifier, for every triage script. Moved here from
// scripts/play-vitals-triage.mjs on 2026-11-15 (issue #907) with no change in
// behavior. scripts/play-vitals-triage.mjs imports it back (and exports it
// again for scripts/__tests__/play-vitals-lineage.test.mjs);
// scripts/sentry-triage.mjs uses classifySentryLineage() below.
// The rule in words: docs/operations/version-numbering.md, "Crash lineage".

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
export const V1_FRAME_PATTERNS = [
  /libflutter\.so/i,
  /io\.flutter/i,
  /dart:/i,
  /FlutterRenderer/i,
  /flutter_runner/i,
  /com\.ryanheise/i, // just_audio_background (Flutter plugin)
  /just_audio/i,
];

// Frame signatures specific to the RN / Expo / Hermes stack (v2 only).
export const V2_FRAME_PATTERNS = [
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
export const MIN_V2_VERSION_CODE_TIEBREAKER = 812;

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

/**
 * Classify a Sentry issue (an item of the Sentry issues API) by its frames.
 * The text is the issue title, the culprit and the string values of
 * `metadata` (`type`, `value`, `filename`, `function`, ...). A Sentry issue
 * has no versionCode, so the result comes from the frame patterns only.
 *
 * @param {{title?:string, culprit?:string, metadata?:object}} issue
 * @returns {'v1'|'v2'|'unknown'}
 */
export function classifySentryLineage(issue) {
  const metadata = Object.values(issue?.metadata || {})
    .filter(v => typeof v === 'string')
    .join(' ');
  return classifyAppLineage(
    {cause: issue?.title || '', location: issue?.culprit || ''},
    metadata,
  );
}
