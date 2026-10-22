#!/usr/bin/env node
// @ai
//
// scripts/__tests__/anr-card.test.mjs
// -----------------------------------
// Pure-function tests for scripts/lib/anr-card.mjs.
//
// Run:  node --test scripts/__tests__/anr-card.test.mjs
// The repo's eslint config declares no Node globals; these are Node builtins.
/* global globalThis, Response, Buffer */

import {describe, it, after, before} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  buildOfRelease,
  compareVersions,
  fetchPlayAnr,
  fetchSentryWeek,
  freezeOptions,
  freezeVerdict,
  latestV2Hang,
  markObserved,
  missedDays,
  overLimit,
  pooledRate,
  renderAnrCard,
  scorePct,
  UNAVAILABLE,
  v2VersionCodes,
  weekWindows,
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

describe('freezeVerdict (the fixed rule, owner 2026-10-20, G-V1)', () => {
  // a of b this week, c of d the week before.
  const v = (a, b, c, d) =>
    freezeVerdict({users: b, frozeUsers: a, prevUsers: d, prevFrozeUsers: c});

  it('is TOO FEW when both weeks have fewer than 5 users who froze', () => {
    assert.equal(v(4, 1000, 4, 1000), 'TOO FEW');
    assert.equal(v(0, 1000, 0, 1000), 'TOO FEW');
    assert.equal(v(1, 10, 4, 5000), 'TOO FEW');
  });
  it('compares when one week has 5 or more', () => {
    assert.equal(v(5, 1000, 4, 1000), 'WORSE'); // 125%
    assert.equal(v(4, 1000, 5, 1000), 'BETTER'); // 4/5 = 80%
  });
  it('is BETTER at exactly 80% of last week, SAME just above', () => {
    assert.equal(v(8, 1000, 10, 1000), 'BETTER');
    assert.equal(v(81, 10000, 100, 10000), 'SAME'); // 81%
    assert.equal(v(12, 1500, 10, 1000), 'BETTER'); // 0.8% vs 1.0%
  });
  it('is WORSE at exactly 120% of last week, SAME just below', () => {
    assert.equal(v(12, 1000, 10, 1000), 'WORSE');
    assert.equal(v(119, 10000, 100, 10000), 'SAME'); // 119%
    assert.equal(v(18, 1500, 10, 1000), 'WORSE'); // 1.2% vs 1.0%
  });
  it('has no float error at the boundaries (5ad vs 4cb and 6cb)', () => {
    // 28/100 against 35/100 is exactly 80%; 0.28 / 0.35 in floats is not.
    assert.equal(v(28, 100, 35, 100), 'BETTER');
    // 204/1000 against 17/100 and 42/1472 against 35/1472: exactly 120%.
    assert.equal(v(204, 1000, 17, 100), 'WORSE');
    assert.equal(v(42, 1472, 35, 1472), 'WORSE');
    // 232/1000 against 29/100: exactly 80%.
    assert.equal(v(232, 1000, 29, 100), 'BETTER');
    // 7/700 against 5/600: exactly 120%.
    assert.equal(v(7, 700, 5, 600), 'WORSE');
  });
  it('uses the exact counts, not the rounded shares', () => {
    assert.equal(v(4, 707, 5, 700), 'BETTER'); // 79.2%
    assert.equal(v(3, 2049, 7, 1957), 'BETTER');
  });
  it('last week 0 and this week 5 or more is WORSE; the reverse is BETTER', () => {
    assert.equal(v(5, 1000, 0, 1000), 'WORSE');
    assert.equal(v(0, 1000, 9, 1000), 'BETTER');
  });
  it('a week with no session users is NO DATA, never an exception', () => {
    assert.equal(v(6, 0, 7, 1000), 'NO DATA');
    assert.equal(v(6, 1000, 7, 0), 'NO DATA');
  });
  it('the live case of 2026-10-19 (Android 15/1496 vs 17/1472)', () => {
    assert.equal(v(15, 1496, 17, 1472), 'SAME');
  });
});

