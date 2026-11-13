// Tests for scripts/lib/pipeline-flow.mjs: the detail of each step on the
// ops console's Pipeline page (the time in Los Angeles, the audit reasons, the
// owner-queue details, the store builds, the rollout of each platform).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  ageText,
  auditReason,
  biggestGroup,
  dayAge,
  fixedByBuild,
  iosFullDate,
  notBeforeReady,
  parseNotBefore,
  parseReplies,
  ptDay,
  ptWhen,
  queueDetail,
  rolloutPlatforms,
  rolloutSub,
  storeBuilds,
  storeText,
} from '../lib/pipeline-flow.mjs';

test('ptDay and ptWhen give the date in Los Angeles, not in UTC', () => {
  // 05:34Z on 11-08 is 21:34 on 11-07 in Los Angeles (PST, UTC-8).
  assert.equal(ptDay('2026-11-08T05:34:12Z'), '11-07');
  assert.equal(ptWhen('2026-11-08T05:34:12Z'), '11-07 21:34');
  // Summer time (PDT, UTC-7).
  assert.equal(ptWhen('2026-07-01T06:30:00Z'), '06-30 23:30');
  assert.equal(ptDay(''), '');
  assert.equal(ptWhen('bad'), '');
});

test('ageText and dayAge', () => {
  const now = Date.parse('2026-11-10T20:00:00Z');
  assert.equal(ageText('2026-11-10T13:00:00Z', now), '7 h');
  assert.equal(ageText('2026-11-07T20:00:00Z', now), '3 days');
  assert.equal(ageText('', now), '');
  // 11-10 08:00 PT is "today"; 11-09 23:30 PT is 1 day, by the LA calendar.
  assert.equal(dayAge('2026-11-10T16:00:00Z', now), 'today');
  assert.equal(dayAge('2026-11-10T07:30:00Z', now), '1 day');
  assert.equal(dayAge('2026-11-06T20:00:00Z', now), '4 days');
});

test('auditReason: the disk floor, the test iPhone, the release notes', () => {
  const disk = [
    'release-audit: NOT READY public-beta 3953 commit=abc',
    '',
    '**Verdict: NOT READY.** The disk floor check failed before the build step, so gates 1–5 did not run.',
    '',
    '## Findings',
    '',
    '- F1 (#799) — `scripts/disk-floor.sh build` exit 1: "FAIL only 17 GB free on $HOME. A build step needs 28 GB."',
  ].join('\n');
  assert.deepEqual(auditReason(disk), {
    text: 'Disk floor: 17 GB free, 28 GB needed',
    tags: ['disk floor'],
    issues: [799],
  });
  const phone = [
    'release-audit: NOT READY public-beta 3936 commit=abc',
    '',
    '**DONE.** Verdict: **NOT READY.** The iPhone gates did not run: the test iPhone is stuck in Setup Assistant at "Create an iPhone Passcode".',
    '',
    '## 2. What Omar must do',
    '',
    '- #780 — finish the Setup Assistant, then reply `done`.',
    '',
    '## 3. Where each thing is',
    '',
    '- Owner-queue issues of this run: #777 (F1), #778 (F2).',
  ].join('\n');
  assert.deepEqual(auditReason(phone), {
    text: 'Test iPhone stuck in Setup Assistant',
    tags: ['test iPhone'],
    issues: [780],
  });
  const notes = [
    'release-audit: NOT READY public-beta 3817 commit=abc',
    '',
    '**DONE.** Verdict: **NOT READY.** One gate fails: Gate 9 (release notes). `data/changelog.json` has no 3.2.4 entry.',
  ].join('\n');
  assert.equal(auditReason(notes).text, 'No 3.2.4 release notes');
  assert.equal(
    auditReason('**Verdict: NOT READY.** Gate 9 (release notes) fails.').text,
    'Release notes missing',
  );
  assert.deepEqual(auditReason(notes).tags, ['release notes']);
  // An unknown reason gives the first sentence after the verdict.
  const other =
    '**Verdict: NOT READY.** The source mirror dry run found a leak. More text.';
  assert.equal(
    auditReason(other).text,
    'The source mirror dry run found a leak',
  );
  assert.deepEqual(auditReason('').issues, []);
});

test('parseReplies: each exact text, with a note in brackets kept apart', () => {
  assert.deepEqual(parseReplies('granted | pasted'), [
    {text: 'granted'},
    {text: 'pasted'},
  ]);
  assert.deepEqual(
    parseReplies('done (after you free at least 11 GB on the Mac)'),
    [{text: 'done', note: 'after you free at least 11 GB on the Mac'}],
  );
  assert.deepEqual(
    parseReplies('AUTH-13 pass | AUTH-13 fail: <step and what the app showed>'),
    [
      {text: 'AUTH-13 pass'},
      {text: 'AUTH-13 fail: <step and what the app showed>'},
    ],
  );
  assert.deepEqual(parseReplies(''), []);
});

