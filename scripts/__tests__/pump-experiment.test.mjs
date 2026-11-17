#!/usr/bin/env node
// @ai
//
// scripts/__tests__/pump-experiment.test.mjs
// ------------------------------------------
// Pure-function tests for scripts/lib/pump-experiment.mjs.
//
// Run:  node --test scripts/__tests__/pump-experiment.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  CAP_DAYS,
  compareArms,
  compareProportions,
  compareRates,
  decideCheck,
  flagRunning,
  HARM_KEY,
  PLANNED_COLD_STARTS_PER_ARM,
  recommend,
  renderCheckBody,
  RESULT_KEY,
  FIRST_PUMP_BUILD,
  normalCdf,
  PUMP_FLAG_KEY,
  renderReport,
  rowsToSplits,
  splitQuery,
} from '../lib/pump-experiment.mjs';

const LAB = '(1 = 1)';

describe('splitQuery', () => {
  it('splits by the flag value, on Android builds with the pump only', () => {
    const q = splitQuery({labSQL: LAB});
    assert.match(q, new RegExp(`\\$feature/${PUMP_FLAG_KEY}`));
    assert.match(q, /properties\.\$os_name = 'Android'/);
    assert.match(
      q,
      new RegExp(`toInt\\(properties\\.\\$app_build\\) >= ${FIRST_PUMP_BUILD}`),
    );
    assert.match(q, /prev_exit_reason = 'anr'/);
    assert.match(q, /event = 'app_return_slow'/);
    assert.match(q, /toDateTime\('2026-11-13 00:00:00'\)/);
    assert.ok(q.includes(LAB));
  });

  it('splits by the pump state on request', () => {
    const q = splitQuery({by: 'state', since: '2026-11-20', labSQL: LAB});
    assert.match(q, /properties\.mount_pump/);
    assert.doesNotMatch(q, /\$feature\//);
    assert.match(q, /2026-11-20 00:00:00/);
  });

  it('refuses a malformed date and a missing lab filter', () => {
    assert.throws(
      () => splitQuery({since: "2026-11-13'; DROP", labSQL: LAB}),
      /YYYY-MM-DD/,
    );
    assert.throws(() => splitQuery({}), /labSQL/);
  });

  it('is the first build of the PR #867 merge', () => {
    assert.equal(FIRST_PUMP_BUILD, 4552);
  });
});

describe('rowsToSplits', () => {
  it('names the columns and keeps a missing quantile as null', () => {
    const [s] = rowsToSplits([
      ['treatment', '3', 4, 10, 1, 2, null, 1900, '2026-11-14'],
    ]);
    assert.deepEqual(s, {
      split: 'treatment',
      persons: 3,
      person_days: 4,
      cold_starts: 10,
      anr_exits: 1,
      slow_returns: 2,
      slow_p50_ms: null,
      slow_p90_ms: 1900,
      first_day: '2026-11-14',
    });
  });
});

describe('the statistics', () => {
  it('normalCdf matches the table', () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
    assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
    assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-4);
  });

  it('compareProportions gives the known z test', () => {
    // 10/1000 against 30/1000: pooled p 0.02, z = -3.194, p = 0.0014.
    const r = compareProportions(10, 1000, 30, 1000);
    assert.ok(Math.abs(r.diff + 0.02) < 1e-12);
    assert.ok(Math.abs(r.p - 0.0014) < 2e-4);
    assert.ok(r.high < 0);
    assert.equal(compareProportions(1, 0, 1, 10), null);
  });

  it('compareRates gives the ratio and a log interval', () => {
    const r = compareRates(20, 100, 40, 100);
    assert.ok(Math.abs(r.ratio - 0.5) < 1e-12);
    assert.ok(r.low < 0.5 && r.high > 0.5 && r.high < 1);
    assert.equal(compareRates(0, 100, 4, 100), null);
  });
});

const arm = (split, cold, anr, days, slow) => ({
  split,
  persons: days,
  person_days: days,
  cold_starts: cold,
  anr_exits: anr,
  slow_returns: slow,
  slow_p50_ms: 1800,
  slow_p90_ms: 2600,
});