describe('renderAnrCard (FREEZES (ANR), 44 columns)', () => {
  const week = (over = {}) => ({
    from: '2026-10-13',
    to: '2026-10-19',
    prevFrom: '2026-10-06',
    prevTo: '2026-10-12',
    android: {
      users: 707,
      frozeUsers: 30,
      prevUsers: 700,
      prevFrozeUsers: 10,
      verdict: 'WORSE',
      byBuild: [
        {build: '2027', users: 400, frozeUsers: 2},
        {build: '1717', users: 350, frozeUsers: 28},
      ],
    },
    ios: {
      users: 441,
      frozeUsers: 3,
      prevUsers: 430,
      prevFrozeUsers: 2,
      verdict: 'TOO FEW',
      byBuild: [{build: '1718', users: 441, frozeUsers: 3}],
    },
    ...over,
  });
  const play = {
    date: '2026-10-15',
    day: 0.0099,
    d7: 0.0219,
    d28: 0.0171,
    users: '200',
    series: [],
  };
  const text = (m, o) => renderAnrCard(m, o).join('\n');

  it('golden: the design layout, with the per-build line while staged', () => {
    assert.equal(
      text({play, sentry: {week: week()}}, {staged: true}),
      [
        'FREEZES (ANR) · last 7 days',
        'Android  30 of 707 users froze (4.2%)',
        '         week before 1.4% · WORSE',
        '  2027 fewer than 5 · 1717 8.0%',
        "  Google's score 2.19% · limit 0.47% · OVER",
        '  (7-day; a sample of users; data to 10-15)',
        'iOS      fewer than 5 of 441 users froze',
        '         week before: fewer than 5 · TOO FEW',
      ].join('\n'),
    );
  });
  it('golden: no per-build line when no staged rollout runs', () => {
    assert.equal(
      text({play, sentry: {week: week()}}),
      [
        'FREEZES (ANR) · last 7 days',
        'Android  30 of 707 users froze (4.2%)',
        '         week before 1.4% · WORSE',
        "  Google's score 2.19% · limit 0.47% · OVER",
        '  (7-day; a sample of users; data to 10-15)',
        'iOS      fewer than 5 of 441 users froze',
        '         week before: fewer than 5 · TOO FEW',
      ].join('\n'),
    );
  });
  it('prints 1 to 4 as "fewer than 5" and never its share; 0 as (0%)', () => {
    for (const n of [1, 2, 3, 4]) {
      const w = week();
      w.android = {...w.android, frozeUsers: n, prevFrozeUsers: n};
      delete w.android.verdict; // the renderer then applies the rule itself
      const t = text({play, sentry: {week: w}}, {staged: true});
      assert.match(t, /^Android {2}fewer than 5 of 707 users froze$/m);
      assert.match(t, /^ {9}week before: fewer than 5 · TOO FEW$/m);
      assert.doesNotMatch(t.split('\n')[1], /%/);
      assert.ok(!t.includes(`${n} of 707`));
    }
    const w0 = week();
    w0.android = {...w0.android, frozeUsers: 0};
    assert.match(
      text({play, sentry: {week: w0}}),
      /^Android {2}0 of 707 users froze \(0%\)$/m,
    );
    const p0 = week();
    p0.android = {...p0.android, prevFrozeUsers: 0};
    assert.match(text({play, sentry: {week: p0}}), /^ {9}week before 0% · /m);
    const w5 = week();
    w5.android = {...w5.android, frozeUsers: 5};
    assert.match(
      text({play, sentry: {week: w5}}),
      /^Android {2}5 of 707 users froze \(0\.7%\)$/m,
    );
  });
  it('prints one ⛔ line for each FAILED condition directly under the header', () => {
    const lines = renderAnrCard(
      {play, sentry: {week: week()}},
      {staged: true, abFailed: ['treatment ANR', 'fallback launch']},
    );
    assert.equal(lines[0], 'FREEZES (ANR) · last 7 days');
    assert.equal(lines[1], '⛔ A/B: treatment ANR FAILED · see page');
    assert.equal(lines[2], '⛔ A/B: fallback launch FAILED · see page');
    assert.match(lines[3], /^Android/);
    assert.ok(!text({play, sentry: {week: week()}}).includes('⛔'));
  });
  it('prints `A/B check: no data` while the blocking check has NO DATA', () => {
    const lines = renderAnrCard(
      {play, sentry: {week: week()}},
      {abNoData: true},
    );
    assert.equal(lines[1], 'A/B check: no data');
    assert.ok(!text({play, sentry: {week: week()}}).includes('A/B check'));
  });
  it('prints `unavailable` on its own line, never 0', () => {
    const none = text({play: null, sentry: null, appStore: null});
    assert.equal(
      none,
      [
        'FREEZES (ANR) · last 7 days',
        'Android  unavailable',
        "  Google's score unavailable",
        'iOS      unavailable',
      ].join('\n'),
    );
    const down = {unavailable: true, reason: 'the Sentry request failed'};
    const failed = text({
      play: {error: 'Play token mint failed'},
      sentry: {error: 'Sentry 401', week: week({android: down, ios: down})},
    });
    assert.equal(failed, none);
    assert.doesNotMatch(failed, /\b0\b|error|failed|Sentry/);
    // One platform unavailable, the other one fine.
    const half = text({play, sentry: {week: week({ios: down})}});
    assert.match(half, /^iOS {6}unavailable$/m);
    assert.match(half, /^Android {2}30 of 707/m);
    // Play with no 7-day rate yet is not a 0 either.
    assert.match(
      text({play: {...play, d7: null}, sentry: {week: week()}}),
      /^ {2}Google's score unavailable$/m,
    );
  });
  it("Google's score: two decimals; OVER only when round4(rate) > 0.0047", () => {
    const word = d7 =>
      text({play: {...play, d7}, sentry: null}).match(/· (OVER|UNDER)$/m)[1];
    assert.equal(word(0.0048), 'OVER');
    assert.equal(word(0.0046), 'UNDER');
    assert.equal(word(0.0047), 'UNDER'); // exactly the limit
    assert.equal(word(0.00470004), 'UNDER'); // rounds to 0.0047
    assert.equal(word(0.00475), 'OVER'); // rounds to 0.0048
    assert.match(
      text({play: {...play, d7: 0.0046}, sentry: null}),
      /Google's score 0\.46% · limit 0\.47% · UNDER/,
    );
    assert.equal(scorePct(0.0219), '2.19%');
    assert.equal(overLimit(0.0047), false);
    assert.equal(overLimit(0.0048), true);
    // The text and OVER/UNDER round the same basis points (test run 1, F1).
    assert.equal(scorePct(0.00475), '0.48%');
    assert.equal(overLimit(0.00475), true);
    assert.equal(scorePct(0.00474), '0.47%');
    assert.equal(overLimit(0.00474), false);
  });
  it('leaves out a platform that has no production build', () => {
    const t = text({play, sentry: {week: week({ios: null})}});
    assert.doesNotMatch(t, /^iOS/m);
  });
  it('keeps every line phone-narrow, also with big numbers', () => {
    const w = week();
    w.android = {
      ...w.android,
      users: 123456,
      frozeUsers: 12345,
      prevUsers: 123456,
      prevFrozeUsers: 99999,
    };
    const t = text(
      {play, sentry: {week: w}},
      {
        staged: true,
        abFailed: ['treatment ANR', 'crash from 2027', 'fallback launch'],
        abNoData: true,
      },
    );
    for (const line of t.split('\n')) assert.ok([...line].length <= 44, line);
  });
});

