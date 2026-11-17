#!/usr/bin/env node
// @ai
//
// scripts/__tests__/task-sync.test.mjs
// ------------------------------------
// scripts/link-scheduled-tasks.sh --run-start moves the task tree to origin/qariah-main and
// syncs the live scheduled-task files at the start of each Mac run (scripts/run-start.sh).
// scripts/run-end.sh puts the result in the run-health line (`tasks=`). From 2026-11-06 to
// 2026-11-15 all five live copies were stale, because --check found the drift and nothing
// repaired it.
//
// Run:  node --test scripts/__tests__/task-sync.test.mjs
//
// Each test makes a fake home in a new temporary folder (mkdtemp under os.tmpdir(), which
// is $TMPDIR, else /tmp: the Node form of `mktemp -d`). The fake home holds a git origin,
// a main checkout, the detached task tree and the live task folder. The scripts find them
// through $HOME, so no test reads or changes the real task tree or the real live folder.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));
const LINK = join(SCRIPTS, 'link-scheduled-tasks.sh');
const RUN_END = join(SCRIPTS, 'run-end.sh');
const TASKS = [
  'qariah-daily-triage-fix-loop',
  'qariah-daily-auto-sprint',
  'qariah-biweekly-hygiene-sweep',
  'qariah-release-auditor',
  'qariah-promoter',
];
const REL = '.claude/scheduled-tasks';

function put(path, text) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, text);
}

const git = (cwd, ...args) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=T',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']},
  ).trim();

const skill = (task, v) =>
  `---\nname: ${task}\ndescription: ${v}\n---\n\nThe prompt of ${task}, ${v}.\n`;

/**
 * A fake home: an origin with the five task files on qariah-main, a main checkout, the
 * detached task tree at $HOME/claude/.qariah-tasks, and the live folder at
 * $HOME/.claude/scheduled-tasks. The live folder has v1 of four tasks (the auditor file is
 * a symlink, the hygiene sweep is not installed). Then origin moves to v2 of two tasks.
 */