describe('compareArms', () => {
  it('waits for both arms', () => {
    assert.equal(
      compareArms([arm('control', 900, 20, 400, 30)]).verdict,
      'not enough data',
    );
  });

  it('waits for enough cold starts and ANR exits', () => {
    const r = compareArms([
      arm('treatment', 100, 1, 50, 3),
      arm('control', 100, 2, 50, 6),
    ]);
    assert.equal(r.verdict, 'not enough data');
    assert.match(r.reason, /now 100 and 100; 3/);
  });

  it('says lower when the whole interval is below control', () => {
    const r = compareArms([
      arm('treatment', 5000, 10, 2000, 40),
      arm('control', 5000, 60, 2000, 160),
    ]);
    assert.equal(r.verdict, 'measured');
    assert.equal(r.anrDirection, 'lower');
    assert.equal(r.slowDirection, 'lower');
  });

  it('says no clear difference when the interval holds zero', () => {
    const r = compareArms([
      arm('treatment', 1000, 15, 500, 50),
      arm('control', 1000, 16, 500, 52),
    ]);
    assert.equal(r.anrDirection, 'no clear difference');
    assert.equal(r.slowDirection, 'no clear difference');
  });
});

describe('renderReport', () => {
  it('says when the kill switch is engaged', () => {
    const lines = renderReport({
      since: '2026-11-13',
      arms: [],
      states: [],
      comparison: {
        verdict: 'not enough data',
        reason: 'an arm has no events yet',
      },
      flag: {active: false, variants: []},
    });
    assert.ok(lines.some(l => /kill switch engaged/.test(l)));
    assert.ok(lines.some(l => l === '(no events yet)'));
  });

  it('prints the two arms and the comparison', () => {
    const arms = [
      arm('control', 5000, 60, 2000, 160),
      arm('treatment', 5000, 10, 2000, 40),
    ];
    const lines = renderReport({
      since: '2026-11-13',
      arms,
      states: arms,
      comparison: compareArms(arms),
      flag: {
        active: true,
        variants: [
          {key: 'control', rollout_percentage: 50},
          {key: 'treatment', rollout_percentage: 50},
        ],
      },
    });
    assert.ok(lines.some(l => /control 50%, treatment 50%/.test(l)));
    assert.ok(lines.some(l => /^treatment\s+2000/.test(l)));
    assert.ok(
      lines.some(l =>
        /ANR exits per cold start: 0\.20% against 1\.20%/.test(l),
      ),
    );
    assert.ok(lines.some(l => /ratio 0\.25/.test(l)));
  });
});

const RUNNING = {
  active: true,
  deleted: false,
  variants: [
    {key: 'control', rollout_percentage: 50},
    {key: 'treatment', rollout_percentage: 50},
  ],
};
const day = (split, cold, anr, days, slow, first = '2026-11-20') => ({
  ...arm(split, cold, anr, days, slow),
  first_day: first,
});

describe('flagRunning', () => {
  it('runs only while the flag is on and 50/50', () => {
    assert.equal(flagRunning(RUNNING).running, true);
    assert.match(flagRunning(null).why, /gone/);
    assert.match(flagRunning({...RUNNING, active: false}).why, /kill switch/);
    assert.match(
      flagRunning({
        ...RUNNING,
        variants: [
          {key: 'control', rollout_percentage: 0},
          {key: 'treatment', rollout_percentage: 100},
        ],
      }).why,
      /treatment 100%/,
    );
  });
});

