#!/usr/bin/env node
// @ai
//
// scripts/__tests__/check-ci-health.test.mjs
// ------------------------------------------
// node:test suite for the production-line branch filter in
// scripts/check-ci-health.mjs.
// Run:  node --test scripts/__tests__/check-ci-health.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {LINE_PREFIXES, lineBranchesFromRefs} from '../check-ci-health.mjs';

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
