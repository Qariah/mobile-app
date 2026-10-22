#!/usr/bin/env node
// @ai
//
// scripts/__tests__/ab-card.test.mjs
// ----------------------------------
// Pure-function tests for scripts/lib/ab-card.mjs.
//
// Run:  node --test scripts/__tests__/ab-card.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  AB_ROW_CAP,
  MIN_ENROLLED_TO_JUDGE,
  abConfig,
  REPEAT_USERS,
  abQueries,
  blockingStopConditions,
  clearByOwner,
  buildAbModel,
  collectAbModel,
  eventFacts,
  isPostHogBusy,
  issueKind,
  judgeFirstSeen,
  renderAbCard,
  renderBlocking,
  retryBusy,
  stopVerdict,
} from '../lib/ab-card.mjs';

const CFG = {
  active: true,
  build: 2027,
  sentryRelease: 'com.qariah.app@3.2.1+2027',
  abTest: {flag: 'nonblocking_splash_v2', posthogFlagId: 914347},
};

// [distinct_id, enrolled, arm, anr, fallback, stalled, opened, past_splash]
const ROWS = [
  ['t1', 1, 'treatment', 0, 0, 1, 1, 1],
  ['t2', 1, 'treatment', 1, 1, 0, 1, 1],
  ['c1', 1, 'control', 1, 0, 1, 1, 1],
  ['e1', 1, '', 0, 0, 1, 1, 0],
  // Not enrolled, but `control` is every such device's default: it must NOT
  // count as control (the 2026-10-06 "56 control, 1 treatment" mistake).
  ['n1', 0, 'control', 1, 0, 0, 1, 1],
  ['n2', 0, 'control', 0, 0, 0, 1, 0],
  ['n3', 0, '', 0, 0, 0, 0, 0],
];
// [arm, anr_devices, ran_devices, exits, anr_in_splash, anr_after_splash]
const PROC = [
  ['control', 2, 3, 7, 2, 0],
  ['treatment', 0, 1, 4, 0, 0],
];

describe('abConfig', () => {
  it('reads the build and the flag from the rollout JSON', () => {
    assert.deepEqual(abConfig(CFG), {
      build: '2027',
      flag: 'nonblocking_splash_v2',
      flagId: 914347,
      sentryRelease: 'com.qariah.app@3.2.1+2027',
      baseSha: null,
      buildSha: null,
      minEnrolled: MIN_ENROLLED_TO_JUDGE,
      since: null,
      cleared: [],
    });
  });
  it('carries the launch date (startedAt) as the query lower bound', () => {
    assert.equal(
      abConfig({...CFG, startedAt: '2026-09-28'}).since,
      '2026-09-28',
    );
  });
  it('returns null when the rollout is not active', () => {
    assert.equal(abConfig({...CFG, active: false}), null);
    assert.equal(abConfig(null), null);
  });
  it('returns null when the flag or the build is missing', () => {
    assert.equal(abConfig({...CFG, abTest: undefined}), null);
    assert.equal(abConfig({...CFG, abTest: {}}), null);
    assert.equal(abConfig({...CFG, build: undefined}), null);
  });
  it('honours a configured minimum', () => {
    const c = {...CFG, abTest: {...CFG.abTest, minEnrolledToJudge: 5}};
    assert.equal(abConfig(c).minEnrolled, 5);
  });
});

