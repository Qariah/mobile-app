#!/usr/bin/env node
// @ai
//
// scripts/__tests__/local-pr-checks.test.mjs
// Run:  node --test scripts/__tests__/local-pr-checks.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {classifyCheck, judgePr} from '../local-pr-checks.mjs';

const ADVISORY = new Set(['Claude Code Review', 'EAS Update Preview']);
const policy = {adopt: {advisoryWorkflows: [...ADVISORY]}};
const gate = {
  workflowName: 'Branding Conformance',
  name: 'No hardcoded Bayaan brand strings',
};

describe('classifyCheck', () => {
  it('passes success and skipped', () => {
    assert.equal(
      classifyCheck({...gate, conclusion: 'SUCCESS'}, ADVISORY).verdict,
      'ok',
    );
    assert.equal(
      classifyCheck({...gate, conclusion: 'SKIPPED'}, ADVISORY).verdict,
      'ok',
    );
  });
  it('marks a failed gate as fail', () => {
    assert.equal(
      classifyCheck({...gate, conclusion: 'FAILURE'}, ADVISORY).verdict,
      'fail',
    );
  });
  it('marks a failed advisory workflow as advisory-fail', () => {
    const c = {
      workflowName: 'Claude Code Review',
      name: 'claude-review',
      conclusion: 'FAILURE',
    };
    assert.equal(classifyCheck(c, ADVISORY).verdict, 'advisory-fail');
  });
  it('treats a running check as pending', () => {
    assert.equal(
      classifyCheck(
        {...gate, conclusion: null, status: 'IN_PROGRESS'},
        ADVISORY,
      ).verdict,
      'pending',
    );
  });
});

describe('judgePr', () => {
  const pr = (mergeable, rollup) => ({
    number: 1,
    headRefOid: 'abcdef012345',
    headRefName: 'qariah/fix-x',
    mergeable,
    statusCheckRollup: rollup,
  });
  it('green when mergeable and every gate passes', () => {
    assert.equal(
      judgePr(pr('MERGEABLE', [{...gate, conclusion: 'SUCCESS'}]), policy)
        .green,
      true,
    );
  });
  it('an advisory failure does not block', () => {
    const r = judgePr(
      pr('MERGEABLE', [
        {...gate, conclusion: 'SUCCESS'},
        {workflowName: 'Claude Code Review', name: 'r', conclusion: 'FAILURE'},
      ]),
      policy,
    );
    assert.equal(r.green, true);
  });
  it('a gate failure, a running check or a conflict blocks', () => {
    assert.equal(
      judgePr(pr('MERGEABLE', [{...gate, conclusion: 'FAILURE'}]), policy)
        .green,
      false,
    );
    assert.equal(
      judgePr(pr('MERGEABLE', [{...gate, conclusion: null}]), policy).green,
      false,
    );
    assert.deepEqual(judgePr(pr('CONFLICTING', []), policy).reasons, [
      'mergeable=CONFLICTING',
    ]);
  });
  it('a required gate with no check run blocks', () => {
    const strict = {
      adopt: {
        advisoryWorkflows: [...ADVISORY],
        requiredWorkflows: ['Branding Conformance', 'Test'],
      },
    };
    const r = judgePr(
      pr('MERGEABLE', [{...gate, conclusion: 'SUCCESS'}]),
      strict,
    );
    assert.equal(r.green, false);
    assert.deepEqual(r.reasons, [
      'Test: no check run (the gate did not start)',
    ]);
    assert.equal(judgePr(pr('MERGEABLE', []), strict).green, false);
  });
  it('a PR into a release branch is not held to the required gates', () => {
    const strict = {
      adopt: {
        advisoryWorkflows: [...ADVISORY],
        requiredWorkflows: ['Branding Conformance', 'Test'],
      },
    };
    const r = judgePr(
      {...pr('MERGEABLE', []), baseRefName: 'release/3.2.0-pre-sdk56'},
      strict,
    );
    assert.equal(r.green, true);
  });
});
