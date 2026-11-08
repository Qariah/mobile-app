#!/usr/bin/env node
// @ai
//
// scripts/owner-reply.mjs — Omar's replies to the daily triage.
// ---------------------------------------------------------------------------
// A reply that Omar types in a run's session is lost when the session ends:
// the next run is a new session. This script keeps it as a comment
// `owner-reply: <text>` on the open `Daily card` issue, where every run reads
// it (scripts/lib/owner-replies.mjs explains the rule).
//
//   node scripts/owner-reply.mjs list [--days=30] [--json]
//   node scripts/owner-reply.mjs post --text-file=<path> [--dry-run]
//   node scripts/owner-reply.mjs post --text='share fixed' [--dry-run]
//
// `list` prints each reply with its date, and the reply phrase it matches
// (docs/operations/owner-actions.json → replies): `applied` when
// scripts/owner-actions.mjs applies its effect, `a session must act` when the
// phrase needs a pull request. `post` writes one comment. Shadow mode refuses
// it (scripts/run-start.sh triage --shadow). REST only, so it works in Claude
// Cloud. Exit 0 = done, 1 = GitHub error or refusal, 2 = usage error.
//
// The public-beta and production approval (scripts/lib/promotion-approval.mjs):
//
//   node scripts/owner-reply.mjs promotion list [--json]
//   node scripts/owner-reply.mjs promotion next --action=public-beta [--write] [--json]
//   node scripts/owner-reply.mjs promotion start
//   node scripts/owner-reply.mjs promotion end --state=DONE|FAILED [--note=<text>]
//   node scripts/owner-reply.mjs promotion verify
//
// `next` finds the newest approved build (exit 3 = none) and, with --write,
// writes <main checkout>/.claude/.promotion-approval. It also closes a publish
// whose run died: it posts the FAILED line, and exits 4, so that Omar hears. `start` posts the STARTED
// line, which uses up the reply. `verify` is the publish guard's check: it reads
// the file, reads GitHub again, and prints `<action> <build> <sha>`. `post`
// refuses the approval text: Omar writes that comment himself.

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  dailyCardIssue,
  loadOwnerActions,
  readOwnerReplies,
} from './lib/owner-actions-facts.mjs';
import {PREFIX, ownerOf, replyLine} from './lib/owner-replies.mjs';
import {
  ACTIONS,
  candidates,
  isApprovalText,
  nextApproved,
  parseEvents,
  promotionLine,
  verifyFile,
} from './lib/promotion-approval.mjs';
import {
  DAILY_CARD_TITLE,
  GH_REPO,
  commentOnIssue,
  ghApi,
} from './lib/triage-common.mjs';

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv
    .filter(a => a.startsWith('--'))
    .map(a => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return [m[1], m[2] ?? true];
    }),
);
const [cmd, sub] = argv.filter(a => !a.startsWith('--'));

function usage(msg) {
  console.error(`❌ ${msg}`);
  console.error(
    'usage: owner-reply.mjs list [--days=N] [--json] | post (--text-file=<path> | --text=<text>) [--dry-run] | promotion (list | next --action=<a> [--write] | start | end --state=<s> | verify)',
  );
  process.exit(2);
}

function cardIssueOrExit(issue) {
  if (issue) return issue;
  console.error(`❌ no open issue "${DAILY_CARD_TITLE}" (label ops)`);
  process.exit(1);
}

// The file lives in the main checkout, like .claude/.autonomous-run.
function approvalPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  const common = execFileSync(
    'git',
    ['-C', here, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    {encoding: 'utf8'},
  ).trim();
  return join(dirname(common), '.claude', '.promotion-approval');
}