describe('abQueries', () => {
  const q = abQueries(abConfig(CFG));
  it('scopes both queries to the configured build and excludes the lab', () => {
    for (const sql of [q.perDevice, q.perProcessArm]) {
      assert.match(sql, /properties\.\$app_build = '2027'/);
      assert.match(sql, /\$device_name NOT IN/);
      assert.match(sql, new RegExp(`LIMIT ${AB_ROW_CAP}`));
    }
  });
  it('reads the raw flag value and the configured flag key', () => {
    assert.match(q.perDevice, /JSONExtractString\(properties, 'value'\)/);
    assert.match(q.perDevice, /\$feature_flag = 'nonblocking_splash_v2'/);
  });
  it('counts a device past the splash when a first screen rendered', () => {
    // ColdStartBeganProps (services/analytics/qariahEvents.ts): completion is
    // splash_hidden OR screen_content_rendered. splash_hidden alone counted
    // short onboarding bounces as splash hangs.
    assert.match(
      q.perDevice,
      /max\(event IN \('splash_hidden', 'screen_content_rendered'\)\) AS past_splash/,
    );
  });
  it('follows plan Q1/Q2: boot_risk, prev_process_known, uniq(uuid)', () => {
    assert.match(q.perProcessArm, /properties\.boot_risk = true/);
    assert.match(q.perProcessArm, /prev_process_known = true/);
    assert.match(q.perProcessArm, /uniqIf\(uuid/);
  });
  it('splits the ANR devices by the reveal; a missing value is in the splash', () => {
    assert.match(
      q.perProcessArm,
      /NOT ifNull\(properties\.prev_reached_reveal = true, false\)\) AS anr_in_splash/,
    );
    assert.match(
      q.perProcessArm,
      /AND ifNull\(properties\.prev_reached_reveal = true, false\)\) AS anr_after_splash/,
    );
  });
  it('bounds BOTH queries from the launch date (the PostHog 504 fix)', () => {
    const b = abQueries(abConfig({...CFG, startedAt: '2026-09-28'}));
    for (const sql of [b.perDevice, b.perProcessArm])
      assert.match(sql, /timestamp >= toDateTime\('2026-09-28 00:00:00'\)/);
  });
  it('leaves the queries unbounded without a valid ISO date', () => {
    for (const since of [
      undefined,
      null,
      '',
      "2026-09-28') OR 1=1 --",
      '28/09/2026',
    ]) {
      const b = abQueries({build: '2027', flag: 'f', since});
      for (const sql of [b.perDevice, b.perProcessArm]) {
        assert.doesNotMatch(sql, /timestamp >=/);
        assert.doesNotMatch(sql, /OR 1=1/);
      }
    }
  });
  it('quotes a hostile flag key', () => {
    const sql = abQueries({build: '2027', flag: "x' OR 1=1 --"}).perDevice;
    assert.match(sql, /'x'' OR 1=1 --'/);
  });
});

describe('buildAbModel', () => {
  const m = buildAbModel(ROWS, PROC);
  it('counts arms over enrolled devices only', () => {
    assert.equal(m.users, 7);
    assert.equal(m.enrolled, 4);
    assert.equal(m.groups.treatment.devices, 2);
    assert.equal(m.groups.control.devices, 1);
    assert.equal(m.groups.noArm.devices, 1);
    assert.equal(m.groups.notEnrolled.devices, 3);
  });
  it('counts problems per group', () => {
    assert.deepEqual(m.groups.treatment, {
      devices: 2,
      anr: 1,
      fallback: 1,
      stalled: 1,
      noBoot: 0,
    });
    assert.equal(m.groups.notEnrolled.anr, 1);
    // Opened and never past splash; a device that never opened is not a stall.
    assert.equal(m.groups.notEnrolled.noBoot, 1);
    assert.equal(m.groups.noArm.noBoot, 1);
  });
  it('keeps the arm-of-the-dead-process rows', () => {
    assert.deepEqual(m.byProcessArm.control, {
      anr: 2,
      ran: 3,
      exits: 7,
      anrInSplash: 2,
      anrAfterSplash: 0,
    });
    assert.deepEqual(m.byProcessArm.treatment, {
      anr: 0,
      ran: 1,
      exits: 4,
      anrInSplash: 0,
      anrAfterSplash: 0,
    });
  });
  it('counts every ANR as in the splash when a row has no split', () => {
    const b = buildAbModel([], [['treatment', 2, 5, 9]]);
    assert.equal(b.byProcessArm.treatment.anrInSplash, 2);
    assert.equal(b.byProcessArm.treatment.anrAfterSplash, 0);
  });
  it('accepts PostHog boolean shapes', () => {
    const b = buildAbModel([['x', true, 'control', 'true', false, 0, 1, 1]]);
    assert.equal(b.groups.control.devices, 1);
    assert.equal(b.groups.control.anr, 1);
  });
});

