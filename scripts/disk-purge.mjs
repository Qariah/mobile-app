#!/usr/bin/env node
// @ai
//
// scripts/disk-purge.mjs — delete the build output that an install or a build makes again.
// ---------------------------------------------------------------------------
// WHY (2026-11-15): the daily auto-sprint held at its 28 GB disk floor on 11-10, 11-11,
// 11-13 and 11-14 (PR #943: 21 GB free after the purge), so 0 of the 26 scoped backlog
// issues closed. disk-floor.sh purged only DerivedData/Qariah-* (about 2 GB). The space was
// regenerable output: node_modules (8-9.5 GB a tree), ios/Pods and android/app/build of
// idle worktrees, lab APKs, and agent installs in the scratch folders. A manual clean-up on
// 11-15 took the disk from 19 GB to 49 GB free.
//
// It deletes ONLY these paths, and only when each rule holds:
//   REGENERABLE (node_modules, ios/Pods, android/app/build, android/build, ios/build) of
//     - an auto-sprint tree `qariah-v2-auto-<date>` from an earlier day: HEAD equals its
//       upstream, `git status` shows no change outside the version files that the build
//       scripts patch, and no process runs in it;
//     - any other worktree of the repository: it is not locked, no process runs in it,
//       and no file and no desktop-app session changed in WORKTREE_IDLE_DAYS (when the
//       session records cannot be read, it keeps each of these trees);
//     - a checkout in a folder of the scratch directory (~/claude/.scratch/<task>/): no file
//       in <task>/ changed in SCRATCH_IDLE_HOURS, and no process runs in it. In a folder
//       that is not a git checkout, only node_modules (with a package.json beside it);
//   `*-lab.apk` in ~/qariah-releases older than LAB_APK_DAYS;
//   DerivedData/Bayaan-* and DerivedData/WebDriverAgent-* with no change in
//   DERIVED_DATA_DAYS, when no xcodebuild runs. It keeps the newest WebDriverAgent-*:
//   scripts/iphone-device-test.sh uses it;
//   THE RETENTION RULE (2026-11-15): a store build (.aab, .apk, .ipa) or a mapping or
//     symbols file in ~/qariah-releases older than RETENTION_DAYS, whose build number is
//     not named in docs/operations/active-rollout.json and is not the newest build of its
//     platform. It keeps the mapping and the symbols of each build that it keeps, each
//     file with no build number in its path, audits/, evidence/ and a folder made today.
//     When no copy of the record can be read, it keeps each file. See releasesPlan().
// It never deletes the output of the main checkout, of the task tree ($QARIAH_TASKS_TREE)
// or of the tree that runs it; a folder whose real path is not <tree>/<folder> (a symlink
// in the path); a folder that a symlink of another tree points to; a tracked or a
// not-ignored file; a branch; a commit; a simulator; anything in ~/qariah-releases but an
// old lab APK and the files of the retention rule. Before it deletes a build folder, it
// moves each file that a build cannot make again the same (an .aab, an .ipa, a release
// .apk, the R8 mapping, the native debug symbols) with no copy in ~/qariah-releases to
// ~/qariah-releases/saved-builds/<tree>/<build>/ (<build> when the build output names
// it). A move on one volume uses no new space. Just before each delete it checks again
// that no process has a file open in the path.
//
// WHERE THE SYMBOLS ARE ON 2026-11-15 (so a local copy is a second copy):
//   - R8 is off (android.enableMinifyInReleaseBuilds=false), so a release build has no
//     R8 mapping. isSymbolFile() still saves one if R8 is turned on.
//   - The native debug symbols are inside each AAB (BUNDLE-METADATA/
//     com.android.tools.build.debugsymbols/), so Play gets them with each upload. Sentry
//     gets no Android native symbols: sentry.gradle.kts uploads only the JS source maps.
//   - iOS: ExportOptions uploadSymbols sends the dSYMs to App Store Connect, and the
//     "Upload Debug Symbols to Sentry" build phase sends them to Sentry
//     (SENTRY_ALLOW_FAILURE=true: a failed Sentry upload does not stop the archive).
//     This script saves no dSYM.
//
//   node scripts/disk-purge.mjs --dry-run [--releases]  list each path, its size and the reason
//   node scripts/disk-purge.mjs --releases     delete (scripts/disk-floor.sh build runs it,
//                                              only when free disk is below the build floor)
//   node scripts/disk-purge.mjs                delete, but not by the retention rule
//   node scripts/disk-purge.mjs --own-build-output=<tree> [--dry-run]
//       scripts/run-end.sh autoSprint: delete android/app/build and ios/build of the run's
//       own tree, held or not. No age rule; the other rules apply. --releases is refused
//       here: the end of a run never deletes a store build.
// --releases turns on the retention rule for ~/qariah-releases. The owner approved it only
// below the floor (2026-11-15), so only disk-floor.sh passes it, after its df check.
//
// The size is the `du` size. An APFS clone shares its blocks with its source, so the space
// that a delete frees can be smaller. disk-floor.sh measures the real gain with df.
// Exit 0 always (a path that it cannot judge is kept); exit 2 on a usage error.
import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {laDate, unsafeStatusLines} from './prune-held-trees.mjs';

export const REGENERABLE = [
  'node_modules',
  'ios/Pods',
  'android/app/build',
  'android/build',
  'ios/build',
];
export const OWN_BUILD_OUTPUT = ['android/app/build', 'ios/build'];
export const WORKTREE_IDLE_DAYS = 3;
export const SCRATCH_IDLE_HOURS = 24;
export const LAB_APK_DAYS = 2;
export const DERIVED_DATA_DAYS = 2;
export const DERIVED_DATA_PREFIXES = ['Bayaan-', 'WebDriverAgent-'];
const WDA_PREFIX = 'WebDriverAgent-';
const HOUR = 36e5;
const DAY = 24 * HOUR;
/** In a regenerable folder, look only this deep for a recent change. */
const INSIDE_DEPTH = 2;
/** The file that must exist for an install or a build to make the folder again. */
const SOURCE_OF = {node_modules: 'package.json', 'ios/Pods': 'ios/Podfile'};

