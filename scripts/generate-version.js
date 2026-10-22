#!/usr/bin/env node

/**
 * Git-based version generator
 *
 * This script extracts version information from Git metadata:
 * - Semantic version from the latest Git tag
 * - Build numbers from commit counts
 * - Additional metadata like branch and commit hash
 *
 * Usage:
 *   const versionInfo = require('./scripts/generate-version');
 *   console.log(versionInfo.semanticVersion); // e.g., "1.0.3"
 */

const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Safely executes a Git command and returns the result
 * Returns fallback value if command fails
 */
function safeExec(command, fallback = '') {
  try {
    return execSync(command, {stdio: ['pipe', 'pipe', 'ignore']})
      .toString()
      .trim();
  } catch (error) {
    return fallback;
  }
}

/**
 * Extract the current semantic version from Git tags
 * Follows pattern like "v1.2.3" or "1.2.3"
 */
function getSemanticVersion() {
  // Try to get the latest tag that looks like a version
  let tag = safeExec(
    'git describe --tags --abbrev=0 --match "v[0-9]*.[0-9]*.[0-9]*" --match "[0-9]*.[0-9]*.[0-9]*" 2>/dev/null',
  );

  // If no version tags found, check existing version as fallback
  if (!tag) {
    // Try to read from package.json as fallback
    try {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'package.json')),
      );
      tag = packageJson.version || '1.0.0';
    } catch (e) {
      // Default fallback version if all else fails
      tag = '1.0.0';
    }
  }

  // Strip the 'v' prefix if present
  return tag.replace(/^v/, '');
}

