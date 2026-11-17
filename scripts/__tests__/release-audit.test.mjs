// @ai
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  androidSlug,
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

test('an Android artifact claim prints its install file, or MISSING', () => {
  const lines = [
    JSON.stringify({
      case: 'QP-01',
      device: 'Pixel 3',
      build: 4483,
      result: 'PASS',
      artifact: '/e/auto-2026-11-09/android-pixel3-smoke.xml',
    }),
    JSON.stringify({
      case: 'QP-01',
      device: 'Galaxy A10s',
      build: 4483,
      result: 'PASS',
      artifact: '/e/auto-2026-11-09/android-a10s-smoke.xml',
    }),
    JSON.stringify({
      case: 'QP-01',
      device: 'test iPhone 15 Pro',
      build: 4483,
      result: 'PASS',
      artifact: '/e/auto-2026-11-09/iphone/summary.json',
    }),
  ];
  const files = {
    'android-pixel3-install.txt':
      'package: com.qariah.app\n    versionCode=4483 minSdk=24 targetSdk=35\n    versionName=3.2.5\n',
  };
  const seen = [];
  const readInstall = name => {
    seen.push(name);
    return files[name] ?? null;
  };
  const out = claimsFrom(lines, 'artifacts', {readInstall});
  assert.deepEqual(seen, [
    'android-pixel3-install.txt',
    'android-a10s-install.txt',
  ]);
  assert.match(
    out[0],
    /\n {2}install: android-pixel3-install\.txt versionCode=4483 versionName=3\.2\.5 \(equals the claim build\)$/,
  );
  assert.match(out[1], /\n {2}install: MISSING android-a10s-install\.txt\./);
  assert.equal(
    out[2],
    'QP-01 test iPhone 15 Pro 4483 /e/auto-2026-11-09/iphone/summary.json',
  );
  // A stale install shows as a difference, not as a PASS.
  files['android-pixel3-install.txt'] = '    versionCode=4479\n';
  assert.match(
    claimsFrom(lines.slice(0, 1), 'artifacts', {readInstall})[0],
    /DIFFERS from the claim build 4483/,
  );
  // The cases kind does not change.
  assert.deepEqual(claimsFrom(lines.slice(0, 1), 'cases', {readInstall}), [
    'QP-01 Pixel 3 4483',
  ]);
});

test('the Android slug comes from the artifact, else the device name', () => {
  assert.equal(androidSlug({artifact: 'x/android-a10s-logcat.txt'}), 'a10s');
  assert.equal(androidSlug({device: 'Galaxy A10s', artifact: 'x.png'}), 'a10s');
  assert.equal(androidSlug({device: 'Pixel 3'}), 'pixel3');
  assert.equal(androidSlug({device: 'test iPhone 15 Pro'}), null);
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