test('queueDetail: the structured fields come first', () => {
  const d = queueDetail(
    [
      '<!-- owner-queue:x -->',
      '- kind: action',
      '- do: Run the disk report, then delete the SAFE lines.',
      '- not-before: build>4406',
      '- blocks: audit, promote, bogus',
      '',
      '**Impact:** the audit cannot build.',
    ].join('\n'),
    {run: 'triage'},
  );
  assert.equal(d.do, 'Run the disk report, then delete the SAFE lines.');
  assert.equal(d.why, 'The audit cannot build.');
  assert.deepEqual(d.notBefore, {text: 'build>4406', build: 4406, date: null});
  assert.deepEqual(d.blocks, ['audit', 'promote']);
});

test('queueDetail: an older body gives its parts by its headings', () => {
  // The shape of #799: "Effect:" and "Fix:" lines; the run gives the blocks.
  const a = queueDetail(
    'Gate: 2.\nEffect: no audit is possible.\nFix: free at least 11 GB more.\n\n## Reply\n\ndone',
    {run: 'auditor'},
  );
  assert.equal(a.why, 'No audit is possible.');
  assert.equal(a.do, 'Free at least 11 GB more.');
  assert.deepEqual(a.blocks, ['audit', 'promote']);
  assert.equal(a.notBefore, null);
  // The shape of #814: "Do one of these:" with bold options.
  const b = queueDetail(
    [
      '**Impact:** the listing has the old text.',
      '',
      '**Do one of these:**',
      '',
      '1. **Grant the permission (an agent then uploads it).** Play Console → …',
      '2. **Or paste it yourself.** Play Console → …',
    ].join('\n'),
  );
  assert.equal(
    b.do,
    'Grant the permission (an agent then uploads it). Or paste it yourself.',
  );
  assert.deepEqual(b.blocks, []);
  // The shape of #815: a "When:" line and a bold lead that is not a label.
  const c = queueDetail(
    [
      '**Impact:** a shorter consent screen.',
      '',
      '**When:** on the first build that has #699 (an internal beta above 3.2.5 (4406)). Build 4406 does not have it.',
      '',
      '**Run case AUTH-13 on iOS and on Android** (`docs/operations/regression-test-plan.md`):',
    ].join('\n'),
  );
  assert.equal(c.do, 'Run case AUTH-13 on iOS and on Android');
  assert.equal(c.notBefore.build, 4406);
});

test('parseNotBefore and notBeforeReady', () => {
  assert.deepEqual(parseNotBefore('build>3900'), {
    text: 'build>3900',
    build: 3900,
    date: null,
  });
  assert.equal(parseNotBefore('2026-11-20').date, '2026-11-20');
  assert.equal(parseNotBefore(''), null);
  const now = Date.parse('2026-11-10T20:00:00Z');
  assert.equal(notBeforeReady(null, {now}), true);
  assert.equal(
    notBeforeReady({build: 3900}, {now, newestInternal: 3900}),
    false,
  );
  assert.equal(
    notBeforeReady({build: 3900}, {now, newestInternal: 3901}),
    true,
  );
  assert.equal(
    notBeforeReady({build: 3900}, {now, newestInternal: null}),
    null,
  );
  assert.equal(notBeforeReady({date: '2026-11-20'}, {now}), false);
  assert.equal(notBeforeReady({date: '2026-11-01'}, {now}), true);
  assert.equal(
    notBeforeReady({text: 'when the ops team is back'}, {now}),
    null,
  );
});

test('storeBuilds: internal from the beta app and the internal track, public from external testing and the beta track', () => {
  const store = {
    readAt: '2026-11-08T22:00:00Z',
    ios: {
      app: [
        {
          build: '4419',
          version: '3.2.5',
          uploadedAt: '2026-11-08T16:19:11Z',
          internal: 'IN_BETA_TESTING',
          external: 'WAITING_FOR_BETA_REVIEW',
        },
        {
          build: '3774',
          version: '3.2.4',
          uploadedAt: '2026-11-07T13:41:46Z',
          internal: 'IN_BETA_TESTING',
          external: 'READY_FOR_BETA_SUBMISSION',
        },
        {
          build: '3763',
          version: '3.2.3',
          uploadedAt: '2026-10-31T04:43:35Z',
          internal: 'IN_BETA_TESTING',
          external: 'IN_BETA_TESTING',
        },
      ],
      beta: [
        {
          build: '4406',
          version: '3.2.5',
          uploadedAt: '2026-11-08T14:34:13Z',
          internal: 'IN_BETA_TESTING',
          external: 'READY_FOR_BETA_SUBMISSION',
        },
        {
          build: '3813',
          version: '3.2.3',
          uploadedAt: '2026-11-04T00:34:51Z',
          internal: 'IN_BETA_TESTING',
          external: 'READY_FOR_BETA_SUBMISSION',
        },
        {
          build: '3700',
          version: '3.2.2',
          uploadedAt: '2026-09-04T00:34:51Z',
          internal: 'IN_BETA_TESTING',
          expired: true,
        },
      ],
    },
    android: {
      internal: [{versionCodes: ['4406'], status: 'completed'}],
      beta: [{versionCodes: ['4419'], status: 'completed'}],
    },
    errors: [],
  };
  const lines = [{task: 'autoSprint', status: 'DONE', build: '3813'}];
  const b = storeBuilds(store, {lines, events: []});
  assert.deepEqual(
    b.internal.map(x => [x.build, x.version, x.ios, x.android, x.by]),
    [
      ['4406', '3.2.5', 'in internal testing', 'live', 'hand'],
      ['3813', '3.2.3', 'in internal testing', null, 'auto-sprint'],
    ],
  );
  assert.deepEqual(
    b.public.map(x => [x.build, x.ios, x.android, x.by]),
    [
      ['4419', 'waits for beta review', 'live', 'hand'],
      ['3763', 'in testing', null, 'hand'],
    ],
  );
  assert.equal(
    storeText(b.public[0], {android: 'Play beta track'}),
    'TestFlight: waits for beta review · Play beta track: live',
  );
  // A Promoter build is not a hand build.
  const p = storeBuilds(store, {
    events: [
      {kind: 'promotion', action: 'public-beta', build: '4419', state: 'DONE'},
    ],
  });
  assert.equal(p.public[0].by, 'Promoter');
  // No store: empty lists, and the errors pass through.
  assert.deepEqual(storeBuilds({errors: ['Google Play: 403']}), {
    internal: [],
    public: [],
    readAt: null,
    errors: ['Google Play: 403'],
  });
  assert.deepEqual(storeBuilds(undefined).internal, []);
});

