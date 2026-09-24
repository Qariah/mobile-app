#!/usr/bin/env node
// @ai
//
// scripts/__tests__/local-pr-checks.test.mjs
// Run:  node --test scripts/__tests__/local-pr-checks.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  classifyCheck,
  extractRunBlock,
  fallbackActive,
} from '../local-pr-checks.mjs';

const BILLING =
  "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings";
const ADVISORY = new Set(['Claude Code Review', 'EAS Update Preview']);
const gate = {
  workflowName: 'Branding Conformance',
  name: 'No hardcoded Bayaan brand strings',
};

describe('classifyCheck', () => {
  it('passes success and skipped', () => {
    assert.equal(
      classifyCheck({...gate, conclusion: 'SUCCESS'}, '', ADVISORY).verdict,
      'ok',
    );
    assert.equal(
      classifyCheck({...gate, conclusion: 'SKIPPED'}, '', ADVISORY).verdict,
      'ok',
    );
  });
  it('marks a billing failure on a gate as billing-gate', () => {
    assert.equal(
      classifyCheck({...gate, conclusion: 'FAILURE'}, BILLING, ADVISORY)
        .verdict,
      'billing-gate',
    );
  });
  it('marks a billing failure on an advisory workflow as billing-advisory', () => {
    const c = {
      workflowName: 'Claude Code Review',
      name: 'claude-review',
      conclusion: 'FAILURE',
    };
    assert.equal(
      classifyCheck(c, BILLING, ADVISORY).verdict,
      'billing-advisory',
    );
  });
  it('never overrides a real failure', () => {
    assert.equal(
      classifyCheck(
        {...gate, conclusion: 'FAILURE'},
        'Process completed with exit code 1.',
        ADVISORY,
      ).verdict,
      'fail',
    );
  });
  it('treats a running check as pending', () => {
    assert.equal(
      classifyCheck(
        {...gate, conclusion: null, status: 'IN_PROGRESS'},
        '',
        ADVISORY,
      ).verdict,
      'pending',
    );
  });
});

describe('fallbackActive', () => {
  const policy = {adopt: {localChecksFallback: {until: '2026-10-01'}}};
  it('is on through the until date and off after it', () => {
    assert.equal(fallbackActive(policy, '2026-09-22'), true);
    assert.equal(fallbackActive(policy, '2026-10-01'), true);
    assert.equal(fallbackActive(policy, '2026-10-02'), false);
  });
  it('is off when the block is absent', () => {
    assert.equal(fallbackActive({adopt: {}}, '2026-09-22'), false);
  });
});

describe('extractRunBlock', () => {
  it('reads the branding scan from the real workflow file', () => {
    const yml = readFileSync(
      '.github/workflows/branding-conformance.yml',
      'utf8',
    );
    const block = extractRunBlock(yml, 'Scan for hardcoded brand strings');
    assert.ok(block);
    assert.match(block, /^set -e/);
    assert.match(block, /ALLOWED=/);
    assert.match(block, /exit 1/);
  });
  it('returns null for an unknown step', () => {
    assert.equal(
      extractRunBlock('steps:\n  - name: A\n    run: |\n      echo a\n', 'B'),
      null,
    );
  });
});
