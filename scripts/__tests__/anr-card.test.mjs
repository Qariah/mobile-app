#!/usr/bin/env node
// @ai
//
// scripts/__tests__/anr-card.test.mjs
// -----------------------------------
// Pure-function tests for scripts/lib/anr-card.mjs.
//
// Run:  node --test scripts/__tests__/anr-card.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAY_BAD_BAR,
  buildOfRelease,
  compareVersions,
  latestV2Hang,
  markObserved,
  pooledRate,
  renderAnrCard,
  v2VersionCodes,
} from '../lib/anr-card.mjs';

describe('v2VersionCodes', () => {
  it('drops the v1 Flutter codes 35 and 1255', () => {
    assert.deepEqual(
      v2VersionCodes(['35', '1255', '1717', '1712']),
      [1712, 1717],
    );
  });
  it('dedupes and ignores non-numbers', () => {
    assert.deepEqual(v2VersionCodes(['1717', 1717, undefined, 'x']), [1717]);
  });
});

describe('compareVersions', () => {
  it('orders numerically, not as strings', () => {
    assert.ok(compareVersions('3.10.0', '3.2.1') > 0);
    assert.equal(compareVersions('3.1', '3.1.0'), 0);
    assert.ok(compareVersions('3.0.1', '3.1.0') < 0);
  });
});

describe('buildOfRelease', () => {
  it('reads the build suffix', () => {
    assert.equal(buildOfRelease('com.qariah.app@3.2.0+1717'), '1717');
    assert.equal(buildOfRelease('com.qariah.app@3.2.0'), undefined);
  });
});

describe('pooledRate', () => {
  const day = (hit, active, observed = true) => ({hit, active, observed});

  it('weights by user-days, not by averaging daily rates', () => {
    // 1/10 and 0/90: mean of rates is 5%, pooled is 1%.
    assert.equal(pooledRate([day(1, 10), day(0, 90)], 2), 0.01);
  });
  it('uses only the last `len` days', () => {
    assert.equal(pooledRate([day(50, 50), day(1, 100)], 1), 0.01);
  });
  it('leaves unobserved days out of both sides', () => {
    assert.equal(pooledRate([day(0, 500, false), day(2, 100)], 2), 0.02);
  });
  it('returns null when fewer than half the days were observed', () => {
    const days = [day(1, 100), day(0, 5, false), day(0, 5, false)];
    assert.equal(pooledRate(days, 3), null);
  });
  it('returns null with no active users', () => {
    assert.equal(pooledRate([day(0, 0)], 1), null);
  });
});

describe('markObserved', () => {
  it('flags the 2026-08-26 quota-blackout days, keeps normal low days', () => {
    const totals = {
      '08-24': 60,
      '08-25': 30,
      '08-26': 3,
      '08-27': 4,
      '08-28': 8,
      '08-31': 11,
      '09-01': 70,
      '09-02': 70,
      '09-03': 72,
      '09-04': 59,
      '09-05': 60,
    };
    const o = markObserved(totals);
    assert.equal(o['08-25'], true);
    assert.equal(o['08-26'], false);
    assert.equal(o['08-28'], false);
    assert.equal(o['08-31'], false);
    assert.equal(o['09-01'], true);
  });
  it('treats an empty input as no days', () => {
    assert.deepEqual(markObserved({}), {});
  });
});

describe('latestV2Hang', () => {
  const ds = (percentile, device, points) => ({
    filterCriteria: {percentile, device},
    points,
  });
  const body = datasets => ({
    productData: [
      {metricCategories: [{identifier: 'HANG', metrics: [{datasets}]}]},
    ],
  });

  it('ignores v1 versions and reports the newest v2 version', () => {
    const r = latestV2Hang(
      body([
        ds('percentile.fifty', 'all_iphones', [
          {version: '3.0.1', value: 0},
          {version: '3.2.0', value: 0.1},
          {version: '3.2.1', value: 0.2},
        ]),
        ds('percentile.ninety', 'all_iphones', [
          {version: '3.2.1', value: 2.5},
        ]),
        ds('percentile.ninety', 'iPhone12,1', [{version: '3.2.1', value: 9}]),
      ]),
    );
    assert.deepEqual(r, {version: '3.2.1', p50: 0.2, p90: 2.5});
  });
  it('says so when only v1 has data', () => {
    const r = latestV2Hang(
      body([
        ds('percentile.fifty', 'all_iphones', [{version: '3.0.1', value: 0}]),
      ]),
    );
    assert.deepEqual(r, {none: true, newestAny: '3.0.1'});
  });
});

describe('renderAnrCard', () => {
  const sentry = {
    date: '2026-09-15',
    observed28: 22,
    android: {day: 0.016, d7: 0.0127, d28: null, active: 188},
    hangs: {day: 0.0041, d7: 0.0011, d28: null, active: 242},
    killed: {day: 0, d7: 0.0011, d28: null, active: 242},
  };
  const play = {
    date: '2026-09-14',
    day: 0.0428,
    d7: 0.0217,
    d28: 0.0214,
    users: '200',
    series: [
      {date: '2026-09-13', rate: 0.0179},
      {date: '2026-09-14', rate: 0.0428},
    ],
  };
  const text = m => renderAnrCard(m, '2026-09-16').join('\n');

  it('renders all three windows and the bad-bar verdict', () => {
    const t = text({play, sentry, appStore: {none: true}});
    assert.match(t, /Play · seen {7}4\.28 {3}2\.17 {3}2\.14/);
    assert.match(t, /7d is 4\.6× over/);
    assert.match(t, /Sentry {12}1\.60 {3}1\.27 {6}—/);
    assert.match(t, /Sentry saw 22 of 28 days/);
    assert.match(t, /v2: no data yet/);
    assert.match(t, /09-14 {3}4\.28 {2}▓{9}/);
    assert.doesNotMatch(t, /Play · all/);
  });
  it('prints unavailable and errors, never a zero', () => {
    const t = text({play: null, sentry: {error: 'Sentry 401'}, appStore: null});
    assert.match(t, /Play · seen {6}unavailable/);
    assert.match(t, /error: Sentry 401/);
    assert.doesNotMatch(t, /LAST 7 DAYS/);
    assert.doesNotMatch(t, /0\.00/);
  });
  it('marks a 7d rate under the bar as under', () => {
    const t = text({
      play: {...play, d7: PLAY_BAD_BAR / 2},
      sentry: null,
      appStore: {version: '3.2.1', p50: 0.1, p90: 1},
    });
    assert.match(t, /✅ 7d under/);
    assert.match(t, /3\.2\.1 hangs 1 s\/h p90/);
  });
  it('keeps every line phone-narrow', () => {
    const t = text({
      play,
      sentry,
      appStore: {version: '3.2.1', p50: 0.12, p90: 2.25},
    });
    for (const line of t.split('\n')) assert.ok([...line].length <= 48, line);
  });
});
