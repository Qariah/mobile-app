// @ai
// Tests for the signals snapshot sections card, engagement, health, failures
// and focus (planning/signals-phase1-design.md), and for the --json flags of
// scripts/release-health.mjs and scripts/play-vitals.mjs.
//
// Fixtures: scripts/__tests__/fixtures/signals/ops/. The daily-card,
// rollout-engagement and release-health fixtures are trimmed copies of live
// output from 2026-10-18. The two script tests run the real script in a child
// process with a fake fetch (fixtures/signals/ops/fake-fetch.mjs) and a fake
// `gh` on PATH, so they need no network and can prove that nothing is written.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {composeSchema, validateSnapshot} from '../signals/schema.mjs';
import {findSmallCells, SMALL} from '../signals/lib/rules.mjs';
import * as card from '../signals/sections/card.mjs';
import * as engagement from '../signals/sections/engagement.mjs';
import * as health from '../signals/sections/health.mjs';
import * as failures from '../signals/sections/failures.mjs';
import * as focus from '../signals/sections/focus.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const FIX = join(HERE, 'fixtures/signals/ops');
const load = f => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));

/** Validate one section's data as the snapshot would, and run the second guard. */
function check(section, data, status = 'ok') {
  const schema = composeSchema([{name: section.name, schema: section.schema}]);
  const env = {status, source: 'test', ms: 1, data};
  const v = validateSnapshot(
    {
      schemaVersion: 1,
      generatedAt: '2026-10-19T19:30:00.000Z',
      date: '2026-10-19',
      dataThrough: '2026-10-18',
      asOf: '2026-10-19T18:00:00.000Z',
      tz: 'America/Los_Angeles',
      git: {sha: 'test'},
      rules: {},
      sections: {[section.name]: env},
    },
    schema,
  );
  assert.deepEqual(v.errors, [], `${section.name} schema`);
  assert.deepEqual(findSmallCells(env), [], `${section.name} small cells`);
}

/** No text of a failed source may reach the data. */
function assertNoText(data, ...texts) {
  const s = JSON.stringify(data);
  for (const t of texts) assert.ok(!s.includes(t), `data holds "${t}"`);
}

// ---------------------------------------------------------------------------
// card
// ---------------------------------------------------------------------------

const AT = '2026-10-19T19:30:00.000Z';
const at = {date: '2026-10-18', measuredAt: AT};

test('card: shape keeps the card numbers and suppresses only 1 to 4', () => {
  const d = card.shape(load('daily-card.json'), at);
  check(card, d);
  assert.equal(d.header.measuredAt, AT);
  // People and journey: the sums of the two platform rows.
  assert.deepEqual(d.people, {
    total: 6471,
    iOS: 3615,
    Android: 2856,
    installed: 4144,
  });
  assert.deepEqual(
    d.journey.map(s => [s.label, s.installs]),
    [
      ['Opened', 6428],
      ['Past loading', 6293],
      ['Logged in', 373],
      ['Started', 4483],
      ['Really used', 4242],
    ],
  );
  assert.equal(d.header.windowStart, '2026-09-28');
  assert.deepEqual(
    d.header.builds.map(b => b.build),
    ['1718', '1717', '2027'],
  );
  // ACTIVE and USE exactly as the card prints them.
  assert.deepEqual(d.active[0], {
    label: 'Today',
    dau: 748,
    wau: 3174,
    mau: 8101,
  });
  assert.deepEqual(d.usage[0], {
    label: 'Recitations',
    key: 'plays',
    day: 2802,
    week: 21998,
    month: 91990,
  });
  // The card prints "4 Android · never got in"; the snapshot prints "<5".
  assert.deepEqual(d.failures, [
    {installs: SMALL, platform: 'Android', build: '2027', what: 'never got in'},
  ]);
  assert.equal(d.crashes.find(c => c.id === 'QARIAHV2-1Z').users, SMALL);
  assert.equal(d.crashes.find(c => c.id === 'QARIAHV2-C').users, 5);
  // Sentry ANR: 0.0054 of 370 users = 2 users → "<5" and no value.
  assert.deepEqual(d.anr.sentry.android.day, {
    num: SMALL,
    den: 370,
    value: null,
    lowN: false,
  });
  assert.equal(d.anr.sentry.killed.affectedUsers, 0);
  assert.equal(d.anr.sentry.killed.day.value, 0);
  // The pooled 7d / 28d shares have no numerator in the card JSON: not kept.
  assert.deepEqual(Object.keys(d.anr.sentry.android), [
    'activeUsers',
    'affectedUsers',
    'day',
  ]);
  assert.equal(d.anr.play.dailyUsers, 200);
  assert.deepEqual(d.anr.appStore, {none: true});
  // The FREEZES (ANR) week: cell() on every count, the verdict from the
  // exact counts (iOS 3 of 2049 → "<5", but its verdict is still BETTER).
  assert.deepEqual(d.anr.sentry.week, {
    from: '2026-10-12',
    to: '2026-10-18',
    prevFrom: '2026-10-05',
    prevTo: '2026-10-11',
    android: {
      users: 1496,
      frozeUsers: 15,
      prevUsers: 1472,
      prevFrozeUsers: 17,
      verdict: 'SAME',
      byBuild: [
        {build: '2027', users: 694, frozeUsers: SMALL},
        {build: '1717', users: 883, frozeUsers: 12},
      ],
    },
    ios: {
      users: 2049,
      frozeUsers: SMALL,
      prevUsers: 1957,
      prevFrozeUsers: 7,
      verdict: 'BETTER',
      byBuild: [{build: '1718', users: 2049, frozeUsers: SMALL}],
    },
  });
  // A/B: 4 ANR devices in treatment → "<5"; exits follow their devices.
  assert.equal(d.ab.arms.treatment.devices, 17);
  assert.equal(d.ab.arms.treatment.anrDevices, SMALL);
  assert.equal(d.ab.byProcessArm.treatment.exits, 43);
  assert.deepEqual(card.gaps(d), []);
});

test('card: a missing or failed source is null or {available: false}, never a zero or a text', () => {
  const c = clone(load('daily-card.json'));
  delete c.crashes; // absent, not an array
  c.active = null;
  // A key-parse error can quote key material: it must not reach the data.
  c.anr.play = {error: 'Unexpected token -----BEGIN PRIVATE KEY-----MIIEv'};
  c.anr.sentry = null;
  c.anr.appStore = {version: '3.2.1', p50: 0, p90: 1.2};
  c.ab = {ab: {build: '2027', flag: 'f'}, error: 'PostHog 504 SELECT secret'};
  c.failures = [];
  const d = card.shape(c, at);
  check(card, d, 'partial');
  assert.equal(d.crashes, null);
  assert.equal(d.active, null);
  assert.equal(d.anr.sentry, null);
  assert.deepEqual(d.anr.play, {available: false});
  assert.deepEqual(d.ab, {build: '2027', flag: 'f', available: false});
  assertNoText(d, 'PRIVATE KEY', 'MIIEv', 'SELECT secret');
  const notes = card.gaps(d);
  assertNoText(notes, 'PRIVATE KEY', 'SELECT secret');
  const g = notes.join('\n');
  for (const want of [
    '^active: ',
    '^crashes: ',
    '^anr.play: the request failed',
    '^anr.sentry: unavailable',
    '^ab: the A/B query failed',
  ])
    assert.match(g, new RegExp(want, 'm'));
});

test('card: an empty card is zeros; a changed STEPS list fails loudly', () => {
  const d = card.shape(
    {
      byPlatform: [],
      usage: [],
      active: [],
      failures: [],
      crashes: [],
      anr: {},
      ab: null,
    },
    at,
  );
  check(card, d, 'partial');
  assert.deepEqual(d.people, {total: 0, iOS: 0, Android: 0, installed: 0});
  assert.throws(
    () => card.shapePeople([['iOS', 10, 5, 5]]),
    /columns, expected 8/,
  );
});