/**
 * Floor offset added to every auto-derived build number so that both iOS
 * and Android can publish from `git rev-list --count HEAD` without
 * platform-specific overrides.
 *
 * Why this exists: Google Play tracks `versionCode` strictly-increasing
 * **globally per package name**, regardless of `versionName`. iOS App
 * Store Connect tracks `CFBundleVersion` per `(bundle_id,
 * marketing_version)` pair — so iOS resets per marketing-version bump,
 * Android does not. Whenever the Android floor (highest versionCode
 * ever uploaded to Play for `com.qariah.app`) exceeds the current
 * `git rev-list --count HEAD`, fresh archives would be rejected by
 * Play with "version code N has already been used" or "must be higher
 * than M". The historical fix was to pass `BUILD_NUMBER=<floor+1>` on
 * the Android archive, which silently desynchronized iOS and Android
 * build numbers (Sprint 26 left Android at 1115, iOS at 1106; Sprint
 * 27 republish put iOS at 995, Android at 1116 — 121-unit gap).
 *
 * This offset folds the floor back into the auto-derive so both
 * platforms get the same build number from `git rev-list --count +
 * VERSION_CODE_OFFSET`. The number is monotonically increasing, lands
 * above Play's floor, and the simple "never override" rule from
 * `docs/operations/version-numbering.md` works on both platforms.
 *
 * How to bump this constant:
 * - Only bump it when a one-off Android upload moves the Play floor
 *   above the current auto-derived number again (rare — should not
 *   happen now that the offset is in place).
 * - New value = (highest Play versionCode ever uploaded) - (current
 *   `git rev-list --count HEAD`) + 1.
 * - Record the bump in `planning/ACTIVE_SPRINTS.md` so the lineage
 *   stays auditable.
 *
 * 2026-05-27 — set to 120 after Sprint 27 republish. At that time
 * `git rev-list --count HEAD` = 997, Play floor on `com.qariah.app`
 * = 1116 (Sprint 26's manual leapfrog beta upload). 997 + 120 = 1117,
 * one above the floor. iOS beta most recently shipped as
 * `3.1.7 (995)` on `com.qariah.app.beta`; the next iOS beta build at
 * 1117 satisfies the (com.qariah.app.beta, 3.1.7) monotonic constraint
 * because 1117 > 995.
 *
 * 2026-06-04 — bumped 120 → 242 for the Sprint 29 public-beta cut. The
 * Sprint 29 internal verification beta uploaded `3.1.8 (1257)` to the
 * Play beta track (a one-off that moved the `com.qariah.app` global
 * floor to 1257), while the post-squash-merge `qariah-main` count had
 * fallen to 1016 → auto-derive 1136 < 1257 would be rejected by Play.
 * New value = 1257 (highest Play versionCode) − 1016 (count) + 1 = 242.
 * 1016 + 242 = 1258 (floor+1); after the offset-bump commit, count 1017
 * + 242 = 1259, clearing Play's 1257 floor and the iOS
 * (com.qariah.app, 3.1.8) floor of 1135 (Sprint 28 public beta), both
 * platforms symmetric. See planning/ACTIVE_SPRINTS.md.
 *
 * 2026-06-06 — bumped 242 → 246 for the off-sprint Ambient-overlay-off
 * beta (PR #51). Sprint 30 shipped `3.1.8 (1270)` to BOTH beta tracks
 * (iOS `com.qariah.app.beta` + Play beta), setting the floor at 1270.
 * The squash-merge of PR #50 (CI fix) + #51 (ambient) collapsed the
 * Sprint-30 branch commits → post-merge `qariah-main` count fell to 1024
 * → auto-derive 1266 < 1270 would be rejected by both Play and TestFlight.
 * New value = 1270 (highest shipped versionCode) − 1025 (count after this
 * offset-bump commit) + 1 = 246. 1025 + 246 = 1271, clearing the 1270
 * floor on both platforms, symmetric.
 *
 * 2026-06-20 (Redmi play-freeze hotfix): the squash-merge of PR #214 dropped
 * `qariah-main` count to 1094 → auto-derive 1340, below Play's floor of 1348
 * (Sprint-36 internal beta vc1348). Bumped 246 → 255 so the count after the
 * offset-bump commit (1095) derives 1350, clearing 1348 on both platforms,
 * symmetric. Recorded in planning/ACTIVE_SPRINTS.md.
 *
 * 2026-08-02 (3.2.0 pre-SDK-56 production release): bumped 255 → 441 on the
 * `release/3.2.0-pre-sdk56` branch. This release line is cut from `4473874b`
 * — the last `qariah-main` commit BEFORE the Expo SDK 55→56 absorption
 * (`ffe3f8fb`, PR #257) — so its commit count (1262) is far below the Play
 * floor. Meanwhile the SDK-56 betas pushed the `com.qariah.app` global
 * versionCode floor to 1693 (Sprint 43 internal, Play edit
 * 13288584732409174468). Auto-derive at the old offset would be 1262 + 255 =
 * 1517, which Play rejects.
 * New value = 1704 (chosen target, deliberately clear of the 1693 floor and
 * of the iOS beta-bundle 1694 so the two lines are never confused) − 1263
 * (count after this offset-bump commit) = 441. 1263 + 441 = 1704.
 *
 *   ⚠️ FORWARD-PORT REQUIRED. This bump MUST be carried onto `qariah-main`
 *   before the deferred SDK-56 + RFC-020-filters release ships, or that
 *   release will be REJECTED by Play. `qariah-main` at count 1316 derives
 *   1316 + 255 = 1571, which is BELOW the 1704 this release ships. With the
 *   bump forward-ported it derives 1316 + 441 = 1757, clearing 1704.
 *   See planning/release-3.2.0-pre-sdk56-plan.md §"Forward-port obligations".
 *
 * 2026-09-20 (ANR hotfix, `hotfix/3.2.0-anr-splash`): bumped 441 → 696 on
 * a branch cut from the exact production commit `beb35bb3` (vc1717). Its
 * commit count (1279 after this bump) derives 1279 + 441 = 1720, far below
 * the `com.qariah.app` global floor of 1974 (the 2026-09-16 auto-sprint
 * internal build; read from the Play API, `/edits/{id}/bundles`, edit
 * deleted without a commit).
 * New value = 1975 (floor + 1) − 1279 (count after this offset-bump commit)
 * = 696. 1279 + 696 = 1975.
 *
 *   CEILING. The target must stay BELOW qariah-main's next derive, which was
 *   1982 on 2026-09-20 and only goes up. At or above it, Play's global floor
 *   would reject qariah-main's next internal upload and block the daily
 *   auto-sprint. The safe window on 2026-09-20 was 1975–1981.
 *
 *   NO FORWARD-PORT. Unlike the 2026-08-02 bump, qariah-main already derives
 *   above this number. Do NOT carry 696 onto qariah-main.
 *
 * 2026-09-24 (ANR hotfix, cont.): bumped 696 → 738. The 696 ceiling above was
 * respected and that is exactly what made the branch unpublishable: at 1982 it
 * sat BELOW what qariah-main had put on Play internal, so Play rejected the
 * internal commit with "You cannot rollout this release because it does not
 * allow any existing users to upgrade to the newly added APKs". A deliberately
 * lower number protects the trunk and strands the branch; on ONE track the two
 * goals cannot both hold.
 * New value = 2025 (the internal-track floor on 2026-09-24, after the day's
 * auto-sprint published 2025) + 1 − 1288 (count after this offset-bump commit)
 * = 737 after the iOS-gate commit shifted the count to 1289. 1289 + 737 = 2026.
 *
 *   THE CEILING STILL HOLDS, BARELY. qariah-main's offset is 359 (NOT 441 —
 *   441 is a historical value from the 2026-08-02 note above, and reading it as
 *   current is a mistake this comment has now caused once). At count 1668 the
 *   trunk's next derive is 2027, so 2026 is the ONLY number in the window and
 *   it needs no trunk bump. Verify both numbers from source before the next
 *   bump; do not reuse these.
 *
 *   ⚠️ THE WINDOW IS ONE WIDE AND THE RACE REPEATS. The daily auto-sprint
 *   publishes from qariah-main to Play internal unattended at 3pm PT, raising
 *   the floor every day. Any later build on this branch must clear whatever it
 *   last published, so this bump buys one upload, not a stable lane. The
 *   durable fix is to give this line its own track — `alpha` sits abandoned on
 *   983, a window ~1000 wide — rather than re-bumping daily.
 */