function fakeHome() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'task-sync-')));
  const home = join(base, 'home');
  const origin = join(base, 'origin.git');
  const seed = join(base, 'seed');
  mkdirSync(home, {recursive: true});
  git(base, 'init', '-q', '--bare', '-b', 'qariah-main', origin);
  git(base, 'init', '-q', '-b', 'qariah-main', seed);
  for (const t of TASKS) put(join(seed, REL, t, 'SKILL.md'), skill(t, 'v1'));
  put(join(seed, 'README.md'), 'repo\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'v1');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'qariah-main');
  const main = join(home, 'claude', 'qariah-v2');
  git(base, 'clone', '-q', '-b', 'qariah-main', origin, main);
  const tree = join(home, 'claude', '.qariah-tasks');
  git(main, 'worktree', 'add', '-q', '--detach', tree, 'origin/qariah-main');
  const live = join(home, '.claude', 'scheduled-tasks');
  for (const t of [
    'qariah-daily-triage-fix-loop',
    'qariah-daily-auto-sprint',
    'qariah-promoter',
  ])
    put(join(live, t, 'SKILL.md'), skill(t, 'v1'));
  // The auditor's live file is a symlink: the app cannot read a task through one.
  put(
    join(base, 'elsewhere', 'SKILL.md'),
    skill('qariah-release-auditor', 'v1'),
  );
  mkdirSync(join(live, 'qariah-release-auditor'), {recursive: true});
  symlinkSync(
    join(base, 'elsewhere', 'SKILL.md'),
    join(live, 'qariah-release-auditor', 'SKILL.md'),
  );
  // Another project's task: never touched.
  put(join(live, 'daily-claude-backup', 'SKILL.md'), 'not ours\n');
  // Origin moves on: v2 of the triage loop and the auto-sprint.
  push(seed, {
    'qariah-daily-triage-fix-loop': 'v2',
    'qariah-daily-auto-sprint': 'v2',
  });
  const env = {...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1'};
  for (const k of [
    'QARIAH_TASKS_TREE',
    'QARIAH_LIVE_TASKS_DIR',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_CODE_REMOTE',
    'QARIAH_RUN_STATE_DIR',
  ])
    delete env[k];
  return {
    base,
    home,
    origin,
    seed,
    main,
    tree,
    live,
    env,
    state: join(base, 'state'),
    cleanup: () => rmSync(base, {recursive: true, force: true}),
  };
}

/** Commit new versions of some task files in the seed clone and push them to origin. */
function push(seed, versions) {
  for (const [t, v] of Object.entries(versions))
    put(join(seed, REL, t, 'SKILL.md'), skill(t, v));
  git(seed, 'commit', '-q', '-am', JSON.stringify(versions));
  git(seed, 'push', '-q', 'origin', 'qariah-main');
  return git(seed, 'rev-parse', 'HEAD');
}

const liveText = (f, t) => readFileSync(join(f.live, t, 'SKILL.md'), 'utf8');

function runSync(f, task = 'drafts', extraEnv = {}) {
  const r = spawnSync(
    'bash',
    [
      LINK,
      '--run-start',
      task,
      `--state-file=${join(f.state, `task-sync.${task}.txt`)}`,
    ],
    {encoding: 'utf8', env: {...f.env, ...extraEnv}, cwd: f.base},
  );
  const lines = r.stdout.trim().split('\n');
  return {...r, lines, last: lines.at(-1)};
}

test('--run-start: moves the tree, syncs the changed files, keeps a backup, writes the state', () => {
  const f = fakeHome();
  try {
    const head = git(f.seed, 'rev-parse', 'HEAD');
    const r = runSync(f);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.last, 'tasks=synced', r.stdout);
    assert.equal(
      git(f.tree, 'rev-parse', 'HEAD'),
      head,
      'the tree is at origin',
    );
    assert.match(
      r.stdout,
      /moved the task tree from \w+ to origin\/qariah-main/,
    );
    // The changed files are v2; the symlink is now a real file.
    assert.equal(
      liveText(f, 'qariah-daily-triage-fix-loop'),
      skill('qariah-daily-triage-fix-loop', 'v2'),
    );
    assert.equal(
      liveText(f, 'qariah-daily-auto-sprint'),
      skill('qariah-daily-auto-sprint', 'v2'),
    );
    const aud = join(f.live, 'qariah-release-auditor', 'SKILL.md');
    assert.equal(lstatSync(aud).isSymbolicLink(), false);
    assert.equal(
      readFileSync(aud, 'utf8'),
      skill('qariah-release-auditor', 'v1'),
    );
    // The run's own task: synced, and the line says the run keeps its prompt.
    assert.match(
      r.stdout,
      /qariah-daily-triage-fix-loop — synced from the repo\. This run keeps the prompt/,
    );
    // A task that is not installed stays not installed; another project's task is not touched.
    assert.equal(
      existsSync(join(f.live, 'qariah-biweekly-hygiene-sweep')),
      false,
    );
    assert.match(
      r.stdout,
      /skip qariah-biweekly-hygiene-sweep — not installed/,
    );
    assert.equal(
      readFileSync(join(f.live, 'daily-claude-backup', 'SKILL.md'), 'utf8'),
      'not ours\n',
    );
    // The copies that ran are saved.
    // in the run's state folder, not in ~/.claude.
    assert.deepEqual(
      readdirSync(join(f.home, '.claude')).filter(n =>
        n.startsWith('scheduled-tasks-backup-'),
      ),
      [],
    );
    const backups = readdirSync(join(f.state, 'task-backups'));
    assert.equal(backups.length, 1);
    assert.equal(
      readFileSync(
        join(
          f.state,
          'task-backups',
          backups[0],
          'qariah-daily-triage-fix-loop',
          'SKILL.md',
        ),
        'utf8',
      ),
      skill('qariah-daily-triage-fix-loop', 'v1'),
    );
    // No ANSI colour in a report line, and no temporary file left in the live folder.
    assert.equal(r.stdout.includes('\u001b['), false);
    for (const t of TASKS.filter(n => existsSync(join(f.live, n))))
      assert.deepEqual(readdirSync(join(f.live, t)), ['SKILL.md'], t);
    // The state file for run-end.sh.
    assert.match(
      readFileSync(join(f.state, 'task-sync.drafts.txt'), 'utf8'),
      /^tasks=synced at=\d{13}\n$/,
    );

    // A second run has nothing to copy.
    const r2 = runSync(f);
    assert.equal(r2.last, 'tasks=current', r2.stdout);
    assert.match(r2.stdout, /the task tree is at origin\/qariah-main/);

    // --check agrees.
    const c = spawnSync('bash', [LINK, '--check'], {
      encoding: 'utf8',
      env: f.env,
      cwd: f.base,
    });
    assert.equal(c.status, 0, c.stdout);
    assert.match(c.stdout.trim().split('\n').at(-1), /^tasks-check: ok /);
  } finally {
    f.cleanup();
  }
});

