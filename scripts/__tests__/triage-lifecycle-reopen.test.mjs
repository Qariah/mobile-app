#!/usr/bin/env node
// @ai
//
// scripts/__tests__/triage-lifecycle-reopen.test.mjs
// ----------------------------------------------------
// Node built-in test runner (node:test + node:assert) for the pure
// shouldReopen() / parseVersionCodeFromRelease() helpers exported from
// triage-lifecycle.mjs, plus a hermetic (no-network) smoke test of
// sentryReleaseVersionCode()'s "unset token → unknown" degrade path.
//
// Run:  node --test scripts/__tests__/triage-lifecycle-reopen.test.mjs
//
// scripts/triage-lifecycle.mjs's `main()` invocation at the bottom of the
// file is guarded (`if (import.meta.url === \`file://${process.argv[1]}\`)`)
// specifically so importing it here — to reach these pure helpers — can
// never trigger a live gh/Sentry/Play run (which could mutate real GitHub
// issues). Do NOT remove that guard; these tests rely on it staying in
// place, and removing it would make importing this module for any reason
// unsafe again.
//
// TECH_DEBT #172 — the reopen-on-recurrence pass reopened a CLOSED
// `fixed-in:<vc>` issue whenever the same signature's lastSeen cleared
// closedAt, with NO check on which build that recurrence event actually
// happened on. For Play that's implicitly safe (Play's own aggregation
// rolls `newestVersionCode` forward as new events land under the same
// errorIssue). For Sentry it is NOT — a Sentry shortId is a stable grouping
// key that never rolls forward with the build, so a pre-fix straggler event
// (a slow/stale device still on an OLD build) can mechanically reopen a
// genuinely-fixed issue. This happened for real to GH #164 (QARIAHV2-G,
// slow-cold-start): a Xiaomi Redmi lingering on stale builds 1353/1508 (both
// < the 1518 fix) reopened it after it was closed fixed-in:1518.
//
// These tests guard the fix's core invariant: a recurrence event whose build
// is KNOWN to be older than fixed-in must NOT reopen the issue; every other
// case (no fixed-in recorded, no recurrence at all, or the recurrence build
// being unknown/unresolvable) preserves the pre-existing conservative
// behaviour of reopening.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldReopen,
  parseVersionCodeFromRelease,
  sentryReleaseVersionCode,
} from '../triage-lifecycle.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed "closedAt" anchor so every test's timestamps are legible relative
// to it, rather than depending on Date.now() (which would make failures
// harder to read and, in principle, flake near a day boundary).
const CLOSED_AT = Date.parse('2026-07-01T00:00:00Z');

// ---------------------------------------------------------------------------
// (a) recurrence on a build OLDER than fixed-in must NOT reopen — the bug.
// ---------------------------------------------------------------------------
describe('shouldReopen — stale-build recurrence (the #172 bug)', () => {
  it('does NOT reopen when the recurrence build is known and < fixed-in', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 5 * DAY_MS, // clearly after close + grace
      closedAtMs: CLOSED_AT,
      fixedInVc: 1518,
      recurrenceVc: 1508, // older build — a pre-fix straggler
    });
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'stale-build');
  });

  // The exact real-world #164/QARIAHV2-G shape: fixed-in:1518, recurrence
  // events reported from a Xiaomi Redmi still on builds 1353 and 1508.
  it('does NOT reopen for the #164 shape (fixed-in:1518, recurrence vc1508)', () => {
    const decision = shouldReopen({
      lastSeenMs: Date.parse('2026-07-12T16:59:34Z'),
      closedAtMs: Date.parse('2026-07-05T00:00:00Z'),
      fixedInVc: 1518,
      recurrenceVc: 1508,
    });
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'stale-build');
  });

  it('does NOT reopen for the #164 shape (fixed-in:1518, recurrence vc1353)', () => {
    const decision = shouldReopen({
      lastSeenMs: Date.parse('2026-07-08T12:00:00Z'),
      closedAtMs: Date.parse('2026-07-05T00:00:00Z'),
      fixedInVc: 1518,
      recurrenceVc: 1353,
    });
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'stale-build');
  });

  it('does NOT reopen when the recurrence build equals fixed-in minus one', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 5 * DAY_MS,
      closedAtMs: CLOSED_AT,
      fixedInVc: 100,
      recurrenceVc: 99,
    });
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'stale-build');
  });
});

