#!/usr/bin/env node
// @ai
//
// scripts/__tests__/apply-patches.test.mjs
// ----------------------------------------
// Tests for scripts/apply-patches.sh and its two callers (TECH_DEBT #401).
// A release build from a node_modules that lacks a patch ships the old native
// code with no error: 3.2.4 (3942) shipped without the #773 and #779 patches.
//
// Run:  node --test scripts/__tests__/apply-patches.test.mjs
//
// The functional tests run the script on a throw-away project under the
// temporary folder, with the repository's own patch-package. They never
// change the real node_modules.

import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/apply-patches.sh');

const ORIGINAL = 'module.exports = 1;\n';
const PATCHED = 'module.exports = 2;\n';
const PATCH = [
  'diff --git a/node_modules/demo-pkg/index.js b/node_modules/demo-pkg/index.js',
  'index 0000001..0000002 100644',
  '--- a/node_modules/demo-pkg/index.js',
  '+++ b/node_modules/demo-pkg/index.js',
  '@@ -1 +1 @@',
  '-module.exports = 1;',
  '+module.exports = 2;',
  '',
].join('\n');

let root;

function write(rel, text) {
  const file = join(root, rel);
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, text);
}

function run() {
  const r = spawnSync('bash', [SCRIPT, root], {encoding: 'utf8'});
  return {status: r.status, out: `${r.stdout}${r.stderr}`};
}

const demoFile = () =>
  readFileSync(join(root, 'node_modules/demo-pkg/index.js'), 'utf8');

describe('apply-patches.sh', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apply-patches-'));
    write(
      'package.json',
      '{"name":"fixture","version":"1.0.0","private":true}\n',
    );
    write(
      'package-lock.json',
      '{"name":"fixture","lockfileVersion":3,"packages":{}}\n',
    );
    write(
      'node_modules/demo-pkg/package.json',
      '{"name":"demo-pkg","version":"1.0.0"}\n',
    );
    write('node_modules/demo-pkg/index.js', ORIGINAL);
    write('patches/demo-pkg+1.0.0.patch', PATCH);
    symlinkSync(
      join(REPO, 'node_modules/patch-package'),
      join(root, 'node_modules/patch-package'),
    );
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it('applies a patch that node_modules lacks', () => {
    const r = run();
    assert.equal(r.status, 0, r.out);
    assert.equal(demoFile(), PATCHED);
  });

  it('passes and changes nothing when the patch is already applied', () => {
    write('node_modules/demo-pkg/index.js', PATCHED);
    const r = run();
    assert.equal(r.status, 0, r.out);
    assert.equal(demoFile(), PATCHED);
  });

  it('exits 1 with a clear message when a patch does not apply', () => {
    write('node_modules/demo-pkg/index.js', 'module.exports = 3;\n');
    const r = run();
    assert.equal(r.status, 1, r.out);
    assert.match(
      r.out,
      /does not apply to node_modules\. The build stops here\./,
    );
    assert.match(r.out, /npm ci/);
  });

  it('exits 1 when patch-package is not installed', () => {
    unlinkSync(join(root, 'node_modules/patch-package'));
    const r = run();
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /patch-package is not in/);
  });
});

describe('the archive scripts apply patches/ before the build', () => {
  for (const [file, buildLine] of [
    ['scripts/android-archive.sh', /^\.\/gradlew assembleRelease /m],
    // The child archive (pod install, xcodebuild) starts at this line.
    ['scripts/qariah-ios-archive.sh', /^ {4}QARIAH_IOS_ARCHIVE_CHILD=1 \\$/m],
  ]) {
    it(file, () => {
      const text = readFileSync(join(REPO, file), 'utf8');
      const call = text.search(
        /^if ! bash "\$SCRIPT_DIR\/apply-patches\.sh" "\$REPO_ROOT"; then\n.*\n {4}exit 1\n/m,
      );
      const build = text.search(buildLine);
      assert.notEqual(
        call,
        -1,
        'no apply-patches.sh call that exits 1 on a failure',
      );
      assert.notEqual(build, -1, 'build line not found');
      assert.ok(call < build, 'apply-patches.sh runs after the build');
    });
  }
});
