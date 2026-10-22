// Older snapshot files must stay valid when the schema grows: the check step
// validates YESTERDAY's file with today's code (scripts/signals/check.mjs).
// On 2026-10-20 the new `listens` section and two new fields were required,
// so the real file of 2026-10-19 failed and the snapshot workflow went red.
// A field or section that arrives later is optional (`addedAt` on a section).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot} from '../signals/schema.mjs';
import {judge} from '../signals/snapshot.mjs';

const old = JSON.parse(
  readFileSync(
    new URL(
      './fixtures/signals/compat/snapshot-2026-10-19.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

test('the real snapshot of 2026-10-19 (before listens, week and metric) is still valid', () => {
  assert.equal(old.sections.listens, undefined);
  const v = validateSnapshot(old);
  assert.deepEqual(v.errors, []);
  assert.equal(judge(old).ok, true);
});