// ---------------------------------------------------------------------------
// (b) recurrence on a build AT or AFTER fixed-in DOES reopen — the fix did
// not hold, or it's a new instance of the same root cause.
// ---------------------------------------------------------------------------
describe('shouldReopen — genuine recurrence on a fixed-or-later build', () => {
  it('DOES reopen when the recurrence build is known and > fixed-in', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 5 * DAY_MS,
      closedAtMs: CLOSED_AT,
      fixedInVc: 1518,
      recurrenceVc: 1562, // newer build — the fix genuinely didn't hold
    });
    assert.equal(decision.reopen, true);
    assert.equal(decision.reason, 'recurred');
  });

  it('DOES reopen when the recurrence build EQUALS fixed-in (boundary — not older)', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 5 * DAY_MS,
      closedAtMs: CLOSED_AT,
      fixedInVc: 1518,
      recurrenceVc: 1518,
    });
    assert.equal(decision.reopen, true);
    assert.equal(decision.reason, 'recurred');
  });
});

// ---------------------------------------------------------------------------
// (c) unknown-build recurrence — chosen policy: stay conservative and
// reopen, exactly like the pre-existing (pre-#172-fix) behaviour, rather
// than risk silently suppressing a genuine recurrence just because we
// couldn't resolve a build for it this run (token unset, API hiccup, empty
// topValues, or no fixed-in marker was ever recorded in the first place —
// e.g. an issue closed via resolve-on-quiet rather than close-on-fix).
// ---------------------------------------------------------------------------
describe('shouldReopen — unknown build (conservative: reopen, do not newly suppress)', () => {
  it('DOES reopen when recurrenceVc could not be resolved (null) even though fixed-in is known', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 5 * DAY_MS,
      closedAtMs: CLOSED_AT,
      fixedInVc: 1518,
      recurrenceVc: null, // e.g. SENTRY_READ_TOKEN unset, or the tags query failed
    });
    assert.equal(decision.reopen, true);
    assert.equal(decision.reason, 'recurred');
  });

  it('DOES reopen when recurrenceVc is 0 (Play-style "unknown" sentinel)', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 5 * DAY_MS,
      closedAtMs: CLOSED_AT,
      fixedInVc: 1518,
      recurrenceVc: 0,
    });
    assert.equal(decision.reopen, true);
    assert.equal(decision.reason, 'recurred');
  });

  it('DOES reopen on any recurrence when NO fixed-in marker was ever recorded', () => {
    // The common case for issues closed via resolve-on-quiet, which embeds
    // no fixed-in:<vc> marker at all — there is nothing to compare a build
    // against, so any post-close recurrence is meaningful.
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 5 * DAY_MS,
      closedAtMs: CLOSED_AT,
      fixedInVc: undefined,
      recurrenceVc: 500, // even an old-looking build number — irrelevant, no baseline
    });
    assert.equal(decision.reopen, true);
    assert.equal(decision.reason, 'recurred');
  });

  it('DOES reopen when both fixedInVc and recurrenceVc are unknown', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 5 * DAY_MS,
      closedAtMs: CLOSED_AT,
    });
    assert.equal(decision.reopen, true);
    assert.equal(decision.reason, 'recurred');
  });
});

