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
  anrScoreBuilds,
  cardBuilds,
  renderActive,
  renderHeader,
  renderBuilds,
  renderJourneyWindows,
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
  it('keeps anrScore: false, and anrScoreBuilds leaves those builds out', () => {
    const cfg = {
      card: {
        builds: [
          {platform: 'Android', release: 'com.qariah.app@3.2.1+2027'},
          {
            platform: 'Android',
            release: 'com.qariah.app@3.2.0+1717',
            anrScore: false,
          },
          {
            platform: 'iOS',
            release: 'com.qariah.app@3.2.1+1718',
            anrScore: true,
          },
        ],
      },
    };
    assert.deepEqual(cardBuilds(cfg), [
      {platform: 'Android', version: '3.2.1', build: '2027'},
      {platform: 'Android', version: '3.2.0', build: '1717', anrScore: false},
      {platform: 'iOS', version: '3.2.1', build: '1718'},
    ]);
    assert.deepEqual(
      anrScoreBuilds(cfg).map(b => b.build),
      ['2027', '1718'],
    );
  });
  it("the rollout file: 1717 counts for people and for Google's score (owner 2026-10-25)", () => {
    assert.ok(cardBuilds(ROLLOUT).some(b => b.build === '1717'));
    assert.ok(anrScoreBuilds(ROLLOUT).some(b => b.build === '1717'));
    assert.ok(anrScoreBuilds(ROLLOUT).some(b => b.platform === 'Android'));
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
    windowEnd: '11:00',
    ios: '3.2.1 (1718) phased release COMPLETE 100%',
    android: 'vc2027 40% staged, 182 h, DECISION DUE (see report)',
  });
  it('names the date, what is counted and the end of the windows', () => {
    assert.equal(lines[0], 'QARIAH · Sun 2026-10-11');
    // since 2026-10-30 every block counts every v2 build
    assert.equal(lines[1], 'Every v2 build · lab devices left out');
    assert.ok(!lines.some(l => l.startsWith('Counted ')));
    // the fixed end of the PostHog windows (owner decision A, 2026-10-25)
    assert.ok(lines.includes('Counts end 11:00 Los Angeles time'));
    assert.deepEqual(buildLines(builds), [
      'iOS 1718 (3.2.1)',
      'Android 1717 (3.2.0), 2027 (3.2.1)',
    ]);
  });
  it('prints the rollout, wrapped to the phone width', () => {
    assert.ok(lines.includes('Rollout'));
    for (const l of lines) assert.ok(l.length <= WIDTH, l);
    assert.match(lines.join('\n'), /Android vc2027 40% staged/);
  });
  it('leaves the rollout out when the loop passes none', () => {
    const l = renderHeader({date: 'd'});
    assert.ok(!l.includes('Rollout'));
    // no window end given: no line
    assert.ok(!l.some(x => x.startsWith('Counts end')));
  });
});

describe('renderBuilds, renderJourneyWindows, renderActive, renderUse', () => {
  const live = {
    minPeople: 50,
    rows: [
      {platform: 'iOS', version: '3.2.1', build: '1718', d7: 1621, d30: 4539},
      {
        platform: 'Android',
        version: '3.2.1',
        build: '2027',
        d7: 1206,
        d30: 1984,
      },
    ],
    other: {builds: 19, d7: 21, d30: 44},
  };
  const people = {
    d7: {total: 3011, iOS: 1641, Android: 1370, installed: 1439},
    d30: {total: 8352, iOS: 4573, Android: 3779, installed: 5996},
  };
  it('prints a row for each build, the other builds, and every v2 build, in two columns', () => {
    const l = renderBuilds(live, people);
    assert.deepEqual(l, [
      'BUILDS (people)        7 days  30 days',
      'iOS 1718 (3.2.1)         1621     4539',
      'Android 2027 (3.2.1)     1206     1984',
      '19 other builds            21       44',
      'All v2 builds            3011     8352',
      '  iOS                    1641     4573',
      '  Android                1370     3779',
      '  installed or updated   1439     5996',
    ]);
    for (const line of l) assert.ok(line.length <= WIDTH, line);
    // no other build: no row
    assert.ok(
      !renderBuilds({...live, other: null}, people).some(x =>
        /other builds/.test(x),
      ),
    );
    assert.deepEqual(renderBuilds(null, people), [
      'BUILDS (people)        7 days  30 days',
      '  unavailable',
    ]);
  });
  it('prints the journey in two columns, counts only', () => {
    const l = renderJourneyWindows([
      {label: 'Opened', d7: 2932, d30: 8263},
      {label: 'Logged in', d7: 134, d30: 540},
    ]);
    assert.deepEqual(l, [
      'JOURNEY                7 days  30 days',
      'Opened                   2932     8263',
      'Logged in                 134      540',
    ]);
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
