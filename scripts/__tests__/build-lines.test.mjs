#!/usr/bin/env node
// @ai
//
// scripts/__tests__/build-lines.test.mjs
// --------------------------------------
// node:test suite for scripts/lib/build-lines.mjs — the release-line check that
// stops scripts/prod-close.mjs from closing a trunk fix when production ships a
// hotfix line with a HIGHER build number (the 2026-09-28 3.2.1 (2027) case).
// Run:  node --test scripts/__tests__/build-lines.test.mjs

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  buildIndex,
  countAncestors,
  gitBuildLines,
  lineVerdict,
  parseVersionCodeOffset,
  resolveProduction,
} from '../lib/build-lines.mjs';

describe('parseVersionCodeOffset', () => {
  it('reads the offset constant', () => {
    assert.equal(
      parseVersionCodeOffset('x\nconst VERSION_CODE_OFFSET = 734;\ny'),
      734,
    );
  });
  it('is 0 for a copy from before the offset existed', () => {
    assert.equal(parseVersionCodeOffset('function getBuildNumber() {}'), 0);
  });
});

describe('countAncestors', () => {
  it('counts a chain and a merge like git rev-list --count', () => {
    //  a - b - d (merge of b and c)
    //   \- c -/
    const counts = countAncestors([
      {sha: 'a', parents: []},
      {sha: 'b', parents: ['a']},
      {sha: 'c', parents: ['a']},
      {sha: 'd', parents: ['b', 'c']},
    ]);
    assert.deepEqual(
      [...counts],
      [
        ['a', 1],
        ['b', 2],
        ['c', 2],
        ['d', 4],
      ],
    );
  });
  it('throws when a parent is missing (a shallow history)', () => {
    assert.throws(
      () => countAncestors([{sha: 'b', parents: ['a']}]),
      /not in the history/,
    );
  });
  it('handles more than 32 commits (several bitset words)', () => {
    const commits = Array.from({length: 70}, (_, i) => ({
      sha: `c${i}`,
      parents: i ? [`c${i - 1}`] : [],
    }));
    assert.equal(countAncestors(commits).get('c69'), 70);
  });
});

describe('buildIndex', () => {
  it('maps count + offset to the commits, and keeps collisions', () => {
    const counts = new Map([
      ['main5', 5],
      ['hot3', 3],
      ['old', 1],
    ]);
    const offsets = {main5: 100, hot3: 102, old: null};
    const idx = buildIndex(counts, s => offsets[s]);
    assert.deepEqual(idx.get(105), ['main5', 'hot3']);
    assert.equal(
      idx.has(1),
      false,
      'a commit without the script derives nothing',
    );
  });
});

describe('lineVerdict', () => {
  const prod = {build: 2027, commit: 'P'.repeat(40)};
  const anc = new Set(['h1', 'h2']);
  const isAncestor = a => anc.has(a);
  const v = (fixBuild, candidates, extra = {}) =>
    lineVerdict({fixBuild, prod, candidates, isAncestor, ...extra});

  it('in: every candidate is on the production line', () => {
    assert.equal(v(1975, ['h1', 'h2']).state, 'in');
  });
  it('out: no candidate is on the production line (the trunk-beta case)', () => {
    const r = v(1922, ['t1']);
    assert.equal(r.state, 'out');
    assert.match(r.why, /another line/);
  });
  it('unknown: a mixed list is ambiguous, never a close', () => {
    const r = v(2026, ['h1', 't1']);
    assert.equal(r.state, 'unknown');
    assert.match(
      r.why,
      /ambiguous: 2 commits derive it and 1 are in production/,
    );
  });
  it('unknown: no commit derives the build', () => {
    assert.equal(v(1800, []).state, 'unknown');
  });
  it('unknown: the index failed', () => {
    const r = v(1800, null, {indexError: 'shallow clone'});
    assert.equal(r.state, 'unknown');
    assert.match(r.why, /shallow clone/);
  });
  it('in: the fix build IS the production build', () => {
    assert.equal(v(2027, ['h1', 't1']).state, 'in');
  });
  it('unknown: no production commit, whatever the numbers say', () => {
    const r = lineVerdict({
      fixBuild: 2027,
      prod: {build: 2027, commit: null, why: 'shallow clone'},
      candidates: ['h1'],
      isAncestor,
    });
    assert.equal(r.state, 'unknown');
    assert.match(r.why, /production commit unknown: shallow clone/);
  });
});