test('card: collect runs the card script and reports partial on a gap', async () => {
  let args;
  const fixture = load('daily-card.json');
  const ctx = {
    date: '2026-10-18',
    env: {},
    runScript: async a => {
      args = a;
      return clone(fixture);
    },
  };
  const r = await card.collect(ctx);
  assert.deepEqual(args, card.SCRIPT);
  assert.equal(r.status, 'ok');
  assert.match(r.data.header.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
  const noSentry = await card.collect({
    ...ctx,
    runScript: async () => ({...clone(fixture), crashes: null}),
  });
  assert.equal(noSentry.status, 'partial');
  assert.match(noSentry.notes.join(' '), /SENTRY_READ_TOKEN/);
});

test('card: the week is additive; a failed part keeps the other part', () => {
  const full = load('daily-card.json');
  const old = clone(full);
  delete old.anr.sentry.week; // a card JSON from before 2026-10-20
  const a = card.shape(old, at);
  const b = card.shape(full, at);
  check(card, a, 'partial');
  // Every field of the old shape stays the same; only `week` is new.
  const withoutWeek = Object.fromEntries(
    Object.entries(b.anr.sentry).filter(([k]) => k !== 'week'),
  );
  assert.deepEqual(
    Object.keys(withoutWeek),
    Object.keys(a.anr.sentry).filter(k => k !== 'week'),
  );
  for (const k of Object.keys(withoutWeek))
    assert.deepEqual(withoutWeek[k], a.anr.sentry[k], k);
  // The rest of the card section does not change either.
  for (const k of ['people', 'journey', 'active', 'usage', 'failures', 'ab'])
    assert.deepEqual(b[k], a[k], k);
  assert.deepEqual(b.anr.play, a.anr.play);
  assert.equal(a.anr.sentry.week, null);
  assert.match(card.gaps(a).join('\n'), /anr\.sentry\.week: missing/);

  // The week failed: {available: false}, a note, and no error text.
  const wf = clone(full);
  wf.anr.sentry.week = {error: 'Sentry 500 https://sentry.io/x?token=abc'};
  const c = card.shape(wf, at);
  check(card, c, 'partial');
  assert.deepEqual(c.anr.sentry.week, {available: false});
  assert.match(
    card.gaps(c).join('\n'),
    /anr\.sentry\.week: the request failed/,
  );
  assertNoText(c, 'token=abc', 'Sentry 500');

  // The daily rates failed, the week did not: the week stays.
  const df = clone(full);
  df.anr.sentry = {error: 'Sentry 401', week: full.anr.sentry.week};
  const d = card.shape(df, at);
  check(card, d, 'partial');
  assert.equal(d.anr.sentry.available, false);
  assert.equal(d.anr.sentry.week.android.users, 1496);
  assertNoText(d, 'Sentry 401');
});

test('card: an unavailable platform keeps a fixed reason only, and makes a note', () => {
  const c = clone(load('daily-card.json'));
  c.anr.sentry.week.android = {
    unavailable: true,
    reason: 'the Sentry request failed (Sentry 500 https://x/?t=secret)',
  };
  c.anr.sentry.week.ios = {
    unavailable: true,
    reason: 'Sentry missed days in the two weeks',
  };
  const d = card.shape(c, at);
  check(card, d, 'partial');
  assert.deepEqual(d.anr.sentry.week.android, {
    unavailable: true,
    reason: 'the Sentry request failed',
  });
  assert.deepEqual(d.anr.sentry.week.ios, {
    unavailable: true,
    reason: 'Sentry missed days in the two weeks',
  });
  assertNoText(d, 'secret', 'Sentry 500');
  const g = card.gaps(d).join('\n');
  assert.match(
    g,
    /anr\.sentry\.week\.android: unavailable \(the Sentry request failed\)/,
  );
  assert.match(g, /anr\.sentry\.week\.ios: unavailable/);
});

test('card: the week suppresses every count from 1 to 4', () => {
  const c = clone(load('daily-card.json'));
  c.anr.sentry.week.android = {
    users: 4,
    frozeUsers: 1,
    prevUsers: 3,
    prevFrozeUsers: 2,
    verdict: 'TOO FEW',
    byBuild: [{build: '2027', users: 4, frozeUsers: 4}],
  };
  const d = card.shape(c, at);
  check(card, d);
  const a = d.anr.sentry.week.android;
  assert.deepEqual(
    [a.users, a.frozeUsers, a.prevUsers, a.prevFrozeUsers],
    [SMALL, SMALL, SMALL, SMALL],
  );
  assert.equal(a.verdict, 'TOO FEW');
  assert.deepEqual(a.byBuild[0], {
    build: '2027',
    users: SMALL,
    frozeUsers: SMALL,
  });
  // A planted 3 fails the schema and the second guard.
  const bad = clone(d);
  bad.anr.sentry.week.android.frozeUsers = 3;
  assert.ok(findSmallCells(bad).length > 0);
});

// ---------------------------------------------------------------------------
// engagement
// ---------------------------------------------------------------------------

test('engagement: shape turns fractions back into rates and drops cohorts', () => {
  const d = engagement.shape(load('rollout-engagement.json'), {measuredAt: AT});
  check(engagement, d);
  assert.equal(d.verdict, 'OK');
  assert.deepEqual(d.window, {
    from: '2026-09-19T19:30:00.000Z',
    to: AT,
    days: 30,
    requestedDays: 30,
    retried: false,
  });
  const b1718 = d.builds.find(b => b.build === '1718');
  assert.equal(b1718.users, 4516);
  // 0.61524… of 4382 matured = 2696.
  assert.deepEqual(b1718.activation, {
    share: {num: 2696, den: 4382, value: 0.6152, lowN: false},
    matured: 4382,
  });
  assert.equal(b1718.retention.secondDay.share.den, 4302);
  assert.equal(b1718.retention.d7, null); // the script did not send it
  assert.equal(b1718.core[0].event, 'meaningful_listen');
  assert.equal(b1718.core[0].reach.den, 4516);
  assert.ok(!('cohorts' in b1718));
  // A 2-user build: everything small, no share.
  const b2579 = d.builds.find(b => b.build === '2579');
  assert.equal(b2579.users, SMALL);
  assert.deepEqual(b2579.activation, {share: null, matured: SMALL});
  const b2620 = d.builds.find(b => b.build === '2620');
  assert.equal(
    b2620.core.find(c => c.event === 'meaningful_listen').reach,
    'notInstrumented',
  );
  assert.ok(b2620.notInstrumented.includes('got_value'));
  assert.deepEqual(
    d.builds.find(b => b.build === '2877'),
    {build: '2877', notMeasurable: true, users: 0, labUsers: 36},
  );
});

test('engagement: D7 and D28 are read when the script sends them', () => {
  const out = clone(load('rollout-engagement.json'));
  Object.assign(out.builds[0], {
    retentionD7: 0.25,
    retentionD7Sample: 400,
    retentionD28: null,
    retentionD28Sample: 3,
  });
  const d = engagement.shape(out, {measuredAt: AT});
  check(engagement, d);
  assert.deepEqual(d.builds[0].retention.d7, {
    share: {num: 100, den: 400, value: 0.25, lowN: false},
    matured: 400,
  });
  assert.deepEqual(d.builds[0].retention.d28, {share: null, matured: SMALL});
});

test('engagement: a skipped run is not_configured or error, never ok', async () => {
  const run = out => engagement.collect({runScript: async () => out});
  assert.equal(
    (
      await run({
        skipped: true,
        reason:
          'rollout-engagement: POSTHOG_PROJECT_ID / POSTHOG_PERSONAL_API_TOKEN unset — skipping.',
      })
    ).status,
    'not_configured',
  );
  const e = await run({
    skipped: true,
    reason: 'rollout-engagement: query failed — HTTP 504 SELECT secret',
  });
  assert.equal(e.status, 'error');
  assert.match(e.error, /PostHog query failed/);
  assertNoText(e, '504', 'SELECT secret'); // a fixed text, not the script's
  const ok = await run(load('rollout-engagement.json'));
  assert.equal(ok.status, 'ok');
  assert.match(ok.notes.join(' '), /retentionD7/);
});

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

test('health: keeps releases with 50+ sessions, biggest first, with cells', () => {
  const d = health.shape(load('release-health.json'), {measuredAt: AT});
  check(health, d);
  assert.deepEqual(d.window, {
    period: '14d',
    from: '2026-10-05T19:30:00.000Z',
    to: AT,
  });
  assert.deepEqual(
    d.releases.map(r => r.versionCode),
    [1718, 1717, 2027, 2579, 2877, 2620, 2562],
  );
  assert.equal(d.failing, 1);
  const r2877 = d.releases.find(r => r.versionCode === 2877);
  assert.equal(r2877.pass, false);
  assert.equal(r2877.users, 42);
  assert.equal(d.releases[0].crashFreeUserShare, 0.9982497082847142);
  // A share of exactly 1 must not trip the small-cell scan (the key ends in Share).
  assert.equal(
    d.releases.find(r => r.versionCode === 2620).crashFreeUserShare,
    1,
  );
});

test('health: small user counts are suppressed, sessions with them', () => {
  const out = {
    window: '14d',
    minSessions: 50,
    thresholds: {session: 0.995, user: 0.99},
    releases: [
      {
        release: 'com.qariah.app@3.2.2+9',
        versionCode: 9,
        sessions: 60,
        users: 3,
        cfSession: 1,
        cfUser: 1,
        small: false,
        sessionOk: true,
        userOk: true,
        ok: true,
      },
      {
        release: 'com.qariah.app@3.2.2+8',
        versionCode: 8,
        sessions: 49,
        users: 30,
        cfSession: 1,
        cfUser: 1,
        small: true,
        sessionOk: true,
        userOk: true,
        ok: true,
      },
    ],
  };
  const d = health.shape(out, {measuredAt: AT});
  check(health, d);
  assert.equal(d.releases.length, 1);
  assert.equal(d.releases[0].users, SMALL);
  assert.equal(d.releases[0].sessions, SMALL);
});

test('health: collect without a Sentry key is not_configured and runs nothing', async () => {
  let ran = false;
  const r = await health.collect({
    sentry: () => null,
    runScript: async () => {
      ran = true;
      return {};
    },
  });
  assert.equal(r.status, 'not_configured');
  assert.equal(ran, false);
  const ok = await health.collect({
    sentry: () => ({}),
    runScript: async a => {
      assert.deepEqual(a, health.SCRIPT);
      return load('release-health.json');
    },
  });
  assert.equal(ok.status, 'ok');
});

// ---------------------------------------------------------------------------
// failures
// ---------------------------------------------------------------------------

test('failures: id and signature matching are exact', () => {
  assert.equal(failures.namesId('see QARIAHV2-20 here', 'QARIAHV2-20'), true);
  assert.equal(failures.namesId('[Sentry QARIAHV2-20]', 'QARIAHV2-20'), true);
  assert.equal(
    failures.namesId('QARIAHV2-200 and QARIAHV2-20X', 'QARIAHV2-20'),
    false,
  );
  assert.equal(failures.namesId('QARIAHV2 20', 'QARIAHV2-20'), false);
  assert.equal(
    failures.namesSignature(
      '4 Android · Never got in (b2027)',
      'never got in',
      '2027',
    ),
    true,
  );
  assert.equal(
    failures.namesSignature('never got in on b20270', 'never got in', '2027'),
    false,
  );
  assert.equal(
    failures.namesSignature('stuck on loading b2027', 'never got in', '2027'),
    false,
  );
});

test('failures: issueRecord reads labels, the ledger and the triage marker', () => {
  const ledger = new Map([
    [329, '1902'],
    [5, 'merged'],
  ]);
  const r = failures.issueRecord(
    {
      number: 329,
      state: 'open',
      state_reason: null,
      title: '[Sentry QARIAHV2-20] storage',
      body: 'x',
      labels: [{name: 'fixed-in:1901'}, {name: 'bug'}],
    },
    {id: 'QARIAHV2-20', ledger},
  );
  assert.deepEqual(r, {
    number: 329,
    state: 'open',
    stateReason: null,
    fixedIn: ['1901', '1902'],
    primary: true,
  });
  const m = failures.issueRecord(
    {
      number: 5,
      state: 'closed',
      state_reason: 'completed',
      title: 't',
      body: '<!-- sentry-triage-id:QARIAHV2-20 -->',
      labels: ['fixed-in:1922'],
    },
    {id: 'QARIAHV2-20', ledger},
  );
  assert.deepEqual(m.fixedIn, ['1922']); // the ledger's 'merged' is not a build
  assert.equal(m.primary, true);
  assert.equal(
    failures.issueRecord(
      {number: 6, state: 'open', title: 'about QARIAHV2-20', body: ''},
      {id: 'QARIAHV2-20'},
    ).primary,
    false,
  );
});

test('failures: the fix-in-production rule', () => {
  const never = () => {
    throw new Error('git must not run');
  };
  // Equal → in; above every production build → out (no git).
  assert.equal(
    failures.platformVerdict(['2027'], ['1717', '2027'], never),
    true,
  );
  assert.equal(
    failures.platformVerdict(['2100'], ['1717', '2027'], never),
    false,
  );
  // Below → the release line decides.
  assert.equal(
    failures.platformVerdict(['1361'], ['1718'], () => 'in'),
    true,
  );
  assert.equal(
    failures.platformVerdict(['1922'], ['2027'], () => 'out'),
    false,
  );
  assert.equal(
    failures.platformVerdict(['1922'], ['2027'], () => 'unknown'),
    null,
  );
  const prod = [
    {platform: 'iOS', build: '1718'},
    {platform: 'Android', build: '1717'},
    {platform: 'Android', build: '2027'},
  ];
  assert.deepEqual(failures.fixVerdict([], ['iOS'], prod, never), {
    fixByPlatform: {},
    fixInProduction: false,
  });
  assert.deepEqual(
    failures.fixVerdict(['2027'], ['iOS', 'Android'], prod, () => 'out'),
    {fixByPlatform: {iOS: false, Android: true}, fixInProduction: null},
  );
  assert.deepEqual(
    failures.fixVerdict(['1361'], ['iOS', 'Android'], prod, () => 'in'),
    {fixByPlatform: {iOS: true, Android: true}, fixInProduction: true},
  );
  assert.deepEqual(failures.crashPlatforms(['1718', '1717'], prod), [
    'iOS',
    'Android',
  ]);
  assert.deepEqual(failures.crashPlatforms(['9999'], prod), ['iOS', 'Android']);
  assert.deepEqual(failures.crashPlatforms(['2027'], prod), ['Android']);
});

const cardData = () => card.shape(load('daily-card.json'), at);
const HITS = {
  '"QARIAHV2-20"': [
    {
      number: 329,
      state: 'open',
      title: '[Sentry QARIAHV2-20] title from github',
      body: 'b',
      labels: [{name: 'fixed-in:1901'}],
    },
    {
      number: 398,
      state: 'closed',
      state_reason: 'completed',
      title: 'QARIAHV2-20 write half',
      body: '',
      labels: [{name: 'fixed-in:1922'}],
    },
    {
      number: 165,
      state: 'closed',
      title: '[Sentry QARIAHV2-J] stall',
      body: 'QARIAHV2 20 tokens only',
      labels: [],
    },
  ],
  '"QARIAHV2-19"': [
    {
      number: 205,
      state: 'closed',
      state_reason: 'not_planned',
      title: '[Sentry QARIAHV2-19] ANR',
      body: '',
      labels: [{name: 'fixed-in:1361'}],
    },
  ],
  '"never got in"': [
    {
      number: 600,
      state: 'open',
      title: 'never got in on b1717',
      body: '',
      labels: [],
    },
  ],
};

test('failures: buildRows links issues, dedupes queries and keeps the call cap', () => {
  const queries = [];
  const search = q => {
    queries.push(q);
    if (q === '"QARIAHV2-C"') throw new Error('gh: HTTP 403 rate limit');
    return clone(HITS[q] || []);
  };
  const {rows, calls, notes} = failures.buildRows(cardData(), {
    search,
    line: () => 'out',
  });
  assert.equal(calls, 6);
  assert.equal(new Set(queries).size, queries.length);
  const r20 = rows.find(r => r.id === 'QARIAHV2-20');
  assert.equal(r20.status, 'tracked');
  assert.deepEqual(
    r20.issues.map(i => i.number),
    [329, 398],
  ); // #165 only matched the tokens
  assert.deepEqual(r20.fixedIn, ['1901', '1922']);
  assert.deepEqual(r20.fixByPlatform, {iOS: false});
  assert.equal(r20.fixInProduction, false);
  assert.equal(rows.find(r => r.id === 'QARIAHV2-C').status, 'unknown');
  assert.match(notes.join(' '), /QARIAHV2-C: GitHub search failed/);
  assertNoText(notes, '403', 'rate limit');
  // Issue titles and bodies can quote user text: only numbers and states stay.
  assertNoText(rows, 'title from github', 'write half', 'tokens only');
  assert.deepEqual(Object.keys(r20.issues[0]), [
    'number',
    'state',
    'stateReason',
    'fixedIn',
    'primary',
  ]);
  assert.equal(rows.find(r => r.id === 'QARIAHV2-2S').status, 'untracked');
  // The journey issue names b1717, not the row's b2027: not the same signature.
  const j = rows.find(r => r.kind === 'journey');
  assert.equal(j.status, 'untracked');
  assert.equal(j.installs, SMALL);
  const capped = failures.buildRows(cardData(), {
    search: () => [],
    line: () => 'out',
    maxCalls: 2,
  });
  assert.equal(capped.calls, 2);
  assert.equal(capped.rows.filter(r => r.status === 'unknown').length, 4);
});

test('failures: collect validates, and fails cleanly without the card', async () => {
  const none = await failures.collect({
    sections: {card: {status: 'error', data: null}},
  });
  assert.equal(none.status, 'error');
  const ctx = {
    root: ROOT,
    env: {},
    cfg: {build: 2027, sha: 'b5b032f9'},
    sections: {card: {status: 'ok', data: cardData()}},
    buildLines: () => ({
      shallow: true,
      indexError: 'shallow clone',
      candidates: () => null,
      resolve: () => null,
      addRev: () => undefined,
      isAncestor: () => false,
    }),
    gh: (path, o) => {
      assert.equal(path, 'search/issues');
      assert.match(
        o.query.q,
        /^repo:omar-zarka\/qariah-v2 is:issue ".+" in:title,body$/,
      );
      return {items: clone(HITS[o.query.q.match(/(".+")/)[1]] || [])};
    },
  };
  const r = await failures.collect(ctx);
  assert.equal(r.status, 'ok');
  check(failures, r.data);
  assert.equal(r.data.cardMeasuredAt, AT);
  assert.match(r.data.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
  // 1901 and 1922 are above iOS 1718: out without git. 1361 is below 1717 and 2027:
  // only the release line can place it, and a shallow clone cannot, so it is null.
  assert.equal(r.data.rows[0].fixInProduction, false);
  const r19 = r.data.rows.find(x => x.id === 'QARIAHV2-19');
  assert.deepEqual(r19.fixByPlatform, {Android: null});
  assert.equal(r19.fixInProduction, null);

  // The card says its Sentry requests failed: the crash list is short, so
  // failures is partial, not ok (test plan T-ISO-02).
  const shortList = await failures.collect({
    ...ctx,
    sections: {
      card: {
        status: 'partial',
        notes: [
          'crashes: 3 Sentry request(s) failed; the crash rows may be incomplete',
        ],
        data: cardData(),
      },
    },
  });
  assert.equal(shortList.status, 'partial');
  assert.match(shortList.notes.join(' '), /may be incomplete/);
});

test('engagement: the script window is long enough for D28 (T-SCH-13)', () => {
  assert.ok(engagement.SCRIPT.includes('--days=45'));
});

// ---------------------------------------------------------------------------
// focus
// ---------------------------------------------------------------------------

test('focus: the committed focus file is valid; a bad one names its problems', () => {
  const f = JSON.parse(readFileSync(join(ROOT, focus.FOCUS_FILE), 'utf8'));
  assert.deepEqual(focus.focusProblems(f), []);
  // The owner's focus since 2026-10-20 (planning/signals-anr-listens-design.md).
  assert.equal(f.kind, 'metric');
  assert.equal(f.metric, 'playAnrRate');
  assert.equal(f.platform, 'Android');
  assert.equal(f.limit, 0.0047);
  assert.equal(f.title, "Android freezes under Google's limit");
  assert.equal(f.endCondition, "Google's 28-day ANR score under 0.47%");
  // The rollout fixture keeps the rollout kind tested.
  const r = JSON.parse(
    readFileSync(
      join(FIX, 'focus-rollout/docs/operations/brief-focus.json'),
      'utf8',
    ),
  );
  assert.deepEqual(focus.focusProblems(r), []);
  assert.deepEqual(r.versionCodes, [1717, 2027]);
  const bad = focus.focusProblems(
    JSON.parse(
      readFileSync(
        join(FIX, 'focus-bad/docs/operations/brief-focus.json'),
        'utf8',
      ),
    ),
  );
  assert.match(bad.join('\n'), /setAt/);
  assert.match(bad.join('\n'), /not a rollout measure/);
  assert.match(bad.join('\n'), /versionCodes/);
});

test('focus: PostHog query and shape align 14 LA days and fill gaps', () => {
  const asOfWhere = "created_at <= toDateTime('2026-10-19 18:00:00')";
  const q = focus.posthogActiveQuery(['1717', '2027'], '2026-10-18', asOfWhere);
  assert.ok(q.includes(`AND ${asOfWhere}`)); // the ingestion cut-off
  assert.match(q, /range\(14\)/);
  assert.match(q, /\$app_build IN \('1717', '2027'\)/);
  assert.match(q, /\$device_name/); // lab exclusion
  assert.match(q, /2026-09-28 00:00:00/); // 2026-10-05 − 6 days − 1 day margin
  const dates = Array.from(
    {length: 14},
    (_, i) => `2026-10-${String(5 + i).padStart(2, '0')}`,
  );
  const per = focus.shapePosthog(
    [
      ['2027', '2026-10-18', 157, 530],
      ['2027', '2026-10-17', 3, 4],
      ['9999', '2026-10-18', 1, 1],
    ],
    ['1717', '2027'],
    dates,
  );
  assert.deepEqual(per[0].dau, Array(14).fill(0));
  assert.equal(per[1].dau[13], 157);
  assert.equal(per[1].wau[12], SMALL);
});

const playOut = () => ({
  package: 'com.qariah.app',
  days: 35,
  window: {start: '2026-09-10', end: '2026-10-15'},
  clampedTo: '2026-10-15',
  dims: ['versionCode'],
  metric: 'anr',
  sets: [
    {
      kind: 'anr',
      set: 'anrRateMetricSet',
      metric: 'userPerceivedAnrRate',
      rows: [
        ...Array.from({length: 10}, (_, i) => ({
          date: `2026-10-${String(6 + i).padStart(2, '0')}`,
          dims: {versionCode: '1717'},
          rate: 0.02,
          users: 100,
        })),
        {date: '2026-10-13', dims: {versionCode: '2027'}, rate: 0, users: 60},
        {
          date: '2026-10-14',
          dims: {versionCode: '2027'},
          rate: 0.05,
          users: 60,
        },
        {date: '2026-10-15', dims: {versionCode: '2027'}, rate: 0, users: 70},
        {date: '2026-10-15', dims: {versionCode: '35'}, rate: 0.1, users: 900},
      ],
    },
  ],
});

test('focus: shapePlay pools by users and leaves unpublished days null', () => {
  const dates = Array.from(
    {length: 14},
    (_, i) => `2026-10-${String(5 + i).padStart(2, '0')}`,
  );
  const p = focus.shapePlay(playOut(), ['1717', '2027'], dates);
  assert.equal(p.dataThrough, '2026-10-15');
  const [a, b] = p.rate;
  assert.equal(a.day, 0.02);
  assert.ok(Math.abs(a.d7 - 0.02) < 1e-12);
  assert.equal(a.d28, null); // 10 of 28 days published < half
  assert.equal(b.d7, null); // 3 of 7 days < half
  assert.equal(b.dailyRate[13], null); // 2026-10-18: not published yet
  assert.equal(b.dailyRate[9], 0.05);
  assert.equal(p.users[1].users, 70);
  assert.equal(p.users[0].dailyUsers[0], null); // 2026-10-05: no row
  const failedSet = playOut();
  failedSet.sets[0].error = 'HTTP 403: denied';
  assert.throws(
    () => focus.shapePlay(failedSet, ['1717'], dates),
    /the Play request failed/,
  );
});

test('focus: Sentry helpers', () => {
  assert.equal(
    focus.sentryEnd('2026-10-18', new Date('2026-10-19T19:30:00Z')),
    '2026-10-18',
  );
  assert.equal(
    focus.sentryEnd('2026-10-18', new Date('2026-10-18T20:00:00Z')),
    '2026-10-17',
  ); // a --date run before the UTC day is complete
  const m = focus.statsByDate({
    data: [[Date.parse('2026-10-17T00:00:00Z') / 1000, [{count: 3}]]],
  });
  assert.equal(m.get('2026-10-17'), 3);
  const s = focus.sessionsByRelease({
    intervals: ['2026-10-17T00:00:00Z'],
    groups: [
      {
        by: {release: 'r'},
        series: {'count_unique(user)': [40]},
        totals: {'count_unique(user)': 40},
      },
    ],
  });
  assert.equal(s.daily.get('r').get('2026-10-17'), 40);
  assert.equal(s.totals.get('r'), 40);
  const days = ['2026-10-16', '2026-10-17'];
  const i = focus.shapeIssue(
    days,
    new Map([['2026-10-17', 3]]),
    new Map([['2026-10-17', 9]]),
  );
  assert.deepEqual(i, {days, users: [null, SMALL], events: [null, SMALL]});
});

/** A fake Sentry: answers by path shape. */
const fakeSentry = () => ({
  org: 'qariah',
  call: async path => {
    const day = (d, v) => [Date.parse(`${d}T00:00:00Z`) / 1000, [{count: v}]];
    if (path.includes('/sessions/'))
      return {
        intervals: ['2026-10-17T00:00:00Z', '2026-10-18T00:00:00Z'],
        groups: [
          {
            by: {release: 'com.qariah.app@3.2.0+1717'},
            series: {'count_unique(user)': [220, 161]},
            totals: {'count_unique(user)': 1031},
          },
          {
            by: {release: 'com.qariah.app@3.2.1+2027'},
            series: {'count_unique(user)': [151, 156]},
            totals: {'count_unique(user)': 513},
          },
        ],
      };
    if (path.includes('/events-stats/'))
      return {data: [day('2026-10-17', 2), day('2026-10-18', 6)]};
    if (path.includes('/events/')) return {data: [{'count_unique(user)': 13}]};
    throw new Error(`unexpected ${path}`);
  },
});

test('focus: collect computes every rollout measure and validates', async () => {
  const ctx = {
    root: join(FIX, 'focus-rollout'),
    env: {},
    date: '2026-10-19',
    dataThrough: '2026-10-18',
    now: new Date('2026-10-19T19:30:00Z'),
    asOf: '2026-10-19T18:00:00.000Z',
    asOfSQL: "created_at <= toDateTime('2026-10-19 18:00:00')",
    sections: {},
    sentry: fakeSentry,
    runScript: async a => {
      assert.deepEqual(a, focus.PLAY_ARGS);
      return playOut();
    },
    hogql: async (q, o) => {
      assert.ok(o.limit >= 28);
      assert.ok(q.includes(ctx.asOfSQL), 'the PostHog query has the cut-off');
      return [['1717', '2026-10-18', 142, 955]];
    },
  };
  const r = await focus.collect(ctx);
  assert.equal(r.status, 'ok', JSON.stringify(r.notes));
  check(focus, r.data);
  assert.equal(r.data.asOf, ctx.asOf);
  assert.equal(r.data.measures[0].dataThrough, '2026-10-15'); // Play's newest day
  assert.deepEqual(
    r.data.measures.map(m => m.id),
    ['playAnrRate', 'playUsers', 'sentryAnrUsers', 'posthogActive7d'],
  );
  const s = r.data.measures[2];
  assert.equal(s.days.at(-1), '2026-10-18');
  assert.deepEqual(s.perBuild[0].anrUsers.slice(-2), [SMALL, 6]);
  assert.deepEqual(s.perBuild[0].weekAnrShare, {
    num: 13,
    den: 1031,
    value: 0.0126,
    lowN: false,
  });
  assert.equal(r.data.measures[3].perBuild[0].wau[13], 955);
});

test('focus: one failed source makes the section partial, not failed', async () => {
  const ctx = {
    root: join(FIX, 'focus-rollout'),
    env: {},
    date: '2026-10-19',
    dataThrough: '2026-10-18',
    now: new Date('2026-10-19T19:30:00Z'),
    sections: {},
    sentry: () => null,
    runScript: async () => {
      const e = new Error('Command failed');
      e.stderr = 'PlayAuthError: No service account: set GOOGLE_PLAY_SA_JSON';
      throw e;
    },
    hogql: async () => [],
  };
  const r = await focus.collect(ctx);
  assert.equal(r.status, 'partial');
  check(focus, r.data, 'partial');
  assert.deepEqual(
    r.data.measures.map(m => m.status),
    ['not_configured', 'not_configured', 'not_configured', 'ok'],
  );
});

test('focus: a failed source keeps a fixed text, never the error text', async () => {
  const leak = 'Unexpected token -----BEGIN PRIVATE KEY-----MIIEv';
  const ctx = {
    root: join(FIX, 'focus-rollout'),
    env: {},
    date: '2026-10-19',
    dataThrough: '2026-10-18',
    now: new Date('2026-10-19T19:30:00Z'),
    sections: {},
    sentry: () => ({
      org: 'qariah',
      call: async () => {
        throw new Error(`Sentry 500 on /x: ${leak}`);
      },
    }),
    runScript: async () => {
      const e = new Error(`Command failed: ${leak}`);
      e.stderr = leak;
      throw e;
    },
    hogql: async () => {
      throw new Error(`PostHog 400: ${leak}`);
    },
  };
  const r = await focus.collect(ctx);
  assert.equal(r.status, 'partial');
  check(focus, r.data, 'partial');
  assert.deepEqual(
    r.data.measures.map(m => m.note),
    [
      'the Play request failed (play-vitals.mjs exited with an error)',
      'the Play request failed (play-vitals.mjs exited with an error)',
      'the Sentry request failed',
      'the PostHog query failed',
    ],
  );
  assertNoText(r, 'PRIVATE KEY', 'MIIEv', 'Sentry 500', 'PostHog 400');
});

test('focus: incident and experiment kinds, and a bad file', async () => {
  const base = {
    env: {},
    date: '2026-10-19',
    dataThrough: '2026-10-18',
    now: new Date('2026-10-19T19:30:00Z'),
    sentry: fakeSentry,
  };
  const inc = await focus.collect({
    ...base,
    root: join(FIX, 'focus-incident'),
    sections: {},
  });
  assert.equal(inc.status, 'ok');
  check(focus, inc.data);
  assert.equal(inc.data.focus.issue, 'QARIAHV2-20');
  assert.deepEqual(inc.data.measures[0].users.slice(-2), [SMALL, 6]);

  const exp = await focus.collect({
    ...base,
    root: join(FIX, 'focus-experiment'),
    sections: {card: {status: 'ok', data: cardData()}},
  });
  assert.equal(exp.status, 'ok');
  check(focus, exp.data);
  const arms = exp.data.measures[0].arms;
  assert.deepEqual(arms.treatment.anrShare, {
    num: SMALL,
    den: 17,
    value: null,
    lowN: true,
  });
  const noAb = await focus.collect({
    ...base,
    root: join(FIX, 'focus-experiment'),
    sections: {card: {status: 'ok', data: {...cardData(), ab: null}}},
  });
  assert.equal(noAb.status, 'partial');
  check(focus, noAb.data, 'partial');
  assert.match(noAb.data.measures[0].note, /no A\/B block/);
  const failedAb = await focus.collect({
    ...base,
    root: join(FIX, 'focus-experiment'),
    sections: {
      card: {
        status: 'partial',
        data: {
          ...cardData(),
          ab: {build: '2027', flag: 'f', available: false},
        },
      },
    },
  });
  assert.equal(failedAb.data.measures[0].status, 'error');
  assert.match(failedAb.data.measures[0].note, /A\/B query of the card failed/);

  const bad = await focus.collect({
    ...base,
    root: join(FIX, 'focus-bad'),
    sections: {},
  });
  assert.equal(bad.status, 'error');
  const missing = await focus.collect({
    ...base,
    root: join(FIX, 'no-such-dir'),
    sections: {},
  });
  assert.equal(missing.status, 'not_configured');
});

// ---------------------------------------------------------------------------
// focus, kind metric (planning/signals-anr-listens-design.md, section 2)
// ---------------------------------------------------------------------------

const METRIC_FOCUS = {
  kind: 'metric',
  title: "Android freezes under Google's limit",
  metric: 'playAnrRate',
  platform: 'Android',
  limit: 0.0047,
  endCondition: "Google's 28-day ANR score under 0.47%",
  setBy: 'owner',
  setAt: '2026-10-20',
};
// A fixed config with two Android production builds (the state before PR
// #641), so the tests do not move when the rollout file changes.
const ROLLOUT_CFG = {
  card: {
    builds: [
      {platform: 'iOS', release: 'com.qariah.app@3.2.1+1718'},
      {platform: 'Android', release: 'com.qariah.app@3.2.0+1717'},
      {platform: 'Android', release: 'com.qariah.app@3.2.1+2027'},
    ],
  },
};

/** A fetchPlayAnr() answer: 30 published days to 2026-10-15, one gap. */
const pooledPlay = (d28 = 0.0171) => ({
  codes: [1717, 2027],
  date: '2026-10-15',
  day: 0.0099,
  d7: 0.0219,
  d28,
  users: '900',
  series: Array.from({length: 30}, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 16 + i)).toISOString().slice(0, 10);
    return {date: d, rate: 0.02};
  }).filter(s => s.date !== '2026-10-01'),
});