describe('renderAbCard', () => {
  const ab = abConfig(CFG);
  const model = {
    ab,
    ...buildAbModel(ROWS, PROC),
    sentry: {
      onBuild: [
        {id: 'QARIAHV2-58', users: 1},
        {id: 'QARIAHV2-19', users: 6},
      ],
      firstSeen: [{id: 'QARIAHV2-58', users: 1}],
    },
  };
  const lines = renderAbCard(model);
  const text = lines.join('\n');

  it('fits the phone width', () => {
    for (const l of lines) assert.ok(l.length <= 44, l);
  });
  it('opens with the section title, then the BLOCKING totals', () => {
    assert.equal(lines[0], '⚠️ ANRs 2027 · until 2027 is at 100%');
    assert.match(lines[1], /^BLOCKING · \d pass · \d fail · \d not judged$/);
  });
  it('prints the A/B size, the arms, and the need while too few enrolled', () => {
    assert.match(text, /^ {2}7 on 2027 · 4 enrolled · 3 not$/m);
    assert.match(text, /^ {2}enrolled arms: treatment 2 · control 1$/m);
    assert.match(text, /^ {2}too few to judge: need 30 enrolled$/m);
    const big = renderAbCard({...model, enrolled: 30}).join('\n');
    assert.doesNotMatch(big, /too few/);
  });
  it('prints Q1 with its Q2 denominator, and 0 rather than nothing', () => {
    assert.match(text, /treatment\s+0 of 1\s+4/);
    assert.match(text, /control\s+2 of 3\s+7/);
    const none = renderAbCard({...model, byProcessArm: {}}).join('\n');
    assert.match(none, /treatment\s+0 of 0\s+0/);
  });
  it('prints no percentage after the title', () => {
    assert.doesNotMatch(lines.slice(1).join('\n'), /%/);
  });
  it('lists what does not block under OTHER', () => {
    assert.match(text, /OTHER · does not block/);
    assert.match(text, /treatment ANR after the splash: 0 of 1$/m);
    assert.match(text, /no first screen rendered: 2 devices/);
    assert.doesNotMatch(text, /never got past the splash/);
    assert.match(text, /^ {2}QARIAHV2-58 · 1 user$/m);
    assert.match(text, /crash-free rate, past-splash: see report/);
  });
  it('prints none when no fatal is first seen on the build', () => {
    const t = renderAbCard({
      ...model,
      sentry: {onBuild: [], firstSeen: []},
    }).join('\n');
    assert.match(t, /new Sentry issues: none/);
  });
  it('prints the unavailable line and judges nothing on an error', () => {
    const t = renderAbCard({ab, error: 'PostHog 500'});
    assert.equal(t[1], '  A/B unavailable (PostHog 500)');
    const joined = t.join('\n');
    assert.match(joined, /BLOCKING · 0 pass · 0 fail · 3 not judged/);
    assert.doesNotMatch(joined, /CONTROL vs TREATMENT|PASS|FAIL /);
  });
});

// The 2027 diff (beb35bb3...b5b032f9), abridged.
const CHANGED = [
  'app/_layout.tsx',
  'modules/qariah-boot-splash/android/src/main/java/expo/modules/qariahbootsplash/QariahBootSplashModule.kt',
  'services/bootSplash/bootSplashExperiment.ts',
  'utils/bootSplash.ts',
];

