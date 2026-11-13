#!/usr/bin/env node
// @ai
//
// scripts/__tests__/prune-held-trees.test.mjs
// -------------------------------------------
// scripts/prune-held-trees.mjs removes the tree of a held auto-sprint (or a dead audit)
// only when nothing in it can be lost. On 2026-11-10 and 11-11 a held sprint's 17 GB tree
// made each later run fail the 28 GB disk floor.
//
// Run:  node --test scripts/__tests__/prune-held-trees.test.mjs
//
// The end-to-end test uses temporary git repos (an origin, a main clone, sibling
// worktrees). No test touches a real checkout.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  heldTreeKind,
  judgeTree,
  laDate,
  unsafeStatusLines,
} from '../prune-held-trees.mjs';

const SCRIPT = fileURLToPath(
  new URL('../prune-held-trees.mjs', import.meta.url),
);

test('heldTreeKind: an earlier day sprint tree and an old audit tree only', () => {
  const today = '2026-11-11';
  assert.equal(
    heldTreeKind('qariah-v2-auto-2026-11-10', {today, ageHours: 0}).kind,
    'auto',
  );
  assert.equal(
    heldTreeKind('qariah-v2-auto-2026-11-11', {today, ageHours: 99}),
    null,
    "today's run",
  );
  assert.equal(
    heldTreeKind('qariah-v2-audit-093646df', {today, ageHours: 13}).kind,
    'audit',
  );
  assert.equal(
    heldTreeKind('qariah-v2-audit-093646df', {today, ageHours: 2}),
    null,
    'a running audit',
  );
  assert.equal(
    heldTreeKind('qariah-v2-promote-x', {today, ageHours: 99}),
    null,
  );
  assert.equal(
    heldTreeKind('angry-sanderson-965b17', {today, ageHours: 99}),
    null,
    'a session tree',
  );
});

test('unsafeStatusLines: only the version files are safe', () => {
  const safe = [
    ' M android/app/build.gradle',
    ' M ios/Podfile.lock',
    ' M ios/Qariah.xcodeproj/project.pbxproj',
    ' M ios/Qariah/Info.plist',
    ' M ios/QariahWidgets/Info.plist',
  ].join('\n');
  assert.deepEqual(unsafeStatusLines(safe), []);
  assert.deepEqual(unsafeStatusLines(`${safe}\n M app/_layout.tsx`), [
    ' M app/_layout.tsx',
  ]);
  assert.deepEqual(unsafeStatusLines('?? notes.txt'), ['?? notes.txt']);
  assert.deepEqual(unsafeStatusLines(''), []);
});

test('judgeTree: keeps a tree with a process, unpushed commits or other changes', () => {
  const today = '2026-11-11';
  const base = {ageHours: () => 30, processInside: () => false};
  const git = (unpushed, status) => args =>
    args[0] === 'rev-list' ? `${unpushed}\n` : status;
  const path = '/x/qariah-v2-auto-2026-11-10';
  assert.equal(
    judgeTree(path, {
      today,
      deps: {...base, git: git(0, ' M ios/Podfile.lock\n')},
    }).remove,
    true,
  );
  assert.match(
    judgeTree(path, {
      today,
      deps: {...base, processInside: () => true, git: git(0, '')},
    }).reason,
    /a process runs in it/,
  );
  assert.match(
    judgeTree(path, {today, deps: {...base, git: git(2, '')}}).reason,
    /2 commit\(s\) are not pushed/,
  );
  assert.match(
    judgeTree(path, {today, deps: {...base, git: git(0, ' M app/x.tsx\n')}})
      .reason,
    /outside the version files/,
  );
  assert.equal(
    judgeTree('/x/other-tree', {today, deps: {...base, git: git(0, '')}}),
    null,
  );
});

test('laDate is the date in Los Angeles', () => {
  assert.equal(laDate(Date.parse('2026-11-12T04:05:00Z')), '2026-11-11');
  assert.equal(laDate(Date.parse('2026-11-12T09:00:00Z')), '2026-11-12');
});

test('end to end: removes the safe held tree, keeps the unsafe ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'prune-held-trees-'));
  const g = (cwd, ...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    const origin = join(root, 'origin.git');
    g(root, 'init', '--bare', '-q', origin);
    const main = join(root, 'qariah-v2');
    g(root, 'clone', '-q', origin, main);
    g(main, 'config', 'user.email', 't@example.com');
    g(main, 'config', 'user.name', 'T');
    mkdirSync(join(main, 'android', 'app'), {recursive: true});
    writeFileSync(
      join(main, 'android', 'app', 'build.gradle'),
      'versionCode 1\n',
    );
    writeFileSync(join(main, 'README.md'), 'x\n');
    g(main, 'add', '.');
    g(main, 'commit', '-q', '-m', 'init');
    g(main, 'push', '-q', 'origin', 'HEAD:main');

    const add = (name, branch) => {
      const path = join(root, name);
      g(main, 'worktree', 'add', '-q', '-b', branch, path);
      g(path, 'push', '-q', 'origin', `${branch}:${branch}`);
      return path;
    };
    // Safe: pushed, only the version file changed.
    const safe = add('qariah-v2-auto-2026-01-01', 'auto/2026-01-01');
    writeFileSync(
      join(safe, 'android', 'app', 'build.gradle'),
      'versionCode 2\n',
    );
    // Unsafe: a commit that is not pushed.
    const unpushed = add('qariah-v2-auto-2026-01-02', 'auto/2026-01-02');
    writeFileSync(join(unpushed, 'README.md'), 'y\n');
    g(unpushed, 'commit', '-q', '-am', 'local only');
    // Unsafe: an untracked file.
    const untracked = add('qariah-v2-auto-2026-01-03', 'auto/2026-01-03');
    writeFileSync(join(untracked, 'notes.txt'), 'keep me\n');

    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: main,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(safe), false, r.stdout);
    assert.match(r.stdout, /removed .*qariah-v2-auto-2026-01-01/);
    assert.equal(existsSync(unpushed), true);
    assert.match(r.stdout, /kept .*qariah-v2-auto-2026-01-02: .*not pushed/);
    assert.equal(existsSync(untracked), true);
    assert.match(
      r.stdout,
      /kept .*qariah-v2-auto-2026-01-03: .*outside the version files/,
    );
    // The branch of the removed tree is still on the origin.
    assert.match(
      g(main, 'ls-remote', 'origin', 'auto/2026-01-01'),
      /refs\/heads\/auto\/2026-01-01/,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
