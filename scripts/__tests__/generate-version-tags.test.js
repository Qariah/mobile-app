// @ai
//
// scripts/generate-version.js must never take its marketing version from a
// prerelease or test tag. Sprint 48 (2026-10-20): the upstream absorption
// merged Bayaan's commit 5a813e23, which carries the tag `v2.3.0-1809-test`.
// `git describe` picks the NEAREST matching tag, so the derive gave 2.3.0
// instead of 3.2.2. This test builds a throwaway repo with the same shape and
// runs a copy of the script inside it.

const {execFileSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'generate-version.js');

// BUILD_NUMBER overrides the derive, so a caller's value would hide the bug.
const childEnv = {...process.env};
delete childEnv.BUILD_NUMBER;

function git(cwd, args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args],
    {cwd, env: childEnv, encoding: 'utf8'},
  );
}

describe('generate-version.js ignores prerelease and test tags', () => {
  let scratch;
  let repo;

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-version-tags-'));
    repo = path.join(scratch, 'repo');
    fs.mkdirSync(path.join(repo, 'scripts'), {recursive: true});
    fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'generate-version.js'));
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({name: 'tmp', version: '1.0.0'}),
    );
    git(repo, ['init', '-q']);
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'release']);
    git(repo, ['tag', 'v3.2.2']);
    // A newer commit with an upstream test tag: nearer to HEAD than v3.2.2.
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'upstream merge']);
    git(repo, ['tag', 'v2.3.0-1809-test']);
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'sprint work']);
  });

  afterAll(() => {
    fs.rmSync(scratch, {recursive: true, force: true});
  });

  it('derives 3.2.2, not the nearer v2.3.0-1809-test', () => {
    const out = execFileSync(
      'node',
      [path.join(repo, 'scripts', 'generate-version.js'), '--json-only'],
      {cwd: repo, env: childEnv, encoding: 'utf8'},
    );
    expect(JSON.parse(out).semanticVersion).toBe('3.2.2');
  });
});