describe('judgeFirstSeen (stop condition new-crash-class-on-2027)', () => {
  it('clears a crash in a file 2027 did not change (QARIAHV2-58)', () => {
    const v = judgeFirstSeen(
      {inAppFiles: ['/components/browse/BrowseReciters.tsx']},
      CHANGED,
    );
    assert.equal(v.fromBuild, false);
    assert.equal(v.tag, 'not 2027');
    assert.match(v.reason, /unchanged BrowseReciters\.tsx/);
  });
  it('a crash in a file 2027 changed is 2027, JS path or Kotlin file name', () => {
    assert.equal(
      judgeFirstSeen({inAppFiles: ['app:///utils/bootSplash.ts']}, CHANGED)
        .fromBuild,
      true,
    );
    assert.equal(
      judgeFirstSeen({inAppFiles: ['QariahBootSplashModule.kt']}, CHANGED)
        .fromBuild,
      true,
    );
  });
  it('leaves an ANR to treatment-anr, foreground or background (QARIAHV2-52)', () => {
    for (const background of [false, true]) {
      const v = judgeFirstSeen(
        {anr: true, background, inAppFiles: ['/app/old.tsx']},
        CHANGED,
      );
      assert.equal(v.fromBuild, false);
      assert.equal(v.tag, 'ANR');
      assert.match(v.reason, /see treatment ANR/);
    }
  });
  it('an ANR with a frame in changed code is still 2027', () => {
    const v = judgeFirstSeen(
      {anr: true, background: true, inAppFiles: ['/app/_layout.tsx']},
      CHANGED,
    );
    assert.equal(v.fromBuild, true);
  });
  it('cannot place a frame in the JS bundle itself (no source map)', () => {
    for (const f of ['app:///index.android.bundle', 'main.jsbundle']) {
      const v = judgeFirstSeen({inAppFiles: [f]}, CHANGED);
      assert.equal(v.fromBuild, null, f);
      assert.equal(v.reason, 'bundle frame only');
    }
    // A named source frame next to a bundle frame still decides.
    assert.equal(
      judgeFirstSeen(
        {inAppFiles: ['app:///index.android.bundle', '/utils/bootSplash.ts']},
        CHANGED,
      ).fromBuild,
      true,
    );
  });
  it('cannot place an issue with no app frame, or with no diff', () => {
    assert.equal(judgeFirstSeen({inAppFiles: []}, CHANGED).fromBuild, null);
    assert.equal(
      judgeFirstSeen({inAppFiles: ['/components/x.tsx']}, null).reason,
      'build diff unavailable',
    );
  });
});

describe('stopVerdict / issueKind (new-crash-class-on-2027)', () => {
  const at = (fromBuild, users = 1, reason = 'r') => ({
    users,
    verdict: {fromBuild, reason},
  });
  it('passes old code and ANRs', () => {
    const v = stopVerdict([at(false), at(false, 9)]);
    assert.deepEqual(v, {state: 'PASS', against: 0, watch: 0, total: 2});
  });
  it('fails an issue from 2027, one user is enough', () => {
    assert.equal(stopVerdict([at(true), at(false)]).state, 'FAIL');
  });
  it('watches an unplaced one-user issue, and fails a repeat', () => {
    assert.equal(REPEAT_USERS, 2);
    assert.equal(issueKind(at(null, 1)), 'watch');
    assert.deepEqual(stopVerdict([at(null, 1)]), {
      state: 'PASS',
      against: 0,
      watch: 1,
      total: 1,
    });
    assert.equal(issueKind(at(null, 2)), 'against');
    assert.equal(stopVerdict([at(null, 2)]).state, 'FAIL');
  });
  it('is NO DATA when the diff is missing or an issue has no verdict', () => {
    assert.equal(
      stopVerdict([at(null, 5, 'build diff unavailable')]).state,
      'NO DATA',
    );
    assert.equal(stopVerdict([{users: 1}]).state, 'NO DATA');
    assert.equal(stopVerdict([]).state, 'PASS');
  });
});

