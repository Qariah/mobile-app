// Writes sources.json next to this file: the inputs of one RED day for
// scripts/__tests__/pipeline-status.test.mjs (the CLI test). Synthetic data only.
//   node scripts/__tests__/fixtures/pipeline-status/make-sources.cjs
const fs = require('fs');
const path = require('path');

const OWNER = 'acme';
const SHA = 'b'.repeat(40);
let id = 0;
const c = (body, at) => ({
  id: ++id,
  body,
  user: {login: OWNER},
  created_at: at,
  updated_at: at,
  html_url: `https://example.test/c/${id}`,
});
const run = (task, date, status, at, build = 'none') =>
  c(
    `run-health task=${task} date=${date} status=${status} build=${build} toolCalls=12 minutes=3`,
    at,
  );

const comments = [];
for (const date of ['2026-11-08', '2026-11-09']) {
  const shipped = date === '2026-11-09';
  comments.push(run('triage', date, 'DONE', `${date}T21:15:00Z`));
  comments.push(run('drafts', date, 'DONE', `${date}T21:30:00Z`));
  comments.push(
    run(
      'autoSprint',
      date,
      shipped ? 'DONE' : 'SKIPPED',
      `${date}T23:40:00Z`,
      shipped ? '3901' : 'none',
    ),
  );
}
// An audit on 11-04 stopped at the disk floor (NOT READY 3890).
comments.push(
  c(
    [
      `release-audit: NOT READY public-beta 3890 commit=${SHA}`,
      '',
      '# Release Auditor — public beta candidate 3.2.6 (3890)',
      '',
      '**Verdict: NOT READY.** One gate fails: the disk floor. The Mac has 21 GB free and a build needs 28 GB, so the release builds did not run.',
      '',
      '## 2. What Omar must do',
      '',
      '- #14 — free at least 7 GB on the Mac, then reply `done`.',
    ].join('\n'),
    '2026-11-05T05:40:00Z',
  ),
);
comments.push(
  run('auditor', '2026-11-04', 'DONE', '2026-11-05T05:41:00Z', '3890'),
);
// The last audit: READY 3895 on 11-06. No auditor line on 11-08 or 11-09.
comments.push(
  c(
    `release-audit: READY public-beta 3895 commit=${SHA}`,
    '2026-11-07T05:45:00Z',
  ),
);
comments.push(
  run('auditor', '2026-11-06', 'DONE', '2026-11-07T05:46:00Z', '3895'),
);
comments.push(run('steward', '2026-11-10', 'DONE', '2026-11-10T17:03:00Z'));
comments.push(
  c(
    [
      '<!-- daily-card date=2026-11-10 sections=triage host=cloud -->',
      '```text',
      'Rollout',
      '  iOS 3.2.3 (3772) phased day 6 ≈50%,',
      '    ADVANCING',
      '  Android vc3763 50% inProgress (mirror of',
      '    iOS rung)',
      '',
      'BUILDS',
      '```',
    ].join('\n'),
    '2026-11-10T19:10:00Z',
  ),
);

const wf = (at, conclusion = 'success') => ({
  status: 'completed',
  conclusion,
  created_at: at,
  html_url: 'https://example.test/run',
});
const issue = (number, title, labels, body, created, updated) => ({
  number,
  title,
  body,
  labels,
  assignees: [],
  created_at: created,
  updated_at: updated,
  closed_at: null,
  html_url: `https://example.test/i/${number}`,
});
const pull = (number, title, ref, created) => ({
  number,
  title,
  draft: true,
  head: {ref},
  labels: [],
  created_at: created,
  html_url: `https://example.test/p/${number}`,
});