// ---------------------------------------------------------------------------
// Recurrence-detection itself (unchanged pre-existing semantics) — the
// build-aware guard must not alter WHETHER something counts as "recurred",
// only what happens once it has.
// ---------------------------------------------------------------------------
describe('shouldReopen — recurrence-after-close gate (pre-existing semantics preserved)', () => {
  it('does NOT reopen when lastSeen is before closedAt', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT - DAY_MS,
      closedAtMs: CLOSED_AT,
      fixedInVc: 1518,
      recurrenceVc: 1600,
    });
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'not-recurred');
  });

  it('does NOT reopen for a same-day close + lingering event inside the grace window', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 60 * 60 * 1000, // 1h after close — inside the 24h grace
      closedAtMs: CLOSED_AT,
    });
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'not-recurred');
  });

  it('treats lastSeen exactly at the grace boundary as NOT recurred (boundary is <=)', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + DAY_MS, // exactly closedAt + default 24h grace
      closedAtMs: CLOSED_AT,
    });
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'not-recurred');
  });

  it('DOES reopen one millisecond past the grace boundary', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + DAY_MS + 1,
      closedAtMs: CLOSED_AT,
    });
    assert.equal(decision.reopen, true);
    assert.equal(decision.reason, 'recurred');
  });

  it('respects a custom graceMs override', () => {
    const decision = shouldReopen({
      lastSeenMs: CLOSED_AT + 2 * DAY_MS,
      closedAtMs: CLOSED_AT,
      graceMs: 3 * DAY_MS, // wider than default — 2 days later still inside grace
    });
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'not-recurred');
  });

  it('does NOT reopen when lastSeenMs is missing/falsy', () => {
    const decision = shouldReopen({closedAtMs: CLOSED_AT});
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'no-recency');
  });

  it('does NOT reopen when closedAtMs is missing/falsy', () => {
    const decision = shouldReopen({lastSeenMs: CLOSED_AT + 5 * DAY_MS});
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'no-recency');
  });

  it('does NOT reopen for a totally empty call', () => {
    const decision = shouldReopen();
    assert.equal(decision.reopen, false);
    assert.equal(decision.reason, 'no-recency');
  });
});

// ---------------------------------------------------------------------------
// parseVersionCodeFromRelease — the release-string → versionCode parse that
// feeds recurrenceVc for the Sentry lane.
// ---------------------------------------------------------------------------
describe('parseVersionCodeFromRelease', () => {
  it('parses the standard Android release format', () => {
    assert.equal(
      parseVersionCodeFromRelease('com.qariah.app@3.1.8+1518'),
      1518,
    );
  });

  it('parses the same format as reported on #164/QARIAHV2-G', () => {
    assert.equal(
      parseVersionCodeFromRelease('com.qariah.app@3.1.8+1277'),
      1277,
    );
    assert.equal(
      parseVersionCodeFromRelease('com.qariah.app@3.1.8+1314'),
      1314,
    );
  });

  it('returns null for a release string with no trailing +build', () => {
    assert.equal(parseVersionCodeFromRelease('com.qariah.app@3.1.8'), null);
  });

  it('returns null for empty/undefined/null input', () => {
    assert.equal(parseVersionCodeFromRelease(''), null);
    assert.equal(parseVersionCodeFromRelease(undefined), null);
    assert.equal(parseVersionCodeFromRelease(null), null);
  });

  it('returns a Number, not a string', () => {
    const vc = parseVersionCodeFromRelease('com.qariah.app@3.1.8+1518');
    assert.equal(typeof vc, 'number');
  });
});

// ---------------------------------------------------------------------------
// sentryReleaseVersionCode — hermetic smoke test only (no network). Confirms
// the real function's degrade-to-null path when SENTRY_READ_TOKEN is unset,
// i.e. the actual mechanism behind the "unknown build" policy tested above,
// without depending on a live Sentry credential in the test environment.
// ---------------------------------------------------------------------------
describe('sentryReleaseVersionCode — degrade path (no network)', () => {
  it('resolves to null (unknown) without throwing when SENTRY_READ_TOKEN is unset', async () => {
    const prevToken = process.env.SENTRY_READ_TOKEN;
    delete process.env.SENTRY_READ_TOKEN;
    try {
      // A synthetic id guarantees this can never collide with a real,
      // already-memoized id from another test/run in the same process.
      const vc = await sentryReleaseVersionCode('test-fixture-no-token-id');
      assert.equal(vc, null);
    } finally {
      if (prevToken === undefined) delete process.env.SENTRY_READ_TOKEN;
      else process.env.SENTRY_READ_TOKEN = prevToken;
    }
  });

  it('resolves to null for a falsy issue id without making any call', async () => {
    assert.equal(await sentryReleaseVersionCode(null), null);
    assert.equal(await sentryReleaseVersionCode(undefined), null);
    assert.equal(await sentryReleaseVersionCode(''), null);
  });
});
