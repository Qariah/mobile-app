#!/usr/bin/env node
// @ai
//
// scripts/pump-experiment.mjs — the mount pump experiment, treatment against
// control. The report is read only: two HogQL queries and one flag read.
//
//   node scripts/pump-experiment.mjs                  # since the start (2026-11-13)
//   node scripts/pump-experiment.mjs --since=2026-11-20
//   node scripts/pump-experiment.mjs --json
//   node scripts/pump-experiment.mjs --check [--dry-run] [--run=triage]
//
// It prints, for each arm of the PostHog flag `background_mount_pump` and for
// each pump state: persons, person-days, cold starts, ANR exits (cold starts
// after `prev_exit_reason = anr`), slow returns (`app_return_slow`) and their
// frame times; then the ANR-exit difference and the slow-return rate ratio,
// with 95% intervals. scripts/lib/pump-experiment.mjs has the definitions.
//
// --check is the daily check of the triage cloud routine
// (.claude/routines/qariah-daily-triage.md). It prints one line
// `PUMP CHECK: <state> — <reason>`. For the states harm, result and cap it
// files one owner-queue decision (scripts/owner-queue.mjs ask, one open issue
// for each key); --dry-run passes to that command. The rules are
// decideCheck() in the library, fixed on 2026-11-13.
//
// The kill switch is the flag itself: turn `background_mount_pump` off in
// PostHog (or set the variant `control` to 100%), and the pump stops at once.
// The check then prints `stopped` and files nothing.
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
import {
  compareArms,
  decideCheck,
  EXPERIMENT_START,
  PUMP_FLAG_ID,
  renderCheckBody,
  renderReport,
  rowsToSplits,
  splitQuery,
} from './lib/pump-experiment.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = {
    since: EXPERIMENT_START,
    json: false,
    check: false,
    dryRun: false,
    run: 'triage',
  };
  for (const a of argv) {
    if (a === '--json') o.json = true;
    else if (a === '--check') o.check = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a.startsWith('--since=')) o.since = a.slice('--since='.length);
    else if (a.startsWith('--run=')) o.run = a.slice('--run='.length);
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.since)) {
    console.error(`--since must be YYYY-MM-DD, not ${o.since}`);
    process.exit(2);
  }
  if (o.check && o.since !== EXPERIMENT_START) {
    console.error('--check always reads from the start; drop --since');
    process.exit(2);
  }
  return o;
}

/** The flag as {active, deleted, variants}; a 404 is a deleted flag. */
async function readFlag(ph) {
  try {
    const f = await ph.request(`/feature_flags/${PUMP_FLAG_ID}/`);
    return {
      active: Boolean(f.active) && !f.deleted,
      deleted: Boolean(f.deleted),
      variants: f.filters?.multivariate?.variants ?? [],
    };
  } catch (e) {
    if (/PostHog 404/.test(String(e?.message))) {
      return {active: false, deleted: true, variants: []};
    }
    throw e;
  }
}

/** File the owner-queue item. Returns the exit code of owner-queue.mjs. */
function fileItem(decision, body, {dryRun, run}) {
  const dir = mkdtempSync(join(tmpdir(), 'pump-check-'));
  try {
    const bodyFile = join(dir, 'body.md');
    writeFileSync(bodyFile, body);
    const args = [
      join(HERE, 'owner-queue.mjs'),
      'ask',
      `--kind=${decision.kind}`,
      `--key=${decision.key}`,
      `--priority=${decision.priority}`,
      `--title=${decision.title}`,
      `--reply=${decision.reply}`,
      `--do=Decide on the mount pump: ${decision.reply.replace(/^Reply /, '')}`,
      `--body-file=${bodyFile}`,
      `--run=${run}`,
      ...(dryRun ? ['--dry-run'] : []),
    ];
    const r = spawnSync(process.execPath, args, {stdio: 'inherit'});
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
  const labSQL = labExclusionSQL();
  const [armRows, stateRows, flag] = await Promise.all([
    ph.hogql(splitQuery({by: 'arm', since: args.since, labSQL}), {cap: 20}),
    ph.hogql(splitQuery({by: 'state', since: args.since, labSQL}), {cap: 20}),
    args.check ? readFlag(ph) : readFlag(ph).catch(() => null),
  ]);
  const arms = rowsToSplits(armRows);
  const states = rowsToSplits(stateRows);
  const comparison = compareArms(arms);
  const reportLines = renderReport({
    since: args.since,
    arms,
    states,
    comparison,
    flag,
  });

  if (args.check) {
    const today = new Date().toISOString().slice(0, 10);
    const decision = decideCheck({arms, flag, today});
    console.log(`PUMP CHECK: ${decision.state} — ${decision.reason}`);
    if (!decision.key) return;
    const body = renderCheckBody({decision, comparison, reportLines});
    const code = fileItem(decision, body, args);
    if (code !== 0) {
      console.error(`owner-queue.mjs ask exited ${code}`);
      process.exit(1);
    }
    return;
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {since: args.since, flag, arms, states, comparison},
        null,
        2,
      ),
    );
    return;
  }
  for (const line of reportLines) console.log(line);
}

main().catch(e => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