/*
 * 2026-09-27 (ANR hotfix v2, TECH_DEBT #223): bumped 737 -> 734 so this line
 * derives 2027. The number goes DOWN because this branch has more commits than
 * the 2026 build had. Play, read from the API on 2026-09-27: production 1717,
 * beta 1705, alpha 983, internal 2026; the highest uploaded bundle is 2026.
 * 2027 = that maximum + 1. Count after this offset commit = 1293; 1293 + 734 =
 * 2027. The build is made at this commit; later doc-only commits on the branch
 * raise the derive, and they do not change the uploaded build.
 *
 *   CEILING. qariah-main's next derive on 2026-09-27 = count 1692 + offset 359
 *   = 2051. 2027 is below it, so the trunk needs no bump. Do NOT carry 734
 *   onto qariah-main.
 */
const VERSION_CODE_OFFSET = 734;

/**
 * Get build number from total commit count + VERSION_CODE_OFFSET.
 * This ensures build numbers always increase AND always stay above
 * Google Play's global per-package floor (see VERSION_CODE_OFFSET).
 */
function getBuildNumber() {
  // Override from env var if provided (useful for CI/CD or one-off
  // recovery — applies as-is without the offset, on the assumption
  // that callers know the floor when overriding).
  if (process.env.BUILD_NUMBER) {
    return process.env.BUILD_NUMBER;
  }

  // Try to get total commit count
  const commitCount = safeExec('git rev-list --count HEAD', '1');

  // Ensure it's a positive integer
  const count = parseInt(commitCount, 10);
  const safeCount = isNaN(count) || count <= 0 ? 1 : count;
  return String(safeCount + VERSION_CODE_OFFSET);
}

/**
 * Get version code for Android
 * Must be an integer that increases with each release
 */
function getVersionCode() {
  const buildNumber = getBuildNumber();
  return parseInt(buildNumber, 10);
}

/**
 * Get the current Git branch name
 */
function getCurrentBranch() {
  return safeExec('git rev-parse --abbrev-ref HEAD', 'unknown');
}

/**
 * Get the current commit hash (short version)
 */
function getGitHash() {
  return safeExec('git rev-parse --short HEAD', 'unknown');
}

/**
 * Generate a build timestamp
 */
function getBuildTime() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
}

/**
 * Get full version string for display
 */
function getFullVersion(semanticVersion, buildNumber) {
  return `${semanticVersion} (${buildNumber})`;
}

/**
 * Parse semantic version components
 */
function parseVersionComponents(version) {
  const parts = version.split('.');
  return {
    major: parseInt(parts[0] || 0, 10),
    minor: parseInt(parts[1] || 0, 10),
    patch: parseInt(parts[2] || 0, 10),
  };
}

// Generate the complete version information
function generateVersionInfo() {
  const semanticVersion = getSemanticVersion();
  const buildNumber = getBuildNumber();
  const versionCode = getVersionCode();
  const gitBranch = getCurrentBranch();
  const gitHash = getGitHash();
  const buildTime = getBuildTime();
  const fullVersion = getFullVersion(semanticVersion, buildNumber);
  const versionComponents = parseVersionComponents(semanticVersion);

  return {
    semanticVersion,
    buildNumber,
    versionCode,
    gitBranch,
    gitHash,
    buildTime,
    fullVersion,
    ...versionComponents,
  };
}

// Generate version info
const versionInfo = generateVersionInfo();

// Log version info if script is executed directly.
//
// `--json-only` (or `-j`) suppresses the human-readable header so callers can
// JSON.parse(stdout) directly without regex-matching out a `{...}` substring.
// Used by scripts/verify-version-sync.js — see PR review on #251 for why
// regex-extracting JSON from interleaved log output is fragile.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const jsonOnly = argv.includes('--json-only') || argv.includes('-j');
  if (jsonOnly) {
    process.stdout.write(JSON.stringify(versionInfo));
  } else {
    console.log('Generated version information:');
    console.log(JSON.stringify(versionInfo, null, 2));
  }
}

module.exports = versionInfo;
