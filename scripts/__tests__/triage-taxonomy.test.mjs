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
//
// It also guards the fix record: an issue leaves the loop queue on EITHER a
// `fixed-in:<build>` label or a triage-state ledger row, so a build that already
// carries the fix cannot be re-investigated the next day.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  BUCKETS,
  fixedInLabelOf,
  resolveFixedIn,
} from '../lib/triage-taxonomy.mjs';

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

describe('classify — fixed-in:<build> label (label OR ledger)', () => {
  it('a sentry bug with a fixed-in label waits for a release, NOT loop-eligible', () => {
    // The real #409 shape on 2026-09-11: post-sprint Step 14b labelled it
    // `fixed-in:1922`, the ledger had no row yet, and the loop re-queued it.
    const r = classify(
      issue(
        ['sentry', 'bug', 'severity:high', 'android', 'fixed-in:1922'],
        '[Sentry QARIAHV2-30] RemoteServiceException',
        409,
      ),
    );
    assert.equal(r.bucket, 'awaiting-release');
    assert.equal(r.loopEligible, false);
    assert.equal(r.fixedIn, '1922');
    assert.match(r.reason, /1922/);
  });
  it('a promoted human-lane issue with a fixed-in label is NOT loop-eligible', () => {
    const r = classify(
      issue(['testflight', 'loop-actionable', 'fixed-in:1769'], 'x', 11),
    );
    assert.equal(r.bucket, 'awaiting-release');
    assert.equal(r.loopEligible, false);
    assert.equal(r.fixedIn, '1769');
  });
  it('no fixed-in label and no ledger row stays loop-eligible', () => {
    const r = classify(issue(['sentry', 'bug'], 'x', 12));
    assert.equal(r.loopEligible, true);
    assert.equal(r.fixedIn, null);
  });
  it('ignores a malformed fixed-in label', () => {
    const r = classify(issue(['sentry', 'bug', 'fixed-in:next'], 'x', 13));
    assert.equal(r.loopEligible, true);
    assert.equal(r.fixedIn, null);
  });
  it('a fixed Play ANR leaves native-crash for awaiting-release', () => {
    // The 2026-09-27 backfill shape: build 1975 carries #451, behind a flag.
    const r = classify(
      issue(
        [
          'play-store',
          'anr',
          'incident:cold-start-hang',
          'fixed-in:1975',
          'behind-flag:nonblocking_splash',
        ],
        '[Play ANR] x @ Input dispatching timed out (No focused window)',
        275,
      ),
    );
    assert.equal(r.bucket, 'awaiting-release');
    assert.equal(r.loopEligible, false);
    assert.equal(r.incident, 'cold-start-hang');
  });
  it('a fixed-in label beats remediation-drafted (an adopted draft that shipped)', () => {
    const r = classify(
      issue(['sentry', 'bug', 'remediation-drafted', 'fixed-in:2013'], 'x', 15),
    );
    assert.equal(r.bucket, 'awaiting-release');
  });
  it('the incident umbrella stays an incident even with a fixed-in label', () => {
    const r = classify(
      issue(
        ['incident', 'incident:cold-start-hang', 'fixed-in:1975'],
        '[incident] cold-start-hang',
        187,
      ),
    );
    assert.equal(r.bucket, 'incident');
  });
  it('the ledger alone still works (unchanged behaviour)', () => {
    const r = classify(issue(['sentry', 'bug'], 'x', 14), {
      fixedInBuild: new Map([[14, '1717']]),
    });
    assert.equal(r.loopEligible, false);
    assert.equal(r.fixedIn, '1717');
  });
});

describe('resolveFixedIn — which build wins', () => {
  it('returns null when neither source has a value', () => {
    assert.equal(resolveFixedIn(null, null), null);
  });
  it('takes the label when only the label has a value', () => {
    assert.equal(resolveFixedIn('1922', null), '1922');
  });
  it('takes the ledger when only the ledger has a value', () => {
    assert.equal(resolveFixedIn(null, '1717'), '1717');
  });
  it('takes the HIGHER build when both are numbers', () => {
    assert.equal(resolveFixedIn('1922', '1717'), '1922');
    assert.equal(resolveFixedIn('1717', '1922'), '1922');
  });
  it('takes the numeric side when the ledger holds the `merged` sentinel', () => {
    assert.equal(resolveFixedIn('1922', 'merged'), '1922');
  });
});

describe('fixedInLabelOf', () => {
  it('reads the build out of a well-formed label', () => {
    assert.equal(fixedInLabelOf(['bug', 'fixed-in:1922']), '1922');
  });
  it('rejects a non-numeric build', () => {
    assert.equal(fixedInLabelOf(['fixed-in:1922-hotfix']), null);
    assert.equal(fixedInLabelOf(['prefix-fixed-in:1922']), null);
  });
  it('returns null for an empty label set', () => {
    assert.equal(fixedInLabelOf([]), null);
    assert.equal(fixedInLabelOf(undefined), null);
  });
});