/** The paths that this script uses, from the environment and $HOME. */
export function defaultPaths(env = process.env, home = homedir()) {
  return {
    home,
    releasesDir: env.QARIAH_RELEASES_DIR || join(home, 'qariah-releases'),
    scratchDir: env.QARIAH_SCRATCH_DIR || join(home, 'claude', '.scratch'),
    tasksTree: env.QARIAH_TASKS_TREE || join(home, 'claude', '.qariah-tasks'),
    derivedData: join(home, 'Library', 'Developer', 'Xcode', 'DerivedData'),
    sessionsDir: join(
      home,
      'Library',
      'Application Support',
      'Claude',
      'claude-code-sessions',
    ),
  };
}

/** The real path, or the resolved path when it does not exist. */
export function realOr(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** Is `segs` (a path split on "/") a folder in REGENERABLE, at any depth? */
export function isRegenerable(segs) {
  const n = segs.length;
  const last = segs[n - 1];
  if (last === 'node_modules') return true;
  if (last === 'Pods') return segs[n - 2] === 'ios';
  if (last === 'build') {
    return (
      segs[n - 2] === 'ios' ||
      segs[n - 2] === 'android' ||
      (segs[n - 2] === 'app' && segs[n - 3] === 'android')
    );
  }
  return false;
}

const safeLstat = p => {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
};

/**
 * The first entry under `top` (or `top` itself) with an mtime after `sinceMs`, as
 * {path, ms}; null when there is none. It does not follow a symlink, skips `.git`, and
 * looks only INSIDE_DEPTH levels into a regenerable folder (an install or a build writes
 * near its top). `maxDepth` limits the whole walk.
 */
export function recentChange(top, sinceMs, {maxDepth = Infinity} = {}) {
  const st = safeLstat(top);
  if (!st) return null;
  if (st.mtimeMs > sinceMs) return {path: top, ms: st.mtimeMs};
  if (!st.isDirectory()) return null;
  const stack = [{dir: top, segs: [], depth: 0, inside: null}];
  while (stack.length) {
    const {dir, segs, depth, inside} = stack.pop();
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === '.git') continue;
      const path = join(dir, name);
      const s = safeLstat(path);
      if (!s) continue;
      if (s.mtimeMs > sinceMs) return {path, ms: s.mtimeMs};
      if (!s.isDirectory()) continue;
      const next = [...segs, name];
      const nextInside =
        inside !== null ? inside + 1 : isRegenerable(next) ? 0 : null;
      if (nextInside !== null && nextInside >= INSIDE_DEPTH) continue;
      if (depth + 1 >= maxDepth) continue;
      stack.push({dir: path, segs: next, depth: depth + 1, inside: nextInside});
    }
  }
  return null;
}

/** The newest mtime of `top` and of its entries down to `maxDepth`; 0 when it is gone. */
export function newestMtime(top, {maxDepth = 3} = {}) {
  const st = safeLstat(top);
  if (!st) return 0;
  let newest = st.mtimeMs;
  if (!st.isDirectory()) return newest;
  const stack = [{dir: top, depth: 0}];
  while (stack.length) {
    const {dir, depth} = stack.pop();
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const s = safeLstat(join(dir, name));
      if (!s) continue;
      newest = Math.max(newest, s.mtimeMs);
      if (s.isDirectory() && depth + 1 < maxDepth)
        stack.push({dir: join(dir, name), depth: depth + 1});
    }
  }
  return newest;
}

/** `git worktree list --porcelain` → [{path, locked}]. */
export function parseWorktrees(porcelain) {
  const out = [];
  for (const block of String(porcelain || '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const head = lines.find(l => l.startsWith('worktree '));
    if (!head) continue;
    out.push({
      path: resolve(head.slice('worktree '.length)),
      locked: lines.some(l => l === 'locked' || l.startsWith('locked ')),
    });
  }
  return out;
}

/** `git worktree list --porcelain` → the paths. */
export function parseWorktreeList(porcelain) {
  return parseWorktrees(porcelain).map(w => w.path);
}

/**
 * The desktop-app session records: [{paths, lastActivityAt, isArchived}]. null = unknown
 * (the folder is missing or unreadable, or no record names a path): then each tree that
 * the session rule judges is kept.
 */
export function readSessions(sessionsDir) {
  if (!existsSync(sessionsDir)) return null;
  const out = [];
  try {
    for (const a of readdirSync(sessionsDir)) {
      const da = join(sessionsDir, a);
      if (!safeLstat(da)?.isDirectory()) continue;
      for (const b of readdirSync(da)) {
        const db = join(da, b);
        if (!safeLstat(db)?.isDirectory()) continue;
        for (const f of readdirSync(db)) {
          if (!/^local_.*\.json$/.test(f)) continue;
          const d = JSON.parse(readFileSync(join(db, f), 'utf8'));
          const paths = [d.worktreePath, d.cwd].filter(
            p => typeof p === 'string' && p,
          );
          if (!paths.length) continue;
          out.push({
            paths,
            lastActivityAt: Number(d.lastActivityAt || d.createdAt || 0),
            isArchived: Boolean(d.isArchived),
          });
        }
      }
    }
  } catch {
    return null;
  }
  return out.length ? out : null;
}

/** The newest activity of a session that is not archived and works in `root`; 0 for none. */
export function sessionActivity(root, sessions) {
  const r = realOr(root);
  let ms = 0;
  for (const s of sessions) {
    if (s.isArchived) continue;
    if (
      s.paths.map(realOr).some(p => p === r || p.startsWith(`${r}/`)) &&
      s.lastActivityAt > ms
    )
      ms = s.lastActivityAt;
  }
  return ms;
}

const ago = (now, ms) => {
  const h = (now - ms) / HOUR;
  return h < 48
    ? `${Math.max(0, Math.round(h))} h ago`
    : `${Math.round(h / 24)} d ago`;
};

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });

