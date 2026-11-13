#!/usr/bin/env node
// @ai
//
// scripts/__tests__/incident-knowledge-gh.test.mjs
// ------------------------------------------------
// The shared gh() wrapper of scripts/lib/incident-knowledge.mjs must read an
// output larger than Node's default limit of 1 MiB. On 2026-11-10 the list of
// 300 closed issues with their bodies was 1.11 MB, execFileSync stopped with
// ENOBUFS, and triage-lifecycle failed in Diagnostics Watch.
//
// Run:  node --test scripts/__tests__/incident-knowledge-gh.test.mjs
//
// A fake `gh` first on PATH prints 2 MiB. No test calls GitHub.

import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {GH_MAX_BUFFER, gh} from '../lib/incident-knowledge.mjs';

let dir;
let prevPath;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'incident-knowledge-gh-'));
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env node\nprocess.stdout.write('x'.repeat(Number(process.env.FAKE_GH_BYTES)));\n`,
  );
  chmodSync(join(dir, 'gh'), 0o755);
  prevPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${prevPath}`;
});
after(() => {
  process.env.PATH = prevPath;
  delete process.env.FAKE_GH_BYTES;
  rmSync(dir, {recursive: true, force: true});
});

test('gh() reads an output of 2 MiB (above the default limit of 1 MiB)', () => {
  process.env.FAKE_GH_BYTES = String(2 * 1024 * 1024);
  assert.equal(gh(['issue', 'list']).length, 2 * 1024 * 1024);
});

test('gh() names the limit when the output is too large', () => {
  process.env.FAKE_GH_BYTES = String(GH_MAX_BUFFER + 1);
  assert.throws(() => gh(['issue', 'list']), /output above \d+ bytes/);
});
