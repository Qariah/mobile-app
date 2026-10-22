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
//   gate-disabled  a required gate workflow is not active, or not found     → ALERT
//   gate-silent    a required gate does not fire on qariah-main pushes      → ALERT
//   unchecked      a required gate could not be read                        → NOT CHECKED
//
// The script judges REQUIRED gates (`adopt.requiredWorkflows` in
// docs/operations/auto-sprint-policy.json) on push runs only: one query for
// qariah-main and one for each release/* and hotfix/* branch (the gates
// trigger on no other branch). A gate fails when its newest push run on qariah-main failed, or
// when its newest run on a release branch used in the last 14 days failed. It
// is silent when it has no push run on qariah-main, or when its newest trunk
// run is more than 24 h older than the newest qariah-main commit. It is "not
// checked" when a read fails or its first trunk run is still in progress.
// Draft-PR runs never count: a draft's failure belongs to that PR.
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
import {readAdopt} from './lib/auto-sprint-policy.mjs';

const REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

// @ai The advisory and required sets come from the auto-sprint policy (the
// same reader as scripts/local-pr-checks.mjs), so the two scripts cannot
// drift apart. The defaults apply only when the policy cannot be read, and
// the script then says so on stderr.
function loadAdopt() {
  try {
    return readAdopt();
  } catch (e) {
    console.error(
      `⚠️  check-ci-health: cannot read auto-sprint-policy.json (${e.message}); using the default gate list`,
    );
    return {};
  }
}
const ADOPT = loadAdopt();

// A failure here is best-effort noise, not a broken pipeline — surface as WARN.
const ADVISORY = new Set(
  ADOPT.advisoryWorkflows || ['Claude Code Review', 'EAS Update Preview'],
);

// Gate workflows that must stay active and must run on qariah-main. On
// 2026-10-03 `Test` had been `disabled_manually` with zero runs, and this
// script listed it as "disabled (expected)".
const REQUIRED_GATES = new Set(
  ADOPT.requiredWorkflows || [
    'Branding Conformance',
    'Lint & Typecheck',
    'Test',
  ],
);

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

const meaningful = runs =>
  runs.find(r => r.status === 'completed' && !NON_SIGNAL.has(r.conclusion));

const summarize = r =>
  r && {
    conclusion: r.conclusion,
    event: r.event,
    headBranch: r.head_branch,
    createdAt: r.created_at,
    url: r.html_url,
  };

