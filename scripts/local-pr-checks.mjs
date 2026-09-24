#!/usr/bin/env node
// @ai
//
// scripts/local-pr-checks.mjs
// ---------------------------
// Decide whether a draft PR's checks are "green" for the daily auto-sprint's
// adoption rule (`adopt.requireChecksGreen` in docs/operations/auto-sprint-policy.json).
//
// Normal case: the answer comes from GitHub's check rollup, unchanged.
//
// Temporary fallback (owner decision 2026-09-21): GitHub Actions cannot start
// jobs because of an account-billing failure. Every check then fails with
// "The job was not started because recent account payments have failed …",
// and no PR can ever be green. Until `adopt.localChecksFallback.until`, this
// script treats such a BILLING-BLOCKED check as follows:
//   - a GATE check → run its local equivalent on the PR head; green if it passes.
//   - an ADVISORY check (review agent, EAS preview) → ignored, as check-ci-health does.
// A check that failed for any other reason is a real failure and is never overridden.
// After the `until` date the fallback turns itself off and the rule is strict again.
//
// Usage:
//   node scripts/local-pr-checks.mjs --pr=463 [--pr=456] [--json] [--today=YYYY-MM-DD]
// Exit 0 when every PR is green, 1 when any is not, 2 on a usage or read error.

import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const REPO = 'omar-zarka/qariah-v2';
export const BILLING_RE =
  /job was not started because recent account payments have failed|spending limit needs to be increased/i;
const OK_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

/**
 * Local equivalents for GATE workflows, keyed by workflow name. Each runs the
 * `run:` block of the named step straight from the workflow file on the PR
 * head, so the allowlist and the logic can never drift from CI.
 */
export const LOCAL_EQUIVALENTS = {
  'Branding Conformance': {
    workflow: '.github/workflows/branding-conformance.yml',
    step: 'Scan for hardcoded brand strings',
  },
};

/** Classify one check-rollup entry. `annotation` is the first annotation message, if any. */
export function classifyCheck(check, annotation, advisory) {
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
  if (BILLING_RE.test(annotation || ''))
    return {
      wf,
      name: check.name,
      verdict: advisory.has(wf) ? 'billing-advisory' : 'billing-gate',
    };
  return {
    wf,
    name: check.name,
    verdict: advisory.has(wf) ? 'advisory-fail' : 'fail',
  };
}

/** Extract the `run: |` block of the step named `stepName` from workflow YAML text. */
export function extractRunBlock(yaml, stepName) {
  const lines = yaml.split('\n');
  const at = lines.findIndex(l => l.trim() === `- name: ${stepName}`);
  if (at < 0) return null;
  for (let i = at + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)run:\s*\|\s*$/);
    if (/^\s*- name:/.test(lines[i])) return null;
    if (!m) continue;
    const out = [];
    let indent = null;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') {
        out.push('');
        continue;
      }
      const lead = l.match(/^\s*/)[0].length;
      if (indent === null) indent = lead;
      if (lead < indent) break;
      out.push(l.slice(indent));
    }
    return out.join('\n');
  }
  return null;
}

/** True when the fallback is switched on and `today` is on or before its end date. */
export function fallbackActive(policy, today) {
  const fb = policy?.adopt?.localChecksFallback;
  return Boolean(fb && fb.until && today <= fb.until);
}

function gh(args) {
  return execFileSync('gh', args, {encoding: 'utf8'});
}

function firstAnnotation(detailsUrl) {
  const job = String(detailsUrl || '').match(/\/job\/(\d+)/);
  if (!job) return '';
  try {
    return gh([
      'api',
      `repos/${REPO}/check-runs/${job[1]}/annotations`,
      '-q',
      '[.[].message] | join("\\n")',
    ]);
  } catch {
    return '';
  }
}

