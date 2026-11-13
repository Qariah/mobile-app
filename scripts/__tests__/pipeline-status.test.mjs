// Tests for scripts/pipeline-status.mjs and scripts/lib/pipeline-status.mjs:
// the verdict of each stage, the owner items, the rows, the overall line, the
// bucket signer, and the CLI on a fixture file.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  cardRollout,
  computeStatus,
  newestPublicBeta,
  dueDates,
  FLOW_KEYS,
  isLoopDraft,
  parseRunLines,
  recentRuns,
  runOutcome,
} from '../lib/pipeline-status.mjs';
import {encodeKey, putSignalsJson, signV4} from '../signals/lib/sigv4.mjs';
import {parseArgs} from '../pipeline-status.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'pipeline-status', 'sources.json');
const SCRIPT = join(HERE, '..', 'pipeline-status.mjs');

// 2026-11-10 12:00 in Los Angeles (PST, UTC-8).
const NOW = Date.parse('2026-11-10T20:00:00Z');
const REPO = 'acme/app';
const OWNER = 'acme';
const SHA = 'a'.repeat(40);

const POLICY = {
  runLimits: {
    triage: {maxWallMinutes: 90},
    drafts: {maxWallMinutes: 180},
    autoSprint: {maxWallMinutes: 360},
    auditor: {maxWallMinutes: 480},
  },
  adopt: {
    label: 'remediation-drafted',
    branchPatterns: ['^qariah/fix-'],
    excludeBranchPatterns: ['^qariah/repro-'],
  },
  promotion: {publicBetaEveryDays: 2},
};

let id = 0;
const comment = (body, at, login = OWNER) => ({
  id: ++id,
  body,
  user: {login},
  created_at: at,
  updated_at: at,
  html_url: `https://example.test/c/${id}`,
});
const run = (task, date, status, at, build = 'none') =>
  comment(
    `run-health task=${task} date=${date} status=${status} build=${build} toolCalls=10 minutes=2`,
    at,
  );

// Every daily run on 11-08 and 11-09, all DONE (the auto-sprint shipped 3900).
function goodRuns() {
  const out = [];
  for (const [date, next] of [
    ['2026-11-08', '2026-11-09'],
    ['2026-11-09', '2026-11-10'],
  ]) {
    out.push(run('triage', date, 'DONE', `${date}T21:15:00Z`));
    out.push(run('drafts', date, 'DONE', `${date}T21:30:00Z`));
    out.push(run('autoSprint', date, 'DONE', `${date}T23:40:00Z`, '3900'));
    out.push(run('auditor', date, 'SKIPPED', `${next}T05:40:00Z`));
  }
  return out;
}
const wfRun = (at, conclusion = 'success') => ({
  status: 'completed',
  conclusion,
  created_at: at,
  html_url: 'https://example.test/run',
});
const goodWorkflows = () => ({
  'diagnostics-watch.yml': [
    wfRun('2026-11-10T16:13:00Z'),
    wfRun('2026-11-09T16:13:00Z'),
  ],
  'signals-snapshot.yml': [
    wfRun('2026-11-10T19:30:00Z'),
    wfRun('2026-11-09T19:30:00Z'),
  ],
});
const promotionDone = (build, at) => [
  comment(`promotion: STARTED public-beta ${build} commit=${SHA}`, at),
  comment(`promotion: DONE public-beta ${build}`, at),
];

function sources(extra = {}) {
  return {
    repo: REPO,
    now: NOW,
    cardIssue: 1,
    comments: [...goodRuns(), ...promotionDone('3890', '2026-11-09T18:00:00Z')],
    issues: [],
    closedQueue: [],
    pulls: [],
    rollout: {active: false},
    policy: POLICY,
    workflows: goodWorkflows(),
    ...extra,
  };
}
const stage = (st, key) => st.stages.find(s => s.key === key);

test('a day where every stage ran is GREEN, with eight stages', () => {
  const st = computeStatus(sources());
  assert.equal(st.schemaVersion, 1);
  assert.equal(st.stages.length, 8);
  assert.deepEqual(
    st.stages.map(s => s.verdict),
    ['OK', 'OK', 'OK', 'OK', 'IDLE', 'OK', 'IDLE', 'OK'],
  );
  assert.equal(st.overall.level, 'GREEN');
  assert.deepEqual(st.bottlenecks, []);
  assert.match(stage(st, 'integrate').details[0], /last internal beta 3900/);
});

