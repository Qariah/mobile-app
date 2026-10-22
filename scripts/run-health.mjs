#!/usr/bin/env node
// @ai
//
// scripts/run-health.mjs — the run-health watchdog.
// ---------------------------------------------------------------------------
// Runs daily at 23:30 UTC from .github/workflows/run-health.yml, away from the
// Mac and away from the cloud routine. It reads the comments on the pinned
// issues "Daily card" and "Daily card (shadow)", and checks that each
// scheduled run left its output (the rules are in scripts/lib/run-health.mjs):
//   - the triage card by 22:00 UTC;
//   - a `run-health` line with status DONE or SKIPPED for task=triage,
//     task=drafts (the local 1pm loop) and task=autoSprint (the local 3pm run).
// If one is missing or bad, it opens ONE issue labelled `run-health`, assigned
// to the owner, or adds a comment to the one that is already open. It reports
// each fault once (a marker in the comment).
//
// Usage:
//   node scripts/run-health.mjs [--dry-run] [--json] [--now=<ISO time>]
//
// Env: GH_REPO (default omar-zarka/qariah-v2), GH_TOKEN (in Actions),
//      RUN_HEALTH_ASSIGNEE (default omar-zarka).
// Exit 0 = the check ran (faults or not). Exit 1 = it could not read GitHub.

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  alertMarker,
  addDays,
  evaluateRunHealth,
  ownerDate,
} from './lib/run-health.mjs';
import {
  DAILY_CARD_TITLE,
  GH_REPO,
  SHADOW_CARD_TITLE,
  commentOnIssue,
  createIssue,
  getIssue,
  ghApi,
  listIssues,
  upsertLabel,
} from './lib/triage-common.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const DRY = !!args['dry-run'];
const NOW = args.now ? Date.parse(args.now) : Date.now();
const ASSIGNEE = process.env.RUN_HEALTH_ASSIGNEE || 'omar-zarka';
const LABEL = 'run-health';
const ALERT_TITLE = 'Run health: a scheduled run did not finish';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function policy() {
  return JSON.parse(
    readFileSync(join(ROOT, 'docs/operations/auto-sprint-policy.json'), 'utf8'),
  );
}

// Comments on an `ops` issue with this exact title since `sinceIso`.
// null when the issue does not exist.
function cardComments(title, sinceIso) {
  const issue = listIssues({state: 'open', labels: 'ops'}).find(
    i => i.title === title,
  );
  if (!issue) return {issue: null, comments: null};
  const comments = ghApi(`repos/${GH_REPO}/issues/${issue.number}/comments`, {
    query: {since: sinceIso, per_page: 100},
    paginate: true,
  }).map(c => ({body: c.body || '', createdAt: c.created_at}));
  return {issue, comments};
}

function main() {
  const p = policy();
  const rl = p.runLimits || {};
  const maxWallMinutes = {
    triage: rl.triage?.maxWallMinutes ?? 90,
    drafts: rl.drafts?.maxWallMinutes ?? 180,
    autoSprint: rl.autoSprint?.maxWallMinutes ?? 360,
  };
  const since = `${addDays(ownerDate(NOW), -3)}T00:00:00Z`;
  const daily = cardComments(DAILY_CARD_TITLE, since);
  const shadow = cardComments(SHADOW_CARD_TITLE, since);

  const {checks} = evaluateRunHealth({
    now: NOW,
    maxWallMinutes,
    mainComments: daily.comments,
    shadowComments: shadow.comments,
    mainCreatedAt: daily.issue && daily.issue.createdAt,
    shadowCreatedAt: shadow.issue && shadow.issue.createdAt,
    triageRunsInCloud: p.triageRunsInCloud === true,
  });

  const bad = checks.filter(c => !c.ok);
  console.log(
    `▶ run-health  ${new Date(NOW).toISOString().slice(0, 16)}Z  triageRunsInCloud=${p.triageRunsInCloud === true}${DRY ? '  (DRY RUN)' : ''}`,
  );
  for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.text}`);
  if (args.json) console.log(JSON.stringify({checks}, null, 2));
  if (!bad.length) {
    console.log('▶ no fault found');
    return;
  }

  // One open alert issue. Report each fault once.
  const open = listIssues({state: 'open', labels: LABEL}).find(
    i => i.title === ALERT_TITLE,
  );
  let reported = '';
  if (open) {
    const full = getIssue(open.number, {comments: true});
    reported = [full.body, ...full.comments.map(c => c.body)].join('\n');
  }
  const fresh = bad.filter(c => !reported.includes(alertMarker(c.key)));
  if (!fresh.length) {
    console.log(`▶ every fault is already on #${open.number}`);
    return;
  }

  const text = [
    ...fresh.map(c => alertMarker(c.key)),
    `**Run-health check, ${ownerDate(NOW)}** (\`scripts/run-health.mjs\`, 23:30 UTC).`,
    '',
    'These scheduled runs did not leave a good result:',
    ...fresh.map(c => `- ${c.text}`),
    '',
    'What to do:',
    '1. Open the run. Cloud routine: https://claude.ai/code/routines (routine `qariah-daily-triage`). Local tasks: the Claude desktop app, Scheduled.',
    '2. Read the end of the transcript. Find why it stopped (a limit, a failure, the Mac asleep, no network).',
    '3. Close this issue when the cause is fixed. The next fault opens a new one.',
    '',
    `The daily lines are on the pinned issues "${DAILY_CARD_TITLE}" and "${SHADOW_CARD_TITLE}".`,
  ].join('\n');

  if (DRY) {
    console.log(
      `▶ DRY RUN — would ${open ? `comment on #${open.number}` : `open "${ALERT_TITLE}"`}:\n---\n${text}\n---`,
    );
    return;
  }
  if (open) {
    const url = commentOnIssue(open.number, text);
    console.log(`▶ added the faults to ${url}`);
  } else {
    try {
      upsertLabel(LABEL, 'b60205', 'A scheduled run did not finish well');
    } catch {
      /* the label exists — fine */
    }
    const made = createIssue({
      title: ALERT_TITLE,
      body: text,
      labels: [LABEL],
      assignees: [ASSIGNEE],
    });
    console.log(`▶ opened ${made.url}`);
  }
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
