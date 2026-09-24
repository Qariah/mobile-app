#!/usr/bin/env node
// @ai
//
// scripts/__tests__/evidence-block.test.mjs
// Run:  node --test scripts/__tests__/evidence-block.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  validate,
  extractBlock,
  renderSkeleton,
} from '../lib/evidence-block.mjs';

const GOOD_SENTRY = `
Tester says audio stops mid-ayah on a Galaxy A52.

### Evidence
- Platform: android
- Builds: 1712-1717
- Bug class: B
- Signature: ExpoKeepAwake\\.deactivate
- Sentry: QARIAHV2-C (8 events / 4 users, releases 3.1.8+1128..3.2.0+1717)
- PostHog: none
- Repro: none
`;

const GOOD_REPRO = `
### Evidence
- Platform: both
- Builds: 1717
- Bug class: B
- Signature: mushaf-rotation
- Repro: Pixel 3 · build 1717 · steps: open p50, rotate · observed: lands on p157 · expected: stays on p50 · artifact: planning/boot-gate-evidence/rot.png
`;

const GOOD_POSTHOG = `
### Evidence
- Platform: ios
- Builds: >=1718
- Bug class: A
- Signature: v1_restore
- PostHog: distinct_id 1b2c3d4e-0000-4000-8000-1234567890ab — sign_in_succeeded → v1_restore_checked → v1_restore_skipped (2026-08-16T02:10Z)
`;

describe('evidence-block.validate', () => {
  it('accepts a Sentry pointer with counts', () => {
    const r = validate(GOOD_SENTRY);
    assert.equal(r.ok, true, JSON.stringify(r.missing));
    assert.deepEqual(r.pointers, ['sentry']);
  });
  it('accepts a full local repro', () => {
    const r = validate(GOOD_REPRO);
    assert.equal(r.ok, true, JSON.stringify(r.missing));
    assert.deepEqual(r.pointers, ['repro']);
  });
  it('accepts a PostHog distinct_id + event sequence', () => {
    const r = validate(GOOD_POSTHOG);
    assert.equal(r.ok, true, JSON.stringify(r.missing));
    assert.deepEqual(r.pointers, ['posthog']);
  });
  it('rejects prose with no block (#234 how-to)', () => {
    const r = validate(
      'How do I switch the Mushaf to Arabic-only? The setting is hard to find.',
    );
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ['evidence block']);
  });
  it('rejects a block whose only pointer is vague prose', () => {
    const r = validate(`### Evidence
- Platform: android
- Builds: 1717
- Bug class: B
- Signature: crash
- Sentry: the app crashes sometimes
- Repro: could not reproduce`);
    assert.equal(r.ok, false);
    assert.ok(r.missing.some(m => m.startsWith('at least one hard pointer')));
  });
  it('rejects a missing signature / platform', () => {
    const r = validate(`### Evidence
- Builds: 1717
- Bug class: B
- Sentry: QARIAHV2-C (8 events / 4 users)`);
    assert.equal(r.ok, false);
    assert.ok(r.missing.some(m => m.startsWith('platform')));
    assert.ok(r.missing.some(m => m.startsWith('signature')));
  });
  it('the LAST block wins (a later comment supersedes)', () => {
    const text = `### Evidence\n- Platform: android\n\n## Comment\n${GOOD_REPRO}`;
    const r = validate(text);
    assert.equal(r.ok, true);
    assert.equal(extractBlock(text).includes('Pixel 3'), true);
  });
  it('renderSkeleton round-trips through parseFields', () => {
    const sk = renderSkeleton({
      platform: 'android',
      builds: '1717',
      'bug class': 'B',
      signature: 'x',
      sentry: 'QARIAHV2-C (2 events / 1 users)',
    });
    assert.equal(validate(sk).ok, true);
  });
});

// ---------------------------------------------------------------------------
// CLI contract.
//
// These guard the failure that motivated the fix: an EMPTY read used to print
// the ordinary {ok:false, missing:["evidence block"]} verdict, so a `gh` call
// that returned nothing was indistinguishable from an issue that genuinely had
// no evidence — and would silently hold a properly documented bug. Empty input
// must exit 2 and must never produce the missing-evidence shape.
describe('CLI', () => {
  const CLI = new URL('../lib/evidence-block.mjs', import.meta.url).pathname;

  const run = (args, input) =>
    spawnSync(process.execPath, [CLI, ...args], {
      input: input ?? '',
      encoding: 'utf8',
    });

  const GOOD_FILE = join(mkdtempSync(join(tmpdir(), 'evb-')), 'issue.md');
  writeFileSync(GOOD_FILE, GOOD_SENTRY);

  it('accepts --file=<path>', () => {
    assert.equal(run([`--file=${GOOD_FILE}`]).status, 0);
  });

  it('accepts --file <path> (the space form the docstring showed)', () => {
    assert.equal(run(['--file', GOOD_FILE]).status, 0);
  });

  it('accepts stdin', () => {
    assert.equal(run([], GOOD_SENTRY).status, 0);
  });

  it('exits 1 — a verdict — when the text genuinely has no block', () => {
    const r = run([], 'just prose, no evidence here');
    assert.equal(r.status, 1);
    assert.deepEqual(JSON.parse(r.stdout).missing, ['evidence block']);
  });

  it('exits 2 on empty stdin, and NOT with the missing-evidence shape', () => {
    const r = run([], '');
    assert.equal(r.status, 2);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error, 'empty input');
    assert.equal(out.missing, undefined);
  });

  it('exits 2 when --file has no path', () => {
    assert.equal(run(['--file']).status, 2);
  });

  it('exits 2 when the file does not exist', () => {
    const r = run(['--file=/nonexistent/nope.md']);
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).missing, undefined);
  });
});
