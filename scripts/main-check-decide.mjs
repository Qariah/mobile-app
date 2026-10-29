#!/usr/bin/env node
// @ai
//
// scripts/main-check-decide.mjs
// -----------------------------
// The first job of .github/workflows/main-check.yml. It decides whether the
// scheduled run checks the qariah-main head again.
//
//   - A manual run (workflow_dispatch) always checks.
//   - A scheduled run checks when qariah-main has a commit that no earlier run
//     tested: the newest earlier run whose Test or Lint job passed or failed
//     has another head.
//   - When the head did not change, the run gives the result of that tested
//     run: it passes after a pass, and it fails after a failure. So the newest
//     run of the workflow always shows the state of the qariah-main head, and
//     scripts/check-ci-health.mjs reads that state from one run.
//
// A run that tested nothing does not count: a run that only repeated a result,
// or a run whose jobs GitHub did not start (on 2026-10-25 the spending limit
// stopped every job). Without this rule, one such failure would repeat until
// the next commit.
//
// The job writes `run=true` or `run=false` to $GITHUB_OUTPUT and exits 1 to
// repeat a failure. Env: GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_EVENT_NAME,
// GITHUB_RUN_ID, GITHUB_OUTPUT, GH_TOKEN (the `gh` CLI reads it).

import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';

const WORKFLOW_FILE = 'main-check.yml';
// The name of the decide job in main-check.yml. Every other job is a test job.
export const DECIDE_JOB = 'New commits since the last check?';
const COUNTED = new Set(['success', 'failure']);

/** Pure: did this run's Test or Lint job run to a pass or a failure? */
export function tested(jobs) {
  return (jobs || []).some(
    j => j.name !== DECIDE_JOB && COUNTED.has(j.conclusion),
  );
}

/**
 * Pure: {event, sha, runId, runs} → {run, fail, note}. `runs` are the runs of
 * this workflow on qariah-main, newest first, as the Actions API gives them,
 * each with `tested` (see tested()) for the runs that the caller read.
 */
export function decide({event, sha, runId, runs}) {
  if (event !== 'schedule')
    return {run: true, fail: false, note: `${event}: check the head`};
  const prev = (runs || []).find(
    r =>
      String(r.id) !== String(runId) &&
      r.status === 'completed' &&
      COUNTED.has(r.conclusion) &&
      r.tested === true,
  );
  if (!prev)
    return {
      run: true,
      fail: false,
      note: 'no earlier tested run: check the head',
    };
  if (prev.head_sha !== sha)
    return {
      run: true,
      fail: false,
      note: `new commits since ${prev.head_sha.slice(0, 8)}: check the head`,
    };
  if (prev.conclusion === 'failure')
    return {
      run: false,
      fail: true,
      note: `no new commit since the failed run ${prev.html_url}`,
    };
  return {
    run: false,
    fail: false,
    note: `no new commit since the passed run ${prev.html_url}`,
  };
}

const gh = path => JSON.parse(execFileSync('gh', ['api', path]).toString());

function main() {
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY;
  const runs = gh(
    `repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?branch=qariah-main&status=completed&per_page=20`,
  ).workflow_runs;
  // Read the jobs of each run, newest first, up to the first run that tested.
  for (const r of runs) {
    if (
      String(r.id) === String(env.GITHUB_RUN_ID) ||
      !COUNTED.has(r.conclusion)
    )
      continue;
    r.tested = tested(gh(`repos/${repo}/actions/runs/${r.id}/jobs`).jobs);
    if (r.tested) break;
  }
  const d = decide({
    event: env.GITHUB_EVENT_NAME,
    sha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runs,
  });
  console.log(d.note);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `run=${d.run}\n`);
  if (d.fail) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
