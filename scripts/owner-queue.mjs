#!/usr/bin/env node
// @ai
//
// scripts/owner-queue.mjs — the owner queue: one issue for each question or finding.
// ---------------------------------------------------------------------------
// A scheduled run never asks a question in its session, and never leaves a
// finding as prose in its report. It files the item here. The Steward
// (.claude/routines/qariah-steward.md, a cloud routine every 2 hours) reads
// the open queue and answers it, fixes it, hands it to the Fixer, or
// escalates it to the owner. The rules are in scripts/lib/owner-queue.mjs.
//
//   node scripts/owner-queue.mjs ask --kind=decision|action|info --title=<text> \
//        --body-file=<path> [--reply=<the exact reply text>] [--due=<ISO>] \
//        [--run=<task>] [--issue=<n>] [--key=<a-z0-9->] [--priority=P0|P1|P2] [--dry-run]
//   node scripts/owner-queue.mjs list [--json] [--kind=<k>]
//   node scripts/owner-queue.mjs answer <n> --by=steward|owner --text-file=<path> [--dry-run]
//   node scripts/owner-queue.mjs handover <n> --text-file=<path> [--dry-run]
//   node scripts/owner-queue.mjs escalate <n> [--dry-run]
//   node scripts/owner-queue.mjs needs-you [--json]
//
// `ask` files one issue with the label `owner-queue` and the kind, with the
// marker `<!-- owner-queue:<key> -->` (the key is `--key`, or a slug of the
// title). An open issue with the same key is updated, not duplicated.
// `--issue=<n>` updates that issue. `answer` records the answer as a comment
// and closes the issue. `handover` records the Steward's answer, removes the
// `owner-queue` label and keeps the issue OPEN with `loop-actionable`, so the
// Fixer's queue (open issues only) gets it. `escalate` assigns the repository owner and adds the
// label `escalated` (the Steward does this for an owner-only item, with one
// email). `needs-you` prints the card's `NEEDS YOU` lines from the open
// `decision` and `action` items.
//
// REST only (scripts/lib/triage-common.mjs), so it works on the Mac and in a
// cloud session. Shadow mode refuses every write. Exit 0 = done, 1 = GitHub
// error or refusal, 2 = usage error.

import {readFileSync} from 'node:fs';
import {
  GH_REPO,
  addIssueLabels,
  closeIssue,
  commentOnIssue,
  createIssue,
  getIssue,
  ghApi,
  isShadowRun,
  listIssues,
  removeIssueLabel,
  updateIssue,
  upsertLabel,
} from './lib/triage-common.mjs';
import {
  LABEL,
  ESCALATED_LABEL,
  FIXER_LABEL,
  QUEUE_PALETTE,
  answerBody,
  handoverRefusal,
  keyOf,
  labelsFor,
  needsYouLines,
  parseQueueIssue,
  renderBody,
  sortQueue,
  validateAsk,
} from './lib/owner-queue.mjs';
import {ownerOf} from './lib/owner-replies.mjs';

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv
    .filter(a => a.startsWith('--'))
    .map(a => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return [m[1], m[2] ?? true];
    }),
);
const [cmd, num] = argv.filter(a => !a.startsWith('--'));
const DRY = !!flags['dry-run'];

function usage(msg) {
  if (msg) console.error(`❌ ${msg}`);
  console.error(
    [
      'usage:',
      '  owner-queue.mjs ask --kind=decision|action|info --title=<text> --body-file=<path>',
      '        [--reply=<text>] [--due=<ISO>] [--run=<task>] [--issue=<n>] [--key=<k>] [--priority=P0|P1|P2] [--dry-run]',
      '  owner-queue.mjs list [--json] [--kind=<k>]',
      '  owner-queue.mjs answer <n> --by=steward|owner --text-file=<path> [--dry-run]',
      '  owner-queue.mjs handover <n> --text-file=<path> [--dry-run]',
      '  owner-queue.mjs escalate <n> [--dry-run]',
      '  owner-queue.mjs needs-you [--json]',
    ].join('\n'),
  );
  process.exit(2);
}

const str = k => (typeof flags[k] === 'string' ? flags[k] : undefined);

function openQueue() {
  return listIssues({state: 'open', labels: LABEL, limit: 500}).map(
    parseQueueIssue,
  );
}

function ensureQueueLabels(labels) {
  if (DRY) return;
  for (const l of labels) {
    try {
      upsertLabel(l, QUEUE_PALETTE[l] || 'ededed');
    } catch {
      /* exists, or a race */
    }
  }
}

function ask() {
  let body;
  const bodyFile = str('body-file');
  if (!bodyFile) usage('ask needs --body-file=<path>');
  try {
    body = readFileSync(bodyFile, 'utf8');
  } catch (e) {
    usage(`cannot read ${bodyFile}: ${e.code || e.message}`);
  }
  const v = validateAsk({
    kind: str('kind'),
    title: str('title'),
    body,
    reply: str('reply'),
    due: str('due'),
    run: str('run'),
    key: str('key'),
    priority: str('priority'),
    issue: flags.issue === undefined ? undefined : Number(flags.issue),
  });
  if (!v.ok) usage(v.errors.join('; '));
  const f = v.fields;
  const asked = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const text = renderBody({...f, asked});
  const labels = labelsFor(f);

  // A dry run reads nothing: it prints what it would file.
  if (DRY) {
    console.log(
      `· DRY RUN — would file (or update the open issue with key ${f.key}) [${labels.join(', ')}] "${f.title}"`,
    );
    console.log(text);
    return;
  }
  // The issue to update: --issue, else the open issue with this key.
  let target = null;
  if (f.issue) {
    const i = getIssue(f.issue);
    if (i.state !== 'open') usage(`#${f.issue} is not open`);
    target = i;
  } else {
    target =
      listIssues({state: 'open', labels: LABEL, limit: 500}).find(
        i => keyOf(i.body) === f.key,
      ) || null;
  }
  ensureQueueLabels(labels);
  if (target) {
    updateIssue(target.number, {title: f.title, body: text});
    addIssueLabels(target.number, labels);
    commentOnIssue(
      target.number,
      `Asked again${f.run ? ` by the ${f.run} run` : ''} on ${asked}. The body is updated.`,
    );
    console.log(`✓ updated #${target.number} ${target.url}`);
    console.log(`#${target.number}`);
  } else {
    const made = createIssue({title: f.title, body: text, labels});
    console.log(`✓ filed #${made.number} ${made.url}`);
    console.log(`#${made.number}`);
  }
}