test('parseRunLines keeps only the owner and drops a line posted twice', () => {
  const at = '2026-11-09T21:15:00Z';
  const ls = parseRunLines(
    [
      run('triage', '2026-11-09', 'DONE', at),
      run('triage', '2026-11-09', 'DONE', '2026-11-09T21:15:10Z'),
      comment(
        'run-health task=triage date=2026-11-09 status=FAILED build=none',
        at,
        'someone',
      ),
    ],
    {owner: OWNER},
  );
  assert.equal(ls.length, 1);
  assert.equal(ls[0].build, null);
});

test('dueDates: a run is due only after its start plus its wall clock and slack', () => {
  // 12:00 PT: the triage of 11-10 (13:07 + 90 + 30 min) is not due yet.
  assert.deepEqual(dueDates('triage', NOW, 90), ['2026-11-09', '2026-11-08']);
  // 16:00 PT: it is.
  const late = Date.parse('2026-11-11T00:00:00Z');
  assert.deepEqual(dueDates('triage', late, 90), ['2026-11-10', '2026-11-09']);
  // The auditor of 11-09 (21:30 + 480 + 30 min) ends at 06:00 PT on 11-10.
  assert.deepEqual(
    dueDates('auditor', Date.parse('2026-11-10T13:59:00Z'), 480),
    ['2026-11-08', '2026-11-07'],
  );
  assert.deepEqual(
    dueDates('auditor', Date.parse('2026-11-10T14:00:00Z'), 480),
    ['2026-11-09', '2026-11-08'],
  );
});

test('two missed or failed due days are STUCK; one is LATE; SKIPPED is IDLE', () => {
  const opts = {now: NOW, policy: POLICY};
  const L = cs => parseRunLines(cs, {owner: OWNER});
  assert.equal(runOutcome('drafts', L([]), opts).verdict, 'STUCK');
  assert.equal(
    runOutcome(
      'drafts',
      L([run('drafts', '2026-11-08', 'DONE', '2026-11-08T21:30:00Z')]),
      opts,
    ).verdict,
    'LATE',
  );
  assert.equal(
    runOutcome(
      'drafts',
      L([
        run('drafts', '2026-11-08', 'FAILED', '2026-11-08T21:30:00Z'),
        run('drafts', '2026-11-09', 'FAILED', '2026-11-09T21:30:00Z'),
      ]),
      opts,
    ).verdict,
    'STUCK',
  );
  const skipped = runOutcome(
    'autoSprint',
    L([
      run('autoSprint', '2026-11-08', 'DONE', '2026-11-08T23:00:00Z'),
      run('autoSprint', '2026-11-09', 'SKIPPED', '2026-11-09T23:00:00Z'),
    ]),
    opts,
  );
  assert.equal(skipped.verdict, 'IDLE');
  // A retry on the same day that ended DONE makes the day good.
  const retried = runOutcome(
    'drafts',
    L([
      run('drafts', '2026-11-08', 'DONE', '2026-11-08T21:30:00Z'),
      run('drafts', '2026-11-09', 'FAILED', '2026-11-09T21:10:00Z'),
      run('drafts', '2026-11-09', 'DONE', '2026-11-09T22:10:00Z'),
    ]),
    opts,
  );
  assert.equal(retried.verdict, 'OK');
  assert.equal(retried.days[0].status, 'DONE');
});

test('a run that already posted today counts before it is due', () => {
  const now = Date.parse('2026-11-10T21:20:00Z'); // 13:20 PT
  const ls = parseRunLines(
    [
      run('triage', '2026-11-08', 'FAILED', '2026-11-08T21:15:00Z'),
      run('triage', '2026-11-09', 'FAILED', '2026-11-09T21:15:00Z'),
      run('triage', '2026-11-10', 'DONE', '2026-11-10T21:16:00Z'),
    ],
    {owner: OWNER},
  );
  const o = runOutcome('triage', ls, {now, policy: POLICY});
  assert.equal(o.days[0].date, '2026-11-10');
  assert.equal(o.verdict, 'OK');
});

test('the audit STUCK after two nights with no line makes the overall RED', () => {
  const comments = goodRuns().filter(c => !/task=auditor/.test(c.body));
  const st = computeStatus(
    sources({
      comments: [...comments, ...promotionDone('3890', '2026-11-09T18:00:00Z')],
    }),
  );
  assert.equal(stage(st, 'audit').verdict, 'STUCK');
  assert.equal(st.overall.level, 'RED');
  assert.match(
    st.overall.reason,
    /^Audit stopped two due days in a row: 2026-11-09 MISSING, 2026-11-08 MISSING/,
  );
  const missing = st.runs48h.filter(r => r.result === 'MISSING');
  assert.ok(missing.some(r => r.task === 'auditor' && r.date === '2026-11-09'));
});