describe('freezeOptions', () => {
  const builds = [
    {platform: 'iOS', build: '1718'},
    {platform: 'Android', build: '1717'},
    {platform: 'Android', build: '2027'},
  ];
  const conds = [
    {label: 'treatment ANR', state: 'FAIL'},
    {label: 'crash from 2027', state: 'NO DATA'},
    {label: 'fallback launch', state: 'FAIL'},
  ];
  it('staged = active and two Android production builds', () => {
    assert.equal(freezeOptions({active: true, builds}).staged, true);
    assert.equal(freezeOptions({active: false, builds}).staged, false);
    assert.equal(
      freezeOptions({active: true, builds: builds.slice(0, 2)}).staged,
      false,
    );
  });
  it('names the FAIL conditions and NO DATA only while the rollout is active', () => {
    const on = freezeOptions({active: true, builds, abConditions: conds});
    assert.deepEqual(on.abFailed, ['treatment ANR', 'fallback launch']);
    assert.equal(on.abNoData, true);
    const off = freezeOptions({active: false, builds, abConditions: conds});
    assert.deepEqual(off.abFailed, []);
    assert.equal(off.abNoData, false);
    const pass = freezeOptions({
      active: true,
      builds,
      abConditions: conds.map(c => ({...c, state: 'PASS'})),
    });
    assert.deepEqual([pass.abFailed, pass.abNoData], [[], false]);
  });
});