describe('clearByOwner (abTest.ownerCleared)', () => {
  const CLEARED = [
    {id: 'QARIAHV2-5K', users: 2, date: '2026-10-17', reason: 'hwui abort'},
  ];
  const repeat = users => ({
    id: 'QARIAHV2-5K',
    users,
    verdict: {fromBuild: null, tag: 'unknown', reason: 'no app frame'},
  });
  it('clears a ruled issue while it stays within the ruled users', () => {
    const i = repeat(2);
    i.verdict = clearByOwner(i, CLEARED);
    assert.equal(i.verdict.tag, 'cleared');
    assert.match(i.verdict.reason, /owner 2026-10-17: hwui abort/);
    assert.equal(issueKind(i), 'clear');
    assert.equal(stopVerdict([i]).state, 'PASS');
  });
  it('judges it again when it spreads past the ruled users', () => {
    const i = repeat(3);
    i.verdict = clearByOwner(i, CLEARED);
    assert.equal(issueKind(i), 'against');
    assert.match(i.verdict.reason, /cleared at 2 users, now 3/);
  });
  it('leaves other issues and missing verdicts alone', () => {
    const other = {...repeat(5), id: 'QARIAHV2-99'};
    assert.equal(clearByOwner(other, CLEARED), other.verdict);
    assert.equal(
      clearByOwner({id: 'QARIAHV2-5K', users: 1}, CLEARED),
      undefined,
    );
    assert.equal(clearByOwner(repeat(2), undefined).tag, 'unknown');
  });
  it('abConfig carries the list', () => {
    const c = {...CFG, abTest: {...CFG.abTest, ownerCleared: CLEARED}};
    assert.deepEqual(abConfig(c).cleared, CLEARED);
  });
});

