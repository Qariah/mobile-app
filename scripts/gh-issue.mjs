#!/usr/bin/env node
// @ai
//
// scripts/gh-issue.mjs — read, label and comment on one issue over REST.
// ---------------------------------------------------------------------------
// The triage skill's Step 2.5 used `gh issue view --json` and `gh issue edit
// --add-label`. Both use GraphQL, which the Claude Cloud GitHub proxy refuses.
// This file does the same three things with the REST helpers in
// scripts/lib/triage-common.mjs, so Step 2.5 works on the Mac and in the cloud.
// In shadow mode (scripts/run-start.sh triage --shadow) every write is refused.
//
//   node scripts/gh-issue.mjs view <n>                   # body, then each comment body
//   node scripts/gh-issue.mjs label <n> <label> [...]    [--dry-run]
//   node scripts/gh-issue.mjs comment <n> --body-file=<path> [--dry-run]
//
// `view` prints what scripts/lib/evidence-block.mjs reads on stdin:
//   node scripts/gh-issue.mjs view 475 | node scripts/lib/evidence-block.mjs
// Exit 0 = done, 1 = GitHub error or shadow refusal, 2 = usage error.

import {readFileSync} from 'node:fs';
import {
  addIssueLabels,
  commentOnIssue,
  getIssue,
  isShadowRun,
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
const [cmd, num, ...rest] = argv.filter(a => !a.startsWith('--'));
const n = Number(num);
const DRY = !!flags['dry-run'];

function usage() {
  console.error(
    'usage:\n  gh-issue.mjs view <n>\n  gh-issue.mjs label <n> <label> [<label>...] [--dry-run]\n  gh-issue.mjs comment <n> --body-file=<path> [--dry-run]',
  );
  process.exit(2);
}
if (!Number.isInteger(n) || n <= 0) usage();

try {
  if (cmd === 'view') {
    const i = getIssue(n, {comments: true});
    console.log([i.body, ...i.comments.map(c => c.body)].join('\n'));
  } else if (cmd === 'label') {
    if (!rest.length) usage();
    if (DRY) console.log(`· DRY RUN — would add ${rest.join(', ')} to #${n}`);
    else {
      addIssueLabels(n, rest);
      console.log(`✓ #${n} +${rest.join(' +')}`);
    }
  } else if (cmd === 'comment') {
    if (typeof flags['body-file'] !== 'string') usage();
    const body = readFileSync(flags['body-file'], 'utf8');
    if (DRY)
      console.log(`· DRY RUN — would comment on #${n}:\n---\n${body}\n---`);
    else console.log(`✓ ${commentOnIssue(n, body)}`);
  } else usage();
} catch (e) {
  console.error(
    `❌ ${e.message}${isShadowRun() ? ' (shadow mode is on: .claude/.shadow-run)' : ''}`,
  );
  process.exit(1);
}
