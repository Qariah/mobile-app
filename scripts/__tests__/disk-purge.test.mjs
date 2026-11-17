#!/usr/bin/env node
// @ai
//
// scripts/__tests__/disk-purge.test.mjs
// -------------------------------------
// scripts/disk-purge.mjs deletes regenerable build output when the disk is below the build
// floor. The daily auto-sprint held at that floor on 2026-11-10, 11-11, 11-13 and 11-14.
// These tests check the selection rules: what it deletes, what it keeps, and that it
// never deletes a store build, a symbol file or a simulator.
//
// Run:  node --test scripts/__tests__/disk-purge.test.mjs
//
// Each test makes a fake home in a new temporary folder (mkdtemp under os.tmpdir(), which
// is $TMPDIR, else /tmp: the Node form of `mktemp -d`). The fake home holds a git origin,
// a main checkout, worktrees, a scratch folder, a releases folder and a DerivedData
// folder. No test reads or changes a real checkout or the real home.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  RETENTION_DAYS,
  apply,
  buildNumberOfOutput,
  defaultPaths,
  describe as describePlan,
  duBytes,
  isRegenerable,
  isStoreBuild,
  isSymbolFile,
  lsofBusy,
  namedBuildNumbers,
  parseWorktreeList,
  parseWorktrees,
  plan,
  readRolloutRecords,
  readSessions,
  recentChange,
  releaseBuildNumber,
  releaseFileKind,
  releasesPlan,
  savedBuildPath,
  sessionActivity,
} from '../disk-purge.mjs';
import {laDate} from '../prune-held-trees.mjs';

const SCRIPT = fileURLToPath(new URL('../disk-purge.mjs', import.meta.url));
const NOW = Date.parse('2026-11-15T20:00:00Z');
const TODAY = '2026-11-15';
const OLD = NOW - 10 * 24 * 36e5;

function put(path, text = 'x\n') {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, text);
}

/** Set the mtime of each entry under `dir` (children first) to `ms`. */
function ageAll(dir, ms) {
  const s = lstatSync(dir);
  if (s.isDirectory()) {
    for (const name of readdirSync(dir)) ageAll(join(dir, name), ms);
  }
  if (s.isSymbolicLink()) lutimesSync(dir, ms / 1000, ms / 1000);
  else utimesSync(dir, ms / 1000, ms / 1000);
}

function touch(path, ms = NOW) {
  utimesSync(path, ms / 1000, ms / 1000);
}

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'disk-purge-')));

test('isRegenerable: only the five folders, at any depth', () => {
  for (const p of [
    'node_modules',
    'a/node_modules',
    'ios/Pods',
    'x/ios/Pods',
    'android/app/build',
    'android/build',
    'ios/build',
  ])
    assert.equal(isRegenerable(p.split('/')), true, p);
  for (const p of ['build', 'Pods', 'src/build', 'app/build', 'android', 'ios'])
    assert.equal(isRegenerable(p.split('/')), false, p);
});

test('isStoreBuild and isSymbolFile: the files that a build cannot make again the same', () => {
  assert.equal(isStoreBuild('bundle/release/app-release.aab'), true);
  assert.equal(isStoreBuild('export/Qariah.ipa'), true);
  assert.equal(isStoreBuild('apk/release/app-release.apk'), true);
  assert.equal(isStoreBuild('apk/debug/app-debug.apk'), false);
  assert.equal(isStoreBuild('apk/release/output-metadata.json'), false);
  assert.equal(isSymbolFile('mapping/release/mapping.txt'), true);
  assert.equal(
    isSymbolFile('native-debug-symbols/release/native-debug-symbols.zip'),
    true,
  );
  assert.equal(isSymbolFile('logs/manifest-merger-release-report.txt'), false);
});

