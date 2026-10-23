#!/usr/bin/env node
// @ai
//
// scripts/lint-qariah-owned.mjs
// -----------------------------
// Run ESLint on the files that Qariah owns, and nothing else (TECH_DEBT #236).
//
// A file is Qariah-owned when it is tracked in this checkout and does NOT exist
// in the upstream tree at the pinned commit. The pin is the SHA in
// scripts/lint-qariah-owned.upstream-sha: the newest upstream/develop commit
// that qariah-main contains. The ownership test reads only the file names of
// that tree, so it needs no history and no file contents. A file that exists
// upstream is never linted here, even when Qariah changed it. Fork economics:
// a lint fix in an upstream file is a merge conflict at every upstream sync
// (planning/simplify-analysis-2026-07-18.md).
//
// Why a pin, not the tip of upstream/develop: when upstream renames or deletes
// a file that qariah-main still tracks, the file would look Qariah-owned, and
// one lint error in it would turn the required check red for every PR. The pin
// moves only when qariah-main absorbs upstream, so the two always agree.
//
// EACH UPSTREAM ABSORPTION PR UPDATES THE PIN. After the merge, run:
//   git fetch upstream develop
//   node scripts/lint-qariah-owned.mjs --update-pin
// and commit scripts/lint-qariah-owned.upstream-sha. If the pin is not
// updated, the files that the absorption brought in look Qariah-owned, and any
// lint error in them blocks the PR. Procedure: docs/operations/weekly-upstream-sync-status.md.
//
// The full `npm run lint` step in .github/workflows/lint.yml stays advisory.
// This script is the blocking part of the lint gate.
//
// Usage:
//   node scripts/lint-qariah-owned.mjs               lint, print the errors only
//   node scripts/lint-qariah-owned.mjs --fix         lint and fix what ESLint can fix
//   node scripts/lint-qariah-owned.mjs --list        print the owned files, lint nothing
//   node scripts/lint-qariah-owned.mjs --print-pin   print the pinned SHA (the CI step uses it)
//   node scripts/lint-qariah-owned.mjs --update-pin  write `git merge-base HEAD upstream/develop`
//
// Locally, `git fetch upstream develop` makes the pinned commit available. CI
// fetches exactly the pinned commit (file names only) in the step before this
// one. Set QARIAH_UPSTREAM_REF to compare with another ref, for a trial.
//
// Warnings (they never fail the run): the pin is not an ancestor of HEAD, the
// pin is older than the newest upstream commit in HEAD, and an exclude line
// that matches no Qariah-owned file. A shallow checkout (CI) has no history,
// so the two pin checks do not run there.
//
// Exit codes: 0 = clean, 1 = ESLint found an error, 2 = the script could not run
// (no pin, no upstream commit, no ESLint, ESLint crashed).
//
// scripts/lint-qariah-owned.exclude lists paths to leave out. Use it only for a
// Qariah-owned file with a lint error that cannot be fixed now. Do not edit an
// upstream file for lint.

import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** The extensions that `eslint .` lints in this repository (checked 2026-10-21). */
export const LINT_EXTENSIONS = ['.js', '.ts', '.tsx'];

/** A path segment that ESLint never lints: a dot-folder, or a folder in .eslintignore. */
const SKIPPED_SEGMENT = /^(\..*|node_modules|android|ios)$/;

const PIN_FILE = 'lint-qariah-owned.upstream-sha';
const EXCLUDE_FILE = 'lint-qariah-owned.exclude';
const UPSTREAM_TIP = 'upstream/develop';
const FULL_SHA = /^[0-9a-f]{40}$/;

/** True when `eslint .` would lint this repository path. */
export function isLintable(path) {
  if (!LINT_EXTENSIONS.some(ext => path.endsWith(ext))) return false;
  return !path.split('/').some(segment => SKIPPED_SEGMENT.test(segment));
}