test('a READY build with no go WAITS, and it is a "needs you" item with the exact reply', () => {
  const comments = [
    ...goodRuns(),
    ...promotionDone('3890', '2026-11-09T18:00:00Z'),
    comment(
      `release-audit: READY public-beta 3905 commit=${SHA}`,
      '2026-11-10T05:45:00Z',
    ),
  ];
  const st = computeStatus(sources({comments}));
  assert.equal(stage(st, 'promote').verdict, 'WAITS');
  const approve = st.needsYou.items.find(i => i.type === 'approve');
  assert.equal(approve.reply, 'owner-reply: go public-beta 3905');
  assert.equal(st.needsYou.counts.approvals, 1);
  // After the go, the Promoter publishes: no longer waiting for the owner.
  const go = computeStatus(
    sources({
      comments: [
        ...comments,
        comment('owner-reply: go public-beta 3905', '2026-11-10T15:00:00Z'),
      ],
    }),
  );
  assert.equal(go.needsYou.counts.approvals, 0);
  assert.equal(stage(go, 'promote').verdict, 'OK');
  assert.match(stage(go, 'promote').details[0], /publishing 3905/);
});

// Owner rule (2026-11-09): an old public beta is not a problem when nothing
// waits to go out.
test('an old public beta with nothing READY is OK, not LATE', () => {
  const comments = [
    ...goodRuns(),
    ...promotionDone('3880', '2026-11-05T18:00:00Z'),
  ];
  const st = computeStatus(sources({comments}));
  const p = stage(st, 'promote');
  assert.equal(p.verdict, 'OK');
  assert.equal(p.details[0], 'nothing waits to go out');
  assert.match(p.details[1], /last public beta 3880 .* by the Promoter/);
  assert.doesNotMatch(st.overall.reason || '', /Promote is late/);
  const flow = Object.fromEntries(st.flow.map(s => [s.key, s]));
  assert.match(flow.promote.why, /^Nothing waits to go out\./);
  assert.doesNotMatch(flow.promote.rule, /every \d+ days/);
});

test('an approved build that is not out 24 hours after the go is LATE', () => {
  const comments = [
    ...goodRuns(),
    ...promotionDone('3890', '2026-11-08T18:00:00Z'),
    comment(
      `release-audit: READY public-beta 3905 commit=${SHA}`,
      '2026-11-09T05:45:00Z',
    ),
    comment('owner-reply: go public-beta 3905', '2026-11-09T15:00:00Z'),
  ];
  const st = computeStatus(sources({comments}));
  const p = stage(st, 'promote');
  assert.equal(p.verdict, 'LATE');
  assert.match(p.details[0], /3905 approved 29 h ago, not published/);
  assert.equal(st.overall.level, 'AMBER');
  const flow = Object.fromEntries(st.flow.map(s => [s.key, s]));
  assert.match(flow.promote.why, /You approved 3905 29 h ago/);
  // Under 24 hours, the same approval is still "publishing".
  const early = computeStatus(
    sources({comments, now: Date.parse('2026-11-10T10:00:00Z')}),
  );
  assert.equal(stage(early, 'promote').verdict, 'OK');
  assert.match(stage(early, 'promote').details[0], /publishing 3905/);
});

test('a public beta made by hand covers the READY builds up to its number', () => {
  const comments = [
    ...goodRuns(),
    ...promotionDone('3890', '2026-11-08T18:00:00Z'),
    comment(
      `release-audit: READY public-beta 3895 commit=${SHA}`,
      '2026-11-09T05:45:00Z',
    ),
  ];
  const store = {
    readAt: '2026-11-10T19:59:00Z',
    ios: {
      app: [
        {
          build: '3899',
          version: '3.2.6',
          uploadedAt: '2026-11-09T18:00:00Z',
          internal: 'IN_BETA_TESTING',
          external: 'IN_BETA_TESTING',
          expired: false,
        },
      ],
      beta: [],
    },
    android: {
      internal: [],
      beta: [{versionCodes: ['3899'], status: 'completed', name: '3899'}],
      production: [],
    },
  };
  const st = computeStatus(sources({comments, store}));
  const p = stage(st, 'promote');
  assert.equal(p.verdict, 'OK');
  assert.match(p.details[1], /last public beta 3899 .*by hand/);
  assert.equal(st.needsYou.counts.approvals, 0, 'no go for a covered build');
  // A READY build above the hand build still waits for the go.
  const newer = computeStatus(
    sources({
      store,
      comments: [
        ...comments,
        comment(
          `release-audit: READY public-beta 3905 commit=${SHA}`,
          '2026-11-10T05:45:00Z',
        ),
      ],
    }),
  );
  assert.equal(stage(newer, 'promote').verdict, 'WAITS');
  assert.equal(newer.needsYou.counts.approvals, 1);
});