describe('weekWindows', () => {
  it('the last 7 complete UTC days and the 7 before', () => {
    assert.deepEqual(weekWindows(new Date('2026-10-20T03:14:00Z')), {
      from: '2026-10-13',
      to: '2026-10-19',
      prevFrom: '2026-10-06',
      prevTo: '2026-10-12',
    });
    // 23:59 UTC is still the same UTC day: it is not in the window.
    assert.equal(
      weekWindows(new Date('2026-10-19T23:59:00Z')).to,
      '2026-10-18',
    );
  });
});

describe('fetchSentryWeek', () => {
  const realFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = realFetch;
  });
  const builds = [
    {platform: 'iOS', version: '3.2.1', build: '1718'},
    {platform: 'Android', version: '3.2.0', build: '1717'},
    {platform: 'Android', version: '3.2.1', build: '2027'},
  ];
  const now = new Date('2026-10-20T03:14:00Z');
  const ts = d => Date.parse(`${d}T00:00:00Z`) / 1000;

  /**
   * A stub Sentry: distinct users by the query and the window.
   * low: days with almost no production errors (Sentry missed them).
   */
  function stub({low = [], users = null} = {}) {
    const seen = [];
    globalThis.fetch = async url => {
      const u = new URL(String(url));
      seen.push(u);
      const q = u.searchParams.get('query') || '';
      const prev = u.searchParams.get('start').startsWith('2026-10-06');
      const json = body => new Response(JSON.stringify(body), {status: 200});
      if (u.pathname.endsWith('/events-stats/')) {
        const data = [];
        for (let i = 30; i >= 1; i--) {
          const d = new Date(now.getTime() - i * 86_400_000)
            .toISOString()
            .slice(0, 10);
          data.push([ts(d), [{count: low.includes(d) ? 2 : 100}]]);
        }
        return json({data});
      }
      if (u.pathname.endsWith('/sessions/')) {
        if (u.searchParams.get('groupBy') === 'release')
          return json({
            groups: [
              {
                by: {release: 'com.qariah.app@3.2.1+1718'},
                totals: {'count_unique(user)': 2049},
              },
              {
                by: {release: 'com.qariah.app@3.2.0+1717'},
                totals: {'count_unique(user)': 883},
              },
              {
                by: {release: 'com.qariah.app@3.2.1+2027'},
                totals: {'count_unique(user)': 694},
              },
            ],
          });
        const android = q.includes('+1717');
        const n =
          users ?? (android ? (prev ? 1472 : 1496) : prev ? 1957 : 2049);
        return json({groups: [{by: {}, totals: {'count_unique(user)': n}}]});
      }
      const android = q.includes('ApplicationNotResponding');
      if (u.searchParams.getAll('field').includes('release'))
        return json({
          data: android
            ? [
                {
                  release: 'com.qariah.app@3.2.0+1717',
                  'count_unique(user)': 12,
                },
                {release: 'com.qariah.app@3.2.1+2027', 'count_unique(user)': 3},
              ]
            : [{release: 'com.qariah.app@3.2.1+1718', 'count_unique(user)': 3}],
        });
      const n = android ? (prev ? 17 : 15) : prev ? 7 : 3;
      return json({data: [{'count_unique(user)': n}]});
    };
    return seen;
  }

  it('returns null without a token, and calls nothing', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
    };
    assert.equal(await fetchSentryWeek({token: '', org: 'o', builds}), null);
    assert.equal(calls, 0);
  });
  it('counts distinct users of the production releases, per platform and week', async () => {
    const seen = stub();
    const w = await fetchSentryWeek({token: 't', org: 'o', builds, now});
    assert.deepEqual(w, {
      from: '2026-10-13',
      to: '2026-10-19',
      prevFrom: '2026-10-06',
      prevTo: '2026-10-12',
      android: {
        users: 1496,
        frozeUsers: 15,
        prevUsers: 1472,
        prevFrozeUsers: 17,
        verdict: 'SAME',
        byBuild: [
          {build: '2027', users: 694, frozeUsers: 3},
          {build: '1717', users: 883, frozeUsers: 12},
        ],
      },
      ios: {
        users: 2049,
        frozeUsers: 3,
        prevUsers: 1957,
        prevFrozeUsers: 7,
        verdict: 'BETTER',
        byBuild: [{build: '1718', users: 2049, frozeUsers: 3}],
      },
    });
    // Production only, complete UTC days, the right freeze on each platform.
    for (const u of seen) {
      assert.equal(u.searchParams.get('environment'), 'production');
      assert.match(u.searchParams.get('end'), /T00:00:00$/);
    }
    const iosFreeze = seen.find(u =>
      (u.searchParams.get('query') || '').includes('App Hanging'),
    );
    assert.match(
      iosFreeze.searchParams.get('query'),
      /error\.type:\["App Hanging",WatchdogTermination\] release:\["com\.qariah\.app@3\.2\.1\+1718"\]/,
    );
    const androidFreeze = seen.find(u =>
      (u.searchParams.get('query') || '').includes('ApplicationNotResponding'),
    );
    // One query over both production releases (the union).
    assert.match(
      androidFreeze.searchParams.get('query'),
      /release:\["com\.qariah\.app@3\.2\.1\+2027","com\.qariah\.app@3\.2\.0\+1717"\]/,
    );
    assert.ok(
      seen.some(u => u.searchParams.get('end') === '2026-10-20T00:00:00'),
    );
    assert.ok(
      seen.some(u => u.searchParams.get('end') === '2026-10-13T00:00:00'),
    );
  });
  it('a failed request makes each platform unavailable, never a zero', async () => {
    globalThis.fetch = async () => new Response('{}', {status: 500});
    const w = await fetchSentryWeek({token: 't', org: 'o', builds, now});
    assert.equal(w.from, '2026-10-13');
    for (const p of [w.android, w.ios]) {
      assert.equal(p.unavailable, true);
      assert.match(p.reason, /^the Sentry request failed/);
      assert.equal(p.users, undefined);
    }
  });
  it('a day that Sentry missed in the two weeks makes the week unavailable', async () => {
    stub({low: ['2026-10-08']});
    const w = await fetchSentryWeek({token: 't', org: 'o', builds, now});
    assert.deepEqual(w.android, {
      unavailable: true,
      reason: UNAVAILABLE.missed,
    });
    assert.deepEqual(w.ios, {unavailable: true, reason: UNAVAILABLE.missed});
    // A missed day before the two weeks does not count.
    stub({low: ['2026-09-25']});
    const ok = await fetchSentryWeek({token: 't', org: 'o', builds, now});
    assert.equal(ok.android.users, 1496);
  });
  it('a week with no session users is unavailable', async () => {
    stub({users: 0});
    const w = await fetchSentryWeek({token: 't', org: 'o', builds, now});
    assert.deepEqual(w.android, {
      unavailable: true,
      reason: UNAVAILABLE.noUsers,
    });
  });
  it('a platform with no production build is null', async () => {
    stub();
    const w = await fetchSentryWeek({
      token: 't',
      org: 'o',
      builds: builds.filter(b => b.platform === 'Android'),
      now,
    });
    assert.equal(w.ios, null);
    assert.equal(w.android.users, 1496);
  });
  it('missedDays checks the 14 days of the two weeks only', () => {
    const win = weekWindows(now);
    const daily = {};
    for (let i = 1; i <= 30; i++) {
      const d = new Date(now.getTime() - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      daily[d] = 100;
    }
    assert.deepEqual(missedDays(daily, win), []);
    delete daily['2026-10-12'];
    assert.deepEqual(missedDays(daily, win), ['2026-10-12']);
  });
});

