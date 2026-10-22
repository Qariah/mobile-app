#!/usr/bin/env node
// @ai
//
// scripts/__tests__/card-layout.test.mjs
// --------------------------------------
// Pure-function tests for scripts/lib/card-layout.mjs (the top half of the
// daily card).
//
// Run:  node --test scripts/__tests__/card-layout.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  WIDTH,
  buildLines,
  cardBuilds,
  renderActive,
  renderHeader,
  renderJourney,
  renderUse,
  wrap,
} from '../lib/card-layout.mjs';

const ROLLOUT = JSON.parse(
  readFileSync(
    new URL('../../docs/operations/active-rollout.json', import.meta.url),
    'utf8',
  ),
);

describe('cardBuilds', () => {
  it('reads card.builds', () => {
    assert.deepEqual(
      cardBuilds({
        card: {
          builds: [
            {platform: 'iOS', release: 'com.qariah.app@3.2.1+1718'},
            {platform: 'Android', release: 'com.qariah.app@3.2.0+1717'},
            {platform: 'Web', release: 'com.qariah.app@1.0.0+1'},
            {platform: 'Android', release: 'not a release'},
          ],
        },
      }),
      [
        {platform: 'iOS', version: '3.2.1', build: '1718'},
        {platform: 'Android', version: '3.2.0', build: '1717'},
      ],
    );
  });
  it('falls back to the current release of each platform', () => {
    assert.deepEqual(
      cardBuilds({
        sentryReleaseIos: 'com.qariah.app@3.2.1+1718',
        sentryRelease: 'com.qariah.app@3.2.1+2027',
      }),
      [
        {platform: 'iOS', version: '3.2.1', build: '1718'},
        {platform: 'Android', version: '3.2.1', build: '2027'},
      ],
    );
    assert.deepEqual(cardBuilds(null), []);
  });
  it('the rollout file names a production build on each platform', () => {
    const builds = cardBuilds(ROLLOUT);
    assert.ok(builds.some(b => b.platform === 'iOS'));
    assert.ok(builds.some(b => b.platform === 'Android'));
  });
});

describe('wrap', () => {
  it('keeps the leading spaces and indents the next lines', () => {
    assert.deepEqual(
      wrap('  Android vc2027 40% staged, DECISION DUE', 24, '    '),
      ['  Android vc2027 40%', '    staged, DECISION DUE'],
    );
  });
  it('keeps a long word whole', () => {
    assert.deepEqual(wrap('a ' + 'x'.repeat(50), 20), [
      'a',
      `  ${'x'.repeat(50)}`,
    ]);
  });
});

describe('renderHeader', () => {
  const builds = [
    {platform: 'iOS', version: '3.2.1', build: '1718'},
    {platform: 'Android', version: '3.2.0', build: '1717'},
    {platform: 'Android', version: '3.2.1', build: '2027'},
  ];
  const lines = renderHeader({
    date: '2026-10-11',
    weekday: 'Sun',
    windowLabel: 'since launch (2026-09-28)',
    builds,
    ios: '3.2.1 (1718) phased release COMPLETE 100%',
    android: 'vc2027 40% staged, 182 h, DECISION DUE (see report)',
  });
  it('names the date, the window and each counted build', () => {
    assert.equal(lines[0], 'QARIAH · Sun 2026-10-11');
    assert.equal(lines[1], 'Counted since launch (2026-09-28):');
    assert.deepEqual(buildLines(builds), [
      'iOS 1718 (3.2.1)',
      'Android 1717 (3.2.0), 2027 (3.2.1)',
    ]);
    assert.ok(lines.includes('  Android 1717 (3.2.0), 2027 (3.2.1)'));
    assert.ok(lines.includes('Active and use: all versions'));
    assert.ok(lines.includes('Never counted: lab devices'));
  });
  it('prints the rollout, wrapped to the phone width', () => {
    assert.ok(lines.includes('Rollout'));
    for (const l of lines) assert.ok(l.length <= WIDTH, l);
    assert.match(lines.join('\n'), /Android vc2027 40% staged/);
  });
  it('leaves the rollout out when the loop passes none', () => {
    const l = renderHeader({date: 'd', windowLabel: 'w', builds});
    assert.ok(!l.includes('Rollout'));
  });
});

describe('renderJourney, renderActive, renderUse', () => {
  it('prints people by platform and the steps as counts', () => {
    const l = renderJourney({
      total: 10,
      byPlatform: {iOS: 7, Android: 3},
      installed: 4,
      steps: [
        {label: 'Opened', n: 10},
        {label: 'Logged in', n: 2},
      ],
    });
    assert.equal(l[0], '10 people · iOS 7 · Android 3');
    assert.equal(l[1], '  4 of them installed or updated it');
    assert.equal(l[3], 'Opened            10');
    assert.doesNotMatch(l.join('\n'), /%|▓/);
  });
  it('prints the 3 x 3 tables, and unavailable when a query gave nothing', () => {
    const a = renderActive([
      {label: 'Today', dau: 683, wau: 3117, mau: 7839},
      {label: 'Yesterday', dau: 736, wau: 3101, mau: 7808},
    ]);
    assert.equal(a[0], 'ACTIVE           DAU    WAU    MAU');
    assert.equal(a[1], 'Today            683   3117   7839');
    assert.deepEqual(renderActive(null).slice(1), ['  unavailable']);
    const u = renderUse([
      {label: 'Recitations', day: 2761, week: 23082, month: 88621},
    ]);
    assert.equal(u[0], 'USE              day   week  month');
    assert.equal(u[1], 'Recitations     2761  23082  88621');
    for (const l of [...a, ...u]) assert.ok(l.length <= WIDTH, l);
  });
});
