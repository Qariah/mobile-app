#!/usr/bin/env node
// @ai
//
// scripts/__tests__/ci-required-checks.test.mjs
// ---------------------------------------------
// The required status checks of qariah-main are the job names that
// scripts/configure-branch-protection.sh lists. A job rename makes a required
// check that never reports. Issue #906 moved Qariah's own CI steps into
// .github/workflows/qariah-checks.yml (TECH_DEBT #359); this test keeps each
// required name on a pull-request job, and keeps the new workflow in the
// trunk run (main-check.yml) and in the pipeline's list of required gates.
//
// Run:  node --test scripts/__tests__/ci-required-checks.test.mjs

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const WORKFLOWS = join(REPO, '.github', 'workflows');
const read = rel => readFileSync(join(REPO, rel), 'utf8');

function requiredContexts() {
  const m = read('scripts/configure-branch-protection.sh').match(
    /CONTEXTS_JSON='(\[[\s\S]*?\])'/,
  );
  assert.ok(m, 'CONTEXTS_JSON not found');
  return JSON.parse(m[1]);
}

/** {workflow name, job name} of each job that runs on a pull request. */
function pullRequestJobs() {
  return readdirSync(WORKFLOWS)
    .filter(f => f.endsWith('.yml'))
    .flatMap(f => {
      const doc = yaml.load(readFileSync(join(WORKFLOWS, f), 'utf8'));
      if (!doc?.on?.pull_request) return [];
      return Object.entries(doc.jobs || {}).map(([id, job]) => ({
        file: f,
        workflow: doc.name,
        name: job.name || id,
      }));
    });
}

test('each required check name is the name of one pull-request job', () => {
  const contexts = requiredContexts();
  assert.deepEqual(contexts, [
    'TypeScript, duplicate keys, Qariah-owned ESLint, branding (blocking); Prettier, full ESLint (advisory)',
    'Jest',
  ]);
  const jobs = pullRequestJobs();
  for (const name of contexts) {
    const hits = jobs.filter(j => j.name === name);
    assert.equal(hits.length, 1, `${name}: ${JSON.stringify(hits)}`);
  }
});

test('main-check.yml calls each gate workflow on the qariah-main head', () => {
  const doc = yaml.load(read('.github/workflows/main-check.yml'));
  const called = Object.values(doc.jobs)
    .map(j => j.uses)
    .filter(Boolean);
  for (const file of ['test.yml', 'lint.yml', 'qariah-checks.yml']) {
    assert.ok(called.includes(`./.github/workflows/${file}`), file);
  }
});

test('the pipeline counts Qariah checks as a required gate', () => {
  const policy = JSON.parse(read('docs/operations/auto-sprint-policy.json'));
  const doc = yaml.load(read('.github/workflows/qariah-checks.yml'));
  assert.ok(policy.adopt.requiredWorkflows.includes(doc.name));
  for (const wf of ['Lint & Typecheck', 'Test']) {
    assert.ok(policy.adopt.requiredWorkflows.includes(wf), wf);
  }
});

test('qariah-checks.yml has the triggers of lint.yml and test.yml', () => {
  const on = f => yaml.load(read(`.github/workflows/${f}`)).on;
  const qariah = on('qariah-checks.yml');
  assert.deepEqual(qariah, on('lint.yml'));
  assert.deepEqual(qariah, on('test.yml'));
});