describe('resolveProduction', () => {
  const fake = (o = {}) => ({
    shallow: false,
    added: [],
    resolve: s => (s === 'abc' ? 'a'.repeat(40) : null),
    addRev(s) {
      this.added.push(s);
    },
    candidates: () => [],
    indexError: null,
    ...o,
  });
  it('uses the recorded sha, and adds it to the index', () => {
    const l = fake();
    const p = resolveProduction({build: 2027, sha: 'abc'}, l);
    assert.equal(p.commit, 'a'.repeat(40));
    assert.deepEqual(l.added, ['a'.repeat(40)]);
  });
  it('a recorded sha that is not in the clone resolves to nothing', () => {
    const p = resolveProduction({build: 2027, sha: 'zzz'}, fake());
    assert.equal(p.commit, null);
    assert.match(p.why, /not in this clone/);
  });
  it('a shallow clone resolves to nothing', () => {
    const p = resolveProduction(
      {build: 2027, sha: 'abc'},
      fake({shallow: true}),
    );
    assert.equal(p.commit, null);
    assert.match(p.why, /shallow/);
  });
  it('without a sha: only ONE deriving commit is enough', () => {
    assert.equal(
      resolveProduction({build: 1717}, fake({candidates: () => ['x']})).commit,
      'x',
    );
    const two = resolveProduction(
      {build: 2027},
      fake({candidates: () => ['x', 'y']}),
    );
    assert.equal(two.commit, null);
    assert.match(two.why, /2 commits derive build 2027/);
  });
});

// A real repository: trunk + a hotfix line with a larger offset + a side branch
// whose derived numbers collide with the trunk's.
describe('gitBuildLines on a real repository', () => {
  let dir;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (...a) =>
    execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...a], {
      env,
      encoding: 'utf8',
    }).trim();
  const commit = (msg, offset) => {
    if (offset !== undefined)
      writeFileSync(
        join(dir, 'scripts/generate-version.js'),
        `const VERSION_CODE_OFFSET = ${offset};\n`,
      );
    writeFileSync(join(dir, 'log.txt'), `${msg}\n`, {flag: 'a'});
    git('add', '-A');
    git('commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  const sha = {};

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-lines-'));
    mkdirSync(join(dir, 'scripts'));
    git('init', '-q', '-b', 'main');
    sha.a = commit('a', 100); // count 1 → 101
    sha.b = commit('b'); //       count 2 → 102
    sha.c = commit('c'); //       count 3 → 103 (a trunk beta)
    sha.d = commit('d'); //       count 4 → 104
    git('checkout', '-q', '-b', 'hotfix', sha.b);
    sha.h1 = commit('h1', 200); // count 3 → 203
    sha.h2 = commit('h2'); //      count 4 → 204 (production)
    git('checkout', '-q', '-b', 'side', sha.a);
    sha.s1 = commit('s1', 101); // count 2 → 103, collides with c
    git('checkout', '-q', 'main');
  });
  after(() => rmSync(dir, {recursive: true, force: true}));

  const lines = () => gitBuildLines({cwd: dir, refs: ['--branches']});
  const verdict = (l, prod, fixBuild) =>
    lineVerdict({
      fixBuild,
      prod,
      candidates: l.candidates(fixBuild),
      indexError: l.indexError,
      isAncestor: (a, b) => l.isAncestor(a, b),
    });

  it('derives the same numbers as count + offset', () => {
    const l = lines();
    assert.deepEqual(l.candidates(204), [sha.h2]);
    assert.deepEqual(l.candidates(104), [sha.d]);
    assert.deepEqual(new Set(l.candidates(103)), new Set([sha.c, sha.s1]));
  });

  it('a trunk fix with a LOWER number is not in the hotfix production build', () => {
    const l = lines();
    const prod = resolveProduction({build: 204, sha: sha.h2}, l);
    assert.equal(prod.commit, sha.h2);
    assert.equal(verdict(l, prod, 104).state, 'out');
    assert.equal(verdict(l, prod, 103).state, 'out');
  });

  it('a fix on the production line, and the fork point, are in', () => {
    const l = lines();
    const prod = resolveProduction({build: 204}, l);
    assert.equal(prod.commit, sha.h2, 'one commit derives 204');
    assert.equal(verdict(l, prod, 203).state, 'in');
    assert.equal(verdict(l, prod, 102).state, 'in');
  });

  it('a collision across lines holds the issue (ambiguous)', () => {
    const l = lines();
    const prod = resolveProduction({build: 104, sha: sha.d}, l);
    const r = verdict(l, prod, 103);
    assert.equal(r.state, 'unknown');
    assert.match(r.why, /ambiguous/);
  });

  it('a build no commit derives holds the issue', () => {
    const l = lines();
    const prod = resolveProduction({build: 204, sha: sha.h2}, l);
    assert.equal(verdict(l, prod, 150).state, 'unknown');
  });

  it('a shallow clone resolves nothing and holds everything', () => {
    const shallowDir = mkdtempSync(join(tmpdir(), 'build-lines-shallow-'));
    try {
      execFileSync(
        'git',
        [
          'clone',
          '-q',
          '--depth=1',
          '--branch',
          'hotfix',
          `file://${dir}`,
          shallowDir,
        ],
        {env},
      );
      const l = gitBuildLines({cwd: shallowDir, refs: ['--branches']});
      assert.equal(l.shallow, true);
      const prod = resolveProduction({build: 204, sha: 'HEAD'}, l);
      assert.equal(prod.commit, null);
      assert.equal(verdict(l, prod, 203).state, 'unknown');
    } finally {
      rmSync(shallowDir, {recursive: true, force: true});
    }
  });
});
