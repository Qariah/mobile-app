#!/usr/bin/env node
// @ai
//
// scripts/prune-held-trees.mjs — remove a held run's build tree when nothing in it can be lost.
// ---------------------------------------------------------------------------
// WHY (2026-11-11): a daily auto-sprint that stops (the disk floor, a hard stop) keeps its
// tree `../qariah-v2-auto-<date>` for the owner. The tree holds about 17 GB of node_modules,
// Pods and build output, so the next day's run failed the 28 GB disk floor too, and so did
// every run after it: no internal beta between 11-09 and 11-11. The work of a held sprint
// is on its pushed branch and its PR; the tree itself is build output.
//
// It removes a sibling tree of the main checkout when ALL of these hold:
//   - its name is `qariah-v2-auto-<YYYY-MM-DD>` with a date before today in Los Angeles,
//     or `qariah-v2-audit-<sha>` made more than AUDIT_MIN_AGE_HOURS ago (an audit removes
//     its own tree; a leftover one is from a run that died);
//   - no process has its working directory in the tree;
//   - every commit of the tree is on a remote (nothing unpushed);
//   - `git status` lists only the version files that the build scripts patch (VERSION_FILES)
//     and no untracked file.
// Anything else is kept, with the reason. The command names the tree in full, so the
// run-limits hook (.claude/hooks/qariah-run-limits.cjs) lets a scheduled run do it.
//
//   node scripts/prune-held-trees.mjs            remove the safe trees, print one line each
//   node scripts/prune-held-trees.mjs --dry-run  print what it would do
//
// scripts/disk-floor.sh build runs it before it purges the build caches. Exit 0 always
// (a tree it cannot judge is kept); exit 2 on a usage error.
import {execFileSync} from 'node:child_process';
import {existsSync, statSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** The files that the version sync and the build scripts patch, and restore afterwards. */
export const VERSION_FILES = [
  'android/app/build.gradle',
  'ios/Podfile.lock',
  'ios/Qariah.xcodeproj/project.pbxproj',
];
const IOS_INFO_PLIST = /^ios\/[^/]+\/Info\.plist$/;

export const AUDIT_MIN_AGE_HOURS = 12;

/** The date in Los Angeles, YYYY-MM-DD. */
export function laDate(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Is a tree, by its name and age, one that a held or dead run left?
 * → {kind: 'auto'|'audit', reason} or null.
 */
export function heldTreeKind(name, {today, ageHours}) {
  const auto = /^qariah-v2-auto-(\d{4}-\d{2}-\d{2})$/.exec(name);
  if (auto) {
    return auto[1] < today
      ? {kind: 'auto', reason: `a sprint tree from ${auto[1]}`}
      : null;
  }
  if (/^qariah-v2-audit-[0-9a-f]{7,40}$/.test(name)) {
    return ageHours >= AUDIT_MIN_AGE_HOURS
      ? {kind: 'audit', reason: `an audit tree ${Math.floor(ageHours)} h old`}
      : null;
  }
  return null;
}

/**
 * The lines of `git status --porcelain` that would be lost: anything but a change to a
 * version file. An untracked file counts as lost.
 */
export function unsafeStatusLines(porcelain) {
  return String(porcelain || '')
    .split('\n')
    .filter(Boolean)
    .filter(line => {
      if (line.startsWith('??')) return true;
      const file = line.slice(3).trim();
      return !(VERSION_FILES.includes(file) || IOS_INFO_PLIST.test(file));
    });
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });

function mainCheckout() {
  const common = run('git', [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]).trim();
  return dirname(common);
}

function worktrees(main) {
  const out = run('git', ['-C', main, 'worktree', 'list', '--porcelain']);
  return out
    .split('\n')
    .filter(l => l.startsWith('worktree '))
    .map(l => resolve(l.slice('worktree '.length)));
}

function processInside(path) {
  try {
    const out = run('lsof', ['-d', 'cwd', '-Fn']);
    return out
      .split('\n')
      .some(
        l =>
          l.startsWith('n') &&
          (l.slice(1) === path || l.slice(1).startsWith(`${path}/`)),
      );
  } catch {
    return true; // cannot tell: keep the tree
  }
}

/** The verdict for one tree: {remove: boolean, reason}. */
export function judgeTree(path, {today, now = Date.now(), deps = {}}) {
  const name = basename(path);
  const age =
    deps.ageHours ??
    (p => {
      const marker = join(p, '.git');
      return existsSync(marker) ? (now - statSync(marker).mtimeMs) / 36e5 : 0;
    });
  const kind = heldTreeKind(name, {today, ageHours: age(path)});
  if (!kind) return null;
  const busy = deps.processInside ?? processInside;
  if (busy(path))
    return {remove: false, reason: `${kind.reason}; a process runs in it`};
  const git = deps.git ?? (args => run('git', ['-C', path, ...args]));
  let unpushed;
  let status;
  try {
    unpushed = Number(
      git(['rev-list', '--count', 'HEAD', '--not', '--remotes']).trim(),
    );
    status = git(['status', '--porcelain']);
  } catch (e) {
    return {
      remove: false,
      reason: `${kind.reason}; git cannot read it (${String(e.message).slice(0, 80)})`,
    };
  }
  if (unpushed > 0) {
    return {
      remove: false,
      reason: `${kind.reason}; ${unpushed} commit(s) are not pushed`,
    };
  }
  const lost = unsafeStatusLines(status);
  if (lost.length) {
    return {
      remove: false,
      reason: `${kind.reason}; ${lost.length} change(s) outside the version files (${lost[0].trim()})`,
    };
  }
  return {
    remove: true,
    reason: `${kind.reason}; pushed, only version-file changes`,
  };
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => a !== '--dry-run');
  if (unknown.length) {
    console.error(
      `usage: node scripts/prune-held-trees.mjs [--dry-run] (unknown: ${unknown.join(' ')})`,
    );
    process.exit(2);
  }
  const dry = args.includes('--dry-run');
  const today = laDate();
  let main;
  let trees;
  try {
    main = mainCheckout();
    trees = worktrees(main);
  } catch (e) {
    console.log(
      `prune-held-trees: cannot list the worktrees (${String(e.message).slice(0, 120)}); kept all`,
    );
    return;
  }
  let removed = 0;
  for (const path of trees) {
    if (path === main) continue;
    const verdict = judgeTree(path, {today});
    if (!verdict) continue;
    if (!verdict.remove) {
      console.log(`prune-held-trees: kept ${path}: ${verdict.reason}`);
      continue;
    }
    if (dry) {
      console.log(`prune-held-trees: would remove ${path}: ${verdict.reason}`);
      continue;
    }
    try {
      run('git', ['-C', main, 'worktree', 'remove', '--force', path]);
      removed++;
      console.log(
        `prune-held-trees: removed ${path}: ${verdict.reason}. Its branch and PR keep the work.`,
      );
    } catch (e) {
      console.log(
        `prune-held-trees: could not remove ${path}: ${String(e.message).slice(0, 120)}`,
      );
    }
  }
  if (!removed && !dry) console.log('prune-held-trees: no held tree to remove');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