test('newestPublicBeta takes the higher build of the Promoter line and the stores', () => {
  assert.equal(newestPublicBeta(null, []), null);
  assert.deepEqual(
    newestPublicBeta({build: '3890', at: '2026-11-08T18:00:00Z'}, [
      {build: '3899', at: null, by: 'hand'},
      {build: '3880', at: null, by: 'hand'},
    ]),
    {build: '3899', at: null, by: 'hand'},
  );
  assert.equal(
    newestPublicBeta({build: '3900', at: 'x'}, [{build: '3899', by: 'hand'}])
      .by,
    'Promoter',
  );
});

// 2026-11-11: a fixed Diagnostics Watch stayed LATE for a day after a manual rerun passed.
test('collect: a manual run that passed after a failed scheduled run clears it', () => {
  const failed = goodWorkflows();
  failed['diagnostics-watch.yml'] = [
    wfRun('2026-11-10T16:13:00Z', 'failure'),
    wfRun('2026-11-09T16:13:00Z'),
  ];
  const late = computeStatus(sources({workflows: failed}));
  assert.equal(stage(late, 'collect').verdict, 'LATE');
  const fixed = computeStatus(
    sources({
      workflows: failed,
      workflowsManual: {
        'diagnostics-watch.yml': [wfRun('2026-11-10T18:00:00Z')],
      },
    }),
  );
  assert.equal(stage(fixed, 'collect').verdict, 'OK');
  assert.ok(
    stage(fixed, 'collect').details.some(d => /a manual run passed/.test(d)),
    JSON.stringify(stage(fixed, 'collect').details),
  );
  // A manual run from before the failure does not clear it.
  const older = computeStatus(
    sources({
      workflows: failed,
      workflowsManual: {
        'diagnostics-watch.yml': [wfRun('2026-11-10T10:00:00Z')],
      },
    }),
  );
  assert.equal(stage(older, 'collect').verdict, 'LATE');
});

test('collect: two failed snapshots are STUCK; no run for 30 hours is LATE', () => {
  const two = goodWorkflows();
  two['signals-snapshot.yml'] = [
    wfRun('2026-11-10T19:30:00Z', 'failure'),
    wfRun('2026-11-09T19:30:00Z', 'failure'),
  ];
  const st = computeStatus(sources({workflows: two}));
  assert.equal(stage(st, 'collect').verdict, 'STUCK');
  assert.match(st.bottlenecks[0], /Signals snapshot ended with failure twice/);
  const stale = goodWorkflows();
  stale['diagnostics-watch.yml'] = [wfRun('2026-11-09T08:13:00Z')];
  const st2 = computeStatus(sources({workflows: stale}));
  assert.equal(stage(st2, 'collect').verdict, 'LATE');
  assert.match(stage(st2, 'collect').problem, /no run for 35 h/);
});

const issue = (number, labels, extra = {}) => ({
  number,
  title: `Issue ${number}`,
  body: '',
  labels,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  html_url: `https://example.test/i/${number}`,
  ...extra,
});

test('a P0 owner decision is first in "needs you" and makes the overall RED', () => {
  const body = [
    '<!-- owner-queue:pause-ios -->',
    'kind: decision',
    'run: triage',
    '',
    'A new hang.',
    '',
    '## Reply',
    '',
    'pause ios',
  ].join('\n');
  const issues = [
    issue(40, ['owner-queue', 'action'], {
      body: '<!-- owner-queue:x -->\nkind: action\n\n## Reply\n\ndone',
      title: 'Do a thing',
    }),
    issue(41, ['owner-queue', 'decision', 'priority:P0', 'escalated'], {
      body,
      title: 'Pause the ramp?',
      created_at: '2026-11-10T01:00:00Z',
    }),
    issue(42, ['owner-queue', 'info'], {
      body: '<!-- owner-queue:y -->\nkind: info',
    }),
  ];
  const pulls = [
    {
      number: 7,
      title: 'feat: a',
      draft: true,
      head: {ref: 'claude/a'},
      labels: [],
      created_at: '2026-11-05T00:00:00Z',
      html_url: 'https://example.test/p/7',
    },
    {
      number: 8,
      title: 'fix: loop',
      draft: true,
      head: {ref: 'qariah/fix-8'},
      labels: [],
      created_at: '2026-11-05T00:00:00Z',
      html_url: 'https://example.test/p/8',
    },
  ];
  const st = computeStatus(sources({issues, pulls}));
  assert.equal(st.overall.level, 'RED');
  assert.equal(st.needsYou.items[0].number, 41);
  assert.equal(st.needsYou.items[0].reply, 'pause ios');
  assert.deepEqual(st.needsYou.counts, {
    decisions: 1,
    actions: 1,
    approvals: 0,
    reviews: 1,
    now: 2,
    later: 0,
    held: 0,
  });
  assert.equal(st.needsYou.stewardInfo, 1);
  assert.ok(
    st.needsYou.items.every(i => i.number !== 8),
    'a loop draft waits for the auto-sprint, not the owner',
  );
  assert.match(
    st.bottlenecks.find(b => /more than 3 days/.test(b)),
    /#40, 9 days/,
  );
  assert.equal(st.week.escalations, 1);
});