test('--check: a live edit is a DRIFT line; the next --run-start repairs it and saves the edit', () => {
  const f = fakeHome();
  try {
    runSync(f);
    put(join(f.live, 'qariah-promoter', 'SKILL.md'), 'edited in the app\n');
    const c = spawnSync('bash', [LINK, '--check'], {
      encoding: 'utf8',
      env: f.env,
      cwd: f.base,
    });
    assert.equal(c.status, 1);
    assert.match(
      c.stdout.trim().split('\n').at(-1),
      /^tasks-check: DRIFT in qariah-promoter \(task tree at \w+\)\. The next run-start\.sh syncs it/,
    );
    const r = runSync(f, 'autoSprint');
    assert.equal(r.last, 'tasks=synced');
    assert.equal(
      liveText(f, 'qariah-promoter'),
      skill('qariah-promoter', 'v1'),
    );
    const saved = readdirSync(join(f.state, 'task-backups'))
      .map(n => join(f.state, 'task-backups', n, 'qariah-promoter', 'SKILL.md'))
      .filter(existsSync);
    assert.equal(readFileSync(saved[0], 'utf8'), 'edited in the app\n');
  } finally {
    f.cleanup();
  }
});

test('--run-start: a dirty tree stays where it is, and only committed text reaches a live file', () => {
  const f = fakeHome();
  try {
    runSync(f);
    const at = git(f.tree, 'rev-parse', 'HEAD');
    // A person edits a task file in the tree, and origin moves on again.
    const dirty = join(f.tree, REL, 'qariah-promoter', 'SKILL.md');
    put(dirty, 'not reviewed\n');
    push(f.seed, {'qariah-promoter': 'v3'});
    const r = runSync(f, 'promoter');
    assert.equal(r.status, 0);
    assert.equal(r.last, 'tasks=stale', r.stdout);
    assert.match(r.stdout, /the task tree has local changes .*so it stays at/);
    assert.equal(git(f.tree, 'rev-parse', 'HEAD'), at, 'not moved');
    assert.equal(readFileSync(dirty, 'utf8'), 'not reviewed\n', 'edit kept');
    assert.equal(
      liveText(f, 'qariah-promoter'),
      skill('qariah-promoter', 'v1'),
      'the live copy is the commit of the tree, not the edit',
    );
    // --check compares with the commit too: no drift, but it says the tree is stale.
    const c = spawnSync('bash', [LINK, '--check'], {
      encoding: 'utf8',
      env: f.env,
      cwd: f.base,
    });
    assert.equal(c.status, 0, c.stdout);
    assert.match(c.stdout, /tasks-check: ok .*STALE/);
  } finally {
    f.cleanup();
  }
});

test('--run-start: a failed fetch is a line; the sync uses the last fetched origin/qariah-main', () => {
  const f = fakeHome();
  try {
    // The main checkout fetched v2 earlier; then the origin goes away.
    git(f.main, 'fetch', '-q', 'origin');
    git(f.main, 'remote', 'set-url', 'origin', join(f.base, 'missing.git'));
    const r = runSync(f);
    assert.equal(r.status, 0);
    assert.equal(r.last, 'tasks=stale', r.stdout);
    assert.match(r.stdout, /WARN the fetch of origin\/qariah-main failed/);
    assert.equal(
      liveText(f, 'qariah-daily-auto-sprint'),
      skill('qariah-daily-auto-sprint', 'v2'),
    );
  } finally {
    f.cleanup();
  }
});

test('--run-start: no task tree → tasks=no-tree, exit 0, nothing changed', () => {
  const f = fakeHome();
  try {
    const r = runSync(f, 'drafts', {QARIAH_TASKS_TREE: join(f.base, 'nope')});
    assert.equal(r.status, 0);
    assert.equal(r.last, 'tasks=no-tree');
    assert.match(r.stdout, /FAIL the task tree is missing/);
    assert.equal(
      liveText(f, 'qariah-daily-triage-fix-loop'),
      skill('qariah-daily-triage-fix-loop', 'v1'),
    );
    assert.match(
      readFileSync(join(f.state, 'task-sync.drafts.txt'), 'utf8'),
      /^tasks=no-tree at=/,
    );
  } finally {
    f.cleanup();
  }
});