const metricCtx = (over = {}) => ({
  root: ROOT,
  env: {},
  cfg: ROLLOUT_CFG,
  date: '2026-10-19',
  dataThrough: '2026-10-18',
  now: new Date('2026-10-19T19:30:00Z'),
  asOf: '2026-10-19T18:00:00.000Z',
  sections: {card: {status: 'ok', data: cardData()}},
  playToken: async () => 'tok-play',
  sentry: () => {
    throw new Error('the metric kind needs no Sentry call');
  },
  hogql: async () => {
    throw new Error('the metric kind needs no PostHog query');
  },
  runScript: async () => {
    throw new Error('the metric kind runs no script');
  },
  ...over,
});

test('focus metric: the file check accepts the metric kind and names its problems', () => {
  assert.deepEqual(focus.focusProblems(METRIC_FOCUS), []);
  const p = focus
    .focusProblems({
      ...METRIC_FOCUS,
      metric: 'crashRate',
      limit: 4.7,
      setAt: '20 Oct',
    })
    .join('\n');
  assert.match(p, /metric must be one of playAnrRate/);
  assert.match(p, /limit must be a share between 0 and 1/);
  assert.match(p, /setAt/);
  assert.match(
    focus.focusProblems({...METRIC_FOCUS, platform: 'iOS'}).join('\n'),
    /platform of playAnrRate must be Android/,
  );
  // A metric focus needs no measures list.
  assert.equal(METRIC_FOCUS.measures, undefined);
});