function classify(wf, runs, {staleDays}) {
  const advisory = ADVISORY.has(wf.name);
  const latestMeaningful = meaningful(runs);
  const scheduleRuns = runs.filter(r => r.event === 'schedule');

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

// The gate workflows trigger on pushes to qariah-main, release/** and
// hotfix/** only, so those are the lines a gate can report on. A branch cut
// before the trigger existed has no gate runs; it then adds nothing.
// A failed run on a release line counts only while the line is in use.
const RELEASE_LINE_WINDOW_DAYS = 14;
// The trunk gate is stale when its newest run is this much older than the
// newest commit on qariah-main: the gate stopped firing on new pushes.
const TRUNK_STALE_HOURS = 24;

function gateRuns(wf, query) {
  return (
    ghJson(`repos/${REPO}/actions/workflows/${wf.id}/runs?event=push&${query}`)
      .workflow_runs || []
  );
}

// Both production lines: release/* ships iOS, hotfix/* ships Android (see
// CLAUDE.md "Branch model").
export const LINE_PREFIXES = ['release', 'hotfix'];

/**
 * The branch names under `prefix/` in a `git/matching-refs` answer. The query
 * has no trailing slash (the Claude Cloud GitHub proxy rejects one with HTTP
 * 400 "Request path could not be canonicalized"), so it is a plain prefix
 * match: `heads/release` also returns `releases-foo`. Keep only `prefix/...`.
 */
export function lineBranchesFromRefs(refs, prefix) {
  const head = `refs/heads/${prefix}/`;
  return (refs || [])
    .map(r => r && r.ref)
    .filter(ref => typeof ref === 'string' && ref.startsWith(head))
    .map(ref => ref.slice('refs/heads/'.length));
}

/** The release/* and hotfix/* branches on origin, or null when a read fails. */
function releaseBranches() {
  try {
    return LINE_PREFIXES.flatMap(p =>
      lineBranchesFromRefs(
        ghJson(`repos/${REPO}/git/matching-refs/heads/${p}`),
        p,
      ),
    );
  } catch {
    return null;
  }
}

const notChecked = note => ({
  status: 'unchecked',
  advisory: false,
  note: `not checked — ${note}`,
});

/**
 * Classify a required gate from push runs only: one query for qariah-main and
 * one for each release branch. A window of the newest runs of all events or
 * branches is not enough: draft-PR runs and trunk runs push a red run out.
 * A read that fails makes the gate "not checked", never "ok" or "silent".
 */
function classifyGate(wf, trunkHeadDate, releases) {
  const readTrunk = () => gateRuns(wf, 'branch=qariah-main&per_page=10');
  let trunkRuns;
  try {
    trunkRuns = readTrunk();
  } catch (e) {
    return notChecked(`read failed: ${String(e.message || e).split('\n')[0]}`);
  }
  if (releases === null)
    return notChecked('the release and hotfix branch list could not be read');
  const releaseLatest = [];
  for (const b of releases) {
    let r;
    try {
      r = meaningful(
        gateRuns(wf, `branch=${encodeURIComponent(b)}&per_page=5`),
      );
    } catch {
      return notChecked(`the runs on ${b} could not be read`);
    }
    if (r && daysAgo(r.created_at) <= RELEASE_LINE_WINDOW_DAYS)
      releaseLatest.push(r);
  }

  const trunk = meaningful(trunkRuns);
  const failed = [trunk, ...releaseLatest].filter(
    x => x && x.conclusion !== 'success',
  );
  if (failed.length) {
    return {
      status: 'failing',
      advisory: false,
      latest: summarize(failed[0]),
      note: `GATE failed on ${failed.map(x => x.head_branch).join(', ')}`,
    };
  }
  if (!trunk) {
    // The first trunk run can still be queued or running (for example just
    // after the merge that adds the gate). That is not silence.
    if (trunkRuns.some(x => x.status !== 'completed'))
      return notChecked('the first qariah-main run is still in progress');
    return {
      status: 'gate-silent',
      advisory: false,
      note: 'no completed push run on qariah-main — the gate does not fire on the trunk',
    };
  }
  if (!trunkHeadDate)
    return notChecked('the qariah-main head commit could not be read');
  // Staleness uses the newest run of ANY status: a run that is still in
  // progress for the newest commit is not silence.
  const isStale = runs =>
    new Date(trunkHeadDate).getTime() - new Date(runs[0].created_at).getTime() >
    TRUNK_STALE_HOURS * 3_600_000;
  if (isStale(trunkRuns)) {
    // Read once more before the ALERT: the runs API has once returned a list
    // without its newest runs.
    let again;
    try {
      again = readTrunk();
    } catch (e) {
      return notChecked(
        `read failed: ${String(e.message || e).split('\n')[0]}`,
      );
    }
    if (again.length && isStale(again)) {
      return {
        status: 'gate-silent',
        advisory: false,
        latest: summarize(trunk),
        note: `the newest qariah-main run is older than the newest qariah-main commit by more than ${TRUNK_STALE_HOURS} h — the gate stopped firing`,
      };
    }
  }
  return {status: 'ok', advisory: false, latest: summarize(trunk)};
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

  // A required gate that is not active, or not found. A deleted entry does not
  // count when an active workflow with the same name exists (a renamed file).
  const gateProblems = [...REQUIRED_GATES]
    .filter(n => !active.some(w => w.name === n))
    .map(n => {
      const entry = workflows.find(w => w.name === n);
      return {
        name: n,
        status: 'gate-disabled',
        advisory: false,
        note: entry
          ? `required gate is ${entry.state} — no PR or push runs it`
          : 'required gate workflow not found',
      };
    });

  let trunkHeadDate;
  try {
    trunkHeadDate = ghJson(`repos/${REPO}/commits/qariah-main`).commit
      ?.committer?.date;
  } catch {
    /* without it, the staleness check is skipped */
  }
  const releases = releaseBranches();
  const results = [];
  for (const wf of active) {
    if (REQUIRED_GATES.has(wf.name)) {
      results.push({
        name: wf.name,
        state: wf.state,
        ...classifyGate(wf, trunkHeadDate, releases),
      });
      continue;
    }
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

  const alerts = [
    ...results.filter(
      r =>
        (r.status === 'failing' && !r.advisory) ||
        r.status === 'cron-stalled' ||
        r.status === 'gate-silent',
    ),
    ...gateProblems,
  ];
  const warnings = results.filter(r => r.status === 'failing' && r.advisory);
  // A required gate whose runs could not be read: not a pass, not an alert.
  const unchecked = results.filter(r => r.status === 'unchecked');
  const okCount = results.filter(r => r.status === 'ok').length;

  const partition = {
    repo: REPO,
    generatedAt: new Date().toISOString(),
    summary: {
      active: active.length,
      ok: okCount,
      gateFailing: alerts.filter(r => r.status === 'failing').length,
      cronStalled: alerts.filter(r => r.status === 'cron-stalled').length,
      gateDisabled: alerts.filter(r => r.status === 'gate-disabled').length,
      gateSilent: alerts.filter(r => r.status === 'gate-silent').length,
      advisoryFailing: warnings.length,
      unchecked: unchecked.length,
      idle: results.filter(r => r.status === 'idle' || r.status === 'no-signal')
        .length,
      disabled: disabled.length,
    },
    alerts,
    warnings,
    unchecked,
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
    alerts.length === 0 && unchecked.length > 0
      ? `🩺 CI health: NOT CHECKED — ${unchecked.length} required gate(s) could not be read · ${s.ok} ok`
      : alerts.length === 0
        ? `🩺 CI health: healthy — ${s.ok} ok` +
          (s.advisoryFailing
            ? ` · ${s.advisoryFailing} advisory-fail (non-blocking)`
            : '') +
          (s.idle ? ` · ${s.idle} idle` : '')
        : `🩺 CI health: ⚠️ ${s.gateFailing} gate-fail · ${s.gateDisabled} gate-disabled · ${s.gateSilent} gate-silent · ${s.cronStalled} cron-stalled · ${s.ok} ok`;
  console.log(headline);

  for (const a of alerts) {
    const b = a.latest?.headBranch ? ` [${a.latest.headBranch}]` : '';
    const url = a.latest?.url ? `\n     ${a.latest.url}` : '';
    console.log(`  ❌ ${a.name}: ${a.note}${b}${url}`);
  }
  for (const w of warnings) {
    console.log(`  ⚠️  ${w.name}: ${w.note}\n     ${w.latest?.url || ''}`);
  }
  for (const u of unchecked) {
    console.log(`  ❔ ${u.name}: ${u.note}`);
  }
  const otherDisabled = disabled.filter(d => !REQUIRED_GATES.has(d.name));
  if (otherDisabled.length) {
    console.log(
      `  ⏸️  disabled (not a gate): ${otherDisabled.map(d => d.name).join(', ')}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