describe('fetchPlayAnr (Google token step)', () => {
  // The token comes from scripts/lib/google-play-auth.mjs (TECH_DEBT #234).
  // Both Google calls go to a stub fetch; the key is a throwaway RSA key.
  let dir;
  let saFile;
  const realFetch = globalThis.fetch;
  before(() => {
    dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'anr-card-test-'));
    const {privateKey} = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
      publicKeyEncoding: {type: 'spki', format: 'pem'},
    });
    saFile = join(dir, 'sa.json');
    writeFileSync(
      saFile,
      JSON.stringify({
        client_email: 'bot@example.com',
        private_key: privateKey,
      }),
    );
  });
  after(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, {recursive: true, force: true});
  });

  it('returns null, and calls no API, when no service-account file exists', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error('must not be called');
    };
    assert.equal(await fetchPlayAnr({saPath: join(dir, 'absent.json')}), null);
    assert.equal(calls, 0);
  });

  it('reports a plain error, with no secret, when Google refuses the token', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({error: 'invalid_grant'}), {status: 400});
    assert.deepEqual(await fetchPlayAnr({saPath: saFile}), {
      error: 'Play token mint failed',
    });
  });

  it('mints a reporting-scope token and sends it to the ANR query', async () => {
    const seen = [];
    globalThis.fetch = async (url, init) => {
      seen.push({url: String(url), init});
      if (String(url).includes('oauth2.googleapis.com'))
        return new Response(JSON.stringify({access_token: 'tok-anr'}), {
          status: 200,
        });
      // No rows: the card gets {error: 'no v2 versionCode in Play data'}.
      return new Response(JSON.stringify({rows: []}), {status: 200});
    };
    const out = await fetchPlayAnr({saPath: saFile, pkg: 'com.example.app'});
    assert.deepEqual(out, {error: 'no v2 versionCode in Play data'});

    const claim = JSON.parse(
      Buffer.from(
        new URLSearchParams(String(seen[0].init.body))
          .get('assertion')
          .split('.')[1],
        'base64url',
      ).toString('utf8'),
    );
    assert.equal(
      claim.scope,
      'https://www.googleapis.com/auth/playdeveloperreporting',
    );
    assert.match(
      seen[1].url,
      /apps\/com\.example\.app\/anrRateMetricSet:query$/,
    );
    assert.equal(seen[1].init.headers.Authorization, 'Bearer tok-anr');
  });
});

