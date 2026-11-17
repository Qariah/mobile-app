// @ai
// The push checks skip a draft pull request and run when it becomes ready
// (owner, 2026-11-01). A scheduled Main check calls test.yml and lint.yml with
// no pull request: the same `if` lets those runs through.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

for (const [file, job] of [
  ['test.yml', 'jest'],
  ['lint.yml', 'check'],
  ['url-leak-guard.yml', 'url-leaks'],
  ['qariah-checks.yml', 'qariah'],
]) {
  test(`${file}: a draft skips, and ready_for_review and later pushes run`, () => {
    const text = readFileSync(
      new URL(`../../.github/workflows/${file}`, import.meta.url),
      'utf8',
    );
    assert.match(
      text,
      /pull_request:\n {4}types: \[opened, synchronize, reopened, ready_for_review\]/,
    );
    assert.match(
      text,
      new RegExp(
        `\\n {2}${job}:\\n(?: {4}#.*\\n)* {4}if: github\\.event\\.pull_request\\.draft != true\\n`,
      ),
    );
  });
}