function list() {
  let items = sortQueue(openQueue());
  const kind = str('kind');
  if (kind) items = items.filter(i => i.kind === kind);
  if (flags.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  if (!items.length) {
    console.log('owner queue: empty');
    return;
  }
  for (const i of items)
    console.log(
      `#${i.number} [${i.kind}${i.priority === 'P2' ? '' : ` ${i.priority}`}${i.escalated ? ' escalated' : ''}]${i.run ? ` ${i.run}` : ''}${i.due ? ` due ${i.due.slice(0, 10)}` : ''} · ${i.title}`,
    );
}

function answer() {
  const n = Number(num);
  if (!Number.isInteger(n) || n <= 0) usage('answer needs an issue number');
  const file = str('text-file');
  if (!file) usage('answer needs --text-file=<path>');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    usage(`cannot read ${file}: ${e.code || e.message}`);
  }
  let body;
  try {
    body = answerBody({
      by: str('by'),
      text,
      at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
  } catch (e) {
    usage(e.message);
  }
  const issue = getIssue(n);
  if (!(issue.labels || []).some(l => l.name === LABEL))
    usage(`#${n} is not an owner-queue issue`);
  if (DRY) {
    console.log(`· DRY RUN — would answer and close #${n}:\n---\n${body}\n---`);
    return;
  }
  closeIssue(n, {reason: 'completed', comment: body});
  console.log(`✓ answered and closed #${n} ${issue.url}`);
}

// A hand-over to the Fixer: the answer comment, then the `owner-queue` label
// comes off and the issue stays OPEN with `loop-actionable`, so the Fixer's
// queue (open issues only) gets it, and the Steward does not read it again.
function handover() {
  const n = Number(num);
  if (!Number.isInteger(n) || n <= 0) usage('handover needs an issue number');
  const file = str('text-file');
  if (!file) usage('handover needs --text-file=<path>');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    usage(`cannot read ${file}: ${e.code || e.message}`);
  }
  let body;
  try {
    body = answerBody({
      by: 'steward',
      text,
      at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
  } catch (e) {
    usage(e.message);
  }
  const issue = getIssue(n);
  const why = handoverRefusal(issue);
  if (why) {
    console.error(`owner-queue: REFUSED handover of #${n}: ${why}`);
    process.exit(1);
  }
  if (DRY) {
    console.log(
      `· DRY RUN — would comment on #${n}, remove the label ${LABEL}, and keep it open for the Fixer:\n---\n${body}\n---`,
    );
    return;
  }
  commentOnIssue(n, body);
  removeIssueLabel(n, LABEL);
  console.log(
    `✓ handed #${n} to the Fixer: label ${LABEL} removed, ${FIXER_LABEL} kept, issue open ${issue.url}`,
  );
}

function escalate() {
  const n = Number(num);
  if (!Number.isInteger(n) || n <= 0) usage('escalate needs an issue number');
  const issue = getIssue(n);
  if (!(issue.labels || []).some(l => l.name === LABEL))
    usage(`#${n} is not an owner-queue issue`);
  const owner = ownerOf(GH_REPO);
  if (DRY) {
    console.log(
      `· DRY RUN — would assign @${owner} and label ${ESCALATED_LABEL} on #${n}`,
    );
    return;
  }
  ensureQueueLabels([ESCALATED_LABEL]);
  if (isShadowRun()) throw new Error(`SHADOW: refused to escalate #${n}`);
  ghApi(`repos/${GH_REPO}/issues/${n}/assignees`, {
    method: 'POST',
    body: {assignees: [owner]},
  });
  addIssueLabels(n, [ESCALATED_LABEL]);
  console.log(
    `✓ escalated #${n}: assigned @${owner}, label ${ESCALATED_LABEL}`,
  );
}

function needsYou() {
  const items = openQueue();
  const lines = needsYouLines(items);
  if (flags.json) {
    console.log(JSON.stringify({lines, items: sortQueue(items)}, null, 2));
    return;
  }
  if (!lines.length) console.log('NEEDS YOU · none (owner queue)');
  for (const l of lines) console.log(`NEEDS YOU · ${l}`);
}

try {
  if (cmd === 'ask') ask();
  else if (cmd === 'list') list();
  else if (cmd === 'answer') answer();
  else if (cmd === 'handover') handover();
  else if (cmd === 'escalate') escalate();
  else if (cmd === 'needs-you') needsYou();
  else usage();
} catch (e) {
  console.error(
    `❌ ${e.message}${isShadowRun() ? ' (shadow mode is on: .claude/.shadow-run)' : ''}`,
  );
  process.exit(1);
}