test('rolloutPlatforms: the newest iOS build of the file, the live card lines', () => {
  const rollout = {
    active: true,
    release: '3.2.3',
    build: 3763,
    startedAt: '2026-11-01',
    platforms: {
      ios: {
        current: {version: '3.2.3', build: 3772, state: 'WAITING_FOR_REVIEW'},
        hotfix: {
          version: '3.2.4',
          build: 3774,
          state: 'READY_FOR_SALE (Apple approved it).',
          phasedRelease: 'ACTIVE from approval (day 1 on 2026-11-08)',
        },
        mechanism: 'Apple phased release',
      },
      android: {
        current: {
          versionCode: 3763,
          status: 'completed',
          userFraction: 1,
          since: '2026-11-08T02:20Z',
        },
      },
    },
  };
  const card = {
    date: '2026-11-08',
    rollout: [
      'iOS 3.2.4 (3774) phased day 1 ≈1% ACTIVE (3.2.3 3772 phased ended by the 3.2.4 release)',
      'Android vc3763 completed 100% since 2026-11-08T02:20Z',
    ],
  };
  const p = rolloutPlatforms(rollout, card);
  assert.deepEqual(p.ios, {
    version: '3.2.4',
    build: '3774',
    state: 'READY_FOR_SALE',
    phased: 'ACTIVE',
    day: 1,
    percent: 1,
    line: card.rollout[0],
  });
  assert.deepEqual(p.android, {
    versionCode: '3763',
    version: '3.2.3',
    status: 'completed',
    percent: 100,
    since: '2026-11-08T02:20Z',
    line: card.rollout[1],
  });
  assert.equal(
    rolloutSub(p),
    'iOS 3.2.4 (3774) phased day 1 · Android vc3763 100 %',
  );
  // Day 1 on 11-08: day 7 (100 %) is 6 days later.
  assert.equal(iosFullDate(p, card.date), '2026-11-14');
  // No card: the file alone.
  const f = rolloutPlatforms(rollout, null);
  assert.equal(f.ios.build, '3774');
  assert.equal(f.ios.day, 1);
  assert.equal(f.android.line, null);
  // A paused ramp.
  const paused = rolloutPlatforms(rollout, {
    rollout: ['iOS 3.2.3 (3772) phased release PAUSED at day 6'],
  });
  assert.equal(paused.ios.phased, 'PAUSED');
  assert.match(rolloutSub(paused), /paused at day 6/);
  assert.equal(iosFullDate(paused, '2026-11-08'), null);
  assert.deepEqual(rolloutPlatforms(null, null), {
    active: false,
    release: null,
    startedAt: null,
    ios: null,
    android: null,
  });
});

test('fixedByBuild and biggestGroup', () => {
  const issues = [
    {
      number: 1,
      title: 'a',
      labels: ['fixed-in:1975', 'incident:cold-start-hang'],
    },
    {
      number: 2,
      title: 'b',
      labels: [{name: 'fixed-in:1975'}, 'incident:cold-start-hang'],
    },
    {number: 3, title: 'c', labels: ['fixed-in:3813', 'incident:memory-oom']},
    {number: 4, title: 'd', labels: ['bug']},
  ];
  assert.deepEqual(fixedByBuild(issues), [
    {
      build: '1975',
      count: 2,
      issues: [
        {number: 2, title: 'b'},
        {number: 1, title: 'a'},
      ],
    },
    {build: '3813', count: 1, issues: [{number: 3, title: 'c'}]},
  ]);
  assert.deepEqual(biggestGroup(issues), {group: 'cold-start-hang', count: 2});
  assert.equal(biggestGroup([]), null);
});
