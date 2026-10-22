#!/usr/bin/env node
// @ai
//
// scripts/__tests__/release-watch.test.mjs
// ----------------------------------------
// node:test suite for scripts/lib/release-watch.mjs — the RELEASE WATCH
// build filter that scripts/daily-card.mjs uses in a shallow clone.
// Run:  node --test scripts/__tests__/release-watch.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productionBuilds, shallowWatchBuilds} from '../lib/release-watch.mjs';

// The shape of docs/operations/active-rollout.json on 2026-09-27.
const cfg = {
  active: false,
  build: 1717,
  sentryReleaseIos: 'com.qariah.app@3.2.1+1718',
  engagement: {
    buildsToWatch: ['1712', '1713', '1717', '1718', '1726', '1769', '2025'],
  },
};

describe('productionBuilds', () => {
  it('reads Android from `build` and iOS from `sentryReleaseIos`', () => {
    assert.deepEqual(productionBuilds(cfg), {android: 1717, ios: 1718});
  });
  it('is null when either platform is missing or unreadable', () => {
    assert.equal(productionBuilds({...cfg, build: undefined}), null);
    assert.equal(productionBuilds({...cfg, sentryReleaseIos: undefined}), null);
    assert.equal(
      productionBuilds({...cfg, sentryReleaseIos: 'com.qariah.app@3.2.1'}),
      null,
    );
    assert.equal(productionBuilds(null), null);
  });
});

describe('shallowWatchBuilds', () => {
  it('keeps only builds above the production build of BOTH platforms', () => {
    // 1718 is the iOS production build, so it is not new; 1712-1717 are older.
    assert.deepEqual(shallowWatchBuilds(cfg), ['1726', '1769', '2025']);
  });
  it('uses the higher platform, whichever it is', () => {
    const iosBehind = {
      ...cfg,
      build: 1769,
      sentryReleaseIos: 'com.qariah.app@3.2.1+1718',
    };
    assert.deepEqual(shallowWatchBuilds(iosBehind), ['2025']);
  });
  it('lists only builds the file records as shipped', () => {
    // 1800 is above production but not in buildsToWatch, so it never appears.
    const out = shallowWatchBuilds(cfg);
    assert.ok(!out.includes('1800'));
    assert.ok(out.every(b => cfg.engagement.buildsToWatch.includes(b)));
  });
  it('accepts numbers in buildsToWatch and ignores junk', () => {
    const mixed = {
      ...cfg,
      engagement: {buildsToWatch: [1726, 'x', '', '2025']},
    };
    assert.deepEqual(shallowWatchBuilds(mixed), ['1726', '2025']);
  });
  it('is null (print no build lines) when the file cannot answer', () => {
    assert.equal(shallowWatchBuilds({...cfg, build: undefined}), null);
    assert.equal(
      shallowWatchBuilds({...cfg, sentryReleaseIos: undefined}),
      null,
    );
    assert.equal(shallowWatchBuilds({...cfg, engagement: {}}), null);
    assert.equal(shallowWatchBuilds(undefined), null);
  });
  it('never lists a production build from the real rollout file', () => {
    const real = JSON.parse(
      readFileSync(
        new URL('../../docs/operations/active-rollout.json', import.meta.url),
        'utf8',
      ),
    );
    const prod = productionBuilds(real);
    assert.ok(prod, 'the rollout file names both production builds');
    for (const b of shallowWatchBuilds(real))
      assert.ok(Number(b) > Math.max(prod.android, prod.ios));
  });
});