function runLocalEquivalent(wfName, headSha) {
  const eq = LOCAL_EQUIVALENTS[wfName];
  if (!eq)
    return {wf: wfName, ok: false, detail: 'no local equivalent defined'};
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const dir = mkdtempSync(
    join(process.env.TMPDIR || tmpdir(), 'local-pr-checks-'),
  );
  try {
    // The PR head may not be in the local object store yet.
    execFileSync('git', ['-C', top, 'fetch', '-q', 'origin', headSha]);
    execFileSync('git', [
      '-C',
      top,
      'worktree',
      'add',
      '--detach',
      '-q',
      dir,
      headSha,
    ]);
    const block = extractRunBlock(
      readFileSync(join(dir, eq.workflow), 'utf8'),
      eq.step,
    );
    if (!block)
      return {
        wf: wfName,
        ok: false,
        detail: `step "${eq.step}" not found in ${eq.workflow}`,
      };
    const r = spawnSync('bash', ['-c', block], {cwd: dir, encoding: 'utf8'});
    const out = `${r.stdout || ''}${r.stderr || ''}`
      .trim()
      .split('\n')
      .slice(-6)
      .join('\n');
    return {wf: wfName, ok: r.status === 0, detail: out};
  } finally {
    spawnSync('git', ['-C', top, 'worktree', 'remove', '--force', dir]);
    rmSync(dir, {recursive: true, force: true});
  }
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
        'number,headRefOid,headRefName,mergeable,statusCheckRollup',
      ]),
    );
    if (pr.mergeable !== 'UNKNOWN') return pr;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  }
  return pr;
}

export function checkPr(n, policy, today) {
  const pr = readPr(n);
  const advisory = new Set(
    policy?.adopt?.localChecksFallback?.advisoryWorkflows || [],
  );
  const checks = (pr.statusCheckRollup || []).map(c =>
    classifyCheck(
      c,
      String(c.conclusion).toUpperCase() === 'FAILURE'
        ? firstAnnotation(c.detailsUrl)
        : '',
      advisory,
    ),
  );
  const reasons = [];
  if (pr.mergeable !== 'MERGEABLE') reasons.push(`mergeable=${pr.mergeable}`);
  for (const c of checks) {
    if (c.verdict === 'fail')
      reasons.push(`${c.wf} / ${c.name}: failed (not billing)`);
    if (c.verdict === 'pending')
      reasons.push(`${c.wf} / ${c.name}: still running`);
  }
  const billingGates = [
    ...new Set(checks.filter(c => c.verdict === 'billing-gate').map(c => c.wf)),
  ];
  const billingAny = checks.some(c => c.verdict.startsWith('billing'));
  let mode = 'ci';
  const local = [];
  if (billingAny) {
    if (!fallbackActive(policy, today)) {
      reasons.push(
        `billing-blocked checks and the local fallback is off (until=${policy?.adopt?.localChecksFallback?.until ?? 'unset'}, today=${today})`,
      );
    } else {
      mode = 'local';
      if (reasons.length === 0)
        for (const wf of billingGates) {
          const r = runLocalEquivalent(wf, pr.headRefOid);
          local.push(r);
          if (!r.ok) reasons.push(`${wf}: local equivalent failed`);
        }
    }
  }
  return {
    pr: pr.number,
    head: pr.headRefOid,
    branch: pr.headRefName,
    green: reasons.length === 0,
    mode,
    reasons,
    checks,
    local,
  };
}

function main() {
  const args = process.argv.slice(2);
  const prs = args
    .filter(a => a.startsWith('--pr='))
    .flatMap(a => a.slice(5).split(','))
    .filter(Boolean);
  const json = args.includes('--json');
  const todayArg = args.find(a => a.startsWith('--today='));
  const today = todayArg
    ? todayArg.slice(8)
    : new Date().toISOString().slice(0, 10);
  if (prs.length === 0) {
    console.error(
      'usage: node scripts/local-pr-checks.mjs --pr=<n>[,<n>] [--json] [--today=YYYY-MM-DD]',
    );
    process.exit(2);
  }
  const policy = JSON.parse(
    readFileSync('docs/operations/auto-sprint-policy.json', 'utf8'),
  );
  const results = prs.map(n => checkPr(n, policy, today));
  if (json) console.log(JSON.stringify(results, null, 2));
  else
    for (const r of results) {
      console.log(
        `PR #${r.pr} ${r.green ? 'GREEN' : 'NOT GREEN'} (mode=${r.mode}) ${r.branch}@${r.head.slice(0, 8)}`,
      );
      for (const c of r.checks)
        console.log(`   ${c.verdict.padEnd(16)} ${c.wf} / ${c.name}`);
      for (const l of r.local)
        console.log(
          `   local ${l.ok ? 'PASS' : 'FAIL'}  ${l.wf}\n      ${l.detail.replace(/\n/g, '\n      ')}`,
        );
      for (const why of r.reasons) console.log(`   ✗ ${why}`);
    }
  process.exit(results.every(r => r.green) ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
