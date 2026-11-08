#!/usr/bin/env node
// @ai
//
// scripts/__tests__/upstream-queue.test.mjs — node:test suite for
// scripts/lib/upstream-queue.mjs (the open Qariah PRs on thebayaan/Bayaan).
// Run:  node --test scripts/__tests__/upstream-queue.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  PING_DAYS,
  QUEUE_LIMIT,
  queueItem,
  renderTable,
  roundUpText,
  summarize,
} from '../lib/upstream-queue.mjs';

const NOW = '2026-11-06T12:00:00Z';
const ctx = {now: NOW, us: 'omar-zarka'};
const pr = (number, created, extra = {}) => ({
  number,
  title: `PR ${number}`,
  created_at: created,
  updated_at: created,
  draft: false,
  head: {ref: `b/${number}`},
  ...extra,
});

describe('queueItem', () => {
  it('a PR with no activity waits on the maintainer', () => {
    const i = queueItem(pr(317, '2026-07-23T05:18:33Z'), {}, ctx);
    assert.equal(i.ageDays, 106);
    assert.equal(i.idleDays, 106);
    assert.equal(i.waitsOn, 'maintainer (no review yet)');
    assert.equal(i.lastBy, null);
  });
  it('the last event decides who waits', () => {
    const ours = queueItem(
      pr(1, '2026-11-01T00:00:00Z'),
      {lastComment: {user: 'omar-zarka', at: '2026-11-03T00:00:00Z'}},
      ctx,
    );
    assert.equal(ours.waitsOn, 'maintainer');
    assert.equal(ours.idleDays, 3);
    const theirs = queueItem(
      pr(2, '2026-11-01T00:00:00Z'),
      {
        lastReview: {
          user: 'osman',
          state: 'CHANGES_REQUESTED',
          at: '2026-11-05T00:00:00Z',
        },
      },
      ctx,
    );
    assert.equal(theirs.waitsOn, 'us');
    const approved = queueItem(
      pr(3, '2026-11-01T00:00:00Z'),
      {
        lastReview: {
          user: 'osman',
          state: 'APPROVED',
          at: '2026-11-02T00:00:00Z',
        },
        lastComment: {user: 'osman', at: '2026-11-01T12:00:00Z'},
      },
      ctx,
    );
    assert.equal(approved.waitsOn, 'maintainer (approved, not merged)');
    assert.equal(approved.lastAt, '2026-11-02T00:00:00Z');
  });
  it('a draft waits on us', () => {
    assert.equal(
      queueItem(pr(4, '2026-11-01T00:00:00Z', {draft: true}), {}, ctx).waitsOn,
      'us (draft)',
    );
  });
});

describe('summarize and renderTable', () => {
  const items = [
    queueItem(pr(317, '2026-07-23T00:00:00Z'), {}, ctx),
    queueItem(
      pr(363, '2026-10-13T00:00:00Z'),
      {
        lastReview: {
          user: 'osman',
          state: 'APPROVED',
          at: '2026-10-17T00:00:00Z',
        },
      },
      ctx,
    ),
    queueItem(
      pr(493, '2026-11-03T00:00:00Z'),
      {
        lastReview: {
          user: 'osman',
          state: 'CHANGES_REQUESTED',
          at: '2026-11-04T00:00:00Z',
        },
      },
      ctx,
    ),
  ];
  it('counts, orders by age and applies the limit', () => {
    const s = summarize(items);
    assert.equal(s.limit, QUEUE_LIMIT);
    assert.equal(s.open, 3);
    assert.equal(s.canPropose, true);
    assert.equal(s.onMaintainer, 2);
    assert.equal(s.onUs, 1);
    assert.equal(s.oldestIdleDays, 106);
    assert.equal(s.roundUpDue, true);
    assert.deepEqual(
      s.items.map(i => i.number),
      [317, 363, 493],
    );
  });
  it('refuses over the limit', () => {
    const many = Array.from({length: 7}, (_, i) =>
      queueItem(pr(i + 1, '2026-11-01T00:00:00Z'), {}, ctx),
    );
    const s = summarize(many);
    assert.equal(s.overLimit, true);
    assert.equal(s.canPropose, false);
    assert.equal(summarize(many.slice(0, 6)).canPropose, true);
  });
  it('no round-up when every wait is short', () => {
    const s = summarize([queueItem(pr(1, '2026-11-04T00:00:00Z'), {}, ctx)]);
    assert.equal(s.roundUpDue, false);
    assert.equal(roundUpText(s), '');
  });
  it('renders the table', () => {
    const md = renderTable(summarize(items));
    assert.match(md, /^Open Qariah PRs on thebayaan\/Bayaan: 3 \(limit 6\)/);
    assert.match(
      md,
      /\| \[#317\]\(https:\/\/github.com\/thebayaan\/Bayaan\/pull\/317\) \| PR 317 \| 106 \| 106 \| — \| maintainer \(no review yet\) \|/,
    );
  });
});

describe('roundUpText', () => {
  it('names the oldest waiting PR as the target and lists only the ones past the ping threshold', () => {
    const s = summarize([
      queueItem(pr(317, '2026-07-23T00:00:00Z'), {}, ctx),
      queueItem(
        pr(363, '2026-10-13T00:00:00Z'),
        {
          lastReview: {
            user: 'osman',
            state: 'APPROVED',
            at: '2026-10-17T00:00:00Z',
          },
        },
        ctx,
      ),
      queueItem(
        pr(481, '2026-10-31T00:00:00Z'),
        {
          lastReview: {
            user: 'osman',
            state: 'APPROVED',
            at: '2026-11-02T00:00:00Z',
          },
        },
        ctx,
      ),
    ]);
    const text = roundUpText(s, {maintainer: 'osman'});
    assert.match(text, /^<!-- round-up target: #317 -->/);
    assert.match(text, /Hi @osman/);
    assert.match(
      text,
      /- #317 PR 317 — open 106 days, no activity for 106 days. It waits for your review./,
    );
    assert.match(
      text,
      /- #363 PR 363 — open 24 days, no activity for 20 days. Approved; it waits for a merge./,
    );
    assert.ok(!text.includes('#481'), 'a 4-day wait is under the threshold');
    assert.equal(PING_DAYS, 7);
  });
});
