#!/usr/bin/env node
// @ai
//
// scripts/__tests__/ci-local.test.mjs
// Run:  node --test scripts/__tests__/ci-local.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {STEPS, blockingSteps, expand} from '../ci-local.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const workflow = file =>
  yaml.load(readFileSync(join(REPO, '.github', 'workflows', file), 'utf8'));

describe('ci-local', () => {
  it('runs every blocking step of the gate workflows, and only those', () => {
    for (const file of ['url-leak-guard.yml', 'lint.yml', 'test.yml']) {
      const want = blockingSteps(workflow(file)).sort();
      const have = STEPS.filter(([f]) => f === file)
        .map(([, n]) => n)
        .sort();
      assert.deepEqual(have, want, file);
    }
  });

  it('skips the advisory steps', () => {
    const names = blockingSteps(workflow('lint.yml'));
    assert.ok(!names.includes('Prettier'));
    assert.ok(!names.includes('ESLint'));
  });

  it('puts the event name into an expression, and refuses others', () => {
    assert.equal(expand('${{ github.event_name }}', 'schedule'), 'schedule');
    assert.equal(expand('npm run x', 'pull_request'), 'npm run x');
    assert.throws(() => expand('${{ inputs.x }}', 'schedule'));
  });
});
