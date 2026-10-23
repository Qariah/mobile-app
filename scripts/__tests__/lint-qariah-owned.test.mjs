// @ai-generated
// scripts/lint-qariah-owned.mjs (TECH_DEBT #236): the rule that decides which
// files the blocking ESLint step lints. Run: node --test scripts/__tests__/lint-qariah-owned.test.mjs
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {
  chunkByLength,
  isDirectRun,
  isLintable,
  parseExcludeList,
  parsePin,
  qariahOwned,
  unmatchedExcludes,
  writePin,
} from '../lint-qariah-owned.mjs';

const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(SCRIPTS_DIR, 'lint-qariah-owned.mjs');
const PIN_FILE = join(SCRIPTS_DIR, 'lint-qariah-owned.upstream-sha');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('isLintable: lints js, ts and tsx, as `eslint .` does', () => {
  assert.equal(isLintable('services/auth/pkce.ts'), true);
  assert.equal(isLintable('components/QariahRootEffects.tsx'), true);
  assert.equal(isLintable('scripts/generate-version.js'), true);
  assert.equal(
    isLintable('app/(tabs)/(c.collection)/collection/notes.tsx'),
    true,
  );
});

test('isLintable: skips other file types', () => {
  assert.equal(isLintable('docs/operations/system-map.html'), false);
  assert.equal(isLintable('scripts/daily-card.mjs'), false);
  assert.equal(isLintable('config/branding.cjs'), false);
  assert.equal(isLintable('assets/data/catalog.json'), false);
  assert.equal(
    isLintable('modules/qariah-memory/ios/QariahMemory.swift'),
    false,
  );
});

test('isLintable: skips the folders that ESLint ignores', () => {
  assert.equal(isLintable('.claude/hooks/qariah-publish-guard.js'), false);
  assert.equal(isLintable('.maestro/helpers/pick.js'), false);
  assert.equal(isLintable('.eslintrc.js'), false);
  assert.equal(isLintable('node_modules/x/index.js'), false);
  assert.equal(isLintable('android/app/build.js'), false);
  assert.equal(isLintable('modules/qariah-memory/android/gen.ts'), false);
  assert.equal(isLintable('ios/Pods/x.js'), false);
});

test('qariahOwned: keeps a file that is not on upstream', () => {
  const owned = qariahOwned(
    ['services/auth/pkce.ts', 'services/userState/syncQueue.ts'],
    ['store/playerStore.ts'],
  );
  assert.deepEqual(owned, [
    'services/auth/pkce.ts',
    'services/userState/syncQueue.ts',
  ]);
});

test('qariahOwned: drops a file that exists on upstream, also when Qariah changed it', () => {
  const owned = qariahOwned(
    ['app/_layout.tsx', 'config/featureFlags.ts', 'services/qariahBoot.ts'],
    ['app/_layout.tsx', 'config/featureFlags.ts'],
  );
  assert.deepEqual(owned, ['services/qariahBoot.ts']);
});

test('qariahOwned: drops a file that is not lintable', () => {
  const owned = qariahOwned(
    ['docs/a.md', 'scripts/x.mjs', '.claude/hooks/x.js', 'services/x.ts'],
    [],
  );
  assert.deepEqual(owned, ['services/x.ts']);
});

test('qariahOwned: drops a file in the exclude list', () => {
  const owned = qariahOwned(
    ['components/Moved.tsx', 'services/x.ts'],
    [],
    ['components/Moved.tsx'],
  );
  assert.deepEqual(owned, ['services/x.ts']);
});

test('qariahOwned: returns a sorted list and does not change its input', () => {
  const tracked = ['b/two.ts', 'a/one.ts'];
  assert.deepEqual(qariahOwned(tracked, []), ['a/one.ts', 'b/two.ts']);
  assert.deepEqual(tracked, ['b/two.ts', 'a/one.ts']);
});

test('parseExcludeList: reads one path for each line and ignores comments', () => {
  const text = [
    '# a header comment',
    '',
    'components/Moved.tsx   # moved upstream',
    '   services/old.ts',
    '# components/Off.tsx',
  ].join('\n');
  assert.deepEqual(parseExcludeList(text), [
    'components/Moved.tsx',
    'services/old.ts',
  ]);
});