test('backlogs: investigate issues untouched for 14 days, and too many loop drafts', () => {
  const issues = Array.from({length: 20}, (_, i) =>
    issue(100 + i, ['investigate'], {updated_at: '2026-10-26T00:00:00Z'}),
  );
  const pulls = Array.from({length: 11}, (_, i) => ({
    number: 200 + i,
    title: 'fix',
    draft: true,
    head: {ref: `qariah/fix-${i}`},
    labels: [],
    created_at: '2026-11-09T00:00:00Z',
    html_url: 'https://example.test/p',
  }));
  const st = computeStatus(sources({issues, pulls}));
  assert.equal(stage(st, 'triage').verdict, 'BACKLOG');
  assert.equal(stage(st, 'fix').verdict, 'BACKLOG');
  assert.equal(st.overall.level, 'AMBER');
});

test('close WAITS for production while an issue has a fixed-in label', () => {
  const st = computeStatus(
    sources({
      issues: [issue(5, ['bug', 'fixed-in:3900']), issue(6, ['fixed-in:3901'])],
    }),
  );
  assert.equal(stage(st, 'close').verdict, 'WAITS');
  assert.match(stage(st, 'close').details[0], /2 issues fixed in 3900, 3901/);
});

test('the card Rollout block: a deeper indent continues the line above', () => {
  const body = [
    '<!-- daily-card date=2026-11-10 sections=triage host=cloud -->',
    '```text',
    'Rollout',
    '  iOS 3.2.3 (3772) phased day 5 ≈20%,',
    '    ADVANCING',
    '  Android vc3763 20% inProgress',
    '',
    'BUILDS',
    '```',
  ].join('\n');
  assert.deepEqual(cardRollout(body), [
    'iOS 3.2.3 (3772) phased day 5 ≈20%, ADVANCING',
    'Android vc3763 20% inProgress',
  ]);
  const paused = body.replace('ADVANCING', 'PAUSED');
  const st = computeStatus(
    sources({
      rollout: {active: true, release: '3.2.3', startedAt: '2026-11-01'},
      comments: [
        ...goodRuns(),
        ...promotionDone('3890', '2026-11-09T18:00:00Z'),
        comment(paused, '2026-11-10T19:00:00Z'),
      ],
    }),
  );
  assert.equal(stage(st, 'ramp').verdict, 'WAITS');
  assert.equal(
    stage(st, 'ramp').details[0],
    'iOS 3.2.3 (3772) phased day 5 ≈20%, PAUSED',
  );
});

test('isLoopDraft: the label, a loop branch, and an excluded branch', () => {
  const p = (ref, labels = []) => ({head: {ref}, labels});
  assert.equal(isLoopDraft(p('qariah/fix-1'), POLICY.adopt), true);
  assert.equal(
    isLoopDraft(p('claude/x', ['remediation-drafted']), POLICY.adopt),
    true,
  );
  assert.equal(isLoopDraft(p('qariah/repro-1'), POLICY.adopt), false);
  assert.equal(isLoopDraft(p('claude/x'), POLICY.adopt), false);
});

test('rows: a Promoter run with no approval is left out; Steward rows of one day become one', () => {
  const comments = [
    run('promoter', '2026-11-10', 'SKIPPED', '2026-11-10T15:00:00Z'),
    run('steward', '2026-11-10', 'DONE', '2026-11-10T17:00:00Z'),
    run('steward', '2026-11-10', 'DONE', '2026-11-10T19:00:00Z'),
    run('promoter', '2026-11-10', 'FAILED', '2026-11-10T19:30:00Z'),
  ];
  const rows = recentRuns({
    now: NOW,
    lines: parseRunLines(comments, {owner: OWNER}),
    events: [],
    policy: POLICY,
  }).filter(r => r.kind === 'run');
  assert.deepEqual(
    rows.map(r => [r.task, r.result, r.count || 1]),
    [
      ['promoter', 'FAILED', 1],
      ['steward', 'DONE', 2],
    ],
  );
});