test('--run-start: a copy that fails is drift; QARIAH_LIVE_TASKS_DIR moves the live folder', () => {
  const f = fakeHome();
  try {
    const other = join(f.base, 'live-2');
    put(join(other, 'qariah-promoter', 'SKILL.md'), 'old\n');
    chmodSync(join(other, 'qariah-promoter'), 0o555); // the rename cannot replace the file
    const r = runSync(f, 'drafts', {QARIAH_LIVE_TASKS_DIR: other});
    chmodSync(join(other, 'qariah-promoter'), 0o755);
    if (process.getuid && process.getuid() === 0) return; // root ignores the mode
    assert.equal(r.status, 0);
    assert.equal(r.last, 'tasks=drift', r.stdout);
    assert.match(r.stdout, /qariah-promoter — the copy to .* failed/);
    assert.equal(
      readFileSync(join(other, 'qariah-promoter', 'SKILL.md'), 'utf8'),
      'old\n',
    );
    // The default live folder was not touched.
    assert.equal(
      liveText(f, 'qariah-daily-auto-sprint'),
      skill('qariah-daily-auto-sprint', 'v1'),
    );
  } finally {
    f.cleanup();
  }
});

test('the command line: a bad mode or no task is a usage error', () => {
  for (const args of [
    ['--run-start'],
    ['--sync-everything'],
    ['--check', 'x'],
  ]) {
    const r = spawnSync('bash', [LINK, ...args], {encoding: 'utf8'});
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage/);
  }
});