describe('blockingStopConditions', () => {
  const ab = abConfig(CFG);
  const clean = buildAbModel(
    ROWS.map(r => [...r.slice(0, 4), 0, ...r.slice(5)]),
    PROC,
  );
  const sentry = {onBuild: [], firstSeen: []};
  const byId = m =>
    Object.fromEntries(
      blockingStopConditions({ab, sentry, ...m}).map(c => [c.id, c]),
    );

  it('names the three blocking conditions in order', () => {
    assert.deepEqual(
      blockingStopConditions({ab, sentry, ...clean}).map(c => c.id),
      [
        'treatment-anr',
        'new-crash-class-on-2027',
        'crash-guard-fallback-launches',
      ],
    );
  });
  it('passes when no treatment process hit an ANR, whatever control did', () => {
    // PROC: control 2 of 3 devices with an ANR exit, treatment 0 of 1.
    const c = byId(clean)['treatment-anr'];
    assert.equal(c.state, 'PASS');
    assert.equal(c.detail, '0 of 1 devices');
  });
  it('fails on one ANR of a treatment process before the reveal', () => {
    const m = buildAbModel([], [['treatment', 1, 4, 9, 1, 0]]);
    const c = byId({...clean, byProcessArm: m.byProcessArm})['treatment-anr'];
    assert.equal(c.state, 'FAIL');
    assert.equal(c.detail, '1 of 4 devices');
  });
  it('passes an ANR after the reveal, and reports it (QARIAHV2-3J)', () => {
    const m = {...clean, ...buildAbModel([], [['treatment', 1, 5, 20, 0, 1]])};
    m.groups = clean.groups;
    m.users = clean.users;
    const c = byId(m)['treatment-anr'];
    assert.equal(c.state, 'PASS');
    assert.equal(c.detail, '0 of 5 devices');
    const text = renderAbCard({ab, sentry, ...m}).join('\n');
    assert.match(text, /OTHER · does not block/);
    assert.match(text, /treatment ANR after the splash: 1 of 5$/m);
  });
  it('is TOO FEW when no device ran the treatment yet', () => {
    const c = byId({...clean, byProcessArm: {}})['treatment-anr'];
    assert.equal(c.state, 'TOO FEW');
  });
  it('fails on one fallback launch, with the device denominator', () => {
    const c = byId(buildAbModel(ROWS, PROC))['crash-guard-fallback-launches'];
    assert.equal(c.state, 'FAIL');
    assert.equal(c.detail, '1 of 7 devices');
    assert.equal(byId(clean)['crash-guard-fallback-launches'].state, 'PASS');
  });
  it('judges the crash condition from the Sentry verdicts', () => {
    const one = verdict => ({
      ...clean,
      sentry: {onBuild: [], firstSeen: [{id: 'X', users: 1, verdict}]},
    });
    const crash = m => byId(m)['new-crash-class-on-2027'];
    assert.equal(crash(one({fromBuild: false, reason: 'r'})).state, 'PASS');
    assert.equal(crash(one({fromBuild: true, reason: 'r'})).state, 'FAIL');
    assert.equal(
      crash(one({fromBuild: true, reason: 'r'})).detail,
      '1 of 1 issues',
    );
    assert.equal(crash({...clean, sentry: null}).state, 'NO DATA');
    assert.equal(
      crash({...clean, sentry: {error: 'Sentry 503'}}).state,
      'NO DATA',
    );
  });
  it('judges nothing on an A/B error', () => {
    const cs = blockingStopConditions({ab, error: 'PostHog 500'});
    assert.deepEqual(
      cs.map(c => c.state),
      ['NO DATA', 'NO DATA', 'NO DATA'],
    );
  });
  it('keeps whole words at four-digit counts', () => {
    const big = {
      ...clean,
      users: 1000,
      byProcessArm: {
        treatment: {
          anr: 1,
          ran: 1234,
          exits: 9,
          anrInSplash: 0,
          anrAfterSplash: 1,
        },
      },
    };
    const lines = renderAbCard({ab, sentry, ...big});
    for (const l of lines) assert.ok(l.length <= 44, l);
    const text = lines.join('\n');
    assert.match(text, /0 of 1234 devices$/m);
    assert.match(text, /0 of 1000 devices$/m);
    assert.match(text, /treatment ANR after the splash: 1 of 1234$/m);
    const err = renderBlocking(blockingStopConditions({ab, error: 'x'}));
    assert.match(err.join('\n'), /NO DATA no A\/B data$/m);
  });
  it('renders within the phone width, totals first', () => {
    const lines = renderBlocking(
      blockingStopConditions({ab, sentry, ...buildAbModel(ROWS, PROC)}),
    );
    for (const l of lines) assert.ok(l.length <= 44, l);
    assert.equal(lines[0], 'BLOCKING · 2 pass · 1 fail · 0 not judged');
    assert.match(lines.join('\n'), /fallback launch\s+FAIL\s+1 of 7 devices/);
  });
});

describe('eventFacts', () => {
  it('reads the ANR kind and the in-app frame files', () => {
    const f = eventFacts({
      entries: [
        {
          type: 'exception',
          data: {
            values: [
              {
                type: 'ApplicationNotResponding',
                value: 'Background ANR',
                stacktrace: {
                  frames: [
                    {inApp: false, filename: 'Looper.java'},
                    {inApp: true, filename: 'MainActivity.kt'},
                  ],
                },
              },
            ],
          },
        },
      ],
    });
    assert.deepEqual(f, {
      anr: true,
      background: true,
      inAppFiles: ['MainActivity.kt'],
    });
  });
});