test('focus metric: the production versionCodes come from card.builds (Android only)', () => {
  assert.deepEqual(focus.productionCodes(ROLLOUT_CFG), [1717, 2027]);
  // The committed file names one Android production build since PR #641.
  const live = JSON.parse(
    readFileSync(join(ROOT, 'docs/operations/active-rollout.json'), 'utf8'),
  );
  assert.deepEqual(focus.productionCodes(live), [2027]);
  assert.deepEqual(
    focus.productionCodes({
      card: {
        builds: [
          {platform: 'iOS', release: 'com.qariah.app@3.2.1+1718'},
          {platform: 'Android', release: 'com.qariah.app@3.2.1+2027'},
        ],
      },
    }),
    [2027],
  );
});

test("focus metric: shapeMetricPlay gives 28 days to Play's date, null for an unpublished day", () => {
  const m = focus.shapeMetricPlay(pooledPlay());
  assert.equal(m.dataThrough, '2026-10-15');
  assert.equal(m.daily.length, 28);
  assert.equal(m.daily[0].date, '2026-09-18');
  assert.equal(m.daily.at(-1).date, '2026-10-15');
  assert.equal(m.daily.find(d => d.date === '2026-10-01').rate, null);
  assert.equal(m.daily.find(d => d.date === '2026-10-02').rate, 0.02);
  assert.deepEqual([m.day, m.d7, m.d28], [0.0099, 0.0219, 0.0171]);
  assert.throws(
    () => focus.shapeMetricPlay({error: 'HTTP 403 -----BEGIN PRIVATE KEY'}),
    /^Error: the Play request failed$/,
  );
});

