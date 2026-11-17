#!/usr/bin/env node
// @ai
//
// scripts/v1-restore-watch.mjs — the v1 restore watch (TECH_DEBT #137).
//
//   node scripts/v1-restore-watch.mjs                       # print the counts only
//   node scripts/v1-restore-watch.mjs --check [--dry-run] [--run=triage]
//
// It counts, for the last 30 days, the people who ran the v1 check and the
// people who got v1 favorites back, and prints one line
// `V1 RESTORE: <state> — <reason>`. With --check and the state `retire`
// (fewer than 5 restores), it files one owner-queue decision (key
// `v1-restore-retire`; an open item with the key is updated, not duplicated),
// unless an item with the key closed in the last 90 days (the owner answered).
// --dry-run passes to scripts/owner-queue.mjs. The rules are in
// scripts/lib/v1-restore-watch.mjs. The daily triage routine runs --check.
//
// Settings: POSTHOG_PERSONAL_API_TOKEN and POSTHOG_PROJECT_ID from the
// environment (`set -a && . ./.env.local && set +a`).
//
// Exit 0 = printed (and filed), 1 = an API, settings or filing error,
// 2 = usage error.

import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPosthogClient, posthogConfig} from './lib/posthog-client.mjs';
import {labExclusionSQL} from './lib/lab-exclusion.mjs';
import {listIssues} from './lib/triage-common.mjs';
import {
  decide,
  recentAnswer,
  renderBody,
  rowToCounts,
  SNOOZE_DAYS,
  watchQuery,
} from './lib/v1-restore-watch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = {check: false, dryRun: false, run: 'triage'};
  for (const a of argv) {
    if (a === '--check') o.check = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a.startsWith('--run=')) o.run = a.slice('--run='.length);
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

function fileItem(decision, body, {dryRun, run}) {
  const dir = mkdtempSync(join(tmpdir(), 'v1-restore-watch-'));
  try {
    const bodyFile = join(dir, 'body.md');
    writeFileSync(bodyFile, body);
    const r = spawnSync(
      process.execPath,
      [
        join(HERE, 'owner-queue.mjs'),
        'ask',
        `--kind=${decision.kind}`,
        `--key=${decision.key}`,
        `--priority=${decision.priority}`,
        `--title=${decision.title}`,
        `--reply=${decision.reply}`,
        '--do=Decide whether to retire the v1 restore: reply `retire v1 restore` or `keep v1 restore`',
        `--body-file=${bodyFile}`,
        `--run=${run}`,
        ...(dryRun ? ['--dry-run'] : []),
      ],
      {stdio: 'inherit'},
    );
    return r.status ?? 1;
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = posthogConfig();
  if (!config.token || !config.project) {
    console.error(
      'POSTHOG_PERSONAL_API_TOKEN and POSTHOG_PROJECT_ID are not set (source .env.local).',
    );
    process.exit(1);
  }
  const ph = createPosthogClient({...config, timeoutMs: 60000});
  const counts = rowToCounts(
    await ph.hogql(watchQuery({labSQL: labExclusionSQL()}), {cap: 5}),
  );
  const decision = decide(counts);

  if (args.check && decision.key) {
    const since = new Date(Date.now() - SNOOZE_DAYS * 86400000).toISOString();
    const answered = recentAnswer(
      listIssues({labels: 'owner-queue', state: 'closed', since}),
    );
    if (answered) {
      console.log(
        `V1 RESTORE: snoozed — ${decision.reason}; the owner answered #${
          answered.number
        } on ${answered.closedAt.slice(0, 10)}`,
      );
      return;
    }
  }
  console.log(`V1 RESTORE: ${decision.state} — ${decision.reason}`);
  if (!args.check || !decision.key) return;
  const code = fileItem(decision, renderBody(counts), args);
  if (code !== 0) {
    console.error(`owner-queue.mjs ask exited ${code}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