test('recentChange: sees a source edit, not a deep file in node_modules or .git', () => {
  const root = tmp();
  try {
    put(join(root, 'src', 'a.ts'));
    put(join(root, 'node_modules', 'pkg', 'lib', 'deep', 'b.js'));
    put(join(root, '.git', 'index'));
    ageAll(root, OLD);
    const since = NOW - 3 * 24 * 36e5;
    assert.equal(recentChange(root, since), null);
    touch(join(root, 'node_modules', 'pkg', 'lib', 'deep', 'b.js'));
    touch(join(root, '.git', 'index'));
    assert.equal(recentChange(root, since), null, 'deep install file and .git');
    touch(join(root, 'node_modules', 'pkg'));
    assert.match(recentChange(root, since).path, /node_modules\/pkg$/);
    touch(join(root, 'node_modules', 'pkg'), OLD);
    touch(join(root, 'src', 'a.ts'));
    assert.match(recentChange(root, since).path, /src\/a\.ts$/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('parseWorktrees: the paths and the locked trees', () => {
  const porcelain =
    'worktree /a/main\nHEAD 1\nbranch refs/heads/x\n\n' +
    'worktree /a/wt\nHEAD 2\ndetached\nlocked\n\n' +
    'worktree /a/wt2\nHEAD 3\nbranch refs/heads/y\nlocked agent at work\n\n' +
    'worktree /a/wt3\nHEAD 4\nbranch refs/heads/z\nprunable gitdir file points to non-existent location\n';
  assert.deepEqual(parseWorktrees(porcelain), [
    {path: '/a/main', locked: false},
    {path: '/a/wt', locked: true},
    {path: '/a/wt2', locked: true},
    {path: '/a/wt3', locked: false},
  ]);
  assert.deepEqual(parseWorktreeList(porcelain), [
    '/a/main',
    '/a/wt',
    '/a/wt2',
    '/a/wt3',
  ]);
});

test('readSessions fails closed; sessionActivity compares real paths', () => {
  const root = tmp();
  try {
    assert.equal(
      readSessions(join(root, 'missing')),
      null,
      'no folder → unknown',
    );
    const dir = join(root, 'sessions');
    put(
      join(dir, 'acct', 'env', 'local_0.json'),
      JSON.stringify({lastActivityAt: 7}),
    );
    assert.equal(readSessions(dir), null, 'no record names a path → unknown');
    mkdirSync(join(root, 'w', 'a'), {recursive: true});
    mkdirSync(join(root, 'w', 'b', 'sub'), {recursive: true});
    symlinkSync(join(root, 'w', 'a'), join(root, 'link-a'));
    put(
      join(dir, 'acct', 'env', 'local_1.json'),
      JSON.stringify({cwd: join(root, 'link-a'), lastActivityAt: 5}),
    );
    put(
      join(dir, 'acct', 'env', 'local_2.json'),
      JSON.stringify({
        cwd: join(root, 'w', 'b', 'sub'),
        lastActivityAt: 9,
        isArchived: true,
      }),
    );
    const s = readSessions(dir);
    assert.equal(s.length, 2, 'the record with no path is left out');
    assert.equal(
      sessionActivity(join(root, 'w', 'a'), s),
      5,
      'a session that names the tree through a symlink',
    );
    assert.equal(sessionActivity(join(root, 'w', 'b'), s), 0, 'archived');
    assert.equal(sessionActivity(join(root, 'w'), s), 5, 'inside the tree');
    put(join(dir, 'acct', 'env', 'local_3.json'), '{not json');
    assert.equal(readSessions(dir), null, 'unreadable → unknown');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('lsofBusy: fails closed when the listing is not complete', () => {
  const listing = 'p1\nfcwd\nn/a/tree\np2\nn/b/file.txt\n';
  const ok = lsofBusy(() => listing);
  assert.equal(ok('/a/tree'), true);
  assert.equal(ok('/a'), true, 'a cwd inside the path');
  assert.equal(ok('/b'), true, 'an open file inside the path');
  assert.equal(ok('/c'), false);
  const err = props => () => {
    throw Object.assign(new Error('lsof'), props);
  };
  assert.equal(
    lsofBusy(err({status: 1, stdout: listing}))('/c'),
    false,
    'exit 1 with a listing: the listing is good',
  );
  assert.equal(
    lsofBusy(err({code: 'ENOBUFS', stdout: listing}))('/c'),
    true,
    'output too big: fail closed',
  );
  assert.equal(
    lsofBusy(err({status: null, signal: 'SIGTERM', stdout: listing}))('/c'),
    true,
  );
  assert.equal(lsofBusy(err({code: 'ENOENT'}))('/c'), true, 'no lsof');
});

test('defaultPaths: the env vars first, then $HOME', () => {
  const p = defaultPaths(
    {QARIAH_RELEASES_DIR: '/r', QARIAH_SCRATCH_DIR: '/s'},
    '/h',
  );
  assert.equal(p.releasesDir, '/r');
  assert.equal(p.scratchDir, '/s');
  assert.equal(p.tasksTree, join('/h', 'claude', '.qariah-tasks'));
  assert.equal(
    p.derivedData,
    join('/h', 'Library', 'Developer', 'Xcode', 'DerivedData'),
  );
});

/** A fake home with a repository, worktrees, scratch, releases and DerivedData. */
function fakeHome() {
  const base = tmp();
  const home = join(base, 'home');
  const g = (cwd, ...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const origin = join(base, 'origin.git');
  mkdirSync(home, {recursive: true});
  g(base, 'init', '--bare', '-q', origin);
  const main = join(home, 'claude', 'qariah-v2');
  g(base, 'clone', '-q', origin, main);
  g(main, 'config', 'user.email', 't@example.com');
  g(main, 'config', 'user.name', 'T');
  put(
    join(main, '.gitignore'),
    'node_modules/\nios/Pods/\nandroid/app/build/\nandroid/build/\nios/build/\n.claude/worktrees/\n',
  );
  put(join(main, 'package.json'), '{}\n');
  put(join(main, 'ios', 'Podfile'), '# pods\n');
  put(join(main, 'android', 'app', 'build.gradle'), 'versionCode 1\n');
  put(join(main, 'src', 'a.ts'), 'export {};\n');
  g(main, 'add', '.');
  g(main, 'commit', '-q', '-m', 'init');
  g(main, 'push', '-q', 'origin', 'HEAD:main');
  put(join(main, 'node_modules', 'pkg', 'index.js'));

  const add = (path, branch, {push = true} = {}) => {
    g(main, 'worktree', 'add', '-q', '-b', branch, path);
    if (push) g(path, 'push', '-q', '-u', 'origin', `${branch}:${branch}`);
    put(join(path, 'node_modules', 'pkg', 'index.js'));
    return path;
  };
  const t = {};
  const out = join('android', 'app', 'build', 'outputs');
  // An earlier auto-sprint tree: pushed, clean. Its build folder holds an AAB, the R8
  // mapping and the native debug symbols with no copy, and an APK with a copy.
  t.autoOld = add(
    join(home, 'claude', 'qariah-v2-auto-2026-11-10'),
    'auto/2026-11-10',
  );
  put(join(t.autoOld, 'ios', 'Pods', 'Manifest.lock'));
  put(
    join(t.autoOld, out, 'bundle', 'release', 'app-release.aab'),
    'aab-11-10\n',
  );
  put(join(t.autoOld, out, 'apk', 'release', 'app-release.apk'), 'apk-11-10\n');
  put(join(t.autoOld, out, 'mapping', 'release', 'mapping.txt'), 'map-11-10\n');
  put(
    join(
      t.autoOld,
      out,
      'native-debug-symbols',
      'release',
      'native-debug-symbols.zip',
    ),
    'sym-11-10\n',
  );
  put(
    join(
      t.autoOld,
      'android',
      'app',
      'build',
      'intermediates',
      'x',
      'release',
      'y.apk',
    ),
  );
  put(join(t.autoOld, 'android', 'app', 'build.gradle'), 'versionCode 2\n'); // a version file
  // Today's auto-sprint tree.
  t.autoToday = add(
    join(home, 'claude', `qariah-v2-auto-${TODAY}`),
    `auto/${TODAY}`,
  );
  put(
    join(t.autoToday, out, 'bundle', 'release', 'app-release.aab'),
    'aab-today\n',
  );
  put(join(t.autoToday, 'ios', 'build', 'Build', 'Products', 'x.o'));
  // An earlier auto-sprint tree with a commit that is not pushed.
  t.autoUnpushed = add(
    join(home, 'claude', 'qariah-v2-auto-2026-11-09'),
    'auto/2026-11-09',
  );
  put(join(t.autoUnpushed, 'src', 'a.ts'), 'export const x = 1;\n');
  g(t.autoUnpushed, 'commit', '-q', '-am', 'local only');
  // Other worktrees.
  const wt = name => join(main, '.claude', 'worktrees', name);
  t.idle = add(wt('idle'), 'w/idle', {push: false});
  put(join(t.idle, 'src', 'notes.txt'), 'uncommitted work\n'); // kept: not in a deleted folder
  t.busy = add(wt('busy'), 'w/busy', {push: false});
  t.recent = add(wt('recent'), 'w/recent', {push: false});
  t.tracked = add(wt('tracked'), 'w/tracked', {push: false});
  g(t.tracked, 'add', '-f', 'node_modules/pkg/index.js');
  g(t.tracked, 'commit', '-q', '-m', 'a draft committed node_modules');
  t.session = add(wt('session'), 'w/session', {push: false});
  t.noPackage = add(wt('no-package'), 'w/no-package', {push: false});
  rmSync(join(t.noPackage, 'package.json'));
  t.locked = add(wt('locked'), 'w/locked', {push: false});
  g(main, 'worktree', 'lock', '--reason', 'an agent works here', t.locked);
  // A tree whose ios/ is a symlink into another idle tree.
  t.podsOwner = add(wt('pods-owner'), 'w/pods-owner', {push: false});
  put(join(t.podsOwner, 'ios', 'Pods', 'Manifest.lock'));
  t.iosLink = add(wt('ios-link'), 'w/ios-link', {push: false});
  rmSync(join(t.iosLink, 'ios'), {recursive: true, force: true});
  symlinkSync(join(t.podsOwner, 'ios'), join(t.iosLink, 'ios'));
  // An active tree whose node_modules is a symlink to an idle tree's install.
  t.nmTarget = add(wt('nm-target'), 'w/nm-target', {push: false});
  t.nmLink = add(wt('nm-link'), 'w/nm-link', {push: false});
  rmSync(join(t.nmLink, 'node_modules'), {recursive: true, force: true});
  symlinkSync(join(t.nmTarget, 'node_modules'), join(t.nmLink, 'node_modules'));
  // Scratch checkouts: not git checkouts.
  const scratch = join(home, 'claude', '.scratch');
  t.scratchOld = join(scratch, 'old-task', 'repo');
  put(join(t.scratchOld, 'package.json'), '{}\n');
  put(join(t.scratchOld, 'node_modules', 'pkg', 'index.js'));
  put(join(t.scratchOld, 'ios', 'build', 'notes-of-the-agent.txt'));
  t.scratchNew = join(scratch, 'new-task', 'repo');
  put(join(t.scratchNew, 'package.json'), '{}\n');
  put(join(t.scratchNew, 'node_modules', 'pkg', 'index.js'));
  // Releases.
  const rel = join(home, 'qariah-releases');
  t.labOld = join(rel, 'qariah-3.2.5-4500-aaaaaaa-lab.apk');
  t.labNew = join(rel, 'qariah-3.2.5-4600-bbbbbbb-lab.apk');
  put(t.labOld, 'lab-old\n');
  put(t.labNew, 'lab-new\n');
  t.storeApk = join(rel, 'qariah-3.2.5-4501-ccccccc.apk');
  put(t.storeApk, 'apk-11-10\n'); // the copy of autoOld's APK
  t.storeAab = join(rel, 'qariah-3.2.5-4501-ccccccc.aab');
  put(t.storeAab, 'store-aab\n');
  t.storeIpa = join(rel, 'qariah-3.2.5-4501-ccccccc.ipa');
  put(t.storeIpa, 'store-ipa\n');
  t.evidenceApk = join(rel, 'evidence', 'auto-2026-11-01', 'x-lab.apk');
  put(t.evidenceApk, 'evidence\n');
  // DerivedData.
  const dd = join(home, 'Library', 'Developer', 'Xcode', 'DerivedData');
  t.ddBayaanOld = join(dd, 'Bayaan-old');
  put(join(t.ddBayaanOld, 'info.plist'));
  t.ddWdaOld = join(dd, 'WebDriverAgent-old');
  put(join(t.ddWdaOld, 'info.plist'));
  t.ddWdaNew = join(dd, 'WebDriverAgent-new');
  put(join(t.ddWdaNew, 'info.plist'));
  t.ddQariah = join(dd, 'Qariah-abc');
  put(join(t.ddQariah, 'info.plist'));
  // Simulators: never a candidate.
  put(
    join(
      home,
      'Library',
      'Developer',
      'CoreSimulator',
      'Devices',
      'U1',
      'data',
      'f',
    ),
  );

  // Everything is old, then a few things are new.
  ageAll(base, OLD);
  put(join(t.recent, 'src', 'a.ts'), 'export const y = 2;\n');
  put(join(t.nmLink, 'src', 'a.ts'), 'export const z = 3;\n');
  put(join(scratch, 'new-task', 'repo', 'log.txt'), 'running\n');
  touch(t.labNew);
  put(join(t.ddWdaNew, 'Logs', 'x.log'));

  const paths = {
    ...defaultPaths({}, home),
    releasesDir: rel,
    scratchDir: scratch,
  };
  const trees = parseWorktrees(g(main, 'worktree', 'list', '--porcelain'));
  const ctx = {
    now: NOW,
    today: TODAY,
    paths,
    main,
    self: join(base, 'not-a-tree'),
    worktrees: trees.map(w => w.path),
    locked: trees.filter(w => w.locked).map(w => w.path),
    deps: {
      busy: p => p === t.busy || p.startsWith(`${t.busy}/`),
      git: (root, args) =>
        execFileSync('git', ['-C', root, '--no-optional-locks', ...args], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      sessions: () => [
        {paths: [t.session], lastActivityAt: NOW - 36e5, isArchived: false},
        {paths: [t.idle], lastActivityAt: NOW - 36e5, isArchived: true},
      ],
      xcodebuildRuns: () => false,
      du: duBytes,
      namedBuilds: () => ({numbers: new Set([4501]), from: ['test']}),
    },
  };
  return {
    base,
    home,
    main,
    t,
    ctx,
    cleanup: () => rmSync(base, {recursive: true, force: true}),
  };
}

const byPath = items =>
  new Map(items.filter(i => i.path).map(i => [i.path, i]));

test('plan: deletes only regenerable output of idle trees, keeps the rest with a reason', () => {
  const f = fakeHome();
  try {
    const {t, main} = f;
    const items = plan(f.ctx);
    const m = byPath(items);
    const action = p => m.get(p)?.action;
    const reason = p => m.get(p)?.reason || '';

    // The earlier auto-sprint tree: node_modules, Pods and the build folder go.
    assert.equal(action(join(t.autoOld, 'node_modules')), 'delete');
    assert.equal(action(join(t.autoOld, 'ios', 'Pods')), 'delete');
    const build = m.get(join(t.autoOld, 'android', 'app', 'build'));
    assert.equal(build.action, 'delete');
    // The AAB, the mapping and the symbols have no copy: they move first. The APK has a
    // copy. The intermediates are not saved.
    const to = r =>
      savedBuildPath(f.ctx.paths.releasesDir, 'qariah-v2-auto-2026-11-10', r);
    assert.deepEqual(
      build.saves.map(s => s.to).sort(),
      [
        to('android/app/build/outputs/bundle/release/app-release.aab'),
        to('android/app/build/outputs/mapping/release/mapping.txt'),
        to(
          'android/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip',
        ),
      ].sort(),
    );
    // Today's tree, an unpushed tree, the main checkout: kept.
    assert.equal(action(join(t.autoToday, 'node_modules')), 'keep');
    assert.match(reason(join(t.autoToday, 'node_modules')), /today/);
    assert.equal(action(join(t.autoUnpushed, 'node_modules')), 'keep');
    assert.match(reason(join(t.autoUnpushed, 'node_modules')), /upstream/);
    assert.equal(action(join(main, 'node_modules')), 'keep');
    assert.match(reason(join(main, 'node_modules')), /main checkout/);

    // Other worktrees.
    assert.equal(
      action(join(t.idle, 'node_modules')),
      'delete',
      'idle 10 d, archived session',
    );
    assert.equal(action(join(t.busy, 'node_modules')), 'keep');
    assert.match(reason(join(t.busy, 'node_modules')), /process/);
    assert.equal(action(join(t.recent, 'node_modules')), 'keep');
    assert.match(reason(join(t.recent, 'node_modules')), /changed .*3 d/);
    assert.equal(action(join(t.tracked, 'node_modules')), 'keep');
    assert.match(reason(join(t.tracked, 'node_modules')), /tracks/);
    assert.equal(action(join(t.session, 'node_modules')), 'keep');
    assert.match(reason(join(t.session, 'node_modules')), /session/);
    assert.equal(action(join(t.noPackage, 'node_modules')), 'keep');
    assert.match(reason(join(t.noPackage, 'node_modules')), /package\.json/);
    assert.equal(action(join(t.locked, 'node_modules')), 'keep');
    assert.match(reason(join(t.locked, 'node_modules')), /locked/);

    // Symlinks: a symlink in the path, and the target of another tree's symlink.
    assert.equal(action(join(t.iosLink, 'ios', 'Pods')), 'keep');
    assert.match(
      reason(join(t.iosLink, 'ios', 'Pods')),
      /part of its path is a symlink/,
    );
    assert.equal(action(join(t.podsOwner, 'ios', 'Pods')), 'keep');
    assert.match(
      reason(join(t.podsOwner, 'ios', 'Pods')),
      /symlink .*ios-link.* points into it/,
    );
    assert.equal(
      action(join(t.podsOwner, 'node_modules')),
      'delete',
      'its own install is idle',
    );
    assert.equal(action(join(t.nmTarget, 'node_modules')), 'keep');
    assert.match(
      reason(join(t.nmTarget, 'node_modules')),
      /symlink .*nm-link.* points into it/,
    );

    // Scratch: not a git checkout, so only node_modules.
    assert.equal(action(join(t.scratchOld, 'node_modules')), 'delete');
    assert.equal(action(join(t.scratchOld, 'ios', 'build')), 'keep');
    assert.match(
      reason(join(t.scratchOld, 'ios', 'build')),
      /not a git checkout/,
    );
    assert.equal(action(join(t.scratchNew, 'node_modules')), 'keep');
    assert.match(reason(join(t.scratchNew, 'node_modules')), /24 h/);

    // Releases: only the old lab APK. Without --releases (ctx.releases) the retention
    // rule does not run, so a store build is never a candidate; evidence never is.
    assert.equal(action(t.labOld), 'delete');
    assert.equal(action(t.labNew), 'keep');
    for (const p of [t.storeApk, t.storeAab, t.storeIpa, t.evidenceApk])
      assert.equal(m.has(p), false, `${p} is never a candidate`);

    // DerivedData: old Bayaan goes; the newest WebDriverAgent stays, an older one goes;
    // Qariah-* is not this script's.
    assert.equal(action(t.ddBayaanOld), 'delete');
    assert.equal(action(t.ddWdaOld), 'delete');
    assert.equal(action(t.ddWdaNew), 'keep');
    assert.match(reason(t.ddWdaNew), /newest WebDriverAgent/);
    assert.equal(m.has(t.ddQariah), false);

    // Never a simulator.
    assert.equal(
      items.some(i => /simctl|CoreSimulator/.test(`${i.path} ${i.reason}`)),
      false,
    );

    // Nothing outside the five folders, the lab APKs and DerivedData is a candidate.
    for (const it of items.filter(i => i.action === 'delete')) {
      const ok =
        /\/(node_modules|ios\/Pods|android\/app\/build|android\/build|ios\/build)$/.test(
          it.path,
        ) ||
        it.path.endsWith('-lab.apk') ||
        /\/DerivedData\/(Bayaan|WebDriverAgent)-/.test(it.path);
      assert.ok(ok, `unexpected delete ${it.path}`);
    }
    // A dry run names each path with its size, and a total.
    const lines = describePlan(items);
    assert.match(
      lines.join('\n'),
      /would delete .*qariah-v2-auto-2026-11-10\/node_modules \(\d+\.\d GB\)/,
    );
    assert.match(lines.join('\n'), /first, would save .*app-release\.aab/);
    assert.match(lines.at(-1), /^disk-purge: total \d+\.\d GB would be freed/);
  } finally {
    f.cleanup();
  }
});

test('plan: unknown sessions keep the other worktrees; an xcodebuild keeps DerivedData', () => {
  const f = fakeHome();
  try {
    f.ctx.deps.sessions = () => null;
    f.ctx.deps.xcodebuildRuns = () => true;
    const m = byPath(plan(f.ctx));
    assert.equal(m.get(join(f.t.idle, 'node_modules')).action, 'keep');
    assert.match(
      m.get(join(f.t.idle, 'node_modules')).reason,
      /session records/,
    );
    assert.equal(
      m.get(join(f.t.autoOld, 'node_modules')).action,
      'delete',
      'the auto rule needs no session',
    );
    assert.equal(m.get(f.t.ddBayaanOld).action, 'keep');
    assert.match(m.get(f.t.ddBayaanOld).reason, /xcodebuild/);
  } finally {
    f.cleanup();
  }
});

test('plan: the newest WebDriverAgent stays when each one is old', () => {
  const base = tmp();
  try {
    const dd = join(base, 'Library', 'Developer', 'Xcode', 'DerivedData');
    put(join(dd, 'WebDriverAgent-a', 'info.plist'));
    put(join(dd, 'WebDriverAgent-b', 'info.plist'));
    ageAll(join(dd, 'WebDriverAgent-a'), OLD - 24 * 36e5);
    ageAll(join(dd, 'WebDriverAgent-b'), OLD);
    const items = plan({
      now: NOW,
      today: TODAY,
      paths: defaultPaths({}, base),
      main: join(base, 'none'),
      self: join(base, 'none'),
      worktrees: [],
      deps: {
        busy: () => false,
        git: () => '',
        sessions: () => [],
        xcodebuildRuns: () => false,
        du: duBytes,
      },
    });
    const m = byPath(items);
    assert.equal(m.get(join(dd, 'WebDriverAgent-b')).action, 'keep');
    assert.equal(m.get(join(dd, 'WebDriverAgent-a')).action, 'delete');
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
});

test('apply: deletes the plan, saves the files first, checks busy again before each delete', () => {
  const f = fakeHome();
  try {
    const {t} = f;
    const items = plan(f.ctx);
    const log = [];
    const busyNow = p => p === join(t.scratchOld, 'node_modules'); // started after the plan
    const freed = apply(items, {log: l => log.push(l), busy: busyNow});
    assert.ok(freed > 0);
    assert.equal(existsSync(join(t.autoOld, 'node_modules')), false);
    assert.equal(existsSync(join(t.autoOld, 'android', 'app', 'build')), false);
    assert.equal(existsSync(join(t.idle, 'node_modules')), false);
    assert.equal(existsSync(t.labOld), false);
    assert.equal(existsSync(t.ddBayaanOld), false);
    assert.equal(
      existsSync(join(t.scratchOld, 'node_modules')),
      true,
      'busy again → kept',
    );
    assert.ok(
      log.some(l => /kept .*old-task.* open in it now/.test(l)),
      log.join('\n'),
    );
    // The work stays: the version-file change, the uncommitted note, the branch.
    assert.match(
      readFileSync(join(t.autoOld, 'android', 'app', 'build.gradle'), 'utf8'),
      /versionCode 2/,
    );
    assert.equal(existsSync(join(t.idle, 'src', 'notes.txt')), true);
    assert.equal(existsSync(join(t.idle, 'package.json')), true);
    // The AAB, the mapping and the symbols moved to saved-builds.
    const saved = r =>
      savedBuildPath(f.ctx.paths.releasesDir, 'qariah-v2-auto-2026-11-10', r);
    assert.equal(
      readFileSync(
        saved('android/app/build/outputs/bundle/release/app-release.aab'),
        'utf8',
      ),
      'aab-11-10\n',
    );
    assert.equal(
      readFileSync(
        saved('android/app/build/outputs/mapping/release/mapping.txt'),
        'utf8',
      ),
      'map-11-10\n',
    );
    assert.equal(
      readFileSync(
        saved(
          'android/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip',
        ),
        'utf8',
      ),
      'sym-11-10\n',
    );
    // The store builds of the releases folder, and the kept trees, stay whole.
    for (const p of [
      t.storeApk,
      t.storeAab,
      t.storeIpa,
      t.evidenceApk,
      t.labNew,
      join(t.busy, 'node_modules'),
      join(t.recent, 'node_modules'),
      join(t.tracked, 'node_modules'),
      join(t.session, 'node_modules'),
      join(t.locked, 'node_modules'),
      join(t.nmTarget, 'node_modules', 'pkg', 'index.js'),
      join(t.podsOwner, 'ios', 'Pods', 'Manifest.lock'),
      join(t.scratchOld, 'ios', 'build', 'notes-of-the-agent.txt'),
      join(t.scratchNew, 'node_modules'),
      join(t.autoToday, 'node_modules'),
      join(f.main, 'node_modules'),
      t.ddWdaNew,
      t.ddQariah,
      join(f.home, 'Library', 'Developer', 'CoreSimulator', 'Devices', 'U1'),
    ])
      assert.equal(existsSync(p), true, p);
  } finally {
    f.cleanup();
  }
});

test('own build output (run-end.sh): only android/app/build and ios/build of that tree', () => {
  const f = fakeHome();
  try {
    const {t} = f;
    const items = plan({...f.ctx, own: t.autoToday});
    assert.deepEqual(
      items.map(i => [i.path, i.action]),
      [
        [join(t.autoToday, 'android', 'app', 'build'), 'delete'],
        [join(t.autoToday, 'ios', 'build'), 'delete'],
      ],
    );
    assert.equal(items[0].saves.length, 1, 'the AAB moves first');
    apply(items, {log: () => undefined});
    assert.equal(
      existsSync(join(t.autoToday, 'android', 'app', 'build')),
      false,
    );
    assert.equal(
      existsSync(join(t.autoToday, 'node_modules')),
      true,
      'node_modules stays',
    );
    // Never the main checkout, a path that is not a worktree, or a locked tree.
    assert.equal(plan({...f.ctx, own: f.main})[0].action, 'keep');
    assert.equal(
      plan({...f.ctx, own: join(f.base, 'elsewhere')})[0].action,
      'keep',
    );
    assert.match(plan({...f.ctx, own: t.locked})[0].reason, /locked/);
  } finally {
    f.cleanup();
  }
});

test('the command line refuses an unknown argument', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--purge-everything'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

// --- the retention rule for ~/qariah-releases -------------------------------------------

test('releaseBuildNumber and releaseFileKind: the names that the build scripts write', () => {
  const cases = {
    'qariah-3.2.3-3763-cfaa0c8e6.aab': 3763,
    'qariah-3.2.5-4419-7a8645985-public-beta.ipa': 4419,
    'qariah-3.2.4-3774-14851787a.ipa': 3774,
    '3.2.1-2027-anr-hotfix-v2/qariah-3.2.1-2027-b5b032f9-hotfix-v2-arm64.apk': 2027,
    'auto-2026-11-14-android/qariah-4571-auto-2026-11-14-android.apk': null,
    'qariah-3.2.5-9999-debug.apk': null,
    'qariah-9999.apk': null,
    'qariah-unknown-4600-nogit.apk': 4600,
    'saved-builds/qariah-v2-auto-2026-11-10/4401/android-app-build-outputs-bundle-release-app-release.aab': 4401,
    'saved-builds/qariah-v2-auto-2026-11-10/android-app-build-outputs-bundle-release-app-release.aab':
      null,
    'qariah-unknown-0-nogit.apk': null,
    'shortcuts-850/notes.txt': null,
  };
  for (const [rel, want] of Object.entries(cases))
    assert.equal(releaseBuildNumber(rel), want, rel);
  const kind = rel => {
    const k = releaseFileKind(rel);
    return k ? `${k.platform}/${k.kind}` : null;
  };
  assert.equal(kind('qariah-3.2.3-3763-cfaa0c8e6.aab'), 'android/build');
  assert.equal(kind('x/qariah-3.2.3-3763-cfaa0c8e6.apk'), 'android/build');
  assert.equal(kind('qariah-3.2.5-4419-7a8645985.ipa'), 'ios/build');
  assert.equal(
    kind(
      'saved-builds/t/4401/android-app-build-outputs-bundle-release-app-release.aab.2',
    ),
    'android/build',
    'a second saved copy',
  );
  assert.equal(
    kind(
      'saved-builds/t/4401/android-app-build-outputs-mapping-release-mapping.txt',
    ),
    'android/symbols',
  );
  assert.equal(
    kind(
      'saved-builds/t/4401/android-app-build-outputs-native-debug-symbols-release-native-debug-symbols.zip',
    ),
    'android/symbols',
  );
  assert.equal(
    kind('saved-builds/qariah-v2-mapping-fix/4401/x-app-release.aab'),
    'android/build',
    'a tree name with "mapping" in it',
  );
  assert.equal(kind('qariah-3.2.5-4500-aaaaaaa-lab.apk'), null, 'the lab rule');
  assert.equal(kind('bootgate-4570/launch.png'), null);
  assert.equal(kind('3.2.1-2027-anr-hotfix-v2/SHA256SUMS'), null);
});

test('namedBuildNumbers and readRolloutRecords: every number of each copy that parses', () => {
  const nums = namedBuildNumbers([
    '{"build": 3763, "buildsToWatch": ["4419"], "note": "3775 NOT SHIPPED; edit 06248358679598113796"}',
  ]);
  for (const n of [3763, 4419, 3775]) assert.ok(nums.has(n), String(n));
  assert.equal(nums.has(4487), false);
  assert.equal(
    nums.has(6248),
    false,
    'a part of a longer number is not a number',
  );

  const files = {
    '/self/docs/operations/active-rollout.json': '{"build": 4100}',
    '/main/docs/operations/active-rollout.json': '{"build": 4200',
  };
  const r = readRolloutRecords({
    mainTree: '/main',
    self: '/self',
    gitShow: () => '{"build": 4300}',
    readFile: p => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
  });
  assert.deepEqual(r.from, ['origin/qariah-main', 'this tree']);
  assert.ok(r.numbers.has(4100) && r.numbers.has(4300));
  assert.equal(r.numbers.has(4200), false, 'a cut copy does not count');
  assert.equal(
    readRolloutRecords({
      mainTree: '/main',
      self: '/self',
      gitShow: () => {
        throw new Error('no origin/qariah-main');
      },
      readFile: () => {
        throw new Error('ENOENT');
      },
    }),
    null,
    'no copy → null (each file stays)',
  );
});

test('buildNumberOfOutput: the versionCode of the build folder, null when two sources disagree', () => {
  const root = tmp();
  try {
    const out = join(root, 'android', 'app', 'build');
    assert.equal(buildNumberOfOutput(root, 'android/app/build'), null);
    put(
      join(out, 'outputs', 'apk', 'release', 'output-metadata.json'),
      JSON.stringify({elements: [{versionCode: 4401, versionName: '3.2.5'}]}),
    );
    assert.equal(buildNumberOfOutput(root, 'android/app/build'), 4401);
    const manifest = join(
      out,
      'intermediates',
      'merged_manifest',
      'release',
      'processReleaseMainManifest',
      'AndroidManifest.xml',
    );
    put(
      manifest,
      '<manifest android:versionCode="4401" android:versionName="3.2.5">',
    );
    assert.equal(buildNumberOfOutput(root, 'android/app/build'), 4401);
    put(manifest, '<manifest android:versionCode="4402">');
    assert.equal(
      buildNumberOfOutput(root, 'android/app/build'),
      null,
      'disagree → unknown',
    );
    put(
      join(root, 'ios', 'build', 'Qariah-beta.xcarchive', 'Info.plist'),
      '<dict><key>ApplicationProperties</key><dict><key>CFBundleVersion</key>\n<string>4403</string></dict></dict>',
    );
    assert.equal(buildNumberOfOutput(root, 'ios/build'), 4403);
    assert.equal(
      savedBuildPath('/r', 'tree', 'android/app/build/outputs/x.aab', 4401),
      join(
        '/r',
        'saved-builds',
        'tree',
        '4401',
        'android-app-build-outputs-x.aab',
      ),
    );
    assert.equal(
      savedBuildPath('/r', 'tree', 'android/app/build/outputs/x.aab'),
      join('/r', 'saved-builds', 'tree', 'android-app-build-outputs-x.aab'),
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

/** A fake ~/qariah-releases. Each file is 30 d old unless the test says otherwise. */
function fakeReleases() {
  const base = tmp();
  const rel = join(base, 'qariah-releases');
  const OLD30 = NOW - 30 * 24 * 36e5;
  const r = {};
  const file = (key, path, ms = OLD30) => {
    r[key] = join(rel, path);
    put(r[key], `${key}\n`);
    utimesSync(r[key], ms / 1000, ms / 1000);
  };
  const saved = 'saved-builds';
  const aab = 'android-app-build-outputs-bundle-release-app-release.aab';
  const map = 'android-app-build-outputs-mapping-release-mapping.txt';
  const sym =
    'android-app-build-outputs-native-debug-symbols-release-native-debug-symbols.zip';
  file('named', 'qariah-3.2.3-3763-aaaaaaa.aab');
  file('unnamed', 'qariah-3.2.5-4487-bbbbbbb.apk');
  file('unnamedOld', 'qariah-3.2.5-4615-ccccccc.apk', NOW - 20 * 24 * 36e5);
  file('recent', 'qariah-3.2.5-4700-ddddddd.apk', NOW - 5 * 24 * 36e5);
  file('ipaNamed', 'qariah-3.2.4-3774-eeeeeee.ipa');
  file('ipaNewest', 'qariah-3.2.4-3775-fffffff.ipa');
  file('ipaOld', 'qariah-3.2.3-3700-1a1a1a1.ipa');
  file('noNumber', 'qariah-unknown-0-nogit.apk');
  file('busy', 'qariah-3.2.5-4488-2b2b2b2.apk');
  file('lab', 'qariah-3.2.5-4500-3c3c3c3-lab.apk');
  file('autoFolder', 'auto-2026-10-14-android/qariah-3.2.5-4571-7b7b7b7.apk');
  // Names that no archive script writes: no build number, so they stay.
  file('handNamed', 'qariah-4572-auto-2026-10-14-android.apk');
  file('debug', 'qariah-3.2.5-9999-debug.apk');
  file('notBuild', 'bootgate-4570/launch.png');
  file('audit', 'audits/4593/qariah-3.2.5-4593-4d4d4d4.apk');
  file('evidence', 'evidence/auto-2026-10-01/qariah-3.2.5-4400-5e5e5e5.aab');
  file('savedAab', `${saved}/qariah-v2-auto-2026-10-10/4400/${aab}`);
  file('savedMap', `${saved}/qariah-v2-auto-2026-10-10/4400/${map}`);
  file('savedSym', `${saved}/qariah-v2-auto-2026-10-10/4400/${sym}`);
  file('savedNamedMap', `${saved}/qariah-v2-auto-2026-10-11/3763/${map}`);
  file('keptBuild', 'qariah-3.2.5-4420-6f6f6f6.aab', NOW - 3 * 24 * 36e5);
  file('keptBuildSym', `${saved}/qariah-v2-auto-2026-10-12/4420/${sym}`);
  file('legacy', `${saved}/qariah-v2-auto-2026-10-13/${aab}`);
  // Everything (the folders too) is 30 d old. Then a folder that a run made today.
  ageAll(base, OLD30);
  for (const k of Object.keys(r)) utimesSync(r[k], OLD30 / 1000, OLD30 / 1000);
  utimesSync(
    r.unnamedOld,
    (NOW - 20 * 24 * 36e5) / 1000,
    (NOW - 20 * 24 * 36e5) / 1000,
  );
  utimesSync(
    r.recent,
    (NOW - 5 * 24 * 36e5) / 1000,
    (NOW - 5 * 24 * 36e5) / 1000,
  );
  utimesSync(
    r.keptBuild,
    (NOW - 3 * 24 * 36e5) / 1000,
    (NOW - 3 * 24 * 36e5) / 1000,
  );
  r.todayFolder = join(rel, 'auto-today-android');
  r.today = join(r.todayFolder, 'qariah-3.2.5-4300-7a7a7a7.aab');
  put(r.today, 'today\n');
  utimesSync(r.today, OLD30 / 1000, OLD30 / 1000);
  symlinkSync(r.unnamed, join(rel, 'qariah-3.2.5-4489-8b8b8b8.apk'));
  return {
    base,
    rel,
    r,
    ctx: {
      now: NOW,
      today: laDate(Date.now()),
      releasesDir: rel,
      named: {numbers: new Set([3763, 3774, 2026, 11]), from: ['test']},
      busy: p => p === r.busy,
    },
    cleanup: () => rmSync(base, {recursive: true, force: true}),
  };
}

test('releasesPlan: keeps the recent, the named, the newest and their symbols; deletes the rest', () => {
  const f = fakeReleases();
  try {
    const {r} = f;
    const items = releasesPlan(f.ctx);
    const m = byPath(items);
    const action = p => m.get(p)?.action;
    const reason = p => m.get(p)?.reason || '';
    // Deleted: old, not named, not the newest.
    for (const k of [
      'unnamed',
      'unnamedOld',
      'ipaOld',
      'autoFolder',
      'savedAab',
    ])
      assert.equal(action(r[k]), 'delete', k);
    assert.match(
      reason(r.unnamed),
      /build 4487 \(android\) from 30 d ago: not named/,
    );
    // The symbols of a build that goes, go too.
    assert.equal(action(r.savedMap), 'delete');
    assert.equal(action(r.savedSym), 'delete');
    assert.match(reason(r.savedSym), /no build of it stays/);
    // Kept, each with its reason.
    assert.match(
      reason(r.named),
      /build 3763 is named in docs\/operations\/active-rollout\.json/,
    );
    assert.match(reason(r.ipaNamed), /build 3774 is named/);
    assert.match(reason(r.ipaNewest), /the newest ios build \(3775\)/);
    assert.match(reason(r.recent), /from 5 d ago; the rule keeps 14 d/);
    assert.match(reason(r.noNumber), /no build number/);
    assert.match(reason(r.handNamed), /no build number/);
    assert.match(reason(r.debug), /no build number/);
    assert.match(reason(r.legacy), /no build number/);
    assert.match(reason(r.busy), /a process has the file open/);
    assert.match(reason(r.savedNamedMap), /build 3763 is named/);
    assert.match(
      reason(r.keptBuildSym),
      /the mapping or the symbols of build 4420, which stays/,
    );
    for (const k of [
      'named',
      'ipaNamed',
      'ipaNewest',
      'recent',
      'noNumber',
      'legacy',
      'busy',
      'savedNamedMap',
      'keptBuild',
      'keptBuildSym',
      'handNamed',
      'debug',
    ])
      assert.equal(action(r[k]), 'keep', k);
    // The newest Android build is 4700 (recent), so 4615 is not "the newest".
    assert.match(reason(r.unnamedOld), /not the newest android build/);
    // Never looked into: audits/, evidence/, a folder made today, a symlink, a lab APK, a
    // file that is not a build.
    assert.equal(action(join(f.rel, 'audits')), 'keep');
    assert.equal(action(join(f.rel, 'evidence')), 'keep');
    assert.equal(action(r.todayFolder), 'keep');
    assert.match(reason(r.todayFolder), /made this folder today/);
    for (const k of ['audit', 'evidence', 'today', 'lab', 'notBuild'])
      assert.equal(m.has(r[k]), false, k);
    assert.equal(
      m.has(join(f.rel, 'qariah-3.2.5-4489-8b8b8b8.apk')),
      false,
      'symlink',
    );
    // Each keep and each delete has a size; one note gives the totals.
    for (const it of items.filter(
      i => i.action !== 'note' && i.bytes !== undefined,
    ))
      assert.ok(it.bytes > 0, it.path);
    const lines = describePlan(items).join('\n');
    assert.match(
      lines,
      /would delete .*qariah-3\.2\.5-4487-bbbbbbb\.apk \(0\.0 GB\): build 4487/,
    );
    assert.match(
      lines,
      /kept .*qariah-3\.2\.3-3763-aaaaaaa\.aab \(0\.0 GB\): build 3763 is named/,
    );
    assert.match(
      lines,
      /retention in .*: 19 build and symbol files; keep .* GB, delete .* GB; the record: docs\/operations\/active-rollout\.json at test/,
    );

    // apply deletes only those files; the folders and the other files stay.
    apply(items, {log: () => undefined});
    for (const k of [
      'unnamed',
      'unnamedOld',
      'ipaOld',
      'autoFolder',
      'savedAab',
      'savedMap',
      'savedSym',
    ])
      assert.equal(existsSync(r[k]), false, k);
    for (const k of [
      'named',
      'ipaNamed',
      'ipaNewest',
      'recent',
      'noNumber',
      'legacy',
      'busy',
      'savedNamedMap',
      'keptBuild',
      'keptBuildSym',
      'audit',
      'evidence',
      'today',
      'lab',
      'notBuild',
      'handNamed',
      'debug',
    ])
      assert.equal(existsSync(r[k]), true, k);
    assert.equal(
      existsSync(join(f.rel, 'auto-2026-10-14-android')),
      true,
      'the folder stays',
    );
  } finally {
    f.cleanup();
  }
});

test('releasesPlan: with no readable record, each file stays (fail closed)', () => {
  const f = fakeReleases();
  try {
    const items = releasesPlan({...f.ctx, named: null});
    assert.equal(items.filter(i => i.action === 'delete').length, 0);
    assert.match(
      byPath(items).get(f.r.unnamed).reason,
      /no copy of docs\/operations\/active-rollout\.json can be read/,
    );
    assert.match(items.at(-1).reason, /not readable, so each file stays/);
  } finally {
    f.cleanup();
  }
});

test(`plan: the retention rule runs with the other rules; a saved build goes into its <build> folder (${RETENTION_DAYS} d)`, () => {
  const f = fakeHome();
  try {
    const {t} = f;
    const out = join(t.autoOld, 'android', 'app', 'build', 'outputs');
    put(
      join(out, 'apk', 'release', 'output-metadata.json'),
      JSON.stringify({elements: [{versionCode: 4401}]}),
    );
    const old = join(f.ctx.paths.releasesDir, 'qariah-3.2.5-4400-9c9c9c9.apk');
    put(old, 'old\n');
    const ms = NOW - 30 * 24 * 36e5;
    utimesSync(old, ms / 1000, ms / 1000);
    // Without --releases the retention rule does not run.
    assert.equal(byPath(plan(f.ctx)).has(old), false, 'no --releases');
    f.ctx.releases = true;
    const items = plan(f.ctx);
    const m = byPath(items);
    assert.equal(m.get(old).action, 'delete');
    assert.equal(m.get(t.storeAab).action, 'keep');
    const build = m.get(join(t.autoOld, 'android', 'app', 'build'));
    const to = r =>
      savedBuildPath(
        f.ctx.paths.releasesDir,
        'qariah-v2-auto-2026-11-10',
        r,
        4401,
      );
    assert.ok(
      build.saves.some(
        s =>
          s.to ===
          to('android/app/build/outputs/bundle/release/app-release.aab'),
      ),
      build.saves.map(s => s.to).join('\n'),
    );
    // Without the record the store build stays.
    f.ctx.deps.namedBuilds = () => null;
    assert.equal(byPath(plan(f.ctx)).get(old).action, 'keep');
    // --own-build-output (run-end.sh) never runs the retention rule, with releases: true too.
    assert.equal(
      plan({...f.ctx, own: t.autoToday}).some(i => i.path === old),
      false,
    );
    f.ctx.deps.namedBuilds = () => ({numbers: new Set(), from: ['test']});
    apply(plan(f.ctx), {log: () => undefined});
    assert.equal(existsSync(old), false);
    assert.equal(
      readFileSync(
        to('android/app/build/outputs/bundle/release/app-release.aab'),
        'utf8',
      ),
      'aab-11-10\n',
    );
    for (const p of [t.storeApk, t.storeAab, t.storeIpa, t.evidenceApk])
      assert.equal(existsSync(p), true, p);
  } finally {
    f.cleanup();
  }
});

test('releasesPlan: a debug APK with a higher number does not take the place of the newest store build', () => {
  const base = tmp();
  try {
    const rel = join(base, 'qariah-releases');
    const OLD30 = NOW - 30 * 24 * 36e5;
    const files = {
      store: join(rel, 'qariah-3.2.5-4800-abcdef1.apk'),
      older: join(rel, 'qariah-3.2.5-4790-abcdef2.apk'),
      debug: join(rel, 'qariah-3.2.5-9999-debug.apk'),
      bare: join(rel, 'qariah-9998-debug.apk'),
    };
    for (const p of Object.values(files)) put(p, 'apk\n');
    ageAll(base, OLD30);
    const m = byPath(
      releasesPlan({
        now: NOW,
        today: laDate(Date.now()),
        releasesDir: rel,
        named: {numbers: new Set(), from: ['test']},
        busy: () => false,
      }),
    );
    assert.equal(m.get(files.store).action, 'keep');
    assert.match(
      m.get(files.store).reason,
      /the newest android build \(4800\)/,
    );
    assert.equal(m.get(files.older).action, 'delete');
    for (const p of [files.debug, files.bare]) {
      assert.equal(m.get(p).action, 'keep', p);
      assert.match(m.get(p).reason, /no build number/);
    }
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
});

test('the command line: an --own-build-output run (run-end.sh) deletes no release file', () => {
  const base = tmp();
  try {
    const rel = join(base, 'qariah-releases');
    const old = join(rel, 'qariah-3.2.5-4400-abcdef3.apk');
    put(old, 'old\n');
    const ms = NOW - 60 * 24 * 36e5;
    utimesSync(old, ms / 1000, ms / 1000);
    const env = {
      ...process.env,
      HOME: join(base, 'home'),
      QARIAH_RELEASES_DIR: rel,
      QARIAH_SCRATCH_DIR: join(base, 'scratch'),
      QARIAH_TASKS_TREE: join(base, 'tasks'),
    };
    // A path that is not a worktree: the own rule keeps it, and nothing else runs.
    const r = spawnSync(
      process.execPath,
      [SCRIPT, `--own-build-output=${join(base, 'not-a-tree')}`],
      {encoding: 'utf8', env},
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(old), true);
    assert.doesNotMatch(r.stdout, /disk-purge: deleted|qariah-releases/);
    assert.match(r.stdout, /disk-purge: total 0\.0 GB deleted/);
    // --releases with --own-build-output is a usage error: the end of a run never
    // deletes a store build.
    const both = spawnSync(
      process.execPath,
      [SCRIPT, `--own-build-output=${join(base, 'x')}`, '--releases'],
      {encoding: 'utf8', env},
    );
    assert.equal(both.status, 2);
    assert.match(both.stderr, /usage/);
    assert.equal(existsSync(old), true);
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
});

test('only disk-floor.sh passes --releases (below the floor); run-end.sh never does', () => {
  const read = name =>
    readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');
  const floor = read('disk-floor.sh');
  const calls = floor.split('\n').filter(l => /disk-purge\.mjs"/.test(l));
  assert.deepEqual(
    calls.map(l => l.trim()),
    ['(cd "$tree" && node "$tree/scripts/disk-purge.mjs" --releases)'],
  );
  // The call sits in the block that runs only when free disk is below the build floor.
  const before = floor.slice(0, floor.indexOf(calls[0]));
  assert.match(
    before.slice(before.lastIndexOf('if [')),
    /^if \[ "\$gb" -lt "\$floor_gb" \] && \[ "\$kind" = build \]; then/,
  );
  assert.equal(/--releases/.test(read('run-end.sh')), false);
});
