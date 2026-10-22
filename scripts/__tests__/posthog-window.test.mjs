#!/usr/bin/env node
// @ai
//
// scripts/__tests__/posthog-window.test.mjs
// -----------------------------------------
// node:test suite for scripts/lib/posthog-window.mjs (the halved-window retry
// that scripts/rollout-engagement.mjs uses on a PostHog timeout).
// Run:  node --test scripts/__tests__/posthog-window.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {isQueryTimeout, withWindowFallback} from '../lib/posthog-window.mjs';

const TIMEOUT = new Error(
  'PostHog 504: {"type":"server_error","detail":"Query has hit the max execution time"}',
);

describe('isQueryTimeout', () => {
  it('matches the 504 of 2026-10-06', () => {
    assert.equal(isQueryTimeout(TIMEOUT), true);
  });
  it('matches the max-execution text on another status', () => {
    assert.equal(
      isQueryTimeout(
        new Error('PostHog 500: Query has hit the max execution time'),
      ),
      true,
    );
  });
  it('matches the local fetch timeout', () => {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    assert.equal(isQueryTimeout(e), true);
  });
  it('does not match other errors', () => {
    assert.equal(isQueryTimeout(new Error('PostHog 401: bad token')), false);
    assert.equal(isQueryTimeout(new Error('row cap')), false);
    assert.equal(isQueryTimeout(undefined), false);
  });
});

describe('withWindowFallback', () => {
  it('uses the requested window when the query succeeds', async () => {
    const seen = [];
    const out = await withWindowFallback(30, async d => {
      seen.push(d);
      return 'ok';
    });
    assert.deepEqual(seen, [30]);
    assert.deepEqual(out, {
      result: 'ok',
      days: 30,
      requestedDays: 30,
      retried: false,
    });
  });
  it('retries once with half the days on a timeout, and says so', async () => {
    const seen = [];
    const out = await withWindowFallback(30, async d => {
      seen.push(d);
      if (d === 30) throw TIMEOUT;
      return 'ok';
    });
    assert.deepEqual(seen, [30, 15]);
    assert.deepEqual(out, {
      result: 'ok',
      days: 15,
      requestedDays: 30,
      retried: true,
    });
  });
  it('rounds an odd window up', async () => {
    const out = await withWindowFallback(7, async d => {
      if (d === 7) throw TIMEOUT;
      return d;
    });
    assert.equal(out.days, 4);
  });
  it('throws a second timeout instead of retrying again', async () => {
    const seen = [];
    await assert.rejects(
      withWindowFallback(30, async d => {
        seen.push(d);
        throw TIMEOUT;
      }),
      /PostHog 504/,
    );
    assert.deepEqual(seen, [30, 15]);
  });
  it('throws any other error without a retry', async () => {
    const seen = [];
    await assert.rejects(
      withWindowFallback(30, async d => {
        seen.push(d);
        throw new Error('PostHog 401: bad token');
      }),
      /401/,
    );
    assert.deepEqual(seen, [30]);
  });
  it('does not retry a 1-day window', async () => {
    await assert.rejects(
      withWindowFallback(1, async () => {
        throw TIMEOUT;
      }),
      /PostHog 504/,
    );
  });
});