/** Read an exclude file: one path for each line, `#` starts a comment. */
export function parseExcludeList(text) {
  return text
    .split('\n')
    .map(line => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

/**
 * The Qariah-owned files that ESLint must lint, sorted.
 * @param {string[]} tracked   paths of the files in this checkout
 * @param {Iterable<string>} upstreamFiles  paths of the files on upstream
 * @param {string[]} [excluded]  paths to leave out (see the header)
 */
export function qariahOwned(tracked, upstreamFiles, excluded = []) {
  const upstream = new Set(upstreamFiles);
  const skip = new Set(excluded);
  return tracked
    .filter(path => isLintable(path) && !upstream.has(path) && !skip.has(path))
    .sort();
}

/** The exclude lines that match no Qariah-owned file: stale, or never useful. */
export function unmatchedExcludes(tracked, upstreamFiles, excluded) {
  const candidates = new Set(qariahOwned(tracked, upstreamFiles));
  return excluded.filter(path => !candidates.has(path));
}

/**
 * The SHA in a pin file: the first line that is not empty and not a comment.
 * Returns null when there is none, or when it is not a full 40-character SHA.
 */
export function parsePin(text) {
  const line = text
    .split('\n')
    .map(entry => entry.replace(/#.*/, '').trim())
    .find(Boolean);
  return line && FULL_SHA.test(line) ? line : null;
}

/** The pin file text with its SHA line replaced (or added). Comments stay. */
export function writePin(text, sha) {
  const lines = text.split('\n');
  const index = lines.findIndex(
    entry => entry.replace(/#.*/, '').trim() !== '',
  );
  if (index === -1) {
    const comments = text.replace(/\n*$/, '');
    return comments ? `${comments}\n${sha}\n` : `${sha}\n`;
  }
  lines[index] = sha;
  return lines.join('\n');
}

/** Split a list into groups so that no command line is too long. */
export function chunkByLength(items, maxChars = 100000) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const item of items) {
    if (current.length && size + item.length + 1 > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += item.length + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * True when this module is the program that Node runs. Both paths go through
 * realpath: Node resolves a symlink for the module URL but not for argv[1],
 * so a symlinked parent folder must not turn the script into a silent no-op.
 */
export function isDirectRun(argvPath, moduleUrl) {
  if (!argvPath) return false;
  try {
    return (
      realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(moduleUrl))
    );
  } catch {
    return false;
  }
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function splitNul(text) {
  return text.split('\0').filter(Boolean);
}

/** A warning never changes the exit code. GitHub shows `::warning::` on the run. */
function warn(message) {
  console.error(
    process.env.GITHUB_ACTIONS
      ? `::warning::lint-qariah-owned: ${message}`
      : `lint-qariah-owned: warning: ${message}`,
  );
}

/** Run a git check that answers with its exit status. Returns true, false or null. */
function gitStatus(root, args) {
  try {
    git(root, args);
    return true;
  } catch (error) {
    return error.status === 1 ? false : null;
  }
}

function hasCommit(root, ref) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function main(argv) {
  const list = argv.includes('--list');
  const fix = argv.includes('--fix');
  const scriptDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
  const pinPath = resolve(scriptDir, PIN_FILE);
  const pinText = existsSync(pinPath) ? readFileSync(pinPath, 'utf8') : '';
  const pin = parsePin(pinText);

  if (argv.includes('--print-pin')) {
    if (!pin) {
      console.error(`lint-qariah-owned: no valid SHA in ${PIN_FILE}.`);
      return 2;
    }
    console.log(pin);
    return 0;
  }

  const root = git(scriptDir, ['rev-parse', '--show-toplevel']).trim();
  const shallow =
    git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true';

  if (argv.includes('--update-pin')) {
    if (shallow || !hasCommit(root, UPSTREAM_TIP)) {
      console.error(
        `lint-qariah-owned: --update-pin needs the full history and ${UPSTREAM_TIP}.\n` +
          'Run: git fetch upstream develop',
      );
      return 2;
    }
    const base = git(root, ['merge-base', 'HEAD', UPSTREAM_TIP]).trim();
    writeFileSync(pinPath, writePin(pinText, base));
    console.error(
      `lint-qariah-owned: pin is now ${base} (the newest ${UPSTREAM_TIP} commit in HEAD).`,
    );
    return 0;
  }

  const override = process.env.QARIAH_UPSTREAM_REF;
  const ref = override || pin;
  if (!ref) {
    console.error(
      `lint-qariah-owned: no valid SHA in ${PIN_FILE}. Run: node scripts/lint-qariah-owned.mjs --update-pin`,
    );
    return 2;
  }
  if (!hasCommit(root, ref)) {
    console.error(
      `lint-qariah-owned: cannot find the upstream commit "${ref}".\n` +
        'The script needs the file names of the upstream tree to find the Qariah-owned files.\n' +
        'Locally, run: git fetch upstream develop\n' +
        'In CI, the step "Fetch the upstream file names" must run before this step.',
    );
    return 2;
  }

  // The two pin checks need history. A shallow checkout (CI) has none.
  if (!override && !shallow) {
    if (
      gitStatus(root, ['merge-base', '--is-ancestor', ref, 'HEAD']) === false
    ) {
      warn(
        `the pinned commit ${ref.slice(0, 12)} is not an ancestor of HEAD. ` +
          'Run --update-pin after you merge upstream, or check the pin.',
      );
    } else if (hasCommit(root, UPSTREAM_TIP)) {
      let base = null;
      try {
        base = git(root, ['merge-base', 'HEAD', UPSTREAM_TIP]).trim();
      } catch {
        base = null;
      }
      if (base && base !== ref) {
        warn(
          `the pin ${ref.slice(0, 12)} is not the newest ${UPSTREAM_TIP} commit in HEAD (${base.slice(0, 12)}). ` +
            'Run --update-pin if HEAD absorbed upstream.',
        );
      }
    }
  }

  const tracked = splitNul(git(root, ['ls-files', '-z'])).filter(path =>
    existsSync(resolve(root, path)),
  );
  const upstreamFiles = splitNul(
    git(root, ['ls-tree', '-r', '-z', '--name-only', ref]),
  );
  const excludePath = resolve(scriptDir, EXCLUDE_FILE);
  const excluded = existsSync(excludePath)
    ? parseExcludeList(readFileSync(excludePath, 'utf8'))
    : [];
  for (const path of unmatchedExcludes(tracked, upstreamFiles, excluded)) {
    warn(
      `${EXCLUDE_FILE} lists "${path}", which matches no Qariah-owned file. Remove the line.`,
    );
  }
  const owned = qariahOwned(tracked, upstreamFiles, excluded);

  if (list) {
    console.log(owned.join('\n'));
    return 0;
  }
  if (owned.length === 0) {
    console.error('lint-qariah-owned: no Qariah-owned file to lint.');
    return 0;
  }

  let eslintBin;
  try {
    const eslintPackage = createRequire(resolve(root, 'package.json')).resolve(
      'eslint/package.json',
    );
    eslintBin = resolve(dirname(eslintPackage), 'bin/eslint.js');
  } catch {
    console.error('lint-qariah-owned: ESLint is not installed. Run npm ci.');
    return 2;
  }

  console.error(
    `lint-qariah-owned: ${owned.length} Qariah-owned ${owned.length === 1 ? 'file' : 'files'} (not in the upstream tree at ${ref.slice(0, 12)}).`,
  );
  let status = 0;
  for (const chunk of chunkByLength(owned)) {
    const args = [eslintBin, '--quiet', ...(fix ? ['--fix'] : []), ...chunk];
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
    });
    status = Math.max(status, result.status ?? 2);
  }
  if (status === 1) {
    console.error(
      '\nlint-qariah-owned: ESLint found errors in Qariah-owned files.\n' +
        'Fix them in these files. Do not edit an upstream file for lint. If a file has an\n' +
        'error that cannot be fixed now, add its path to scripts/lint-qariah-owned.exclude.',
    );
  }
  return status;
}

if (isDirectRun(process.argv[1], import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