test('the week: runs leave out the Steward and the Promoter; missed due days count', () => {
  const st = computeStatus(sources());
  // 8 runs on 11-08 and 11-09; 11-04..11-07 have no line: 4 tasks x 4 days missed.
  assert.equal(st.week.runs, 8);
  assert.equal(st.week.skipped, 2);
  assert.equal(st.week.missed, 16);
  assert.equal(st.week.internalBetas, 1);
  assert.equal(st.week.publicBetas, 1);
  assert.equal(st.week.from, '2026-11-04');
});

test('sigv4: the AWS S3 example request gives the documented signature', () => {
  const {signature, signedHeaders} = signV4({
    method: 'GET',
    path: '/test.txt',
    headers: {
      host: 'examplebucket.s3.amazonaws.com',
      range: 'bytes=0-9',
      'x-amz-content-sha256':
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'x-amz-date': '20130524T000000Z',
    },
    payloadHash:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIA' + 'IOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
  });
  assert.equal(signedHeaders, 'host;range;x-amz-content-sha256;x-amz-date');
  assert.equal(
    signature,
    'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  );
  assert.equal(encodeKey('a b/(c)!.json'), 'a%20b/%28c%29%21.json');
});

test('putSignalsJson: one signed PUT; a missing key throws before any request', async () => {
  const env = {
    SIGNALS_R2_ACCOUNT_ID: 'example',
    SIGNALS_R2_ACCESS_KEY_ID: 'id',
    SIGNALS_R2_SECRET_ACCESS_KEY: 'secret',
    SIGNALS_R2_BUCKET: 'bkt',
  };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, init});
    return {ok: true, status: 200};
  };
  const r = await putSignalsJson('pipeline/status.json', {a: 1}, env, {
    fetchImpl,
    now: new Date('2026-11-10T20:00:00Z'),
  });
  assert.equal(r.bytes, 7);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://example.r2.cloudflarestorage.com/bkt/pipeline/status.json',
  );
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers['x-amz-date'], '20261110T200000Z');
  assert.match(
    calls[0].init.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=id\/20261110\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
  await assert.rejects(
    putSignalsJson('k', {}, {SIGNALS_R2_BUCKET: 'b'}, {fetchImpl}),
    /SIGNALS_R2_\* key is missing/,
  );
  await assert.rejects(
    putSignalsJson('k', {}, env, {
      fetchImpl: async () => ({ok: false, status: 403}),
    }),
    /answered 403/,
  );
  assert.equal(calls.length, 1);
});

test('parseArgs: --upload does not take a fixture; unknown arguments fail', () => {
  assert.throws(
    () => parseArgs(['--upload', '--sources=x.json']),
    /--upload reads live data/,
  );
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  assert.throws(() => parseArgs(['--now=soon']), /ISO time/);
  assert.equal(parseArgs(['--json']).json, true);
});

test('the CLI on the fixture file prints the status JSON', () => {
  const out = execFileSync(
    process.execPath,
    [SCRIPT, `--sources=${FIXTURE}`, '--json'],
    {
      encoding: 'utf8',
    },
  );
  const st = JSON.parse(out);
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.equal(st.computedAt, new Date(fixture.now).toISOString());
  assert.equal(st.overall.level, 'RED');
  assert.equal(stage(st, 'audit').verdict, 'STUCK');
  assert.equal(stage(st, 'promote').verdict, 'WAITS');
  const text = execFileSync(
    process.execPath,
    [SCRIPT, `--sources=${FIXTURE}`],
    {encoding: 'utf8'},
  );
  assert.match(
    text,
    /^pipeline 2026-11-10: RED · Audit stopped two due days in a row/,
  );
});

// ---------------------------------------------------------------------------
// The flow of the Pipeline page (scripts/lib/pipeline-flow.mjs)
// ---------------------------------------------------------------------------

