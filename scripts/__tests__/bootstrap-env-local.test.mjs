// @ai-generated
// #822: the missing-.env.local hint must name only a worktree of this repository,
// never a directory beside it that belongs to another project.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {
  findWorktreeEnvLocal,
} = require('../bootstrap-android-local-properties.js');

const has = paths => p => paths.includes(p);

test('ignores a non-worktree sibling that holds a .env.local', () => {
  // The parent dir holds hevy-sync/.env.local, but git lists only the two Qariah trees.
  const list = () => ['/c/qariah-v2', '/c/qariah-v2-audit'];
  const exists = has(['/c/hevy-sync/.env.local']);
  assert.equal(findWorktreeEnvLocal('/c/qariah-v2-audit', list, exists), null);
});

test('names the main checkout when it has a .env.local', () => {
  const list = () => ['/c/qariah-v2', '/c/qariah-v2-audit'];
  const exists = has(['/c/qariah-v2/.env.local', '/c/hevy-sync/.env.local']);
  assert.equal(
    findWorktreeEnvLocal('/c/qariah-v2-audit', list, exists),
    '/c/qariah-v2/.env.local',
  );
});

test('never names the root itself', () => {
  const list = () => ['/c/qariah-v2'];
  const exists = has(['/c/qariah-v2/.env.local']);
  assert.equal(findWorktreeEnvLocal('/c/qariah-v2', list, exists), null);
});

test('returns null when git lists nothing (not a checkout)', () => {
  assert.equal(
    findWorktreeEnvLocal(
      '/c/x',
      () => [],
      () => true,
    ),
    null,
  );
});

test('the default lister reads this repository', () => {
  // Real git: the result is null or a .env.local inside a listed worktree.
  const root = new URL('../..', import.meta.url).pathname;
  const r = findWorktreeEnvLocal(root);
  assert.ok(r === null || r.endsWith('/.env.local'));
});
