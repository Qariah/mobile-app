#!/usr/bin/env node
// @ai
//
// scripts/__tests__/daily-note.test.mjs
// -------------------------------------
// The daily health note (scripts/signals/daily-note.mjs): the 06:00 test for
// the two crons, the ramp parser, the two lights, the subject and the body.
//
// Run:  node --test scripts/__tests__/daily-note.test.mjs
//
// No test calls a network service.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModel,
  parseRamp,
  renderHtml,
  renderText,
  shouldSend,
  subjectOf,
} from '../signals/daily-note.mjs';

const NOW = Date.parse('2026-11-10T14:05:00Z');

test('one of the two crons is 06:00 in Los Angeles, in winter and in summer', () => {
  // Winter (PST, UTC-8): 14:00 UTC is 06:00.
  assert.equal(
    shouldSend('0 14 * * *', Date.parse('2026-11-10T14:40:00Z')),
    true,
  );
  assert.equal(
    shouldSend('0 13 * * *', Date.parse('2026-11-10T13:10:00Z')),
    false,
  );
  // Summer (PDT, UTC-7): 13:00 UTC is 06:00.
  assert.equal(
    shouldSend('0 13 * * *', Date.parse('2026-07-01T13:20:00Z')),
    true,
  );
  assert.equal(
    shouldSend('0 14 * * *', Date.parse('2026-07-01T14:20:00Z')),
    false,
  );
  // A late start does not change the answer: the cron hour decides.
  assert.equal(
    shouldSend('0 14 * * *', Date.parse('2026-11-10T15:59:00Z')),
    true,
  );
  // A manual run always sends.
  assert.equal(shouldSend('', NOW), true);
});

test('parseRamp reads the two lines of asc-phased-release.mjs status', () => {
  const r = parseRamp(
    [
      'iOS  version 3.2.4  state=READY_FOR_SALE',
      '     phased release: ACTIVE  day=3  ≈5% of auto-updating users — ADVANCING one rung per day',
      'Play  production: vc 3763  status=completed  rollout=100%',
    ].join('\n'),
  );
  assert.deepEqual(r.ios, {
    version: '3.2.4',
    state: 'READY_FOR_SALE',
    phased: 'ACTIVE',
    day: 3,
    percent: 5,
  });
  assert.deepEqual(r.android, {
    versionCode: '3763',
    status: 'completed',
    percent: 100,
  });
  assert.deepEqual(parseRamp(''), {ios: null, android: null});
});

// --- a small set of inputs --------------------------------------------------
const days = [
  '2026-11-01',
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-07',
  '2026-11-08',
  '2026-11-09',
];
const snapshot = ({crashFree = 0.999} = {}) => ({
  sections: {
    active: {
      status: 'ok',
      data: {
        days,
        total: {
          dau: [700, 710, 720, 730, 740, 750, 760, 770, 806],
          wau: [2000, 2006, 2100, 2200, 2300, 2400, 2500, 2600, 3127],
        },
        iOS: {dau: [0, 0, 0, 0, 0, 0, 0, 0, 469]},
        Android: {dau: [0, 0, 0, 0, 0, 0, 0, 0, 337]},
      },
    },
    health: {
      status: 'ok',
      data: {
        releases: [
          {
            release: 'com.qariah.app@3.2.1+2027',
            versionCode: 2027,
            users: 2170,
            crashFreeUserShare: crashFree,
          },
          {
            release: 'com.qariah.app@3.2.4+3774',
            versionCode: 3774,
            users: 123,
            crashFreeUserShare: 1,
          },
          {
            release: 'com.qariah.app@3.2.4+3951',
            versionCode: 3951,
            users: 24,
            crashFreeUserShare: 0.9583,
          },
          {
            release: 'com.qariah.app@3.2.2+3718',
            versionCode: 3718,
            users: 10,
            crashFreeUserShare: 1,
          },
        ],
      },
    },
  },
});
const latest = ({d7 = 0.003} = {}) => ({
  sections: {
    card: {
      data: {
        anr: {
          play: {
            date: '2026-11-08',
            day: 0.002,
            d7,
            d28: 0.004,
            dailyUsers: 200,
          },
        },
        crashes: [
          {
            id: 'QARIAHV2-7B',
            title: 'App hanging',
            users: 13,
            builds: ['3772'],
          },
        ],
      },
    },
  },
});
const status = ({level = 'GREEN', items = []} = {}) => ({
  computedAt: '2026-11-10T14:00:00Z',
  overall: {
    level,
    reason:
      level === 'GREEN'
        ? 'every stage ran on its last due day'
        : 'Collect is late',
  },
  needsYou: {items},
  rollout: {ios: {version: '3.2.4', build: '3774'}},
  builds: {
    internal: [{build: '4483', at: '2026-11-10T00:18:26Z', by: 'auto-sprint'}],
    public: [{build: '4419', at: '2026-11-08T16:19:11Z', by: 'hand'}],
  },
  stages: [
    {
      key: 'triage',
      details: ['49 investigate issues · 19 untouched for 14 days or more'],
    },
    {key: 'audit', details: ['last verdict: READY public-beta 4487 (11-09)']},
  ],
});
const ramp = parseRamp(
  'iOS  version 3.2.4  state=READY_FOR_SALE\n phased release: ACTIVE  day=3  ≈5% x\nPlay  production: vc 3763  status=completed  rollout=100%',
);
const model = (over = {}) =>
  buildModel({
    status: status(over.status),
    snapshot: snapshot(over.snapshot),
    latest: latest(over.latest),
    ramp,
    issues: over.issues || [],
    nowMs: NOW,
  });

