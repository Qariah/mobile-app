#!/usr/bin/env node
// @ai
//
// scripts/ci-local.mjs
// --------------------
// Run the blocking CI gates on this machine, with the commands of the
// workflow files themselves: url-leak-guard.yml, lint.yml and test.yml. Use it
// when GitHub Actions does not start jobs (a billing stop, see CLAUDE.md
// "Process, agents & docs"). The advisory steps (Prettier, the full ESLint)
// and the install steps do not run.
//
//   node scripts/ci-local.mjs          # as Main check: Jest with the *.alldbs suites
//   node scripts/ci-local.mjs --pr     # as a pull request run: Jest without them
//
// Run it on the PR head, in a checkout whose node_modules matches
// package-lock.json (`npm ci`). Exit 0 when every gate passes, 1 when one
// fails. scripts/__tests__/ci-local.test.mjs fails when a workflow gets a
// blocking step that this list does not hold, or loses one that it holds.

import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const REPO = fileURLToPath(new URL('..', import.meta.url));

/** [workflow file, step name]: the blocking gate steps, in run order. */
export const STEPS = [
  ['url-leak-guard.yml', 'Scan for storage-origin tokens'],
  ['lint.yml', 'Duplicate object keys (JS)'],
  ['lint.yml', 'ESLint (Qariah-owned files)'],
  ['lint.yml', 'TypeScript'],
  ['lint.yml', 'Branding (no hardcoded Bayaan brand strings)'],
  ['test.yml', 'Jest'],
  ['test.yml', 'Script tests (node --test)'],
];

// Steps that CI needs and a local checkout does not (or does differently).
export const NOT_LOCAL = new Set([
  'Install dependencies', // node_modules is already installed
  'Fetch the upstream file names', // ensurePin() below
]);

/** Pure: the names of the blocking `run:` steps of a parsed workflow. */
export function blockingSteps(doc) {
  return Object.values(doc.jobs || {}).flatMap(job =>
    (job.steps || [])
      .filter(
        s => s.run && s['continue-on-error'] !== true && !NOT_LOCAL.has(s.name),
      )
      .map(s => s.name),
  );
}

const readWorkflow = file =>
  yaml.load(readFileSync(join(REPO, '.github', 'workflows', file), 'utf8'));

/** Pure: put the event name into a `${{ github.event_name }}` expression. */
export function expand(text, event) {
  const out = String(text).replace(
    /\$\{\{\s*github\.event_name\s*\}\}/g,
    event,
  );
  if (out.includes('${{'))
    throw new Error(`unsupported expression in: ${text}`);
  return out;
}

function findStep(file, name) {
  for (const job of Object.values(readWorkflow(file).jobs || {}))
    for (const s of job.steps || []) if (s.name === name) return s;
  throw new Error(`${file}: no step named "${name}"`);
}

// lint-qariah-owned.mjs needs the pinned upstream commit.
function ensurePin() {
  const pin = execFileSync(
    'node',
    ['scripts/lint-qariah-owned.mjs', '--print-pin'],
    {
      cwd: REPO,
    },
  )
    .toString()
    .trim();
  const have = spawnSync('git', ['cat-file', '-e', `${pin}^{commit}`], {
    cwd: REPO,
  });
  if (have.status !== 0)
    execFileSync('git', ['fetch', '--no-tags', 'upstream', 'develop'], {
      cwd: REPO,
      stdio: 'inherit',
    });
}

function main() {
  const event = process.argv.includes('--pr') ? 'pull_request' : 'schedule';
  ensurePin();
  const results = [];
  for (const [file, name] of STEPS) {
    const step = findStep(file, name);
    const env = {...process.env};
    for (const [k, v] of Object.entries(step.env || {}))
      env[k] = expand(v, event);
    console.log(`\n== ${file} · ${name}`);
    const started = Date.now();
    // GitHub's default shell on Linux: bash -e {0}.
    const r = spawnSync('bash', ['-e', '-c', expand(step.run, event)], {
      cwd: REPO,
      env,
      stdio: 'inherit',
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    results.push({name, ok: r.status === 0, seconds});
  }
  console.log(
    `\nci-local (${event}) at ${execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: REPO}).toString().trim()}:`,
  );
  for (const r of results)
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name} (${r.seconds} s)`);
  process.exit(results.every(r => r.ok) ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
