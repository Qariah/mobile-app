// @ai
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {
  buildsIn,
  escapedDefects,
  formatReport,
  trustedBuilds,
} from '../lib/escaped-defects.mjs';
import {parseEvents} from '../lib/promotion-approval.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures', 'escaped-defects');
const read = f => JSON.parse(readFileSync(join(FIX, f), 'utf8'));

test('buildsIn: the ways an issue names a build', () => {
  assert.deepEqual(
    buildsIn(
      'com.qariah.app@3.2.3+3763 (12), vc2027, build 3900, Build #3813, 3.2.4 (3898), version 3.2.3',
    ),
    [2027, 3763, 3813, 3898, 3900],
  );
  assert.deepEqual(buildsIn('build 12 is too short; #510 is an issue'), []);
  assert.deepEqual(buildsIn(''), []);
});

test('trustedBuilds: READY lines by the owner, plus the production builds', () => {
  const events = parseEvents(read('comments.json'), {owner: 'omar-zarka'});
  const trusted = trustedBuilds({events, rollout: read('rollout.json')});
  assert.deepEqual(
    [...trusted.keys()].sort((a, b) => a - b),
    [3763, 3772, 3900],
  );
  assert.equal(trusted.get(3900).kind, 'ready');
  assert.equal(trusted.get(3900).at, '2026-11-02T04:00:00Z');
  assert.match(trusted.get(3900).url, /issuecomment-1$/);
  assert.equal(trusted.get(3763).kind, 'production');
  assert.equal(trusted.get(3763).at, '2026-11-01T00:00:00Z');
  // A NOT READY line and a line by another login are not trusted builds.
  assert.equal(trusted.has(3817), false);
  assert.equal(trusted.has(3950), false);
});

test('trustedBuilds: --prod adds a build; production wins over ready', () => {
  const events = [
    {
      kind: 'ready',
      build: '3763',
      at: '2026-10-30T00:00:00Z',
      url: 'u',
      sha: 's',
    },
  ];
  const trusted = trustedBuilds({
    events,
    rollout: read('rollout.json'),
    extraProd: ['2027'],
  });
  assert.equal(trusted.get(2027).kind, 'production');
  assert.equal(trusted.get(2027).at, '2026-11-01T00:00:00Z');
  assert.equal(trusted.get(3763).kind, 'production');
  // The earlier READY date is kept: the build was trusted from then on.
  assert.equal(trusted.get(3763).at, '2026-10-30T00:00:00Z');
  assert.equal(trustedBuilds({events: [], rollout: null}).size, 0);
});

test('escapedDefects: the fixture gives two escapes and the right skips', () => {
  const events = parseEvents(read('comments.json'), {owner: 'omar-zarka'});
  const trusted = trustedBuilds({events, rollout: read('rollout.json')});
  const {escaped, skipped} = escapedDefects({
    issues: read('issues.json'),
    trusted,
    since: '2026-10-20T00:00:00Z',
  });
  assert.deepEqual(
    escaped.map(e => [e.number, e.build, e.kind]),
    [
      [801, 3763, 'production'], // Sentry release line, the lowest trusted build wins
      [802, 3900, 'ready'], // "build 3900" after the READY line
    ],
  );
  assert.equal(escaped[0].fixedIn, 3813);
  assert.equal(escaped[0].daysToClose, 2);
  assert.deepEqual(escaped[0].buildsNamed, [3763, 3772]);
  assert.equal(escaped[1].fixedIn, null);
  assert.equal(
    escaped[1].trustedUrl,
    'https://github.com/omar-zarka/qariah-v2/issues/510#issuecomment-1',
  );
  // #803 was reported before the READY line: the audit caught it.
  // #805 names no build. #806 names an internal beta only.
  assert.equal(skipped.noBuild, 3);
  assert.equal(skipped.notDefect, 1); // #804 ops
  assert.equal(skipped.pulls, 1); // #807
  assert.equal(skipped.outOfWindow, 1); // #808, before --since
});

test('escapedDefects: --until bounds the window', () => {
  const events = parseEvents(read('comments.json'), {owner: 'omar-zarka'});
  const trusted = trustedBuilds({events, rollout: read('rollout.json')});
  const {escaped} = escapedDefects({
    issues: read('issues.json'),
    trusted,
    since: '2026-10-20T00:00:00Z',
    until: '2026-11-03T11:00:00Z',
  });
  assert.deepEqual(
    escaped.map(e => e.number),
    [801],
  );
});

test('formatReport: the summary line, one line per issue, the skips', () => {
  const events = parseEvents(read('comments.json'), {owner: 'omar-zarka'});
  const trusted = trustedBuilds({events, rollout: read('rollout.json')});
  const r = escapedDefects({
    issues: read('issues.json'),
    trusted,
    since: '2026-10-20T00:00:00Z',
  });
  const text = formatReport(r, {since: '2026-10-20'});
  assert.match(
    text,
    /^escaped defects since 2026-10-20: 2 \(1 on READY builds, 1 on production builds\)/,
  );
  assert.match(
    text,
    /#801 {2}build 3763 \(production 2026-11-01\) {2}reported 2026-11-03 {2}fixed-in:3813/,
  );
  assert.match(
    text,
    /#802 {2}build 3900 \(ready 2026-11-02\) {2}reported 2026-11-03 {2}open/,
  );
  assert.match(
    text,
    /skipped: 3 issues name no trusted build, 1 are not defects, 1 are pull requests, 1 are outside the window/,
  );
});

test('the CLI runs on the fixture files, text and --json', () => {
  const args = [
    join(here, '..', 'escaped-defects.mjs'),
    '--since=2026-10-20',
    `--issues-file=${join(FIX, 'issues.json')}`,
    `--comments-file=${join(FIX, 'comments.json')}`,
    `--rollout-file=${join(FIX, 'rollout.json')}`,
  ];
  const text = execFileSync('node', args, {encoding: 'utf8'});
  assert.match(
    text,
    /^trusted builds: 3763 \(production 2026-11-01\), 3772 \(production 2026-11-01\), 3900 \(ready 2026-11-02\)/,
  );
  assert.match(text, /escaped defects since 2026-10-20: 2 /);
  const j = JSON.parse(
    execFileSync('node', [...args, '--json'], {encoding: 'utf8'}),
  );
  assert.equal(j.since, '2026-10-20');
  assert.deepEqual(
    j.escaped.map(e => e.number),
    [801, 802],
  );
  assert.deepEqual(
    j.trustedBuilds.map(t => t.build),
    [3763, 3772, 3900],
  );
  assert.equal(j.skipped.noBuild, 3);
});

test('the CLI refuses a call with no --since', () => {
  let code = 0;
  try {
    execFileSync('node', [join(here, '..', 'escaped-defects.mjs')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 2);
});