function readApproval() {
  const p = approvalPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readEvents() {
  const issue = cardIssueOrExit(dailyCardIssue());
  // The approval is valid for 7 days, so 60 days of comments hold every event that counts.
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const comments = ghApi(`repos/${GH_REPO}/issues/${issue.number}/comments`, {
    query: {per_page: 100, since},
    paginate: true,
  });
  return {issue, events: parseEvents(comments, {owner: ownerOf(GH_REPO)})};
}

function promotion() {
  if (sub === 'list') {
    const {events} = readEvents();
    const list = candidates(events);
    const ignored = events.filter(e => e.kind === 'ignored');
    if (flags.json) {
      console.log(JSON.stringify({candidates: list, ignored}));
      return;
    }
    console.log(`PROMOTION CANDIDATES: ${list.length || 'none'}`);
    for (const c of list)
      console.log(`  ${c.action} ${c.build}: ${c.state} (${c.reason})`);
    for (const e of ignored)
      console.log(`  ignored ${e.at.slice(0, 10)} "${e.text}": ${e.reason}`);
  } else if (sub === 'next') {
    if (!ACTIONS.includes(flags.action))
      usage(`--action must be one of ${ACTIONS.join(', ')}`);
    const {issue, events} = readEvents();
    const stale = candidates(events).find(
      c => c.action === flags.action && c.state === 'stale',
    );
    if (stale) {
      const url = commentOnIssue(
        issue.number,
        `${promotionLine({state: 'FAILED', action: stale.action, build: stale.build})} the run stopped with no end line (${stale.reason}). Check which store has the build.`,
      );
      rmSync(approvalPath(), {force: true});
      console.log(
        `FAILED ${stale.action} ${stale.build}: the run died. ${url}`,
      );
      process.exit(4);
    }
    const next = nextApproved(events, {action: flags.action});
    if (!next) {
      if (flags.json) console.log('null');
      else console.log(`no approved ${flags.action} build`);
      process.exit(3);
    }
    const file = {
      action: next.action,
      build: next.build,
      sha: next.ready.sha,
      approvalId: next.approval.id,
      approvalUrl: next.approval.url,
      approvedAt: next.approval.at,
      readyUrl: next.ready.url,
    };
    if (flags.write)
      writeFileSync(approvalPath(), `${JSON.stringify(file, null, 2)}\n`);
    console.log(
      flags.json
        ? JSON.stringify(file)
        : `approved: ${file.action} ${file.build} ${file.sha} (${file.approvalUrl})`,
    );
  } else if (sub === 'start') {
    const file = readApproval();
    if (!file)
      throw new Error('no approval file: run `promotion next --write`');
    const {issue, events} = readEvents();
    const next = nextApproved(events, {action: file.action});
    if (
      !next ||
      next.build !== String(file.build) ||
      next.approval.id !== file.approvalId
    )
      throw new Error(`${file.action} ${file.build} is no longer approved`);
    const posted = ghApi(`repos/${GH_REPO}/issues/${issue.number}/comments`, {
      method: 'POST',
      body: {
        body: `${promotionLine({state: 'STARTED', action: file.action, build: file.build})} commit=${file.sha}`,
      },
    });
    file.startedId = posted.id;
    writeFileSync(approvalPath(), `${JSON.stringify(file, null, 2)}\n`);
    console.log(`✓ ${posted.html_url}`);
  } else if (sub === 'end') {
    if (!['DONE', 'FAILED'].includes(flags.state))
      usage('--state must be DONE or FAILED');
    const file = readApproval();
    if (!file || !file.startedId)
      throw new Error('no started publish in the approval file');
    const issue = cardIssueOrExit(dailyCardIssue());
    const note = typeof flags.note === 'string' ? ` ${flags.note}` : '';
    const url = commentOnIssue(
      issue.number,
      `${promotionLine({state: flags.state, action: file.action, build: file.build})}${note}`,
    );
    rmSync(approvalPath(), {force: true});
    console.log(`✓ ${url}`);
  } else if (sub === 'verify') {
    const {events} = readEvents();
    const r = verifyFile(readApproval(), events);
    if (!r.ok) {
      console.error(r.reason);
      process.exit(1);
    }
    console.log(`${r.action} ${r.build} ${r.sha}`);
  } else {
    usage(sub ? `unknown promotion command "${sub}"` : 'no promotion command');
  }
}

try {
  if (cmd === 'promotion') {
    promotion();
  } else if (cmd === 'list') {
    const days = flags.days === undefined ? 30 : Number(flags.days);
    if (!Number.isFinite(days) || days < 1) usage('--days must be 1 or more');
    const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const {issue, replies} = readOwnerReplies();
    cardIssueOrExit(issue);
    const recent = replies.filter(r => r.date >= from);
    if (flags.json) {
      console.log(JSON.stringify({issue: issue.number, from, replies: recent}));
    } else {
      const phrases = (loadOwnerActions() || {}).replies || [];
      console.log(
        `OWNER REPLIES · ${DAILY_CARD_TITLE} #${issue.number} · since ${from}: ${recent.length || 'none'}`,
      );
      for (const r of recent) console.log(`  ${replyLine(r, phrases)}`);
    }
  } else if (cmd === 'post') {
    let text;
    if (typeof flags['text-file'] === 'string')
      text = readFileSync(flags['text-file'], 'utf8');
    else if (typeof flags.text === 'string') text = flags.text;
    else usage('post needs --text-file=<path> or --text=<text>');
    text = text.trim();
    if (!text) usage('the reply is empty');
    if (text.length > 2000) usage('the reply is longer than 2000 characters');
    if (isApprovalText(text)) {
      console.error(
        '❌ a session must not post a release approval. Omar writes this comment himself on the Daily card.',
      );
      process.exit(1);
    }
    const body = `${PREFIX} ${text}`;
    const issue = cardIssueOrExit(dailyCardIssue());
    if (flags['dry-run']) {
      console.log(`[dry-run] would comment on #${issue.number}:\n${body}`);
    } else {
      console.log(`✓ ${commentOnIssue(issue.number, body)}`);
    }
  } else {
    usage(cmd ? `unknown command "${cmd}"` : 'no command');
  }
} catch (e) {
  console.error(`❌ ${String(e.message || e).slice(0, 300)}`);
  process.exit(1);
}
