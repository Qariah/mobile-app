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

const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');

/** The repository of THIS script. Every git call runs `git -C REPO_ROOT`: a cwd in another checkout gave a wrong version. */
const SCRIPT_DIR = __dirname; // == path.dirname(__filename)
const REPO_ROOT = (() => {
  try {
    return execFileSync(
      'git',
      ['-C', SCRIPT_DIR, 'rev-parse', '--show-toplevel'],
      {stdio: ['pipe', 'pipe', 'ignore']},
    )
      .toString()
      .trim();
  } catch (error) {
    return path.join(SCRIPT_DIR, '..');
  }
})();

/**
 * Safely executes a Git command and returns the result
 * Returns fallback value if command fails
 */
function safeGit(args, fallback = '') {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], {
      stdio: ['pipe', 'pipe', 'ignore'],
    })
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
  let tag = safeGit([
    'describe',
    '--tags',
    '--abbrev=0',
    '--match',
    'v[0-9]*.[0-9]*.[0-9]*',
    '--match',
    '[0-9]*.[0-9]*.[0-9]*',
    // Qariah: never count a prerelease or test tag (upstream's `v2.3.0-1809-test` gave 2.3.0).
    '--exclude',
    '*-*',
  ]);

  // If no version tags found, check existing version as fallback
  if (!tag) {
    // Try to read from package.json as fallback
    try {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'package.json')),
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

/** Added to every derived build number to stay above the Play versionCode floor. History: docs/operations/version-numbering.md. */
const VERSION_CODE_OFFSET = 385;

/**
 * Get build number from total commit count
 * This ensures build numbers always increase
 * Qariah: plus VERSION_CODE_OFFSET.
 */
function getBuildNumber() {
  // Override from env var if provided (useful for CI/CD)
  // Qariah: it applies as-is, without the offset.
  if (process.env.BUILD_NUMBER) {
    return process.env.BUILD_NUMBER;
  }

  // Try to get total commit count
  const commitCount = safeGit(['rev-list', '--count', 'HEAD'], '1');

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
  return safeGit(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');
}

/**
 * Get the current commit hash (short version)
 */
function getGitHash() {
  return safeGit(['rev-parse', '--short', 'HEAD'], 'unknown');
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