test('focus metric: collect pools the production codes, copies the card week and validates', async () => {
  const seen = [];
  const r = await focus.collect(metricCtx(), {
    fetchPlay: async o => {
      seen.push(o);
      return pooledPlay();
    },
  });
  assert.equal(r.status, 'ok', JSON.stringify(r.notes));
  check(focus, r.data);
  assert.deepEqual(seen, [
    {codes: [1717, 2027], seriesDays: 28, token: 'tok-play'},
  ]);
  const m = r.data.metric;
  assert.equal(r.data.focus.kind, 'metric');
  assert.deepEqual(r.data.focus.builds, ['1717', '2027']);
  assert.equal(r.data.focus.limit, 0.0047);
  assert.deepEqual(r.data.measures, []);
  assert.equal(m.status, 'ok');
  assert.equal(m.d28, 0.0171);
  assert.equal(m.ended, false); // 1.71% is not under 0.47%
  assert.deepEqual(m.frozeWeek, {
    from: '2026-10-12',
    to: '2026-10-18',
    prevFrom: '2026-10-05',
    prevTo: '2026-10-11',
    users: 1496,
    frozeUsers: 15,
    prevUsers: 1472,
    prevFrozeUsers: 17,
    verdict: 'SAME',
  });
});

test('focus metric: ended only when the 28-day rate is under the limit', async () => {
  const run = d28 =>
    focus.collect(metricCtx(), {fetchPlay: async () => pooledPlay(d28)});
  assert.equal((await run(0.0046)).data.metric.ended, true);
  assert.equal((await run(0.0047)).data.metric.ended, false); // at the limit
  // The rate rounded to 4 decimals is compared (G-F3).
  assert.equal((await run(0.004649)).data.metric.ended, true); // 0.0046
  assert.equal((await run(0.00474)).data.metric.ended, false); // 0.0047
  const none = await run(null);
  assert.equal(none.data.metric.ended, false);
  check(focus, none.data);
});

