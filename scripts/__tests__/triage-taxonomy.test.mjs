#!/usr/bin/env node
// @ai
//
// scripts/__tests__/triage-taxonomy.test.mjs
// -------------------------------------------
// node:test suite for classify() — the single arbiter of which issues the fix
// loop may draft from. Run:  node --test scripts/__tests__/triage-taxonomy.test.mjs
//
// Guards the feedback-graph promotion edge: a human-lane issue reaches the loop
// ONLY through the `loop-actionable` label (rule 4b), `needs-decision` beats a
// mislabelled `bug` (rule 4a), and a hand-filed `feedback` issue never becomes
// actionable on its own.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {classify, BUCKETS} from '../lib/triage-taxonomy.mjs';

const issue = (labels, title = 'x', number = 1) => ({labels, title, number});

describe('classify — promotion edge (rule 4b)', () => {
  it('TestFlight issue without promotion stays feedback', () => {
    const r = classify(issue(['testflight', 'bug', 'audio']));
    assert.equal(r.bucket, 'feedback');
    assert.equal(r.loopEligible, false);
  });
  it('TestFlight issue WITH loop-actionable becomes actionable + loop-eligible', () => {
    const r = classify(issue(['testflight', 'audio', 'loop-actionable']));
    assert.equal(r.bucket, 'actionable');
    assert.equal(r.loopEligible, true);
  });
  it('store review WITH loop-actionable becomes actionable', () => {
    const r = classify(
      issue(
        ['user-review', 'play-store', 'loop-actionable'],
        '[Play ★1] stops',
      ),
    );
    assert.equal(r.bucket, 'actionable');
  });
  it('email lane issue without promotion is feedback', () => {
    assert.equal(classify(issue(['email', 'feedback'])).bucket, 'feedback');
  });
  it('promoted but pinned-open is actionable yet NOT loop-eligible', () => {
    const r = classify(issue(['testflight', 'loop-actionable'], 'x', 7), {
      pinnedOpen: new Set([7]),
    });
    assert.equal(r.bucket, 'actionable');
    assert.equal(r.loopEligible, false);
  });
  it('promoted but fixed-in-build is NOT loop-eligible', () => {
    const r = classify(issue(['testflight', 'loop-actionable'], 'x', 8), {
      fixedInBuild: new Map([[8, '1717']]),
    });
    assert.equal(r.loopEligible, false);
    assert.match(r.reason, /1717/);
  });
});

describe('classify — rules 1–4 still win over promotion', () => {
  it('remediation-drafted beats loop-actionable', () => {
    assert.equal(
      classify(issue(['loop-actionable', 'remediation-drafted'])).bucket,
      'awaiting-merge',
    );
  });
  it('wontfix beats loop-actionable', () => {
    assert.equal(
      classify(issue(['loop-actionable', 'wontfix'])).bucket,
      'wontfix',
    );
  });
  it('incident umbrella beats loop-actionable', () => {
    assert.equal(
      classify(issue(['incident', 'loop-actionable'], '[incident] x')).bucket,
      'incident',
    );
  });
  it('release-health beats loop-actionable', () => {
    assert.equal(
      classify(issue(['release-health', 'loop-actionable'])).bucket,
      'release-health',
    );
  });
});

describe('classify — needs-decision (rule 4a)', () => {
  it('needs-decision beats bug', () => {
    const r = classify(issue(['bug', 'needs-decision']));
    assert.equal(r.bucket, 'decision');
    assert.equal(r.loopEligible, false);
  });
  it('needs-decision beats loop-actionable (a decision pauses the fix)', () => {
    assert.equal(
      classify(issue(['loop-actionable', 'needs-decision'])).bucket,
      'decision',
    );
  });
  it('decision bucket exists and is never loop-eligible', () => {
    assert.equal(BUCKETS.decision.loopEligible, false);
  });
});

describe('classify — hand-filed issues', () => {
  it('hand-filed `feedback` (repaired template) lands in feedback, never the loop', () => {
    const r = classify(issue(['feedback']));
    assert.equal(r.bucket, 'feedback');
    assert.equal(r.loopEligible, false);
  });
  it('hand-filed `feedback` + `bug` (someone added bug by hand) is STILL feedback', () => {
    assert.equal(classify(issue(['feedback', 'bug'])).bucket, 'feedback');
  });
  it('hand-filed `enhancement` is a feature request', () => {
    assert.equal(classify(issue(['enhancement'])).bucket, 'feature-request');
  });
  it('sentry-lane bug is actionable (unchanged behaviour)', () => {
    const r = classify(issue(['sentry', 'bug', 'severity:high']));
    assert.equal(r.bucket, 'actionable');
    assert.equal(r.loopEligible, true);
  });
});
