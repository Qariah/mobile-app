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

import {readFileSync} from 'node:fs';
import {
  dailyCardIssue,
  loadOwnerActions,
  readOwnerReplies,
} from './lib/owner-actions-facts.mjs';
import {PREFIX, replyLine} from './lib/owner-replies.mjs';
import {DAILY_CARD_TITLE, commentOnIssue} from './lib/triage-common.mjs';

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv
    .filter(a => a.startsWith('--'))
    .map(a => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return [m[1], m[2] ?? true];
    }),
);
const [cmd] = argv.filter(a => !a.startsWith('--'));

function usage(msg) {
  console.error(`❌ ${msg}`);
  console.error(
    'usage: owner-reply.mjs list [--days=N] [--json] | post (--text-file=<path> | --text=<text>) [--dry-run]',
  );
  process.exit(2);
}

function cardIssueOrExit(issue) {
  if (issue) return issue;
  console.error(`❌ no open issue "${DAILY_CARD_TITLE}" (label ops)`);
  process.exit(1);
}

try {
  if (cmd === 'list') {
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
