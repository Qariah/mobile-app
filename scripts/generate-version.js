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
 * 2026-09-07 (first daily auto-sprint): the 3.2.x line shipped from
 * release/3.2.0-pre-sdk56, whose commit count ran ahead of qariah-main; the
 * last uploads were Play internal vc1767 + TestFlight 3.2.1 (1767) on
 * 2026-09-05, while qariah-main derived 1663. New value = 1767 (highest
 * shipped versionCode) − 1409 (count after this offset-bump commit) + 1 = 359.
 * 1409 + 359 = 1768, clearing 1767 on both platforms, symmetric. Recorded in
 * planning/ACTIVE_SPRINTS.md (auto/2026-09-07 row).
 */
const VERSION_CODE_OFFSET = 359;

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
