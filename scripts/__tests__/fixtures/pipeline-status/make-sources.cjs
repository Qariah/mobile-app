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
      12,
      'A crash on start',
      ['investigate'],
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
    pull(22, 'fix: a loop draft', 'qariah/fix-22', '2026-11-09T00:00:00Z'),
  ],
  rollout: {active: true, release: '3.2.3', startedAt: '2026-11-01'},
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
