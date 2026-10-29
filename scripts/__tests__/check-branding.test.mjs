#!/usr/bin/env node
// @ai
//
// scripts/__tests__/check-branding.test.mjs
// -----------------------------------------
// Node built-in test runner (node:test + node:assert) for
// scripts/check-branding.sh and its block-comment filter
// scripts/lib/branding-comment-filter.awk (2026-10-24 divergence audit, MSH-S3).
//
// The filter lets upstream's JSX comments (`{/* … */}`, no `*` at the start
// of each line) name "Bayaan". These tests prove that the gate still fails on
// user-visible text.
//
// Run:  node --test scripts/__tests__/check-branding.test.mjs
//       npm run test:scripts   (all the script tests)
//
// The tests run the script inside a throw-away git repository, so they never
// read the real tree. A stub replaces scripts/check-native-branding.mjs.

import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const NAME = ['Bay', 'aan'].join('');

let root;

function write(rel, text) {
  const file = join(root, rel);
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, text);
}

function check(source) {
  write('components/Fixture.tsx', source);
  const run = spawnSync('bash', ['scripts/check-branding.sh'], {
    cwd: root,
    encoding: 'utf8',
  });
  return {status: run.status, out: `${run.stdout}${run.stderr}`};
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'check-branding-'));
  for (const rel of [
    'scripts/check-branding.sh',
    'scripts/lib/branding-comment-filter.awk',
  ]) {
    mkdirSync(dirname(join(root, rel)), {recursive: true});
    copyFileSync(join(REPO, rel), join(root, rel));
  }
  write('scripts/check-native-branding.mjs', 'process.exit(0);\n');
  const init = spawnSync('git', ['init', '-q'], {cwd: root});
  assert.equal(init.status, 0, 'git init failed');
});

after(() => {
  rmSync(root, {recursive: true, force: true});
});

describe('check-branding.sh', () => {
  it('passes a JSX comment that names the brand on a continuation line', () => {
    const r = check(
      [
        'export const A = () => (',
        '  <View>',
        '    {/* RFC-018: a fork that ships only a provider',
        `        gets no toggle; ${NAME} wires neither. */}`,
        '    <Text>ok</Text>',
        '  </View>',
        ');',
        '',
      ].join('\n'),
    );
    assert.equal(r.status, 0, r.out);
  });

  it('passes a block comment with no * at the start of each line', () => {
    const r = check(
      [
        '/* Upstream note:',
        `   ${NAME} keeps this list. */`,
        'export const B = 1;',
        '',
      ].join('\n'),
    );
    assert.equal(r.status, 0, r.out);
  });

  it('fails on user-visible text', () => {
    const r = check(`export const C = () => <Text>${NAME}</Text>;\n`);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /components\/Fixture\.tsx:1:/);
  });

  it('fails on text after the end of a JSX comment on the same line', () => {
    const r = check(
      [
        'export const D = () => (',
        '  <View>',
        '    {/* a note',
        `        more note */} <Text>${NAME}</Text>`,
        '  </View>',
        ');',
        '',
      ].join('\n'),
    );
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /components\/Fixture\.tsx:4:/);
  });

  it('fails on text after a one-line JSX comment on the same line', () => {
    const r = check(
      [
        'export const E = () => (',
        `  <View>{/* note */}<Text>${NAME}</Text></View>`,
        ');',
        '',
      ].join('\n'),
    );
    assert.equal(r.status, 1, r.out);
  });

  it('fails on a line after a closed JSX comment', () => {
    const r = check(
      [
        'export const F = () => (',
        '  <View>',
        '    {/* a note',
        '        more note */}',
        `    <Text>${NAME}</Text>`,
        '  </View>',
        ');',
        '',
      ].join('\n'),
    );
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /components\/Fixture\.tsx:5:/);
  });

  it('does not take a /* inside code as the start of a comment', () => {
    const r = check(
      [
        "const glob = '**/*.ts';",
        `const label = '${NAME}';`,
        "const end = '*/';",
        '',
      ].join('\n'),
    );
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /components\/Fixture\.tsx:2:/);
  });

  describe("upstream's identifier in RecitersView (LSN-S5)", () => {
    const ID = `get${NAME}OriginalsReciters`;
    const reciters = lines =>
      write('components/RecitersView.tsx', lines.join('\n'));
    after(() => rmSync(join(root, 'components/RecitersView.tsx')));

    it('passes its two upstream lines', () => {
      reciters([
        'import {',
        `  ${ID},`,
        "} from '@/data/reciterCollections';",
        'const rows = useMemo(',
        `    () => seededShuffle(${ID}(10), sessionSeed + 3),`,
        '  [sessionSeed],',
        ');',
        '',
      ]);
      const r = check('export const G = 1;\n');
      assert.equal(r.status, 0, r.out);
    });

    it('fails on the brand in any other line of the file', () => {
      reciters([`  ${ID},`, `const title = '${NAME} Originals';`, '']);
      const r = check('export const H = 1;\n');
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /components\/RecitersView\.tsx:2:/);
      assert.doesNotMatch(r.out, /components\/RecitersView\.tsx:1:/);
    });
  });
});
