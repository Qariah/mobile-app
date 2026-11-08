// @ai
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  appPaths,
  claimsFrom,
  decideCandidate,
  readyReportProblems,
} from '../lib/release-audit.mjs';
import {trainClosed} from '../testflight-public-beta.mjs';

const NOW = Date.parse('2026-11-10T00:00:00Z');
const base = {
  action: 'public-beta',
  head: 'h',
  changed: ['app/a.tsx'],
  events: [],
  everyDays: 2,
  now: NOW,
};
const ready = (at, sha = 'old') => ({
  kind: 'ready',
  action: 'public-beta',
  build: '1',
  sha,
  at,
});

test('app paths leave out docs, scripts and flows', () => {
  assert.deepEqual(
    appPaths([
      'docs/a.md',
      'scripts/x.mjs',
      '.maestro/f.yaml',
      'README.md',
      'services/x.ts',
      'ios/Podfile',
    ]),
    ['services/x.ts', 'ios/Podfile'],
  );
});

test('an app change with no recent READY is audited', () => {
  assert.equal(decideCandidate(base).audit, true);
});

test('a docs-only change is skipped', () => {
  assert.equal(decideCandidate({...base, changed: ['docs/a.md']}).audit, false);
});

test('no record of a public beta is audited', () => {
  assert.equal(decideCandidate({...base, changed: null}).audit, true);
});

test('a READY for this commit is skipped', () => {
  assert.equal(
    decideCandidate({...base, events: [ready('2026-11-01T00:00:00Z', 'h')]})
      .audit,
    false,
  );
});

test('a READY less than the cadence old is skipped; at the cadence it is audited', () => {
  assert.equal(
    decideCandidate({...base, events: [ready('2026-11-09T00:00:00Z')]}).audit,
    false,
  );
  // The daily firing moves a little: 2 days less 6 hours is close enough.
  assert.equal(
    decideCandidate({...base, events: [ready('2026-11-08T05:00:00Z')]}).audit,
    true,
  );
});

test('a NOT READY does not delay the next audit', () => {
  const no = {
    kind: 'not-ready',
    action: 'public-beta',
    build: '1',
    at: '2026-11-09T23:00:00Z',
  };
  assert.equal(decideCandidate({...base, events: [no]}).audit, true);
});

test('a train is closed once Apple approves the version', () => {
  assert.equal(trainClosed('WAITING_FOR_REVIEW'), false);
  assert.equal(trainClosed('PREPARE_FOR_SUBMISSION'), false);
  assert.equal(trainClosed('READY_FOR_SALE'), true);
  assert.equal(trainClosed('PENDING_DEVELOPER_RELEASE'), true);
  assert.equal(trainClosed(null), false);
});

test('the claims come from the results, with no choice by the agent', () => {
  const lines = [
    JSON.stringify({
      case: 'QP-05',
      device: 'pixel3',
      build: 1,
      result: 'PASS',
      artifact: 'a.png',
    }),
    JSON.stringify({case: 'QP-06', device: 'iphone', build: 1, result: 'PASS'}),
    JSON.stringify({
      case: 'QP-07',
      device: 'iphone',
      build: 1,
      result: 'FAIL',
      artifact: 'b.png',
    }),
    'not json',
  ];
  assert.deepEqual(claimsFrom(lines, 'cases'), [
    'QP-05 pixel3 1',
    'QP-06 iphone 1',
  ]);
  assert.deepEqual(claimsFrom(lines, 'artifacts'), [
    'QP-05 pixel3 1 a.png',
    'QP-06 iphone 1 NO ARTIFACT',
  ]);
});

test('a READY report needs the tester text and no failed gate', () => {
  const good = '| 1 | Static gates | PASS |\n\n### What to Test\n\nPlay.';
  assert.deepEqual(readyReportProblems(good), []);
  assert.equal(readyReportProblems('| 1 | x | PASS |').length, 1);
  assert.equal(
    readyReportProblems(
      '| 3 | install | NOT RUN — no device |\n### What to Test\nx',
    ).length,
    1,
  );
  assert.equal(
    readyReportProblems('| 4 | smoke | FAIL |\n### What to Test\nx').length,
    1,
  );
});
