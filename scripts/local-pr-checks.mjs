#!/usr/bin/env node
// @ai
//
// scripts/local-pr-checks.mjs
// ---------------------------
// Decide whether a draft PR's checks are "green" for the daily auto-sprint's
// adoption rule (`adopt.requireChecksGreen` in docs/operations/auto-sprint-policy.json).
//
// The answer comes from GitHub's check rollup:
//   - SUCCESS / SKIPPED / NEUTRAL → ok;
//   - a check still running → not green yet;
//   - a failed check of a workflow in `adopt.advisoryWorkflows` (review agent,
//     EAS preview) → reported, does not block (check-ci-health reports it as WARN);
//   - any other failed check → not green.
// The PR must also be MERGEABLE against its base.
//
// (From 2026-09-21 to the end of the GitHub billing outage this script also ran
// billing-blocked gate checks locally, `adopt.localChecksFallback`. That
// fallback is removed: CI runs on GitHub-hosted runners again.)
//
// Usage:
//   node scripts/local-pr-checks.mjs --pr=463 [--pr=456] [--json]
// Exit 0 when every PR is green, 1 when any is not, 2 on a usage or read error.

import {execFileSync} from 'node:child_process';
import {readPolicy} from './lib/auto-sprint-policy.mjs';
/* global SharedArrayBuffer, Atomics -- Node globals; the shared ESLint env is the RN app's */

const REPO = 'omar-zarka/qariah-v2';
const OK_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

/** Classify one check-rollup entry. */
export function classifyCheck(check, advisory) {
  const wf = check.workflowName || check.name;
  const concl = String(check.conclusion || check.state || '').toUpperCase();
  if (OK_CONCLUSIONS.has(concl)) return {wf, name: check.name, verdict: 'ok'};
  if (
    !concl ||
    concl === 'PENDING' ||
    concl === 'IN_PROGRESS' ||
    concl === 'QUEUED'
  )
    return {wf, name: check.name, verdict: 'pending'};
  return {
    wf,
    name: check.name,
    verdict: advisory.has(wf) ? 'advisory-fail' : 'fail',
  };
}

function gh(args) {
  return execFileSync('gh', args, {encoding: 'utf8'});
}

/**
 * Read the PR. GitHub reports `mergeable: UNKNOWN` for a few seconds after the
 * base branch moves, while it recomputes. Retry that state before judging, or a
 * sound draft reads as not-green on the run right after any merge to main.
 */
function readPr(n, tries = 6, waitMs = 5000) {
  let pr;
  for (let i = 0; i < tries; i++) {
    pr = JSON.parse(
      gh([
        'pr',
        'view',
        String(n),
        '-R',
        REPO,
        '--json',
        'number,headRefOid,headRefName,baseRefName,mergeable,statusCheckRollup',
      ]),
    );
    if (pr.mergeable !== 'UNKNOWN') return pr;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  }
  return pr;
}

/** Decide green / not green from a PR record (pure; the tests use it). */
export function judgePr(pr, policy) {
  const advisory = new Set(policy?.adopt?.advisoryWorkflows || []);
  const checks = (pr.statusCheckRollup || []).map(c =>
    classifyCheck(c, advisory),
  );
  const reasons = [];
  if (pr.mergeable !== 'MERGEABLE') reasons.push(`mergeable=${pr.mergeable}`);
  // @ai A gate that never started is not a pass. A draft whose last push came
  // before a gate existed has no run of that gate, and an empty rollup would
  // read as green. Branding Conformance runs only on PRs into qariah-main, so
  // the script applies the list only to those PRs. In the seconds after a push, a gate
  // with no run yet also reads "did not start"; the verdict is NOT GREEN
  // either way.
  const required =
    !pr.baseRefName || pr.baseRefName === 'qariah-main'
      ? policy?.adopt?.requiredWorkflows || []
      : [];
  for (const wf of required) {
    if (!checks.some(c => c.wf === wf))
      reasons.push(`${wf}: no check run (the gate did not start)`);
  }
  for (const c of checks) {
    if (c.verdict === 'fail') reasons.push(`${c.wf} / ${c.name}: failed`);
    if (c.verdict === 'pending')
      reasons.push(`${c.wf} / ${c.name}: still running`);
  }
  return {
    pr: pr.number,
    head: pr.headRefOid,
    branch: pr.headRefName,
    green: reasons.length === 0,
    reasons,
    checks,
  };
}

export function checkPr(n, policy) {
  return judgePr(readPr(n), policy);
}

function main() {
  const args = process.argv.slice(2);
  const prs = args
    .filter(a => a.startsWith('--pr='))
    .flatMap(a => a.slice(5).split(','))
    .filter(Boolean);
  const json = args.includes('--json');
  if (prs.length === 0) {
    console.error(
      'usage: node scripts/local-pr-checks.mjs --pr=<n>[,<n>] [--json]',
    );
    process.exit(2);
  }
  const policy = readPolicy();
  const results = prs.map(n => checkPr(n, policy));
  if (json) console.log(JSON.stringify(results, null, 2));
  else
    for (const r of results) {
      console.log(
        `PR #${r.pr} ${r.green ? 'GREEN' : 'NOT GREEN'} ${r.branch}@${r.head.slice(0, 8)}`,
      );
      for (const c of r.checks)
        console.log(`   ${c.verdict.padEnd(16)} ${c.wf} / ${c.name}`);
      for (const why of r.reasons) console.log(`   ✗ ${why}`);
    }
  process.exit(results.every(r => r.green) ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