describe('decideCheck', () => {
  const today = '2026-11-25';

  it('files nothing when the flag is off', () => {
    const d = decideCheck({
      arms: [
        day('treatment', 9000, 200, 4000, 900),
        day('control', 9000, 10, 4000, 90),
      ],
      flag: {...RUNNING, active: false},
      today,
    });
    assert.equal(d.state, 'stopped');
    assert.equal(d.key, undefined);
  });

  it('waits while an arm is empty', () => {
    const d = decideCheck({arms: [], flag: RUNNING, today});
    assert.equal(d.state, 'wait');
  });

  it('files a P1 harm item when the pump arm is worse at 99%', () => {
    const d = decideCheck({
      arms: [
        day('treatment', 2000, 40, 900, 60),
        day('control', 2000, 8, 900, 55),
      ],
      flag: RUNNING,
      today,
    });
    assert.equal(d.state, 'harm');
    assert.equal(d.key, HARM_KEY);
    assert.equal(d.priority, 'P1');
    assert.match(d.title, /more ANR exits/);
  });

  it('does not call harm below the minimum cold starts', () => {
    const d = decideCheck({
      arms: [
        day('treatment', 400, 30, 200, 10),
        day('control', 400, 1, 200, 10),
      ],
      flag: RUNNING,
      today,
    });
    assert.equal(d.state, 'wait');
  });

  it('does not call harm on a 95%-only difference', () => {
    // 22/2000 against 10/2000: the 95% interval is above 0, the 99% one is not.
    const r95 = compareProportions(22, 2000, 10, 2000);
    const r99 = compareProportions(22, 2000, 10, 2000, 2.576);
    assert.ok(r95.low > 0 && r99.low <= 0);
    const d = decideCheck({
      arms: [
        day('treatment', 2000, 22, 900, 50),
        day('control', 2000, 10, 900, 50),
      ],
      flag: RUNNING,
      today,
    });
    assert.equal(d.state, 'wait');
  });

  it('files the result at the planned sample', () => {
    const n = PLANNED_COLD_STARTS_PER_ARM;
    const d = decideCheck({
      arms: [
        day('treatment', n, 25, 3000, 100),
        day('control', n, 45, 3000, 200),
      ],
      flag: RUNNING,
      today,
    });
    assert.equal(d.state, 'result');
    assert.equal(d.key, RESULT_KEY);
    assert.equal(d.priority, 'P2');
  });

  it('files the result at the cap before the sample', () => {
    const first = '2026-11-20';
    const arms = [
      day('treatment', 3000, 20, 1500, 60, first),
      day('control', 3000, 22, 1500, 62, first),
    ];
    assert.equal(
      decideCheck({arms, flag: RUNNING, today: addDays(first, CAP_DAYS - 1)})
        .state,
      'wait',
    );
    const d = decideCheck({
      arms,
      flag: RUNNING,
      today: addDays(first, CAP_DAYS),
    });
    assert.equal(d.state, 'cap');
    assert.equal(d.key, RESULT_KEY);
  });
});

describe('addDays and recommend', () => {
  it('adds days across a month and a year', () => {
    assert.equal(addDays('2026-11-20', 56), '2027-01-15');
  });

  it('recommends from the two directions', () => {
    assert.match(
      recommend({anrDirection: 'lower', slowDirection: 'lower'}),
      /^pump default on/,
    );
    assert.match(
      recommend({anrDirection: 'higher', slowDirection: 'lower'}),
      /^turn the pump off/,
    );
    assert.match(
      recommend({anrDirection: 'lower', slowDirection: 'no clear difference'}),
      /^your call/,
    );
    assert.match(
      recommend({verdict: 'not enough data'}),
      /^turn the pump off: no clear gain/,
    );
  });
});

describe('renderCheckBody', () => {
  it('leads with the impact and names the kill switch', () => {
    const arms = [
      day('treatment', 2000, 40, 900, 60),
      day('control', 2000, 8, 900, 55),
    ];
    const decision = decideCheck({arms, flag: RUNNING, today: '2026-11-25'});
    const body = renderCheckBody({
      decision,
      comparison: compareArms(arms),
      reportLines: ['line one'],
    });
    assert.match(body, /^\*\*Impact:\*\* Android users in the pump arm/);
    assert.match(
      body,
      /Recommendation:\*\* turn the pump off: the pump arm has more ANR exits/,
    );
    assert.match(body, /id 1073123/);
    assert.match(body, /`keep running`/);
    assert.match(body, /line one/);
  });
});
