#!/usr/bin/env node
// @ai
//
// scripts/__tests__/scope-block.test.mjs
// --------------------------------------
// The `### Scope` block of scoped TECH_DEBT and feature work (scripts/lib/scope-block.mjs)
// and its taxonomy bucket `scoped` (scripts/lib/triage-taxonomy.mjs), 2026-11-11.
//
// Run:  node --test scripts/__tests__/scope-block.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkScope, parseScopeBlock} from '../lib/scope-block.mjs';
import {BUCKETS, classify} from '../lib/triage-taxonomy.mjs';

const CLI = fileURLToPath(new URL('../lib/scope-block.mjs', import.meta.url));

const GOOD = `Some text first.

### Scope
- Source: TECH_DEBT #239
- Kind: tech-debt
- Goal: The daily card's "Logged in" step counts every signed-in event.
- Change: In scripts/triage-card.mjs, count events with properties.signed_in = true.
- Files: scripts/triage-card.mjs, scripts/__tests__/triage-card.test.mjs
- Acceptance: The card shows the signed-in count of the last 24 hours.
- Test: node-test scripts/__tests__/triage-card.test.mjs
- Size: S
- Risk: low
- Platform: none

### Notes
- Not part of the block: ignored.
`;

test('a complete block is valid, and the next heading ends it', () => {
  const r = checkScope(GOOD);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.fields.size, 'S');
  assert.equal(r.fields['not part of the block'], undefined);
});

test('no block, or a missing field, is not valid', () => {
  assert.deepEqual(parseScopeBlock('no block here'), {});
  const r = checkScope(GOOD.replace(/- Acceptance:.*\n/, ''));
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['acceptance']);
});

test('L, high risk, a bad test form and a missing source are refused', () => {
  const swap = (from, to) => checkScope(GOOD.replace(from, to));
  assert.match(swap('- Size: S', '- Size: L').errors.join(), /split an L item/);
  assert.match(
    swap('- Risk: low', '- Risk: high').errors.join(),
    /owner sprint/,
  );
  assert.match(
    swap(/- Test: .*/, '- Test: check it').errors.join(),
    /Test is not/,
  );
  assert.equal(swap(/- Test: .*/, '- Test: none: a doc-only change').ok, true);
  assert.match(
    swap('- Source: TECH_DEBT #239', '- Source: an idea').errors.join(),
    /Source names no/,
  );
});

test('a protected area needs an owner sprint', () => {
  const auth = checkScope(
    GOOD.replace(
      'scripts/triage-card.mjs, scripts',
      'services/auth/qfAuth.ts, scripts',
    ),
  );
  assert.equal(auth.ok, false);
  assert.match(auth.errors.join(), /QF sign-in or sync/);
  const r2 = checkScope(
    GOOD.replace('- Change: In', '- Change: Write catalog-v1.json in R2. In'),
  );
  assert.match(r2.errors.join(), /catalog in R2/);
});

test('the CLI exits 0, 1 and 2', () => {
  const run = input =>
    spawnSync(process.execPath, [CLI], {input, encoding: 'utf8'});
  assert.equal(run(GOOD).status, 0);
  assert.equal(run('### Scope\n- Size: S\n').status, 1);
  assert.equal(run('').status, 2);
});

test('the taxonomy puts a `scoped` issue in its own bucket, after a decision label', () => {
  assert.ok(BUCKETS.scoped);
  assert.equal(BUCKETS.scoped.loopEligible, false);
  const issue = labels => ({number: 1, title: 'Scope: x', labels});
  assert.equal(classify(issue(['scoped'])).bucket, 'scoped');
  assert.equal(
    classify(issue(['scoped', 'needs-decision'])).bucket,
    'decision',
  );
  assert.equal(
    classify(issue(['scoped', 'fixed-in:4500'])).bucket,
    'awaiting-release',
  );
  assert.equal(classify(issue(['scoped', 'feature-request'])).isFeature, true);
});
