#!/usr/bin/env node
// @ai
//
// scripts/check-ci-health.mjs
// ---------------------------
// GitHub Actions health probe for Qariah v2 — the deterministic half of the
// daily triage loop's CI-health surface (qariah-triage-loop SKILL.md, Step 4b).
//
// A workflow can fail (or a cron can silently STOP firing) with nobody watching
// — exactly the failure mode Sprint 31 (dead upstream-sync cron) and Sprint 37
// (scheduled sync failing on `Resource not accessible`) each cost a sprint to
// notice. This probe reads, for every ACTIVE workflow, its latest *meaningful*
// run (ignoring `skipped`/`cancelled`, which are event-gating, not health) and
// classifies it, plus a cadence-adaptive staleness check for scheduled crons.
//
// It is deterministic and read-only — it decides WHICH workflows are unhealthy;
// the loop's model layer only surfaces the verdict for a human. Fixing CI is a
// human/sprint action (workflows are not in the loop's fix queue), so this NEVER
// edits, re-runs, or disables anything.
//
//   node scripts/check-ci-health.mjs            # human summary, exit 0
//   node scripts/check-ci-health.mjs --json     # machine-readable partition
//   node scripts/check-ci-health.mjs --stale-days=8   # cron staleness floor
//
// Classification per active workflow:
//   ok             latest meaningful run succeeded
//   failing        latest meaningful run failed  → ALERT if a gate, WARN if advisory
//   cron-stalled   newest scheduled run older than its adaptive cadence  → ALERT
//   idle           only skipped/cancelled runs (event-gated, e.g. @claude)  → info
//   no-signal      no runs at all yet                                       → info
//
// ADVISORY workflows (a failure is a WARN, not an ALERT): the review agent and
// the OTA preview are best-effort, non-blocking, and can error transiently
// (usage limit / oversized diff) without CI being broken.
//
// Always exits 0 (advisory tool). The health verdict is in the output, never
// the exit code — so a `set -e` caller can't be tripped by an unhealthy CI.
//
// Env:  GH_REPO (default omar-zarka/qariah-v2). Auth via the `gh` CLI.

import {execFileSync} from 'node:child_process';

const REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

// A failure here is best-effort noise, not a broken pipeline — surface as WARN.
const ADVISORY = new Set(['Claude Code Review', 'EAS Update Preview']);

// Conclusions that carry no health signal (the workflow chose not to run).
const NON_SIGNAL = new Set([
  'skipped',
  'cancelled',
  'neutral',
  'stale',
  null,
  undefined,
]);

function parseArgs(argv) {
  const args = {json: false, staleDays: 8, runsPerWorkflow: 20};
  for (const a of argv.slice(2)) {
    if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--stale-days='))
      args.staleDays = Number(a.split('=')[1]) || 8;
    else if (a.startsWith('--runs='))
      args.runsPerWorkflow = Number(a.split('=')[1]) || 20;
  }
  return args;
}