describe('fetchPlayAnr (pooled production versionCodes, for the focus)', () => {
  const realFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = realFetch;
  });
  it('pools the given codes with a minted token, and keeps seriesDays days', async () => {
    const bodies = [];
    globalThis.fetch = async (url, init) => {
      assert.ok(!String(url).includes('oauth2'), 'no token mint');
      assert.equal(init.headers.Authorization, 'Bearer tok-given');
      bodies.push(JSON.parse(init.body));
      const rows = Array.from({length: 30}, (_, i) => {
        const d = new Date(Date.UTC(2026, 8, 16 + i));
        return {
          startTime: {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
          },
          metrics: [
            {metric: 'userPerceivedAnrRate', decimalValue: {value: '0.02'}},
            {
              metric: 'userPerceivedAnrRate7dUserWeighted',
              decimalValue: {value: '0.021'},
            },
            {
              metric: 'userPerceivedAnrRate28dUserWeighted',
              decimalValue: {value: '0.017'},
            },
            {metric: 'distinctUsers', decimalValue: {value: '900'}},
          ],
        };
      });
      return new Response(JSON.stringify({rows}), {status: 200});
    };
    const out = await fetchPlayAnr({
      codes: [2027, 1717, 1255],
      seriesDays: 28,
      token: 'tok-given',
      pkg: 'com.example.app',
    });
    // One request: no versionCode discovery; v1 1255 is dropped.
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].filter, 'versionCode = 1717 OR versionCode = 2027');
    assert.deepEqual(out.codes, [1717, 2027]);
    assert.equal(out.series.length, 28);
    assert.equal(out.date, '2026-10-15');
    assert.equal(out.d28, 0.017);
  });
});