test('bug: a run line shows its date in Los Angeles, not the UTC date', () => {
  // The auditor of 11-09 posts at 05:40Z on 11-10: 21:40 PT on 11-09. Before
  // the fix the line read "11-10 21:40 PT", a UTC date with a PT time.
  const st = computeStatus(sources());
  const audit = stage(st, 'audit');
  assert.equal(audit.who, 'Auditor · 2026-11-09 · 11-09 21:40 PT · SKIPPED');
  assert.doesNotMatch(audit.who, /11-10 21:40/);
  assert.equal(audit.last, '11-09 21:40 PT · SKIPPED');
  assert.equal(audit.runs[0].when, '11-09 21:40');
  assert.equal(audit.runs[1].when, '11-08 21:40');
  // The same rule for a workflow run and a verdict.
  const late = computeStatus(
    sources({
      workflows: {
        ...goodWorkflows(),
        'signals-snapshot.yml': [
          wfRun('2026-11-10T05:30:00Z', 'failure'),
          wfRun('2026-11-09T19:30:00Z'),
        ],
      },
    }),
  );
  assert.match(
    stage(late, 'collect').who,
    /Signals snapshot 11-09 21:30 PT failure/,
  );
});

test('the flow has 10 steps; the 8 stages are the same objects with the detail fields', () => {
  const st = computeStatus(sources());
  assert.deepEqual(
    st.flow.map(s => s.key),
    FLOW_KEYS,
  );
  assert.equal(st.stages.length, 8);
  for (const s of st.stages)
    assert.equal(st.flow.find(f => f.key === s.key).n, s.n);
  const steward = st.flow.find(s => s.key === 'steward');
  const go = st.flow.find(s => s.key === 'go');
  assert.equal(steward.n, null);
  assert.equal(go.n, null);
  assert.equal(go.verdict, 'GATE');
  assert.equal(go.verdictText, 'YOU');
  // The side steps do not change the overall line.
  assert.equal(st.overall.level, 'GREEN');
  for (const s of st.flow) {
    for (const k of ['sub', 'last', 'why', 'unblock', 'rule']) {
      assert.equal(typeof s[k], 'string', `${s.key}.${k}`);
      assert.ok(s[k].length > 0, `${s.key}.${k} is empty`);
    }
    assert.equal(typeof s.backlog.n, 'number', `${s.key}.backlog`);
    assert.ok(Array.isArray(s.runs), `${s.key}.runs`);
    assert.ok(Array.isArray(s.queue.items), `${s.key}.queue`);
    for (const r of s.runs) assert.match(r.when, /^\d{2}-\d{2} \d{2}:\d{2}$/);
  }
  // The rows of the last 48 hours carry the PT time too.
  for (const r of st.runs48h) assert.match(r.when, /^\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('the fixture: hand builds, audit reasons, needs-you groups, rollout, close', () => {
  const st = computeStatus(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  const by = Object.fromEntries(st.flow.map(s => [s.key, s]));
  // Integrate: the auto-sprint built 3901; 3902 was built by hand after it.
  assert.match(
    by.integrate.details[0],
    /newest internal beta 3\.2\.6 \(3902\), built by hand/,
  );
  assert.match(by.integrate.details[1], /from the auto-sprint 3901/);
  assert.match(by.integrate.why, /3\.2\.6 \(3902\), was built by hand/);
  assert.deepEqual(
    by.integrate.queue.items.map(i => i.ref),
    ['3.2.6 (3902)', '3.2.6 (3901)'],
  );
  assert.match(by.integrate.queue.items[1].title, /^From the auto-sprint/);
  // Promote: the public beta 3880 went out by hand; the Promoter made none.
  assert.match(
    by.promote.why,
    /The newest public beta is 3\.2\.6 \(3880\), published by hand/,
  );
  assert.equal(by.promote.lastRun, null);
  // Audit: the reason of each verdict.
  const v = by.audit.verdicts;
  assert.deepEqual(
    v.map(x => [x.build, x.result]),
    [
      ['3895', 'READY'],
      ['3890', 'NOT READY'],
    ],
  );
  assert.equal(v[1].reason, 'Disk floor: 21 GB free, 28 GB needed');
  assert.deepEqual(v[1].tags, ['disk floor']);
  assert.deepEqual(v[1].issues, [14]);
  // Your go: READY 3895 waits.
  assert.equal(by.go.backlog.n, 1);
  assert.equal(by.go.queue.items[0].ref, '3895');
  // Needs you: the approval and the P1 action are "now"; AUTH-13 waits for a build above 3902.
  const ny = st.needsYou;
  const n14 = ny.items.find(i => i.number === 14);
  assert.equal(
    n14.do,
    'Run ~/.claude/bin/qariah-disk-report.sh, then delete the lines it marks SAFE.',
  );
  assert.deepEqual(n14.replies, [{text: 'done'}]);
  assert.deepEqual(n14.blocks, ['audit', 'promote']);
  assert.equal(n14.group, 'now');
  const n15 = ny.items.find(i => i.number === 15);
  assert.equal(n15.group, 'later');
  assert.deepEqual(n15.notBefore, {
    text: 'build>3902',
    build: 3902,
    date: null,
    ready: false,
  });
  assert.equal(n15.do, 'Run case AUTH-13 on iOS and on Android');
  assert.equal(
    ny.items.find(i => i.type === 'approve').replies[0].text,
    'owner-reply: go public-beta 3895',
  );
  assert.deepEqual(
    ny.held.map(h => h.number),
    [16],
  );
  assert.equal(ny.counts.held, 1);
  assert.equal(ny.counts.later, 1);
  assert.equal(ny.counts.now, 3); // #11 (decision), #14 (action), the approval
  // Ramp: each platform.
  assert.equal(st.rollout.ios.build, '3772');
  assert.equal(st.rollout.android.percent, 50);
  assert.equal(
    by.ramp.sub,
    'iOS 3.2.3 (3772) phased day 6 · Android vc3763 50 %',
  );
  // Close: the issues by the build that fixes them.
  assert.deepEqual(by.close.fixedByBuild, [
    {build: '3901', count: 1, issues: [{number: 13, title: 'Fixed in 3901'}]},
  ]);
  assert.equal(by.close.queue.items[0].ref, '3901');
  // The stores answered.
  assert.deepEqual(st.builds.errors, []);
});

test('a store that does not answer gives a plain line, and no hand build', () => {
  const st = computeStatus(
    sources({
      store: {
        errors: ['Google Play: Play 403 on POST edits'],
        ios: null,
        android: null,
      },
    }),
  );
  const integrate = st.flow.find(s => s.key === 'integrate');
  assert.match(
    integrate.queue.empty,
    /The stores did not answer: Google Play: Play 403/,
  );
  assert.match(integrate.why, /could not read the stores/);
  assert.deepEqual(st.builds.errors, ['Google Play: Play 403 on POST edits']);
});

test('the Steward step: STUCK after two failed runs; LATE when items wait and no run for 8 h', () => {
  const q = issueBody => ({
    number: 31,
    title: 'Pick a name',
    labels: ['owner-queue', 'decision'],
    body: issueBody,
    created_at: '2026-11-10T00:00:00Z',
    updated_at: '2026-11-10T00:00:00Z',
    html_url: 'https://example.test/i/31',
  });
  const two = [
    run('steward', '2026-11-10', 'FAILED', '2026-11-10T17:00:00Z'),
    run('steward', '2026-11-10', 'FAILED', '2026-11-10T19:00:00Z'),
  ];
  const stuck = computeStatus(
    sources({
      comments: [...goodRuns(), ...two],
      issues: [q('## Reply\n\nA | B')],
    }),
  );
  assert.equal(stuck.flow.find(s => s.key === 'steward').verdict, 'STUCK');
  assert.equal(stuck.overall.level, 'AMBER');
  const late = computeStatus(
    sources({
      comments: [
        ...goodRuns(),
        run('steward', '2026-11-10', 'DONE', '2026-11-10T08:00:00Z'),
      ],
      issues: [q('## Reply\n\nA | B')],
    }),
  );
  const s = late.flow.find(x => x.key === 'steward');
  assert.equal(s.verdict, 'LATE');
  assert.deepEqual(
    s.queue.items.map(i => i.ref),
    ['#31'],
  );
  const ok = computeStatus(sources());
  assert.equal(ok.flow.find(x => x.key === 'steward').verdict, 'IDLE');
});

test('the audit texts: the reason in brackets, the blocker title in full', () => {
  const st = computeStatus(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  const audit = st.flow.find(s => s.key === 'audit');
  // The newest verdict of the fixture is READY 3895: no reason in brackets.
  assert.match(audit.why, /Its verdict was READY for 3895\./);
  const late = computeStatus({
    ...JSON.parse(readFileSync(FIXTURE, 'utf8')),
    comments: JSON.parse(readFileSync(FIXTURE, 'utf8')).comments.filter(
      c => !/^release-audit: READY/.test(c.body),
    ),
  });
  const a = late.flow.find(s => s.key === 'audit');
  assert.match(
    a.why,
    /NOT READY for 3890 \(Disk floor: 21 GB free, 28 GB needed\)\./,
  );
  assert.match(
    a.unblock,
    /^#14: Free 11 GB on the Mac for the Auditor\. The next run/,
  );
  assert.doesNotMatch(a.unblock, /…\./);
});
