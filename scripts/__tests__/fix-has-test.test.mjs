// @ai
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  classifyFix,
  decideFixHasTest,
  isTestPath,
  noTestReason,
} from '../lib/fix-has-test.mjs';

test('isTestPath: the test and check paths of this repository', () => {
  for (const p of [
    'scripts/__tests__/fixed-in.test.mjs',
    'data/__tests__/changelog.test.ts',
    'components/__tests__/Foo.test.tsx',
    'scripts/lib/thing.test.cjs',
    '__mocks__/expo-device.js',
    '.maestro/flows/regression/player/play-pause.yaml',
    'docs/operations/regression-test-plan.md',
    'scripts/iphone/cases.mjs',
    '.claude/hooks/notify-owner-queue.test.sh',
    '.claude/hooks/test-guards.sh',
  ])
    assert.equal(isTestPath(p), true, p);
  for (const p of [
    'scripts/lib/fixed-in.mjs',
    'components/Player.tsx',
    'docs/operations/feedback-graph.md',
    '.maestro/README.md',
    'scripts/test-helper.mjs',
    'planning/test-plans/task.md',
  ])
    assert.equal(isTestPath(p), false, p);
});

test('classifyFix: a label, a Refs line, or a fix title makes a fix', () => {
  assert.equal(classifyFix({labels: ['bug']}).isFix, true);
  assert.equal(classifyFix({labels: ['sentry', 'android']}).isFix, true);
  assert.equal(classifyFix({body: 'Something.\n\nRefs #730'}).isFix, true);
  assert.equal(classifyFix({body: 'Fixes #12, #13'}).isFix, true);
  assert.equal(classifyFix({title: 'fix: the share file name'}).isFix, true);
  assert.equal(classifyFix({title: 'fix(audio): seek'}).isFix, true);
  // A bare number is not a Refs line; a feature title is not a fix.
  assert.equal(
    classifyFix({title: 'feat: lite mode', body: 'see #703 and #704'}).isFix,
    false,
  );
  assert.equal(
    classifyFix({title: 'docs: the retro', labels: ['ops']}).isFix,
    false,
  );
});

test('noTestReason: the No test line, with or without a list marker', () => {
  assert.equal(
    noTestReason('Body.\n\nNo test: the change is a comment only.\n'),
    'the change is a comment only.',
  );
  assert.equal(
    noTestReason('- No test: a native race that no driver can reproduce'),
    'a native race that no driver can reproduce',
  );
  assert.equal(
    noTestReason('no test: lower case counts too'),
    'lower case counts too',
  );
  assert.equal(noTestReason('No test:   '), null);
  assert.equal(noTestReason('No tests were run.'), null);
  assert.equal(noTestReason(''), null);
});

test('decideFixHasTest: the four outcomes', () => {
  const notFix = decideFixHasTest({
    title: 'docs: weekly retro',
    body: '',
    labels: [],
    files: ['planning/retro-week-2026-W45.md'],
  });
  assert.equal(notFix.ok, true);
  assert.equal(notFix.isFix, false);
  assert.match(notFix.text, /not a fix PR/);

  const withTest = decideFixHasTest({
    title: 'fix: the share file name',
    body: 'Refs #731',
    labels: ['bug'],
    files: ['utils/share.ts', 'utils/__tests__/share.test.ts'],
  });
  assert.equal(withTest.ok, true);
  assert.deepEqual(withTest.tests, ['utils/__tests__/share.test.ts']);
  assert.match(withTest.text, /carries 1 test file:/);

  const withReason = decideFixHasTest({
    title: 'fix: a native crash',
    body: 'Refs #700\n\nNo test: the crash needs a Samsung One UI device that no driver has.',
    labels: [],
    files: ['modules/anr/android/Watchdog.kt'],
  });
  assert.equal(withReason.ok, true);
  assert.match(withReason.text, /the body says why/);

  const bare = decideFixHasTest({
    title: 'fix: a native crash',
    body: 'Refs #700',
    labels: [],
    files: ['modules/anr/android/Watchdog.kt'],
  });
  assert.equal(bare.ok, false);
  assert.match(bare.text, /no test file and no "No test: <why>" line/);
});

test('decideFixHasTest: a Maestro flow and a catalog case count as tests', () => {
  const flow = decideFixHasTest({
    title: 'fix: tab tap lost',
    body: 'Refs #1',
    files: [
      'patches/react-native-screens+4.29.0.patch',
      '.maestro/flows/smoke/01-tabs.yaml',
    ],
  });
  assert.equal(flow.ok, true);
  const catalog = decideFixHasTest({
    title: 'fix: tab tap lost',
    body: 'Refs #1',
    files: [
      'app/(tabs)/_layout.tsx',
      'docs/operations/regression-test-plan.md',
    ],
  });
  assert.equal(catalog.ok, true);
});