function ghJson(path) {
  const out = execFileSync(
    'gh',
    ['api', path, '-H', 'Accept: application/vnd.github+json'],
    {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  return JSON.parse(out);
}

function daysAgo(iso) {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

/**
 * Adaptive cron-staleness threshold (days). Estimate the cadence from the two
 * newest scheduled runs and allow ~2.5 missed ticks of grace; fall back to the
 * caller's floor when there is only one scheduled run to go on. This nags a
 * daily cron after a couple of missed days but leaves a weekly cron alone for a
 * single missed Monday.
 */
function cronStaleThresholdDays(scheduleRuns, floorDays) {
  if (scheduleRuns.length >= 2) {
    const intervalDays =
      (new Date(scheduleRuns[0].created_at).getTime() -
        new Date(scheduleRuns[1].created_at).getTime()) /
      86_400_000;
    return Math.max(intervalDays * 2.5, floorDays);
  }
  return floorDays;
}

function classify(wf, runs, {staleDays}) {
  const advisory = ADVISORY.has(wf.name);
  const latestMeaningful = runs.find(
    r => r.status === 'completed' && !NON_SIGNAL.has(r.conclusion),
  );
  const scheduleRuns = runs.filter(r => r.event === 'schedule');
  const summarize = r =>
    r && {
      conclusion: r.conclusion,
      event: r.event,
      headBranch: r.head_branch,
      createdAt: r.created_at,
      url: r.html_url,
    };

  // A scheduled cron that stopped firing entirely is the highest-value catch.
  if (scheduleRuns.length > 0) {
    const newest = scheduleRuns[0];
    const threshold = cronStaleThresholdDays(scheduleRuns, staleDays);
    const age = daysAgo(newest.created_at);
    if (age > threshold) {
      return {
        status: 'cron-stalled',
        advisory,
        latest: summarize(newest),
        note: `no scheduled run in ${age.toFixed(1)}d (cadence grace ${threshold.toFixed(1)}d) — cron may have stopped`,
      };
    }
  }

  if (!latestMeaningful) {
    const anyRun = runs[0];
    return {
      status: anyRun ? 'idle' : 'no-signal',
      advisory,
      latest: summarize(anyRun),
      note: anyRun
        ? 'only skipped/cancelled runs (event-gated)'
        : 'no runs yet',
    };
  }

  const failing = latestMeaningful.conclusion !== 'success';
  return {
    status: failing ? 'failing' : 'ok',
    advisory,
    latest: summarize(latestMeaningful),
    note: failing
      ? advisory
        ? `advisory check failed on ${latestMeaningful.head_branch} (non-blocking — usage limit / transient)`
        : `GATE failed on ${latestMeaningful.head_branch}`
      : undefined,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      'Usage: node scripts/check-ci-health.mjs [--json] [--stale-days=8] [--runs=20]',
    );
    return;
  }

  let workflows;
  try {
    workflows =
      ghJson(`repos/${REPO}/actions/workflows?per_page=100`).workflows || [];
  } catch (e) {
    // Offline / unauthenticated: degrade gracefully so a standalone run (and the
    // loop's own Step 0 offline guard) never turns this into a hard error.
    const msg = String(e.message || e).split('\n')[0];
    const payload = {
      repo: REPO,
      error: `gh unavailable: ${msg}`,
      skipped: true,
    };
    console.log(
      args.json
        ? JSON.stringify(payload, null, 2)
        : `🩺 CI health: skipped — ${payload.error}`,
    );
    return;
  }

  const active = workflows.filter(w => w.state === 'active');
  const disabled = workflows
    .filter(w => w.state !== 'active')
    .map(w => ({name: w.name, state: w.state}));

  const results = [];
  for (const wf of active) {
    let runs = [];
    try {
      runs =
        ghJson(
          `repos/${REPO}/actions/workflows/${wf.id}/runs?per_page=${args.runsPerWorkflow}`,
        ).workflow_runs || [];
    } catch {
      /* leave runs empty → no-signal */
    }
    results.push({name: wf.name, state: wf.state, ...classify(wf, runs, args)});
  }

  const alerts = results.filter(
    r => (r.status === 'failing' && !r.advisory) || r.status === 'cron-stalled',
  );
  const warnings = results.filter(r => r.status === 'failing' && r.advisory);
  const okCount = results.filter(r => r.status === 'ok').length;

  const partition = {
    repo: REPO,
    generatedAt: new Date().toISOString(),
    summary: {
      active: active.length,
      ok: okCount,
      gateFailing: alerts.filter(r => r.status === 'failing').length,
      cronStalled: alerts.filter(r => r.status === 'cron-stalled').length,
      advisoryFailing: warnings.length,
      idle: results.filter(r => r.status === 'idle' || r.status === 'no-signal')
        .length,
      disabled: disabled.length,
    },
    alerts,
    warnings,
    workflows: results,
    disabled,
  };

  if (args.json) {
    console.log(JSON.stringify(partition, null, 2));
    return;
  }

  // Human summary — a one-line verdict + per-problem detail.
  const s = partition.summary;
  const headline =
    alerts.length === 0
      ? `🩺 CI health: healthy — ${s.ok} ok` +
        (s.advisoryFailing
          ? ` · ${s.advisoryFailing} advisory-fail (non-blocking)`
          : '') +
        (s.idle ? ` · ${s.idle} idle` : '')
      : `🩺 CI health: ⚠️ ${s.gateFailing} gate-fail · ${s.cronStalled} cron-stalled · ${s.ok} ok`;
  console.log(headline);

  for (const a of alerts) {
    const b = a.latest?.headBranch ? ` [${a.latest.headBranch}]` : '';
    console.log(`  ❌ ${a.name}: ${a.note}${b}\n     ${a.latest?.url || ''}`);
  }
  for (const w of warnings) {
    console.log(`  ⚠️  ${w.name}: ${w.note}\n     ${w.latest?.url || ''}`);
  }
  if (disabled.length) {
    console.log(
      `  ⏸️  disabled (expected): ${disabled.map(d => d.name).join(', ')}`,
    );
  }
}

main();
