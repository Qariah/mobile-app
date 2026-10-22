// @ai
// Unit tests for scripts/lib/intake.mjs (the card's intake line).
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {classifyIntake} from '../lib/intake.mjs';

const NOW = Date.parse('2026-09-28T20:00:00Z');
const hAgo = h => new Date(NOW - h * 3_600_000).toISOString();
const run = (h, conclusion = 'success') => ({
  created_at: hAgo(h),
  status: 'completed',
  conclusion,
  html_url: 'https://github.com/o/r/actions/runs/1',
});
const issue = (number, labels, createdH) => ({
  number,
  labels,
  createdAt: hAgo(createdH),
});

describe('classifyIntake', () => {
  it('flowing when a collector filed an issue in the window', () => {
    const r = classifyIntake({
      now: NOW,
      runs: [run(12)],
      issues: [issue(1, ['sentry', 'bug'], 5)],
    });
    assert.equal(r.state, 'flowing');
    assert.equal(r.filed, 1);
    assert.match(r.line, /^Intake: flowing/);
  });

  it('flowing when the bot commented on an older collector issue', () => {
    const r = classifyIntake({
      now: NOW,
      runs: [run(12)],
      issues: [issue(2, [{name: 'play-store'}], 400)],
      botComments: [{issueNumber: 2}],
    });
    assert.equal(r.state, 'flowing');
    assert.equal(r.updated, 1);
  });

  it('a bot comment on an ops or digest issue is not intake', () => {
    const r = classifyIntake({
      now: NOW,
      runs: [run(12)],
      issues: [
        issue(3, ['ops'], 400),
        issue(4, ['triage-digest', 'sentry'], 400),
      ],
      botComments: [{issueNumber: 3}, {issueNumber: 4}],
    });
    assert.equal(r.state, 'quiet');
  });

  it('a new issue without a collector label is not intake', () => {
    const r = classifyIntake({
      now: NOW,
      runs: [run(12)],
      issues: [issue(5, ['enhancement'], 2)],
    });
    assert.equal(r.state, 'quiet');
    assert.match(r.line, /ran 12 h ago/);
  });

  it('starved when no run in 26 h', () => {
    const r = classifyIntake({now: NOW, runs: [run(40)], issues: []});
    assert.equal(r.state, 'starved');
    assert.match(r.line, /no run in 26 h; the last one started 40 h ago/);
  });

  it('starved when the only run in the window failed (the billing outage shape)', () => {
    const r = classifyIntake({now: NOW, runs: [run(10, 'failure')]});
    assert.equal(r.state, 'starved');
    assert.match(r.line, /ended "failure"/);
  });

  it('starved with no run at all', () => {
    assert.match(classifyIntake({now: NOW}).line, /no run found/);
  });

  it('an in-progress run does not count as a run', () => {
    const r = classifyIntake({
      now: NOW,
      runs: [{created_at: hAgo(1), status: 'in_progress', conclusion: null}],
    });
    assert.equal(r.state, 'starved');
  });
});
