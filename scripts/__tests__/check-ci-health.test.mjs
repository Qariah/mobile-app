#!/usr/bin/env node
// @ai
//
// scripts/__tests__/check-ci-health.test.mjs
// ------------------------------------------
// node:test suite for the production-line branch filter and the gate rules in
// scripts/check-ci-health.mjs.
// Run:  node --test scripts/__tests__/check-ci-health.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  LINE_PREFIXES,
  classifyGate,
  lineBranchesFromRefs,
} from '../check-ci-health.mjs';

const refs = names => names.map(n => ({ref: `refs/heads/${n}`}));

describe('lineBranchesFromRefs', () => {
  it('keeps the branches under the prefix, without refs/heads/', () => {
    assert.deepEqual(
      lineBranchesFromRefs(refs(['release/3.2.0-pre-sdk56']), 'release'),
      ['release/3.2.0-pre-sdk56'],
    );
  });
  it('drops a prefix match that is not under prefix/ (no trailing slash in the query)', () => {
    assert.deepEqual(
      lineBranchesFromRefs(
        refs(['release/3.3.0', 'releases-foo', 'release', 'release-notes']),
        'release',
      ),
      ['release/3.3.0'],
    );
  });
  it('reads hotfix branches the same way', () => {
    assert.deepEqual(
      lineBranchesFromRefs(
        refs(['hotfix/3.2.0-anr-splash', 'hotfixes']),
        'hotfix',
      ),
      ['hotfix/3.2.0-anr-splash'],
    );
  });
  it('gives an empty list for no refs or a bad answer', () => {
    assert.deepEqual(lineBranchesFromRefs([], 'release'), []);
    assert.deepEqual(lineBranchesFromRefs(undefined, 'release'), []);
    assert.deepEqual(lineBranchesFromRefs([{}, null], 'release'), []);
  });
  it('scans both production lines', () => {
    assert.deepEqual(LINE_PREFIXES, ['release', 'hotfix']);
  });
});

describe('classifyGate', () => {
  const now = Date.now();
  const iso = hoursAgo => new Date(now - hoursAgo * 3_600_000).toISOString();
  const run = (conclusion, hoursAgo, branch = 'qariah-main') => ({
    status: 'completed',
    conclusion,
    head_branch: branch,
    created_at: iso(hoursAgo),
    event: 'schedule',
    html_url: 'https://example.invalid/run',
  });
  // A fake runs reader: the trunk query, or one release branch.
  const reader =
    ({trunk = [], lines = {}}) =>
    (wf, query, opts = {}) => {
      if (query.startsWith('branch=qariah-main')) {
        assert.equal(opts.pushOnly, false, 'the trunk reads every event');
        return trunk;
      }
      const b = decodeURIComponent(query.match(/^branch=([^&]+)/)[1]);
      return lines[b] || [];
    };
  const wf = {id: 1, name: 'x'};
  const trunkGate = read => ({trunk: true, lines: false, read});
  const prGate = read => ({read});

  it('trunk gate: ok when its newest run passed after the newest commit', () => {
    const r = classifyGate(
      wf,
      iso(3),
      null,
      trunkGate(reader({trunk: [run('success', 1)]})),
    );
    assert.equal(r.status, 'ok');
  });

  it('trunk gate: failing when its newest run failed', () => {
    const r = classifyGate(
      wf,
      iso(3),
      null,
      trunkGate(reader({trunk: [run('failure', 1), run('success', 9)]})),
    );
    assert.equal(r.status, 'failing');
  });

  it('trunk gate: silent with no completed run, or 24 h behind the head', () => {
    assert.equal(
      classifyGate(wf, iso(1), null, trunkGate(reader({}))).status,
      'gate-silent',
    );
    assert.equal(
      classifyGate(
        wf,
        iso(1),
        null,
        trunkGate(reader({trunk: [run('success', 30)]})),
      ).status,
      'gate-silent',
    );
  });

  it('required gate: does not need a qariah-main run', () => {
    const r = classifyGate(wf, iso(1), [], prGate(reader({})));
    assert.equal(r.status, 'idle');
  });

  it('required gate: failing when a release line in use failed', () => {
    const b = 'hotfix/3.2.0-anr-splash';
    const r = classifyGate(
      wf,
      iso(1),
      [b],
      prGate(reader({lines: {[b]: [run('failure', 5, b)]}})),
    );
    assert.equal(r.status, 'failing');
    assert.match(r.note, /hotfix\/3\.2\.0-anr-splash/);
  });

  it('required gate: not checked when the branch list cannot be read', () => {
    const r = classifyGate(wf, iso(1), null, prGate(reader({})));
    assert.equal(r.status, 'unchecked');
  });
});