const openNames = out =>
  String(out)
    .split('\n')
    .filter(l => l.startsWith('n/'))
    .map(l => l.slice(1));

/**
 * A function path → "a process has its cwd or an open file in it". When the listing is
 * not complete (lsof is missing, the output is too big, a signal), it is always true.
 * lsof exits 1 when it cannot read one process; that output is complete for this user.
 */
export function lsofBusy(list = () => run('lsof', ['-n', '-P', '-Fn'])) {
  let names;
  try {
    names = openNames(list());
  } catch (e) {
    const out = e && typeof e.stdout === 'string' ? e.stdout : '';
    if (e?.code === 'ENOBUFS' || e?.status !== 1 || !out) return () => true;
    names = openNames(out);
  }
  return path => {
    const forms = new Set([path]);
    try {
      forms.add(realpathSync(path));
    } catch {
      /* the path is gone: nothing is open in it */
    }
    for (const n of names)
      for (const p of forms) if (n === p || n.startsWith(`${p}/`)) return true;
    return false;
  };
}

/** `du -sk` in bytes; 0 when du fails. */
export function duBytes(path) {
  try {
    const kb = Number(run('du', ['-sk', path]).split(/\s+/)[0]);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  } catch (e) {
    const kb = Number(String(e?.stdout || '').split(/\s+/)[0]);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  }
}

export const gb = bytes => (bytes / 1024 ** 3).toFixed(1);

/** Is `relPath` a store build? An .aab, an .ipa, or an .apk in a `release/` folder. */
export function isStoreBuild(relPath) {
  if (/\.(aab|ipa)$/.test(relPath)) return true;
  return /\.apk$/.test(relPath) && /(^|\/)release\//.test(relPath);
}

/**
 * Is `relPath` (relative to android/app/build/outputs/) a symbol file? The R8 mapping and
 * the native debug symbols turn a crash report back into names; the next build makes
 * different ones.
 */
export function isSymbolFile(relPath) {
  return /^(mapping|native-debug-symbols)\//.test(relPath);
}

/**
 * The files in a build folder that a build cannot make again the same, as absolute
 * paths: the .aab, the release .apk, the mapping and the native debug symbols under
 * android/app/build/outputs/, and each .ipa under ios/build/. Gradle's intermediates are
 * not in the list.
 */
export function filesToSave(root, rel) {
  const BASE = {
    'android/app/build': join(root, rel, 'outputs'),
    'ios/build': join(root, rel),
  };
  const base = BASE[rel];
  if (!base || !safeLstat(base)?.isDirectory()) return [];
  const found = [];
  const stack = [base];
  while (stack.length) {
    const d = stack.pop();
    let names;
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = join(d, name);
      const s = safeLstat(p);
      if (!s) continue;
      if (s.isDirectory()) {
        // An app bundle or a framework holds no store build.
        if (!/\.(app|framework|dSYM|xcframework|bundle)$/.test(name))
          stack.push(p);
        continue;
      }
      if (!s.isFile()) continue;
      const r = relative(base, p);
      if (isStoreBuild(r) || (rel === 'android/app/build' && isSymbolFile(r)))
        found.push(p);
    }
  }
  return found;
}

function sha256(path) {
  const h = createHash('sha256');
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(4 * 1024 * 1024);
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

/** A file in the releases folder (3 levels deep) with the same size and bytes; or null. */
export function copyInReleases(file, releasesDir) {
  const size = safeLstat(file)?.size;
  if (size == null || !existsSync(releasesDir)) return null;
  let hash = null;
  const stack = [{d: releasesDir, depth: 0}];
  while (stack.length) {
    const {d, depth} = stack.pop();
    let names;
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = join(d, name);
      const s = safeLstat(p);
      if (!s) continue;
      if (s.isDirectory()) {
        if (depth < 3) stack.push({d: p, depth: depth + 1});
      } else if (s.isFile() && s.size === size) {
        hash ??= sha256(file);
        if (sha256(p) === hash) return p;
      }
    }
  }
  return null;
}

/**
 * Where a saved file goes: <releases>/saved-builds/<tree>/<build>/<path with dashes>, or
 * <releases>/saved-builds/<tree>/<path with dashes> when the build number is not known.
 * The retention rule reads the build number from the <build> folder.
 */
export function savedBuildPath(releasesDir, treeName, relPath, build = null) {
  const dashed = relPath.split('/').join('-');
  return Number.isInteger(build) && build > 0
    ? join(releasesDir, 'saved-builds', treeName, String(build), dashed)
    : join(releasesDir, 'saved-builds', treeName, dashed);
}

/** The files under `dir` (down to `depth` levels) whose name passes `match`. */
function findFiles(dir, match, depth) {
  const out = [];
  const stack = [{d: dir, depth: 0}];
  while (stack.length) {
    const {d, depth: n} = stack.pop();
    let names;
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = join(d, name);
      const s = safeLstat(p);
      if (!s) continue;
      if (s.isDirectory()) {
        if (n + 1 < depth) stack.push({d: p, depth: n + 1});
      } else if (s.isFile() && match(name, p)) out.push(p);
    }
  }
  return out;
}

/**
 * The build number of the output in <root>/<rel>, or null. Android: the versionCode in
 * outputs/apk/release/output-metadata.json and in the merged manifests of the release
 * variant. iOS: CFBundleVersion in the Info.plist of an .xcarchive. Two sources that do
 * not agree give null: a saved file with a wrong number could be deleted too early.
 */
