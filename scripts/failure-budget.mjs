#!/usr/bin/env node
// @ai
//
// scripts/failure-budget.mjs — which scheduled task is over its failure budget?
// ---------------------------------------------------------------------------
//   node scripts/failure-budget.mjs [--today=YYYY-MM-DD] [--json]
//   node scripts/failure-budget.mjs --apply --task=<task> [--cause-file=<path>] [--fix=<text>] [--dry-run]
//
// Read-only by default: it reads the `run-health` lines of the last 14 days on
// the pinned Daily card and prints the table of scripts/lib/failure-budget.mjs.
// `--apply` turns off ONE task that the table marks TURN OFF: it adds the label
// `off:<task>` to the Daily card and files one owner-queue item (P1, kind
// action) with the cause and the fix. The weekly retro calls it once for each
// such task, after it looked for the cause. REST only (scripts/lib/triage-common.mjs).
//
// Exit 0 = done (the table may hold TURN OFF rows). 1 = GitHub error or refusal.
// 2 = usage error.

import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  DAILY_CARD_TITLE,
  GH_REPO,
  addIssueLabels,
  ghApi,
  upsertLabel,
} from './lib/triage-common.mjs';
import {
  addDays,
  budgetTable,
  judgeBudget,
  offItemBody,
  parseRunHealth,
} from './lib/failure-budget.mjs';

const flags = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) {
      console.error(`failure-budget: unknown argument ${a}`);
      process.exit(2);
    }
    return [m[1], m[2] ?? true];
  }),
);
const laToday = () =>
  new Date().toLocaleDateString('en-CA', {timeZone: 'America/Los_Angeles'});
const today = flags.today || laToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
  console.error('failure-budget: --today must be YYYY-MM-DD');
  process.exit(2);
}
if (flags.apply && !flags.task) {
  console.error('failure-budget: --apply needs --task=<task> (one task for each call)');
  process.exit(2);
}

function dailyCard() {
  const cards = ghApi(`repos/${GH_REPO}/issues`, {
    query: {state: 'open', labels: 'ops', per_page: 100},
  });
  const card = (cards || []).find(
    i => !i.pull_request && i.title === DAILY_CARD_TITLE,
  );
  if (!card) throw new Error(`no open "${DAILY_CARD_TITLE}" issue with the label ops`);
  return card;
}

let card, result;
try {
  card = dailyCard();
  const since = `${addDays(today, -16)}T00:00:00Z`;
  const comments = ghApi(`repos/${GH_REPO}/issues/${card.number}/comments`, {
    query: {since},
    paginate: true,
  });
  const labels = (card.labels || []).map(l => (typeof l === 'string' ? l : l.name));
  result = judgeBudget(parseRunHealth(comments.map(c => c.body)), {today, labels});
} catch (e) {
  console.error(`failure-budget: FAIL ${String(e.message || e).split('\n')[0]}`);
  process.exit(1);
}

if (!flags.apply) {
  if (flags.json) console.log(JSON.stringify({card: card.number, ...result}, null, 2));
  else {
    console.log(budgetTable(result));
    console.log(
      result.turnOff.length
        ? `\nTURN OFF: ${result.turnOff.join(', ')}. Look for the cause first, then run --apply --task=<task> for each.`
        : '\nNo task is over its budget two weeks in a row.',
    );
  }
  process.exit(0);
}

// --- --apply ------------------------------------------------------------------------
const row = result.rows.find(r => r.task === flags.task);
if (!row || row.verdict !== 'turn-off') {
  console.error(
    `failure-budget: refused. ${flags.task} is not a TURN OFF row (verdict: ${row ? row.verdict : 'no lines'}).`,
  );
  process.exit(1);
}
const cause = flags['cause-file'] ? readFileSync(flags['cause-file'], 'utf8').trim() : '';
const body = offItemBody(row, {card: card.number, cause, fix: flags.fix === true ? '' : flags.fix || ''});
if (flags['dry-run']) {
  console.log(`failure-budget: dry run. Would add \`${row.label}\` to #${card.number} and file:\n\n${body}`);
  process.exit(0);
}
try {
  upsertLabel(
    row.label,
    'B60205',
    'The weekly retro turned this task off (failure budget). Remove it to turn the task on.',
  );
  addIssueLabels(card.number, [row.label]);
} catch (e) {
  console.error(`failure-budget: FAIL could not label #${card.number}: ${String(e.message || e).split('\n')[0]}`);
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), 'failure-budget-'));
try {
  const file = join(dir, 'body.md');
  writeFileSync(file, body);
  const here = dirname(fileURLToPath(import.meta.url));
  const out = execFileSync(
    process.execPath,
    [
      join(here, 'owner-queue.mjs'),
      'ask',
      '--kind=action',
      '--priority=P1',
      `--title=Turned off ${row.task}: over its failure budget two weeks in a row`,
      `--body-file=${file}`,
      '--run=retro',
      `--key=off-${row.task.toLowerCase()}`,
    ],
    {encoding: 'utf8'},
  );
  process.stdout.write(out);
  console.log(`failure-budget: added \`${row.label}\` to #${card.number}`);
} catch (e) {
  console.error(
    `failure-budget: FAIL the label is on #${card.number}, but the owner-queue item did not file: ${String(e.message || e).split('\n')[0]}`,
  );
  process.exit(1);
} finally {
  rmSync(dir, {recursive: true, force: true});
}