const sources = {
  repo: 'acme/app',
  trunk: 'main',
  cardIssue: 1,
  now: Date.parse('2026-11-10T20:00:00Z'),
  comments,
  issues: [
    issue(
      11,
      'Choose the icon for the new screen',
      ['owner-queue', 'decision', 'priority:P1'],
      '<!-- owner-queue:icon -->\nkind: decision\nrun: autoSprint\n\nTwo icons fit.\n\n## Reply\n\nicon A | icon B',
      '2026-11-09T18:00:00Z',
      '2026-11-09T18:00:00Z',
    ),
    issue(
      14,
      'Free 11 GB on the Mac for the Auditor',
      ['owner-queue', 'action', 'priority:P1', 'escalated'],
      [
        '<!-- owner-queue:audit-3890-disk -->',
        '',
        '- kind: action',
        '- priority: P1',
        '- run: auditor',
        '- do: Run ~/.claude/bin/qariah-disk-report.sh, then delete the lines it marks SAFE.',
        '- blocks: audit,promote',
        '',
        '**Impact:** the Auditor needs 28 GB free to build; it had 21 GB.',
        '',
        '## Reply',
        '',
        'done',
      ].join('\n'),
      '2026-11-10T02:00:00Z',
      '2026-11-10T02:00:00Z',
    ),
    issue(
      15,
      'Ops team runs AUTH-13 on the next internal beta',
      ['owner-queue', 'action'],
      [
        '<!-- owner-queue:auth-13 -->',
        '',
        '- kind: action',
        '- not-before: build>3902',
        '',
        '**Impact:** a new sign-in shows a shorter consent screen.',
        '',
        '**Run case AUTH-13 on iOS and on Android** (the regression test plan):',
        '',
        '## Reply',
        '',
        'AUTH-13 pass | AUTH-13 fail: <step and what the app showed>',
      ].join('\n'),
      '2026-11-10T18:00:00Z',
      '2026-11-10T18:00:00Z',
    ),
    issue(
      16,
      '[TestFlight audio] No audio and no reciter photos',
      ['bug', 'testflight', 'needs-decision'],
      '',
      '2026-11-03T15:00:00Z',
      '2026-11-03T15:00:00Z',
    ),
    issue(
      17,
      '[Anomaly] Freezes (ANR) worse on Android',
      ['anomaly'],
      '',
      '2026-11-10T07:00:00Z',
      '2026-11-10T07:00:00Z',
    ),
    issue(
      12,
      'A crash on start',
      ['investigate', 'incident:cold-start-hang'],
      '',
      '2026-10-01T00:00:00Z',
      '2026-10-02T00:00:00Z',
    ),
    issue(
      13,
      'Fixed in 3901',
      ['bug', 'fixed-in:3901'],
      '',
      '2026-11-05T00:00:00Z',
      '2026-11-09T00:00:00Z',
    ),
  ],
  closedQueue: [],
  pulls: [
    pull(21, 'feat: a new agent', 'claude/new-agent', '2026-11-06T00:00:00Z'),
    pull(
      23,
      'chore: a hygiene sweep report',
      'chore/hygiene',
      '2026-11-03T00:00:00Z',
    ),
    pull(22, 'fix: a loop draft', 'qariah/fix-22', '2026-11-09T00:00:00Z'),
  ],
  rollout: {
    active: true,
    release: '3.2.3',
    build: 3763,
    startedAt: '2026-11-01',
    platforms: {
      ios: {
        current: {
          version: '3.2.3',
          build: 3772,
          state: 'READY_FOR_SALE (phased release ACTIVE)',
          phasedRelease: 'ACTIVE, day 6',
        },
      },
      android: {
        current: {
          versionCode: 3763,
          status: 'inProgress',
          userFraction: 0.5,
          since: '2026-11-09T02:20Z',
        },
      },
    },
  },
  // The stores, as scripts/pipeline-status.mjs readStore() gives them.
  store: {
    readAt: '2026-11-10T19:59:00Z',
    ios: {
      app: [
        {
          build: '3880',
          version: '3.2.6',
          uploadedAt: '2026-11-03T18:00:00Z',
          internal: 'IN_BETA_TESTING',
          external: 'IN_BETA_TESTING',
          expired: false,
        },
        {
          build: '3772',
          version: '3.2.3',
          uploadedAt: '2026-11-01T13:14:00Z',
          internal: 'IN_BETA_TESTING',
          external: 'READY_FOR_BETA_SUBMISSION',
          expired: false,
        },
      ],
      beta: [
        {
          build: '3902',
          version: '3.2.6',
          uploadedAt: '2026-11-10T15:00:00Z',
          internal: 'IN_BETA_TESTING',
          external: 'READY_FOR_BETA_SUBMISSION',
          expired: false,
        },
        {
          build: '3901',
          version: '3.2.6',
          uploadedAt: '2026-11-09T23:30:00Z',
          internal: 'IN_BETA_TESTING',
          external: 'READY_FOR_BETA_SUBMISSION',
          expired: false,
        },
      ],
    },
    android: {
      internal: [{versionCodes: ['3902'], status: 'completed', name: '3902'}],
      beta: [{versionCodes: ['3880'], status: 'completed', name: '3880'}],
      production: [
        {versionCodes: ['3763'], status: 'inProgress', name: '3763'},
      ],
    },
    errors: [],
  },
  policy: {
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
  },
  workflows: {
    'diagnostics-watch.yml': [
      wf('2026-11-10T16:13:00Z'),
      wf('2026-11-09T16:13:00Z'),
    ],
    'signals-snapshot.yml': [
      wf('2026-11-10T19:31:00Z'),
      wf('2026-11-09T19:30:00Z'),
    ],
  },
};

fs.writeFileSync(
  path.join(__dirname, 'sources.json'),
  `${JSON.stringify(sources, null, 1)}\n`,
);
