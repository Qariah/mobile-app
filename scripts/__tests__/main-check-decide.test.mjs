#!/usr/bin/env node
// @ai
//
// scripts/__tests__/main-check-decide.test.mjs
// Run:  node --test scripts/__tests__/main-check-decide.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {DECIDE_JOB, decide, tested} from '../main-check-decide.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const run = (
  id,
  sha,
  conclusion,
  {status = 'completed', tested = true} = {},
) => ({
  id,
  head_sha: sha,
  status,
  conclusion,
  tested,
  html_url: `https://github.com/o/r/actions/runs/${id}`,
});

describe('main-check decide', () => {
  it('always checks on a manual run', () => {
    const d = decide({
      event: 'workflow_dispatch',
      sha: HEAD,
      runId: 9,
      runs: [run(8, HEAD, 'success')],
    });
    assert.deepEqual([d.run, d.fail], [true, false]);
  });

  it('checks when no earlier run exists', () => {
    const d = decide({event: 'schedule', sha: HEAD, runId: 9, runs: []});
    assert.deepEqual([d.run, d.fail], [true, false]);
  });

  it('checks when the head changed since the last tested run', () => {
    const d = decide({
      event: 'schedule',
      sha: HEAD,
      runId: 9,
      runs: [run(8, OLD, 'success')],
    });
    assert.deepEqual([d.run, d.fail], [true, false]);
  });

  it('passes without a check when the head passed before', () => {
    const d = decide({
      event: 'schedule',
      sha: HEAD,
      runId: 9,
      runs: [run(8, HEAD, 'success'), run(7, OLD, 'failure')],
    });
    assert.deepEqual([d.run, d.fail], [false, false]);
  });

  it('fails again without a check when the head failed before', () => {
    const d = decide({
      event: 'schedule',
      sha: HEAD,
      runId: 9,
      runs: [run(8, HEAD, 'failure')],
    });
    assert.deepEqual([d.run, d.fail], [false, true]);
    assert.match(d.note, /actions\/runs\/8/);
  });

  it('ignores this run and cancelled runs', () => {
    const d = decide({
      event: 'schedule',
      sha: HEAD,
      runId: 9,
      runs: [
        run(9, HEAD, 'success'),
        run(8, HEAD, 'cancelled'),
        run(7, OLD, 'success'),
      ],
    });
    assert.deepEqual([d.run, d.fail], [true, false]);
  });

  it('ignores a run that tested nothing (GitHub did not start the jobs)', () => {
    const d = decide({
      event: 'schedule',
      sha: HEAD,
      runId: 9,
      runs: [run(8, HEAD, 'failure', {tested: false})],
    });
    assert.deepEqual([d.run, d.fail], [true, false]);
  });

  it('looks past a repeated failure to the run that tested', () => {
    const d = decide({
      event: 'schedule',
      sha: HEAD,
      runId: 9,
      runs: [run(8, HEAD, 'failure', {tested: false}), run(7, HEAD, 'failure')],
    });
    assert.deepEqual([d.run, d.fail], [false, true]);
    assert.match(d.note, /actions\/runs\/7/);
  });
});

describe('main-check tested', () => {
  it('is false when only the decide job ran', () => {
    assert.equal(
      tested([
        {name: DECIDE_JOB, conclusion: 'failure'},
        {name: 'test', conclusion: 'skipped'},
        {name: 'lint', conclusion: 'skipped'},
      ]),
      false,
    );
  });

  it('is true when a test job passed or failed', () => {
    assert.equal(
      tested([
        {name: DECIDE_JOB, conclusion: 'success'},
        {name: 'test / Jest', conclusion: 'failure'},
      ]),
      true,
    );
  });

  it('is false for no jobs', () => {
    assert.equal(tested(undefined), false);
  });
});