test('focus metric: stale Play data (over 7 days before the run) never ends the focus', async () => {
  const fresh = await focus.collect(metricCtx(), {
    fetchPlay: async () => pooledPlay(0.0046),
  });
  assert.equal(fresh.data.metric.ended, true);
  const late = await focus.collect(
    {...metricCtx(), date: '2026-12-31'},
    {fetchPlay: async () => pooledPlay(0.0046)},
  );
  assert.equal(late.data.metric.ended, false);
});

test('focus metric: a missing part is partial with a fixed note, never a leak', async () => {
  const leak = 'Unexpected token -----BEGIN PRIVATE KEY-----MIIEv';
  // No service account.
  const noSa = await focus.collect(
    metricCtx({
      playToken: async () => {
        throw new Error('Play auth failed (PlayAuthError no-service-account)');
      },
    }),
    {fetchPlay: async () => assert.fail('no Play call without a token')},
  );
  assert.equal(noSa.status, 'partial');
  check(focus, noSa.data, 'partial');
  assert.equal(noSa.data.metric.status, 'not_configured');
  assert.equal(noSa.data.metric.frozeWeek.users, 1496); // the week still shows
  // A failed Play request: a fixed text only.
  const failed = await focus.collect(metricCtx(), {
    fetchPlay: async () => {
      throw new Error(leak);
    },
  });
  assert.equal(failed.data.metric.status, 'error');
  assert.equal(failed.data.metric.note, 'the Play request failed');
  assertNoText(failed, 'PRIVATE KEY', 'MIIEv');
  check(focus, failed.data, 'partial');
  // The card's Android week is unavailable: frozeWeek is null with a note.
  const cd = cardData();
  cd.anr.sentry.week.android = {
    unavailable: true,
    reason: 'the Sentry request failed',
  };
  const unav = await focus.collect(
    metricCtx({sections: {card: {status: 'partial', data: cd}}}),
    {fetchPlay: async () => pooledPlay()},
  );
  assert.equal(unav.data.metric.frozeWeek, null);
  assert.equal(unav.status, 'partial');
  check(focus, unav.data, 'partial');
  // No card section (--only=focus): the week is null, and a note says so.
  const noCard = await focus.collect(metricCtx({sections: {}}), {
    fetchPlay: async () => pooledPlay(),
  });
  assert.equal(noCard.status, 'partial');
  assert.equal(noCard.data.metric.frozeWeek, null);
  assert.match(noCard.notes.join('\n'), /frozeWeek is missing/);
  check(focus, noCard.data, 'partial');
  // No Android production build.
  const noAndroid = await focus.collect(
    metricCtx({
      cfg: {
        card: {
          builds: [{platform: 'iOS', release: 'com.qariah.app@3.2.1+1718'}],
        },
      },
    }),
    {fetchPlay: async () => assert.fail('no Play call without a code')},
  );
  assert.equal(noAndroid.data.metric.status, 'error');
  assert.match(noAndroid.data.metric.note, /no Android production build/);
  check(focus, noAndroid.data, 'partial');
});

