#!/usr/bin/env node
// @ai
//
// scripts/__tests__/triage-common-pages.test.mjs
// ----------------------------------------------
// node:test suite for collectPages() in scripts/lib/triage-common.mjs — the
// hand pagination that replaced `gh api --paginate` (the Claude Cloud GitHub
// proxy refuses the `repositories/{id}/...` URLs that --paginate follows).
// Run:  node --test scripts/__tests__/triage-common-pages.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {collectPages, MAX_PAGES, PAGE_SIZE} from '../lib/triage-common.mjs';

const pageOf = (n, start = 0) =>
  Array.from({length: n}, (_, i) => ({id: start + i}));

describe('collectPages', () => {
  it('uses pages of 100 and a cap of 50 pages by default', () => {
    assert.equal(PAGE_SIZE, 100);
    assert.equal(MAX_PAGES, 50);
  });
  it('stops at the first short page and keeps the order', () => {
    const asked = [];
    const out = collectPages(p => {
      asked.push(p);
      return p === 1
        ? pageOf(100)
        : p === 2
          ? pageOf(100, 100)
          : pageOf(7, 200);
    });
    assert.deepEqual(asked, [1, 2, 3]);
    assert.equal(out.length, 207);
    assert.deepEqual(
      out.map(r => r.id),
      Array.from({length: 207}, (_, i) => i),
    );
  });
  it('reads one page when the first page is short', () => {
    const asked = [];
    const out = collectPages(p => {
      asked.push(p);
      return pageOf(3);
    });
    assert.equal(out.length, 3);
    assert.deepEqual(asked, [1]);
  });
  it('asks for one more page after an exactly full page', () => {
    const asked = [];
    const out = collectPages(p => {
      asked.push(p);
      return p === 1 ? pageOf(100) : [];
    });
    assert.deepEqual(asked, [1, 2]);
    assert.equal(out.length, 100);
  });
  it('fails loudly when every page up to the cap is full', () => {
    let calls = 0;
    assert.throws(
      () =>
        collectPages(
          () => {
            calls++;
            return pageOf(10);
          },
          {
            perPage: 10,
            maxPages: 4,
            what: 'issues',
          },
        ),
      /issues: stopped after 4 full pages \(40 items\); the list is incomplete/,
    );
    assert.equal(calls, 4);
  });
  it('fails when a page is not an array', () => {
    assert.throws(
      () => collectPages(() => ({message: 'x'}), {what: 'pulls'}),
      /pulls: page 1 is not a JSON array/,
    );
  });
});