export function buildNumberOfOutput(root, rel) {
  const found = new Set();
  const add = v => {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) found.add(n);
  };
  const base = join(root, rel);
  if (rel === 'android/app/build') {
    try {
      const meta = JSON.parse(
        readFileSync(
          join(base, 'outputs', 'apk', 'release', 'output-metadata.json'),
          'utf8',
        ),
      );
      for (const e of meta.elements || []) add(e.versionCode);
    } catch {
      /* no APK metadata */
    }
    for (const d of [
      'merged_manifest',
      'merged_manifests',
      'packaged_manifests',
    ]) {
      for (const p of findFiles(
        join(base, 'intermediates', d, 'release'),
        n => n === 'AndroidManifest.xml',
        2,
      )) {
        try {
          const m = /android:versionCode="(\d+)"/.exec(readFileSync(p, 'utf8'));
          if (m) add(m[1]);
        } catch {
          /* unreadable */
        }
      }
    }
  } else if (rel === 'ios/build') {
    for (const p of findFiles(
      base,
      (n, path) => n === 'Info.plist' && /\.xcarchive\/Info\.plist$/.test(path),
      2,
    )) {
      try {
        const m = /<key>CFBundleVersion<\/key>\s*<string>(\d+)<\/string>/.exec(
          readFileSync(p, 'utf8'),
        );
        if (m) add(m[1]);
      } catch {
        /* unreadable or a binary plist */
      }
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

// --- the retention rule for ~/qariah-releases ------------------------------------------

/** Keep each build file of the last RETENTION_DAYS days. */
export const RETENTION_DAYS = 14;
/** The record of the builds on the stores (production, and each build in users' hands). */
export const ROLLOUT_REL = 'docs/operations/active-rollout.json';
/** The retention rule never looks into these top folders of ~/qariah-releases. */
export const RELEASES_NEVER = ['audits', 'evidence'];
const RELEASES_DEPTH = 4;

/**
 * Each number in the texts of the rollout record. A build number "named" in the record is
 * any number in it: a field (`build`, `versionCode`, `buildsToWatch`) or a sentence. A
 * number that is not a build only keeps more.
 */
export function namedBuildNumbers(texts) {
  const set = new Set();
  for (const t of texts)
    for (const m of String(t).matchAll(/\d+/g)) set.add(Number(m[0]));
  return set;
}

/**
 * The build number in the path of a file in ~/qariah-releases (relative path), or null.
 * Only the names that the archive scripts and this script write:
 *   qariah-<version>-<build>-<sha>[-<variant>].<ext>   (android-archive.sh, qariah-ios-archive.sh;
 *                                                       <version> is x.y.z or "unknown",
 *                                                       <sha> is a short hash or "nogit")
 *   saved-builds/<tree>/<build>/<file>                  (this script, since 2026-11-15)
 * Another name (for example qariah-4571-auto-2026-11-14-android.apk, or a debug APK) has
 * no number: the file stays, and it cannot take the "newest build" place of a store build.
 */
export const RELEASE_NAME =
  /^qariah-(?:\d+\.\d+\.\d+|unknown)-(\d+)-(?:[0-9a-f]{7,40}|nogit)(?:-[A-Za-z0-9-]+)?\.(?:aab|apk|ipa)(?:\.\d+)?$/;
export function releaseBuildNumber(rel) {
  const segs = rel.split('/');
  let n = null;
  if (segs[0] === 'saved-builds') {
    if (segs.length >= 4 && /^\d+$/.test(segs[2])) n = Number(segs[2]);
  } else {
    const m = RELEASE_NAME.exec(segs[segs.length - 1]);
    if (m) n = Number(m[1]);
  }
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * What a file in ~/qariah-releases is: {platform, kind: 'build'|'symbols'}, or null for a
 * file that is not a build (a log, a screenshot, a README). A lab APK is null: the lab
 * rule deletes the old ones. A saved copy can end in `.2`, `.3` (apply() never overwrites).
 */
export function releaseFileKind(rel) {
  const name = basename(rel);
  if (/-lab\.apk(\.\d+)?$/.test(name)) return null;
  if (/\.(aab|apk)(\.\d+)?$/.test(name))
    return {platform: 'android', kind: 'build'};
  if (/\.ipa(\.\d+)?$/.test(name)) return {platform: 'ios', kind: 'build'};
  // savedBuildPath() names them android-app-build-outputs-mapping-release-mapping.txt and
  // android-app-build-outputs-native-debug-symbols-release-native-debug-symbols.zip.
  if (/native-debug-symbols/.test(name) || /(^|-)mapping[-.]/.test(name))
    return {platform: 'android', kind: 'symbols'};
  return null;
}

/** When a folder was made: its birth time (its mtime when the file system has none). */
const madeMs = st =>
  st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;

/**
 * The retention plan for the store builds in ~/qariah-releases. It keeps:
 *   - each build file and symbol file that changed in the last RETENTION_DAYS days;
 *   - each file whose build number is named in docs/operations/active-rollout.json, the
 *     record of the production builds and of each build in users' hands
 *     (engagement.buildsToWatch: post-sprint Step 14b and the Promoter add a build the day
 *     it ships, and a build leaves it only when its users moved off);
 *   - the newest Android build and the newest iOS build: an internal track can serve a
 *     build before a record names it, and only a store API can say that;
 *   - the mapping and the symbols of each build that it keeps;
 *   - each file with no build number in its path, and each file when the record cannot be
 *     read (fail closed);
 *   - audits/, evidence/, a folder made today, a symlink, a file that a process has open.
 * It deletes the other build and symbol files. It never deletes a log, a screenshot or
 * another file that is not a build, and never a folder.
 * `named`: {numbers: Set<number>, from: string[]} or null (no record could be read).
 */
export function releasesPlan({now, today, releasesDir, named, busy}) {
  const items = [];
  if (!existsSync(releasesDir)) return items;
  const files = [];
  const walk = (dir, rel, depth) => {
    let names = [];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = safeLstat(path);
      if (!st || st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (!rel && RELEASES_NEVER.includes(name)) {
          items.push({
            path,
            action: 'keep',
            reason: `${name}/ is never deleted (the retention rule)`,
          });
          continue;
        }
        if (laDate(madeMs(st)) === today) {
          items.push({
            path,
            action: 'keep',
            reason: 'a run made this folder today (the retention rule)',
          });
          continue;
        }
        if (depth + 1 < RELEASES_DEPTH) walk(path, r, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      const kind = releaseFileKind(r);
      if (!kind) continue;
      files.push({
        path,
        rel: r,
        ...kind,
        build: releaseBuildNumber(r),
        mtimeMs: st.mtimeMs,
        bytes: st.size,
      });
    }
  };
  walk(releasesDir, '', 0);

  const newest = {};
  for (const f of files)
    if (f.kind === 'build' && f.build !== null)
      newest[f.platform] = Math.max(newest[f.platform] || 0, f.build);

  const verdict = f => {
    if (now - f.mtimeMs < RETENTION_DAYS * DAY)
      return `from ${ago(now, f.mtimeMs)}; the rule keeps ${RETENTION_DAYS} d`;
    if (f.build === null)
      return 'no build number in its path, so the record cannot be checked';
    if (!named) return `no copy of ${ROLLOUT_REL} can be read`;
    if (named.numbers.has(f.build))
      return `build ${f.build} is named in ${ROLLOUT_REL}`;
    if (newest[f.platform] === f.build)
      return `the newest ${f.platform} build (${f.build}): an internal track can serve it before a record names it`;
    return null;
  };
  // The build numbers that this plan keeps a build file of.
  const keptBuilds = new Set();
  for (const f of files)
    if (f.kind === 'build' && f.build !== null && verdict(f))
      keptBuilds.add(f.build);

  let keptBytes = 0;
  let deleteBytes = 0;
  for (const f of files) {
    let reason = verdict(f);
    if (!reason && f.kind === 'symbols' && keptBuilds.has(f.build))
      reason = `the mapping or the symbols of build ${f.build}, which stays`;
    if (!reason && busy(f.path)) reason = 'a process has the file open';
    if (reason) {
      keptBytes += f.bytes;
      items.push({path: f.path, action: 'keep', bytes: f.bytes, reason});
      continue;
    }
    deleteBytes += f.bytes;
    items.push({
      path: f.path,
      action: 'delete',
      bytes: f.bytes,
      reason:
        f.kind === 'build'
          ? `build ${f.build} (${f.platform}) from ${ago(
              now,
              f.mtimeMs,
            )}: not named in ${ROLLOUT_REL}, not the newest ${f.platform} build`
          : `the mapping or the symbols of build ${f.build}, from ${ago(
              now,
              f.mtimeMs,
            )}: no build of it stays`,
      saves: [],
    });
  }
  items.push({
    path: null,
    action: 'note',
    reason: `retention in ${releasesDir}: ${
      files.length
    } build and symbol files; keep ${gb(keptBytes)} GB, delete ${gb(
      deleteBytes,
    )} GB; the record: ${
      named
        ? `${ROLLOUT_REL} at ${named.from.join(' + ')}`
        : 'not readable, so each file stays'
    }`,
  });
  return items;
}

/**
 * The plan: [{path, action: 'delete'|'keep'|'note', bytes, reason, saves: [{from, to}]}].
 * `ctx`: {now, today, paths, main, self, worktrees, locked?, own?, releases?, deps: {busy,
 * git, sessions, xcodebuildRuns, du, namedBuilds?}}. `releases: true` adds the retention
 * rule (releasesPlan); `own` returns before it in each case. Pure apart from reads of the file system and the calls
 * in deps.
 */
export function plan(ctx) {
  const {now, today, deps} = ctx;
  // Compare real paths: git prints them (on macOS /var is a symlink to /private/var).
  const real = realOr;
  const paths = {...ctx.paths, tasksTree: real(ctx.paths.tasksTree)};
  const mainRoot = real(ctx.main);
  const self = real(ctx.self);
  const worktrees = ctx.worktrees.map(real);
  const locked = new Set((ctx.locked || []).map(real));
  const items = [];
  const keep = (path, reason) => items.push({path, action: 'keep', reason});
  const note = text => items.push({path: null, action: 'note', reason: text});
  const git = (root, args) => deps.git(root, args);
  const inGitTree = root => {
    try {
      git(root, ['rev-parse', '--show-toplevel']);
      return true;
    } catch {
      return false;
    }
  };
  const isCheckoutTop = root => {
    try {
      return real(git(root, ['rev-parse', '--show-toplevel']).trim()) === root;
    } catch {
      return false;
    }
  };

  // --- the trees: worktrees and scratch checkouts ------------------------------------
  const scratch = real(paths.scratchDir);
  const scratchTop = root => {
    const r = relative(scratch, root);
    if (!r || r.startsWith('..') || isAbsolute(r)) return null;
    return join(scratch, r.split('/')[0]);
  };
  const roots = new Map(); // root → {kind}
  for (const wt of worktrees) {
    if (!existsSync(wt)) continue;
    roots.set(wt, {kind: 'worktree'});
  }
  if (existsSync(scratch)) {
    let tops = [];
    try {
      tops = readdirSync(scratch);
    } catch {
      /* unreadable: no scratch candidates */
    }
    const looksLikeCheckout = d =>
      ['package.json', '.git', 'ios', 'android'].some(n =>
        existsSync(join(d, n)),
      );
    for (const name of tops) {
      const top = join(scratch, name);
      if (!safeLstat(top)?.isDirectory()) continue;
      const found = [];
      if (looksLikeCheckout(top)) found.push(top);
      let subs = [];
      try {
        subs = readdirSync(top);
      } catch {
        /* unreadable */
      }
      for (const sub of subs) {
        const d = join(top, sub);
        if (safeLstat(d)?.isDirectory() && looksLikeCheckout(d)) found.push(d);
      }
      for (const d of found) if (!roots.has(d)) roots.set(d, {kind: 'scratch'});
    }
  }

  // The real targets of each regenerable folder whose path has a symlink in it, in all
  // trees. Tree A can link to tree B's node_modules: B's is then not idle output.
  const linkTargets = new Map(); // target → the link path
  for (const root of [...roots.keys(), mainRoot, self]) {
    for (const rel of REGENERABLE) {
      const p = join(root, rel);
      if (!safeLstat(p)) continue;
      const rp = real(p);
      if (rp !== join(root, rel)) linkTargets.set(rp, p);
    }
  }
  const linkedFrom = path => {
    const rp = real(path);
    for (const [t, from] of linkTargets) {
      if (t === rp || t.startsWith(`${rp}/`) || rp.startsWith(`${t}/`))
        return from;
    }
    return null;
  };

  // The checks of one folder before it is deleted. Returns a keep reason or null.
  const folderProblem = (root, rel, path) => {
    const st = safeLstat(path);
    if (!st) return 'it is gone';
    if (st.isSymbolicLink()) return 'it is a symlink';
    if (!st.isDirectory()) return 'it is not a folder';
    if (real(path) !== join(real(root), rel))
      return `a part of its path is a symlink (it is ${real(path)})`;
    const from = linkedFrom(path);
    if (from) return `the symlink ${from} points into it`;
    const source = SOURCE_OF[rel];
    if (source && !existsSync(join(root, source)))
      return `no ${source} to make it again`;
    if (deps.busy(path)) return 'a process has a file open in it';
    if (inGitTree(root)) {
      try {
        if (git(root, ['ls-files', '--', rel]).trim())
          return 'git tracks a file in it';
        const extra = git(root, [
          'status',
          '--porcelain',
          '--untracked-files=all',
          '--',
          rel,
        ]).trim();
        if (extra)
          return `git shows a file in it that is not ignored (${
            extra.split('\n')[0]
          })`;
      } catch (e) {
        return `git cannot read it (${String(e.message).slice(0, 80)})`;
      }
    }
    return null;
  };

  // A folder to delete: plan the moves of the files that a build cannot make again.
  const addDelete = (root, rel, reason) => {
    const path = join(root, rel);
    const problem = folderProblem(root, rel, path);
    if (problem) return keep(path, problem);
    const saves = [];
    const files = filesToSave(root, rel);
    // The build number goes into the saved path, so the retention rule can check it.
    const build = files.length ? buildNumberOfOutput(root, rel) : null;
    for (const file of files) {
      if (copyInReleases(file, paths.releasesDir)) continue;
      saves.push({
        from: file,
        to: savedBuildPath(
          paths.releasesDir,
          basename(root),
          relative(root, file),
          build,
        ),
      });
    }
    items.push({path, action: 'delete', bytes: deps.du(path), reason, saves});
  };

  // --- the auto-sprint's own build output (run-end.sh) -------------------------------
  if (ctx.own) {
    const root = real(ctx.own);
    if (root === mainRoot || root === paths.tasksTree) {
      keep(root, 'the main checkout or the task tree: never its build output');
      return items;
    }
    if (!worktrees.includes(root)) {
      keep(root, 'not a worktree of this repository');
      return items;
    }
    if (locked.has(root)) {
      keep(root, 'the worktree is locked (git worktree lock)');
      return items;
    }
    for (const rel of OWN_BUILD_OUTPUT) {
      if (safeLstat(join(root, rel)))
        addDelete(root, rel, 'the build output of this run');
    }
    return items;
  }

  // --- worktrees and scratch checkouts -----------------------------------------------
  const sessions = deps.sessions();
  const topVerdict = new Map();
  const judgeTop = top => {
    if (topVerdict.has(top)) return topVerdict.get(top);
    let v = null;
    if (deps.busy(top)) v = `a process runs in ${top}`;
    else {
      const ch = recentChange(top, now - SCRATCH_IDLE_HOURS * HOUR);
      if (ch)
        v = `a file in ${top} changed ${ago(now, ch.ms)} (${
          relative(top, ch.path) || '.'
        }); the scratch rule waits ${SCRATCH_IDLE_HOURS} h`;
    }
    topVerdict.set(top, v);
    return v;
  };

  for (const [root, {kind}] of [...roots].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    let present = REGENERABLE.filter(rel => safeLstat(join(root, rel)));
    if (!present.length) continue;
    const keepAll = reason =>
      present.forEach(rel => keep(join(root, rel), reason));
    if (root === mainRoot) {
      keepAll('the main checkout: the scheduled runs use it');
      continue;
    }
    if (root === paths.tasksTree) {
      keepAll('the task tree of the scheduled tasks');
      continue;
    }
    if (root === self) {
      keepAll('the tree that runs this script');
      continue;
    }
    if (locked.has(root)) {
      keepAll('the worktree is locked (git worktree lock)');
      continue;
    }
    if (deps.busy(root)) {
      keepAll('a process runs in the tree');
      continue;
    }
    const top = scratchTop(root);
    if (top) {
      const v = judgeTop(top);
      if (v) {
        keepAll(v);
        continue;
      }
    }
    if (kind === 'scratch' && !isCheckoutTop(root)) {
      // Not a git checkout: nothing shows what in ios/ or android/ is source.
      for (const rel of present.filter(r => r !== 'node_modules'))
        keep(
          join(root, rel),
          'not a git checkout: only node_modules is deleted here',
        );
      present = present.filter(r => r === 'node_modules');
      if (!present.length) continue;
    }
    const auto = /^qariah-v2-auto-(\d{4}-\d{2}-\d{2})$/.exec(basename(root));
    let reason;
    if (kind === 'worktree' && auto) {
      if (auto[1] >= today) {
        keepAll("today's auto-sprint tree");
        continue;
      }
      let head;
      let upstream = null;
      let status;
      let off = 0;
      try {
        head = git(root, ['rev-parse', 'HEAD']).trim();
        try {
          upstream = git(root, ['rev-parse', '@{u}']).trim();
        } catch {
          upstream = null;
        }
        if (upstream === null) {
          off = Number(
            git(root, [
              'rev-list',
              '--count',
              'HEAD',
              '--not',
              '--remotes',
            ]).trim(),
          );
        }
        status = git(root, ['status', '--porcelain']);
      } catch (e) {
        keepAll(`git cannot read the tree (${String(e.message).slice(0, 80)})`);
        continue;
      }
      if (upstream !== null && upstream !== head) {
        keepAll('HEAD is not equal to its upstream');
        continue;
      }
      if (upstream === null && !(off === 0)) {
        keepAll(`no upstream, and ${off} commit(s) are on no remote`);
        continue;
      }
      const lost = unsafeStatusLines(status);
      if (lost.length) {
        keepAll(
          `git status shows ${
            lost.length
          } change(s) outside the version files (${lost[0].trim()})`,
        );
        continue;
      }
      reason = `an auto-sprint tree from ${auto[1]}: pushed, clean, no process in it`;
    } else if (kind === 'worktree') {
      const since = now - WORKTREE_IDLE_DAYS * DAY;
      let ch = recentChange(root, since);
      if (!ch) {
        // A commit or a checkout writes HEAD and logs/HEAD in the worktree's git folder.
        try {
          const gitdir = resolve(
            root,
            git(root, ['rev-parse', '--git-dir']).trim(),
          );
          for (const f of ['HEAD', join('logs', 'HEAD')]) {
            const s = safeLstat(join(gitdir, f));
            if (s && s.mtimeMs > since)
              ch = {path: join(gitdir, f), ms: s.mtimeMs};
          }
        } catch {
          /* no git folder: the file check above is the rule */
        }
      }
      if (ch) {
        keepAll(
          `a file changed ${ago(now, ch.ms)} (${
            relative(root, ch.path) || '.'
          }); the worktree rule waits ${WORKTREE_IDLE_DAYS} d`,
        );
        continue;
      }
      if (sessions === null) {
        keepAll('the desktop-app session records cannot be read');
        continue;
      }
      const used = sessionActivity(root, sessions);
      if (used > since) {
        keepAll(`a desktop-app session used it ${ago(now, used)}`);
        continue;
      }
      reason = `a worktree with no change in ${WORKTREE_IDLE_DAYS} d and no process in it`;
    } else {
      reason = `a scratch checkout with no change in ${SCRATCH_IDLE_HOURS} h and no process in it`;
    }
    for (const rel of present) addDelete(root, rel, reason);
  }

  // --- lab APKs ------------------------------------------------------------------------
  if (existsSync(paths.releasesDir)) {
    let names = [];
    try {
      names = readdirSync(paths.releasesDir);
    } catch {
      /* unreadable */
    }
    const labs = names.filter(n => n.endsWith('-lab.apk')).sort();
    if (!labs.length) note(`no lab APK in ${paths.releasesDir}`);
    for (const name of labs) {
      const path = join(paths.releasesDir, name);
      const st = safeLstat(path);
      if (!st?.isFile()) continue;
      if (now - st.mtimeMs < LAB_APK_DAYS * DAY) {
        keep(
          path,
          `a lab APK from ${ago(
            now,
            st.mtimeMs,
          )}; the rule waits ${LAB_APK_DAYS} d`,
        );
        continue;
      }
      items.push({
        path,
        action: 'delete',
        bytes: st.size,
        reason: `a lab APK from ${ago(now, st.mtimeMs)}`,
        saves: [],
      });
    }
  }

  // --- DerivedData of Bayaan and WebDriverAgent -------------------------------------------
  if (existsSync(paths.derivedData)) {
    let names = [];
    try {
      names = readdirSync(paths.derivedData);
    } catch {
      /* unreadable */
    }
    const dd = names
      .filter(n => DERIVED_DATA_PREFIXES.some(p => n.startsWith(p)))
      .filter(n => safeLstat(join(paths.derivedData, n))?.isDirectory())
      .sort();
    const xcode = dd.length ? deps.xcodebuildRuns() : false;
    // The newest WebDriverAgent build stays: scripts/iphone-device-test.sh uses it.
    let newestWda = null;
    let newestWdaMs = -1;
    for (const name of dd.filter(n => n.startsWith(WDA_PREFIX))) {
      const ms = newestMtime(join(paths.derivedData, name));
      if (ms > newestWdaMs) {
        newestWdaMs = ms;
        newestWda = name;
      }
    }
    for (const name of dd) {
      const path = join(paths.derivedData, name);
      if (xcode) {
        keep(path, 'an xcodebuild runs');
        continue;
      }
      if (name === newestWda) {
        keep(
          path,
          'the newest WebDriverAgent build: scripts/iphone-device-test.sh uses it',
        );
        continue;
      }
      const ch = recentChange(path, now - DERIVED_DATA_DAYS * DAY, {
        maxDepth: 3,
      });
      if (ch) {
        keep(
          path,
          `it changed ${ago(
            now,
            ch.ms,
          )}; the rule waits ${DERIVED_DATA_DAYS} d`,
        );
        continue;
      }
      if (deps.busy(path)) {
        keep(path, 'a process has a file open in it');
        continue;
      }
      items.push({
        path,
        action: 'delete',
        bytes: deps.du(path),
        reason: `DerivedData with no change in ${DERIVED_DATA_DAYS} d`,
        saves: [],
      });
    }
  }

  // --- the store builds in ~/qariah-releases (the retention rule) ----------------------
  // Only with --releases (ctx.releases): disk-floor.sh passes it below the build floor.
  if (ctx.releases !== true) return items;
  let named = null;
  try {
    named = deps.namedBuilds ? deps.namedBuilds() : null;
  } catch {
    named = null;
  }
  items.push(
    ...releasesPlan({
      now,
      today,
      releasesDir: paths.releasesDir,
      named,
      busy: deps.busy,
    }),
  );
  return items;
}

/**
 * Do the plan. `busy` is checked again just before each delete, so a process that started
 * after the plan keeps its folder. Returns the du bytes of what it deleted.
 */
export function apply(items, {log = console.log, busy = () => false} = {}) {
  let freed = 0;
  for (const it of items) {
    if (it.action !== 'delete') continue;
    if (busy(it.path)) {
      log(`disk-purge: kept ${it.path}: a process has a file open in it now`);
      continue;
    }
    let saved = true;
    for (const s of it.saves) {
      try {
        mkdirSync(dirname(s.to), {recursive: true});
        let to = s.to;
        for (let i = 2; existsSync(to); i++) to = `${s.to}.${i}`;
        renameSync(s.from, to);
        log(`disk-purge: saved ${s.from} to ${to}`);
      } catch (e) {
        saved = false;
        log(
          `disk-purge: kept ${it.path}: could not save ${s.from} (${String(
            e.message,
          ).slice(0, 80)})`,
        );
        break;
      }
    }
    if (!saved) continue;
    try {
      rmSync(it.path, {recursive: true, force: true});
      freed += it.bytes;
      log(`disk-purge: deleted ${it.path} (${gb(it.bytes)} GB): ${it.reason}`);
    } catch (e) {
      log(
        `disk-purge: could not delete ${it.path}: ${String(e.message).slice(
          0,
          120,
        )}`,
      );
    }
  }
  return freed;
}

/** The lines of a dry run. */
export function describe(items) {
  const lines = [];
  let total = 0;
  for (const it of items) {
    if (it.action === 'note') {
      lines.push(`disk-purge: ${it.reason}`);
      continue;
    }
    if (it.action === 'keep') {
      const size = Number.isFinite(it.bytes) ? ` (${gb(it.bytes)} GB)` : '';
      lines.push(`disk-purge: kept ${it.path}${size}: ${it.reason}`);
      continue;
    }
    total += it.bytes;
    lines.push(
      `disk-purge: would delete ${it.path} (${gb(it.bytes)} GB): ${it.reason}`,
    );
    for (const s of it.saves)
      lines.push(`disk-purge:   first, would save ${s.from} to ${s.to}`);
  }
  lines.push(
    `disk-purge: total ${gb(
      total,
    )} GB would be freed (du sizes; an APFS clone shares its blocks with its source, so the real gain can be smaller)`,
  );
  return lines;
}

/**
 * The build numbers named in docs/operations/active-rollout.json: the copy on
 * origin/qariah-main, in the tree that runs this script and in the main checkout, all
 * of them together (a number in one copy is enough to keep a build). A copy that does not
 * parse as JSON does not count: a cut file could miss a number. null when none parses.
 * No network call: origin/qariah-main is the last fetched one.
 */
export function readRolloutRecords({mainTree, self, gitShow, readFile}) {
  const texts = [];
  const from = [];
  const add = (label, read) => {
    try {
      const t = read();
      JSON.parse(t);
      texts.push(t);
      from.push(label);
    } catch {
      /* missing or not JSON: it does not count */
    }
  };
  add('origin/qariah-main', () =>
    gitShow(mainTree, `origin/qariah-main:${ROLLOUT_REL}`),
  );
  add('this tree', () => readFile(join(self, ROLLOUT_REL)));
  if (realOr(mainTree) !== realOr(self))
    add('the main checkout', () => readFile(join(mainTree, ROLLOUT_REL)));
  return texts.length ? {numbers: namedBuildNumbers(texts), from} : null;
}

function realDeps({mainTree, self} = {}) {
  const busy = lsofBusy();
  return {
    namedBuilds: () =>
      readRolloutRecords({
        mainTree,
        self,
        gitShow: (root, spec) => run('git', ['-C', root, 'show', spec]),
        readFile: p => readFileSync(p, 'utf8'),
      }),
    busy,
    git: (root, args) =>
      run('git', ['-C', root, '--no-optional-locks', ...args]),
    sessions: () => readSessions(defaultPaths().sessionsDir),
    xcodebuildRuns: () => {
      try {
        run('pgrep', ['-x', 'xcodebuild']);
        return true;
      } catch (e) {
        return e?.status !== 1; // 1 = no match; anything else = cannot tell
      }
    },
    du: duBytes,
  };
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const releases = args.includes('--releases');
  const ownArg = args.find(a => a.startsWith('--own-build-output='));
  const unknown = args.filter(
    a => a !== '--dry-run' && a !== '--releases' && a !== ownArg,
  );
  if (
    unknown.length ||
    (ownArg && !ownArg.split('=')[1]) ||
    (ownArg && releases)
  ) {
    console.error(
      'usage: node scripts/disk-purge.mjs [--dry-run] [--releases | --own-build-output=<tree>]',
    );
    process.exit(2);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const self = resolve(here, '..');
  let mainTree;
  let trees;
  try {
    const common = run('git', [
      '-C',
      self,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]).trim();
    mainTree = dirname(common);
    trees = parseWorktrees(
      run('git', ['-C', mainTree, 'worktree', 'list', '--porcelain']),
    );
  } catch (e) {
    console.log(
      `disk-purge: cannot list the worktrees (${String(e.message).slice(
        0,
        120,
      )}); deleted nothing`,
    );
    return;
  }
  const items = plan({
    now: Date.now(),
    today: laDate(),
    paths: defaultPaths(),
    main: mainTree,
    self,
    worktrees: trees.map(w => w.path),
    locked: trees.filter(w => w.locked).map(w => w.path),
    own: ownArg ? ownArg.split('=').slice(1).join('=') : null,
    releases,
    deps: realDeps({mainTree, self}),
  });
  if (dry) {
    for (const l of describe(items)) console.log(l);
    return;
  }
  for (const it of items) {
    if (it.action === 'keep')
      console.log(`disk-purge: kept ${it.path}: ${it.reason}`);
    if (it.action === 'note') console.log(`disk-purge: ${it.reason}`);
  }
  // A new lsof listing for each delete: a process can start after the plan.
  const freed = apply(items, {busy: p => lsofBusy()(p)});
  console.log(
    `disk-purge: total ${gb(
      freed,
    )} GB deleted (du sizes; df shows the real gain)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