// ---------------------------------------------------------------------------
// The --json flags, run as child processes with no network
// ---------------------------------------------------------------------------

const PRELOAD = pathToFileURL(join(FIX, 'fake-fetch.mjs')).href;

function sandbox(routes) {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'signals-ops-'));
  writeFileSync(join(dir, 'routes.json'), JSON.stringify(routes));
  // A fake `gh` that records every call and fails, so a GitHub read or write shows.
  writeFileSync(
    join(dir, 'gh'),
    '#!/bin/sh\necho "$@" >> "$GH_STUB_LOG"\nexit 1\n',
  );
  chmodSync(join(dir, 'gh'), 0o755);
  return {
    dir,
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      SIGNALS_FAKE_FETCH: join(dir, 'routes.json'),
      SIGNALS_FAKE_FETCH_LOG: join(dir, 'fetch.log'),
      GH_STUB_LOG: join(dir, 'gh.log'),
      GITHUB_OUTPUT: join(dir, 'github-output'),
    },
    read: f =>
      existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '',
    done: () => rmSync(dir, {recursive: true, force: true}),
  };
}

test('release-health --json prints JSON and files nothing, even for a failing release', () => {
  const groups = load('release-health.json').releases.map(r => ({
    by: {release: r.release},
    totals: {
      'crash_free_rate(session)': r.cfSession,
      'crash_free_rate(user)': r.cfUser,
      'sum(session)': r.sessions,
      'count_unique(user)': r.users,
    },
  }));
  const sb = sandbox([
    {
      match: 'https://sentry.test/api/0/organizations/qariah/sessions/',
      body: {groups},
    },
  ]);
  try {
    const p = spawnSync(
      process.execPath,
      ['--import', PRELOAD, 'scripts/release-health.mjs', '--json'],
      {
        cwd: ROOT,
        env: {
          ...sb.env,
          SENTRY_READ_TOKEN: 'test-token-123456',
          SENTRY_REGION_HOST: 'https://sentry.test',
          SENTRY_ORG: 'qariah',
        },
        encoding: 'utf8',
      },
    );
    assert.equal(p.status, 0, p.stderr);
    const out = JSON.parse(p.stdout); // stdout is the JSON and nothing else
    assert.equal(out.failing, 1);
    assert.equal(out.healthOk, false);
    assert.equal(out.releases.find(r => r.versionCode === 2877).ok, false);
    assert.equal(out.releases.find(r => r.versionCode === 1718).users, 3428);
    assert.match(p.stderr, /DRY RUN/);
    // Nothing written: no gh call (no list, no label, no issue), no GITHUB_OUTPUT.
    assert.equal(sb.read('gh.log'), '');
    assert.equal(existsSync(join(sb.dir, 'github-output')), false);
    const fetched = sb.read('fetch.log').trim().split('\n');
    assert.equal(fetched.length, 1);
    assert.match(fetched[0], /^GET .*sessions\/.*count_unique\(user\)/);
  } finally {
    sb.done();
  }
});