describe('renderAbCard with verdicts', () => {
  const ab = abConfig(CFG);
  const base = {ab, ...buildAbModel(ROWS, PROC)};
  it('prints each issue with its tag, BLOCKING before the A/B table', () => {
    const t = renderAbCard({
      ...base,
      sentry: {
        onBuild: [],
        firstSeen: [
          {
            id: 'QARIAHV2-58',
            users: 1,
            verdict: {
              fromBuild: false,
              tag: 'not 2027',
              reason: 'unchanged BrowseReciters.tsx',
            },
          },
          {
            id: 'QARIAHV2-52',
            users: 1,
            verdict: {
              fromBuild: false,
              tag: 'ANR',
              reason: 'see treatment ANR',
            },
          },
          {
            id: 'QARIAHV2-60',
            users: 1,
            verdict: {fromBuild: null, tag: 'unknown', reason: 'no app frame'},
          },
        ],
      },
    });
    for (const l of t) assert.ok(l.length <= 44, l);
    const text = t.join('\n');
    assert.match(
      text,
      /QARIAHV2-58 · 1 user · not 2027\n {4}unchanged BrowseReciters\.tsx/,
    );
    assert.match(text, /QARIAHV2-52 · 1 user · ANR\n {4}see treatment ANR/);
    assert.match(text, /QARIAHV2-60 · 1 user · watch\n {4}no app frame/);
    assert.match(text, /crash from 2027\s+PASS\s+0 of 3 issues/);
    assert.ok(text.indexOf('BLOCKING') < text.indexOf('CONTROL vs TREATMENT'));
  });
  it('marks a repeat unplaced issue, and fails the condition', () => {
    const text = renderAbCard({
      ...base,
      sentry: {
        onBuild: [],
        firstSeen: [
          {
            id: 'A',
            users: 1,
            verdict: {fromBuild: true, tag: '2027', reason: 'changed x.ts'},
          },
          {
            id: 'B',
            users: 3,
            verdict: {fromBuild: null, tag: 'unknown', reason: 'no app frame'},
          },
        ],
      },
    }).join('\n');
    assert.match(text, /A · 1 user · 2027\n {4}changed x\.ts/);
    assert.match(text, /B · 3 users · repeat/);
    assert.match(text, /crash from 2027\s+FAIL\s+2 of 2 issues/);
  });
});

describe('PostHog busy retry', () => {
  it('knows 503 and 504 as busy, and nothing else', () => {
    assert.ok(isPostHogBusy(new Error('PostHog 503: too busy')));
    assert.ok(isPostHogBusy(new Error('PostHog 504: max execution time')));
    assert.ok(!isPostHogBusy(new Error('PostHog 500')));
  });
  it('retries a busy query once, after the pause', async () => {
    let calls = 0;
    let slept = 0;
    const out = await retryBusy(
      async () => {
        calls++;
        if (calls === 1) throw new Error('PostHog 504: busy');
        return 'ok';
      },
      {waitMs: 5, sleep: async ms => (slept = ms)},
    );
    assert.equal(out, 'ok');
    assert.equal(calls, 2);
    assert.equal(slept, 5);
  });
  it('collectAbModel survives one busy answer and judges the issues', async () => {
    let n = 0;
    const m = await collectAbModel(abConfig({...CFG, sha: 'b5b032f9'}), {
      hogql: async () => {
        n++;
        if (n === 1) throw new Error('PostHog 504: busy');
        return [];
      },
      sentry: {},
      changedFiles: () => CHANGED,
      retry: {waitMs: 0, sleep: async () => {}},
    });
    assert.equal(m.error, undefined);
    assert.equal(m.users, 0);
  });
});

describe('the engagement funnel uses the same first-screen definition', () => {
  it('past_splash in active-rollout.json is splash_hidden or screen_content_rendered', () => {
    const rollout = JSON.parse(
      readFileSync(
        new URL('../../docs/operations/active-rollout.json', import.meta.url),
        'utf8',
      ),
    );
    const step = rollout.engagement.funnel.find(s => s.step === 'past_splash');
    assert.deepEqual([...step.events].sort(), [
      'screen_content_rendered',
      'splash_hidden',
    ]);
  });
});