/** run-end.sh in a dry run, with a `gh` that always fails: it prints the line, posts nothing. */
function runEnd(f, extraEnv = {}) {
  const bin = join(f.base, 'bin');
  put(join(bin, 'gh'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(bin, 'gh'), 0o755);
  const r = spawnSync('bash', [RUN_END, 'drafts', 'DONE'], {
    encoding: 'utf8',
    env: {
      ...f.env,
      PATH: `${bin}:${process.env.PATH}`,
      QARIAH_RUN_STATE_DIR: f.state,
      RUN_END_DRY_RUN: '1',
      ...extraEnv,
    },
  });
  return r.stdout.split('\n').find(l => l.startsWith('run-health ')) || '';
}

test('run-end.sh: the run-health line gives tasks= from this run, else unknown or cloud', () => {
  const f = fakeHome();
  try {
    assert.match(runEnd(f), / tasks=unknown$/, 'no record');
    runSync(f);
    assert.match(runEnd(f), / tasks=synced$/);
    // A record from before this run started belongs to another run.
    const started = Date.now() + 10 * 60e3;
    put(
      join(f.state, 'x.last.json'),
      JSON.stringify({
        task: 'drafts',
        startedAt: started,
        endedAt: Date.now(),
        toolCalls: 3,
        minutes: 1,
      }),
    );
    assert.match(runEnd(f), / tasks=unknown$/);
    rmSync(join(f.state, 'x.last.json'));
    assert.match(runEnd(f, {CLAUDE_CODE_REMOTE: 'true'}), / tasks=cloud$/);
  } finally {
    f.cleanup();
  }
});

test('run-start.sh: syncs on the Mac (after a FAIL too), never in a cloud session', () => {
  const f = fakeHome();
  try {
    // A copy of run-start.sh in a fake repo, with a stub limits hook and a stub preflight.
    const repo = join(f.base, 'repo');
    git(f.base, 'init', '-q', '-b', 'qariah-main', repo);
    mkdirSync(join(repo, 'scripts'), {recursive: true});
    for (const s of ['run-start.sh', 'link-scheduled-tasks.sh', 'bounded.sh'])
      copyFileSync(join(SCRIPTS, s), join(repo, 'scripts', s));
    put(
      join(repo, '.claude', 'hooks', 'qariah-run-limits.cjs'),
      `console.log(JSON.stringify({source: 'stub', limits: {maxToolCalls: 9, maxWallMinutes: 9,
        commandMinutes: {default: 1, build: 1, upload: 1}, sameCallInARow: 3,
        diskFloorGB: {other: 0}, staleMarkerHours: 8}}));\n`,
    );
    const pf = join(
      f.home,
      '.claude',
      'skills',
      'machine-preflight',
      'preflight.sh',
    );
    put(pf, '#!/bin/sh\necho "GAP tool:git (stub)"\n'); // a needed GAP: run-start exits 1
    const run = extraEnv =>
      spawnSync('bash', [join(repo, 'scripts', 'run-start.sh'), 'drafts'], {
        encoding: 'utf8',
        env: {...f.env, QARIAH_RUN_STATE_DIR: f.state, ...extraEnv},
        cwd: repo,
      });
    const cloud = run({CLAUDE_CODE_REMOTE: 'true'});
    assert.equal(cloud.status, 0, cloud.stderr);
    assert.doesNotMatch(cloud.stdout, /run-start: tasks/);
    assert.equal(
      liveText(f, 'qariah-daily-auto-sprint'),
      skill('qariah-daily-auto-sprint', 'v1'),
      'the cloud does not sync',
    );
    const mac = run({});
    assert.equal(mac.status, 1, 'the stub GAP fails the preflight');
    assert.match(mac.stdout, /^run-start: tasks=synced$/m);
    assert.equal(
      liveText(f, 'qariah-daily-auto-sprint'),
      skill('qariah-daily-auto-sprint', 'v2'),
    );
    assert.match(
      readFileSync(join(f.state, 'task-sync.drafts.txt'), 'utf8'),
      /^tasks=synced at=/,
    );
  } finally {
    f.cleanup();
  }
});

test('--run-start: only the newest 5 backup folders stay; with no --state-file nothing is saved', () => {
  const f = fakeHome();
  try {
    const root = join(f.state, 'task-backups');
    const old = ['20200101-000000', '20200102-000000', '20200103-000000'];
    const newer = ['20250101-000000', '20250102-000000'];
    for (const n of [...old, ...newer])
      put(join(root, n, 'qariah-promoter', 'SKILL.md'), `${n}\n`);
    put(join(root, 'README'), 'not a backup folder\n');
    const r = runSync(f); // the triage loop and the auto-sprint files differ: one backup
    assert.equal(r.last, 'tasks=synced');
    const left = readdirSync(root).sort();
    // 6 folders (5 before + the new one): the oldest one goes.
    assert.equal(left.length, 6, left.join(' ')); // 5 folders + the README
    assert.deepEqual(left.slice(0, 4), [
      '20200102-000000',
      '20200103-000000',
      ...newer,
    ]);
    assert.ok(/^\d{8}-\d{6}$/.test(left[4]), left[4]);
    assert.equal(left[5], 'README');
    assert.equal(existsSync(join(root, old[0])), false);
    // No --state-file: the repo copy still wins, and the line says nothing was saved.
    put(join(f.live, 'qariah-promoter', 'SKILL.md'), 'edited in the app\n');
    const n = spawnSync('bash', [LINK, '--run-start', 'drafts'], {
      encoding: 'utf8',
      env: f.env,
      cwd: f.base,
    });
    assert.equal(n.status, 0);
    assert.match(n.stdout, /qariah-promoter .*\n.*was NOT saved/);
    assert.equal(
      liveText(f, 'qariah-promoter'),
      skill('qariah-promoter', 'v1'),
    );
  } finally {
    f.cleanup();
  }
});

test('--run-start: a commit in the task tree that is not on origin/qariah-main → stale, nothing copied', () => {
  const f = fakeHome();
  try {
    // A person commits in the detached tree: a checkout would leave the commit.
    put(join(f.tree, REL, 'qariah-promoter', 'SKILL.md'), 'local commit\n');
    git(f.tree, 'commit', '-q', '-am', 'local');
    const local = git(f.tree, 'rev-parse', 'HEAD');
    const r = runSync(f);
    assert.equal(r.status, 0);
    assert.equal(r.last, 'tasks=stale', r.stdout);
    assert.match(
      r.stdout,
      /which is not on origin\/qariah-main .*so it stays there/,
    );
    assert.match(r.stdout, /nothing was copied/);
    assert.equal(git(f.tree, 'rev-parse', 'HEAD'), local, 'the commit is kept');
    for (const t of [
      'qariah-daily-triage-fix-loop',
      'qariah-daily-auto-sprint',
      'qariah-promoter',
    ])
      assert.equal(liveText(f, t), skill(t, 'v1'), t);
    assert.equal(
      lstatSync(
        join(f.live, 'qariah-release-auditor', 'SKILL.md'),
      ).isSymbolicLink(),
      true,
      'not touched',
    );
  } finally {
    f.cleanup();
  }
});