test('a healthy day: both lights OK, and the subject says "all healthy" with the DAU', () => {
  const m = model();
  assert.equal(m.pipeline.level, 'GREEN');
  assert.equal(m.field.level, 'OK');
  assert.equal(subjectOf(m), 'Qariah: all healthy · DAU 806');
  assert.equal(m.users.dau, 806);
  assert.equal(
    m.users.avg7,
    Math.round((730 + 740 + 750 + 760 + 770 + 806 + 720) / 7),
  );
  assert.equal(m.users.wauBefore, 2006);
});

test('Field is CHECK when the 7-day ANR rate is above 0.47%', () => {
  const m = model({latest: {d7: 0.016}});
  assert.equal(m.field.level, 'CHECK');
  assert.match(m.field.reasons[0], /Play ANR rate 1\.60% for 7 days/);
  assert.equal(subjectOf(m), 'Qariah: field CHECK · pipeline OK · DAU 806');
});

test('Field is CHECK for a store build below 99%, not for a small beta', () => {
  const beta = model();
  assert.equal(
    beta.field.level,
    'OK',
    'the beta 3951 (24 users) does not change the light',
  );
  assert.ok(beta.crash.some(c => c.name === '3.2.4 (3951)' && c.below));
  assert.ok(
    beta.crash.some(c => c.name === '3.2.4 (3774)'),
    'the iOS ramp build is in the table',
  );
  assert.ok(
    !beta.crash.some(c => c.name === '3.2.2 (3718)'),
    'a small build above the bar is left out',
  );
  const store = model({snapshot: {crashFree: 0.985}});
  assert.equal(store.field.level, 'CHECK');
  assert.match(
    store.field.reasons[0],
    /3\.2\.1 \(2027\) has 98\.50% crash-free users/,
  );
});

test('Field is CHECK for a new critical issue in the last 24 hours only', () => {
  const issue = (number, createdAt) => ({
    number,
    title: 'x',
    createdAt,
    labels: [{name: 'investigate'}, {name: 'severity:critical'}],
  });
  const m = model({
    issues: [
      issue(826, '2026-11-10T01:00:00Z'),
      issue(700, '2026-11-08T01:00:00Z'),
    ],
  });
  assert.equal(m.field.level, 'CHECK');
  assert.match(
    m.field.reasons.join(' '),
    /1 new critical issue in 24 hours: #826/,
  );
  assert.deepEqual(
    m.newField.map(i => i.number),
    [826],
  );
});

test('needs you: a go is one item, with its twin decision, and the subject names it', () => {
  const items = [
    {
      group: 'now',
      type: 'approve',
      build: '4487',
      reply: 'owner-reply: go public-beta 4487',
      url: '',
    },
    {
      group: 'now',
      type: 'decision',
      title: 'Publish public beta 4487? (reply on the Daily card)',
      url: 'https://github.com/o/r/issues/834',
    },
    {
      group: 'now',
      type: 'action',
      title: 'Next build: ops team runs AUTH-13',
      url: 'https://github.com/o/r/issues/815',
      replies: [{text: 'AUTH-13 pass'}, {text: 'AUTH-13 fail'}],
    },
    {
      group: 'review',
      type: 'review',
      title: 'PR',
      url: 'https://github.com/o/r/pull/727',
    },
    {
      group: 'later',
      type: 'action',
      title: 'later',
      url: 'https://github.com/o/r/issues/1',
    },
  ];
  const m = model({status: {items}});
  assert.equal(m.needs.length, 3);
  assert.equal(m.needs[0].reply, 'owner-reply: go public-beta 4487');
  assert.equal(m.needs[0].also, 834);
  assert.match(m.needs[1].text, /^#815 /);
  assert.equal(m.needs[1].reply, 'AUTH-13 pass or AUTH-13 fail');
  assert.match(m.needs[2].text, /1 PR wait for your review: #727/);
  assert.equal(subjectOf(m), 'Qariah: all healthy · 1 go waits');
});

test('an AMBER pipeline shows in the subject', () => {
  const m = model({status: {level: 'AMBER'}});
  assert.equal(subjectOf(m), 'Qariah: field OK · pipeline AMBER · DAU 806');
});

test('the ramp rows carry the build and the live percent', () => {
  const m = model();
  assert.deepEqual(
    m.ramp.map(r => [r.store, r.build, r.percent]),
    [
      ['App Store', '3.2.4 (3774)', 5],
      ['Play', 'vc3763', 100],
    ],
  );
});

test('the text and the HTML carry the numbers, and the HTML escapes text', () => {
  const m = model({
    status: {
      items: [{group: 'now', type: 'action', title: 'a <b> & c', url: ''}],
    },
  });
  const text = renderText(m);
  for (const s of [
    'DAU 806',
    'WAU 3,127',
    'App Store 3.2.4 (3774): 5%',
    'internal beta 4483',
    'public beta 4419 (11-08, by hand)',
  ])
    assert.ok(text.includes(s), `text has "${s}"`);
  const html = renderHtml(m);
  assert.ok(html.includes('a &lt;b&gt; &amp; c'));
  assert.ok(!html.includes('a <b> & c'));
  assert.ok(html.includes('https://qariah-ops-console.pages.dev/pipeline'));
});

test('missing inputs give a note that says so, not an error', () => {
  const m = buildModel({
    status: null,
    snapshot: null,
    latest: null,
    ramp: parseRamp(''),
    issues: [],
    nowMs: NOW,
  });
  assert.equal(m.pipeline.level, 'UNKNOWN');
  assert.equal(m.field.level, 'CHECK');
  assert.match(m.field.reasons.join(' '), /Sentry release health is missing/);
  assert.match(renderText(m), /The store read is missing/);
  assert.match(renderText(m), /the PostHog numbers are missing/);
});