test('play-vitals rates --json prints rows as JSON; issues --json is refused', () => {
  const {privateKey} = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'},
  });
  const row = (day, vc, rate, users) => ({
    startTime: {year: 2026, month: 10, day},
    dimensions: [{dimension: 'versionCode', int64Value: vc}],
    metrics: [
      {metric: 'userPerceivedAnrRate', decimalValue: {value: rate}},
      {metric: 'distinctUsers', decimalValue: {value: users}},
    ],
  });
  const sb = sandbox([
    {
      match: 'oauth2.googleapis.com/token',
      body: {access_token: 'fake-access', expires_in: 3600},
    },
    {
      match: 'anrRateMetricSet:query',
      body: {
        rows: [
          row(15, '2027', '0.0099', '70'),
          {
            ...row(14, '1717', null, '100'),
            metrics: [{metric: 'distinctUsers', decimalValue: {value: '100'}}],
          },
        ],
      },
    },
  ]);
  try {
    const env = {
      ...sb.env,
      GOOGLE_PLAY_SA_JSON: JSON.stringify({
        client_email: 'ci@test.iam.gserviceaccount.com',
        private_key: privateKey,
      }),
    };
    const p = spawnSync(
      process.execPath,
      [
        '--import',
        PRELOAD,
        'scripts/play-vitals.mjs',
        'rates',
        '--dims=versionCode',
        '--metric=anr',
        '--days=7',
        '--json',
      ],
      {cwd: ROOT, env, encoding: 'utf8'},
    );
    assert.equal(p.status, 0, p.stderr);
    const out = JSON.parse(p.stdout);
    assert.equal(out.metric, 'anr');
    assert.deepEqual(out.dims, ['versionCode']);
    assert.equal(out.clampedTo, null);
    assert.equal(out.sets.length, 1);
    assert.deepEqual(out.sets[0].rows, [
      {
        date: '2026-10-15',
        dims: {versionCode: '2027'},
        rate: 0.0099,
        users: 70,
      },
      {date: '2026-10-14', dims: {versionCode: '1717'}, rate: null, users: 100},
    ]);
    assert.equal(sb.read('gh.log'), '');
    const refused = spawnSync(
      process.execPath,
      ['--import', PRELOAD, 'scripts/play-vitals.mjs', 'issues', '--json'],
      {cwd: ROOT, env, encoding: 'utf8'},
    );
    assert.equal(refused.status, 2);
  } finally {
    sb.done();
  }
});

test('card: failed Sentry requests in the card JSON make a note (the section becomes partial)', async () => {
  const {requestGaps} = await import('../signals/sections/card.mjs');
  assert.deepEqual(requestGaps({crashesFailedRequests: 0}), []);
  assert.deepEqual(requestGaps({}), []);
  assert.match(
    requestGaps({crashesFailedRequests: 2})[0],
    /2 Sentry request\(s\) failed/,
  );
});

test('daily-card --anr: the JSON keeps the old fields and adds anr.sentry.week; the text is the FREEZES block', () => {
  const ts = d => Date.parse(`${d}T00:00:00Z`) / 1000;
  const sb = sandbox([
    // PostHog: the platform of each build (collectAnr).
    {
      match: '/query/',
      body: {
        results: [
          ['1718', 50, 0],
          ['1717', 0, 40],
          ['2027', 0, 30],
        ],
      },
    },
    // Sentry: the daily rates (fetchSentryAnr).
    {
      match: 'sessions/?field=count_unique(user)&groupBy=release&statsPeriod',
      body: {
        intervals: ['2026-10-17T00:00:00Z', '2026-10-18T00:00:00Z'],
        groups: [
          {
            by: {release: 'com.qariah.app@3.2.0+1717'},
            series: {'count_unique(user)': [200, 210]},
          },
        ],
      },
    },
    // Sentry: the week (fetchSentryWeek).
    {
      match: 'sessions/?field=count_unique(user)&groupBy=release&project=-1',
      body: {
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
      },
    },
    {
      match: 'sessions/?field=count_unique(user)&project=-1',
      body: {groups: [{by: {}, totals: {'count_unique(user)': 1496}}]},
    },
    // 40 days to today (the run date): every day observed.
    {
      match: 'events-stats/',
      body: {
        data: Array.from({length: 40}, (_, i) => [
          ts(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)),
          [{count: 100}],
        ]).reverse(),
      },
    },
    {
      match: 'events/?field=release',
      body: {
        data: [
          {release: 'com.qariah.app@3.2.0+1717', 'count_unique(user)': 12},
          {release: 'com.qariah.app@3.2.1+2027', 'count_unique(user)': 3},
        ],
      },
    },
    {
      match: 'events/?field=count_unique(user)',
      body: {data: [{'count_unique(user)': 15}]},
    },
  ]);
  try {
    const env = {
      ...sb.env,
      HOME: sb.dir, // no Play service account file
      POSTHOG_PERSONAL_API_TOKEN: 'phx_test',
      POSTHOG_PROJECT_ID: '1',
      SENTRY_READ_TOKEN: 'sentry-test-token',
      SENTRY_ORG: 'qariah',
    };
    const run = args =>
      spawnSync(
        process.execPath,
        ['--import', PRELOAD, 'scripts/daily-card.mjs', ...args],
        {cwd: ROOT, env, encoding: 'utf8'},
      );
    const j = run(['--anr', '--json']);
    assert.equal(j.status, 0, j.stderr);
    const anr = JSON.parse(j.stdout);
    assert.deepEqual(Object.keys(anr), ['play', 'sentry', 'appStore']);
    assert.equal(anr.play, null); // no service account: not configured
    assert.equal(anr.appStore, null);
    // The old fields stay; week is added beside them.
    assert.deepEqual(Object.keys(anr.sentry), [
      'date',
      'observed28',
      'android',
      'hangs',
      'killed',
      'week',
    ]);
    const w = anr.sentry.week;
    assert.deepEqual(Object.keys(w), [
      'from',
      'to',
      'prevFrom',
      'prevTo',
      'android',
      'ios',
    ]);
    assert.deepEqual(Object.keys(w.android), [
      'users',
      'frozeUsers',
      'prevUsers',
      'prevFrozeUsers',
      'verdict',
      'byBuild',
    ]);
    assert.equal(w.android.users, 1496);
    assert.equal(w.android.frozeUsers, 15);
    // card.builds names one Android production build since PR #641.
    assert.deepEqual(
      w.android.byBuild.map(b => [b.build, b.users, b.frozeUsers]),
      [['2027', 694, 3]],
    );
    // The Play line pools the production versionCodes only (G-G4): with no
    // service account there is no Play request at all.
    assert.doesNotMatch(sb.read('fetch.log'), /anrRateMetricSet/);

    // --no-ab is accepted and does nothing (G-C8).
    const t = run(['--anr', '--no-ab']);
    assert.equal(t.status, 0, t.stderr);
    const lines = t.stdout.trimEnd().split('\n');
    assert.equal(lines[0], 'FREEZES (ANR) · last 7 days');
    assert.equal(lines[1], 'Android  15 of 1496 users froze (1.0%)');
    assert.match(t.stdout, /^ {2}Google's score unavailable$/m);
    assert.doesNotMatch(t.stdout, /ANRs Android|ANRs Sentry|App Store hangs/);
    for (const l of lines) assert.ok([...l].length <= 44, l);

    // Read-only: no GitHub call; every POST is a PostHog query.
    assert.equal(sb.read('gh.log'), '');
    for (const l of sb.read('fetch.log').split('\n').filter(Boolean))
      if (!l.startsWith('GET ')) assert.match(l, /^POST \S+\/query\/$/);
  } finally {
    sb.done();
  }
});