test('chunkByLength: keeps every command line under the limit and loses no item', () => {
  const items = Array.from({length: 50}, (_, i) => `path/to/file-${i}.ts`);
  const chunks = chunkByLength(items, 100);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.join(' ').length <= 100);
  }
  assert.deepEqual(chunks.flat(), items);
});

test('chunkByLength: gives an empty list for no item', () => {
  assert.deepEqual(chunkByLength([]), []);
});

test('unmatchedExcludes: reports a line for a file that is gone, not lintable or on upstream', () => {
  const tracked = ['services/mine.ts', 'services/other.ts', 'docs/a.md'];
  const upstream = ['services/other.ts'];
  const excluded = [
    'services/mine.ts', // matches: Qariah-owned
    'services/gone.ts', // not tracked
    'services/other.ts', // on upstream
    'docs/a.md', // not lintable
  ];
  assert.deepEqual(unmatchedExcludes(tracked, upstream, excluded), [
    'services/gone.ts',
    'services/other.ts',
    'docs/a.md',
  ]);
});

test('unmatchedExcludes: reports nothing for an empty exclude list', () => {
  assert.deepEqual(unmatchedExcludes(['services/mine.ts'], [], []), []);
});

test('parsePin: reads the first line that is not a comment', () => {
  const text = `# a comment\n\n${SHA_A}  # the pin\n${SHA_B}\n`;
  assert.equal(parsePin(text), SHA_A);
});

test('parsePin: rejects a missing, short or non-hex SHA', () => {
  assert.equal(parsePin(''), null);
  assert.equal(parsePin('# only a comment\n'), null);
  assert.equal(parsePin('5a813e23\n'), null);
  assert.equal(parsePin(`${'g'.repeat(40)}\n`), null);
  assert.equal(parsePin(`${SHA_A.toUpperCase()}\n`), null);
});

test('writePin: replaces the SHA line and keeps the comments', () => {
  const text = `# header\n#\n${SHA_A}\n`;
  assert.equal(writePin(text, SHA_B), `# header\n#\n${SHA_B}\n`);
  assert.equal(parsePin(writePin(text, SHA_B)), SHA_B);
});

test('writePin: adds the SHA to a file that has only comments', () => {
  assert.equal(writePin('# header', SHA_A), `# header\n${SHA_A}\n`);
  assert.equal(writePin('', SHA_A), `${SHA_A}\n`);
});

test('the committed pin file holds one full SHA', () => {
  assert.match(
    parsePin(readFileSync(PIN_FILE, 'utf8')) ?? '',
    /^[0-9a-f]{40}$/,
  );
});

test('--print-pin prints the SHA of the pin file', () => {
  const run = spawnSync(process.execPath, [SCRIPT, '--print-pin'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), parsePin(readFileSync(PIN_FILE, 'utf8')));
});

test('isDirectRun: true for the module itself, false for another file or no path', () => {
  const moduleUrl = pathToFileURL(SCRIPT).href;
  assert.equal(isDirectRun(SCRIPT, moduleUrl), true);
  assert.equal(isDirectRun(PIN_FILE, moduleUrl), false);
  assert.equal(isDirectRun(undefined, moduleUrl), false);
  assert.equal(
    isDirectRun(join(SCRIPTS_DIR, 'no-such-file.mjs'), moduleUrl),
    false,
  );
});

test('the script runs when a symlinked folder holds it (no silent no-op)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lint-qariah-owned-'));
  try {
    const link = join(tmp, 'linked-scripts');
    symlinkSync(SCRIPTS_DIR, link);
    const run = spawnSync(
      process.execPath,
      [join(link, 'lint-qariah-owned.mjs'), '--print-pin'],
      {encoding: 'utf8'},
    );
    assert.equal(run.status, 0);
    // A silent no-op exits 0 with no output. The SHA proves the script ran.
    assert.equal(run.stdout.trim(), parsePin(readFileSync(PIN_FILE, 'utf8')));
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
});

test('the script exits 2 with a clear message when the upstream commit is missing', () => {
  const run = spawnSync(process.execPath, [SCRIPT, '--list'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      QARIAH_UPSTREAM_REF: 'refs/remotes/no-such-remote/no-such-branch',
    },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /cannot find the upstream commit/);
  assert.match(run.stderr, /git fetch upstream develop/);
});
