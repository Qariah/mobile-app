#!/usr/bin/env node
// @ai
//
// scripts/__tests__/v1-restore-watch.test.mjs
// -------------------------------------------
// Pure-function tests for scripts/lib/v1-restore-watch.mjs.
//
// Run:  node --test scripts/__tests__/v1-restore-watch.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  decide,
  MIN_CHECKS,
  recentAnswer,
  renderBody,
  RETIRE_BELOW,
  RETIRE_KEY,
  rowToCounts,
  SNOOZE_DAYS,
  watchQuery,
} from '../lib/v1-restore-watch.mjs';

describe('watchQuery', () => {
  it('counts people with a real restore, lab devices excluded', () => {
    const q = watchQuery({labSQL: '(1 = 1)'});
    assert.match(q, /event = 'v1_restore_checked'/);
    assert.match(q, /event = 'v1_restore_merged'/);
    assert.match(q, /toFloat\(properties\.candidate_total\), 0\) > 0/);
    assert.match(q, /INTERVAL 30 DAY/);
    assert.ok(q.includes('(1 = 1)'));
  });

  it('refuses a missing lab filter and a bad window', () => {
    assert.throws(() => watchQuery({}), /labSQL/);
    assert.throws(
      () => watchQuery({labSQL: '1', days: '30; DROP'}),
      /positive integer/,
    );
  });
});

describe('rowToCounts', () => {
  it('reads the first row, and an empty result as zero', () => {
    assert.deepEqual(rowToCounts([[577, '19']]), {checked: 577, restored: 19});
    assert.deepEqual(rowToCounts([]), {checked: 0, restored: 0});
  });
});

describe('decide', () => {
  it('keeps the restore at the threshold and above', () => {
    assert.equal(decide({checked: 577, restored: 19}).state, 'keep');
    const d = decide({checked: 577, restored: RETIRE_BELOW});
    assert.equal(d.state, 'keep');
    assert.equal(d.key, undefined);
  });

  it('asks to retire below the threshold', () => {
    const d = decide({checked: 400, restored: RETIRE_BELOW - 1});
    assert.equal(d.state, 'retire');
    assert.equal(d.key, RETIRE_KEY);
    assert.equal(d.kind, 'decision');
    assert.equal(d.priority, 'P2');
    assert.match(d.title, /4 restores in 30 days/);
  });

  it('files nothing when PostHog has no data', () => {
    const d = decide({checked: MIN_CHECKS - 1, restored: 0});
    assert.equal(d.state, 'no-data');
    assert.equal(d.key, undefined);
  });
});

describe('recentAnswer', () => {
  const now = new Date('2026-12-20T00:00:00Z');
  const item = (closedAt, key = RETIRE_KEY, state = 'closed') => ({
    number: 1,
    state,
    closedAt,
    body: `<!-- owner-queue:${key} -->\n\n- kind: decision`,
  });

  it('snoozes for SNOOZE_DAYS after the owner answered', () => {
    assert.ok(recentAnswer([item('2026-12-01T00:00:00Z')], {now}));
    const old = new Date(
      now.getTime() - (SNOOZE_DAYS + 1) * 86400000,
    ).toISOString();
    assert.equal(recentAnswer([item(old)], {now}), null);
  });

  it('ignores open items and other keys', () => {
    assert.equal(recentAnswer([item(null, RETIRE_KEY, 'open')], {now}), null);
    assert.equal(
      recentAnswer([item('2026-12-01T00:00:00Z', 'pump-experiment-result')], {
        now,
      }),
      null,
    );
  });
});

describe('renderBody', () => {
  it('leads with the impact and gives the two replies', () => {
    const body = renderBody({checked: 300, restored: 3});
    assert.match(body, /^\*\*Impact:\*\* 3 people got their v1 favorites back/);
    assert.match(body, /`retire v1 restore`/);
    assert.match(body, /`keep v1 restore`/);
    assert.match(body, /TECH_DEBT #137/);
  });
});
