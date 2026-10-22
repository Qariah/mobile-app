#!/usr/bin/env node
// @ai
//
// scripts/__tests__/triage-lab-gate.test.mjs
// ------------------------------------------
// node:test suite for the lab-device gate of the Sentry triage bot
// (scripts/lib/triage-lab-gate.mjs, wired into scripts/sentry-triage.mjs).
// GitHub #646: Sentry QARIAHV2-3S (`deeplink-dropped`) was filed as high severity
// and user-impacting, but all 72 of its events came from lab devices.
//
// Part 1 tests the pure functions. Part 2 runs the real sentry-triage.mjs in a
// child process with --dry-run. It gets a stub `fetch` (a --import preload) and
// a stub `gh` program, so the test calls neither Sentry nor GitHub.
//
// Run:  node --test scripts/__tests__/triage-lab-gate.test.mjs

import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CRASH_LEVELS,
  applyLabGate,
  isLabGated,
  labOnly,
  labShare,
} from '../lib/triage-lab-gate.mjs';

const tag = (value, count) => ({value, count});

describe('labOnly', () => {
  it('is true when every event is from a lab device (the QARIAHV2-3S shape)', () => {
    assert.equal(labOnly([tag('Pixel 3', 71), tag('OnePlus8Pro', 1)]), true);
    assert.equal(labOnly([tag('Pixel 3', 71)], 71), true);
  });

  it('is false when real devices are in the mix', () => {
    assert.equal(labOnly([tag('Pixel 3', 71), tag('SM-S918B', 1)]), false);
  });

  it('is false when no event is from a lab device', () => {
    assert.equal(labOnly([tag('SM-S918B', 4), tag('iPhone15,2', 2)]), false);
  });

  it('matches the exact lab names, not their prefixes', () => {
    assert.equal(labOnly([tag('Pixel 3', 5)]), true);
    assert.equal(labOnly([tag('Pixel 3a', 5)]), false);
    assert.equal(labOnly([tag('Pixel 3 XL', 5)]), false);
    assert.equal(labOnly([tag('Pixel 8', 5)]), false);
    assert.equal(labOnly([tag('OnePlus8Pro', 5)]), true);
    assert.equal(labOnly([tag('OnePlus 8', 5)]), false);
  });

  it('matches the emulator and simulator patterns, whatever the case', () => {
    assert.equal(labOnly([tag('sdk_gphone64_arm64', 3)]), true);
    assert.equal(labOnly([tag('sdk_gphone_x86', 1)]), true);
    assert.equal(labOnly([tag('iOS Simulator', 2)]), true);
    assert.equal(labOnly([tag('iphone SIMULATOR', 2)]), true);
    assert.equal(labOnly([tag('Android Emulator', 2)]), true);
    // `_` is one-character wildcard, as in SQL LIKE (the isLabDevice mirror).
    assert.equal(labOnly([tag('sdkXgphone64', 1)]), true);
    assert.equal(labOnly([tag('sdk_gphone64', 1), tag('SM-A546B', 1)]), false);
  });

  it('is false for an unknown, empty or unreadable breakdown', () => {
    assert.equal(labOnly([]), false);
    assert.equal(labOnly(undefined), false);
    assert.equal(labOnly(null), false);
    assert.equal(labOnly('Pixel 3'), false);
    assert.equal(labOnly([tag('', 3)]), false);
    assert.equal(labOnly([tag(null, 3)]), false);
    assert.equal(labOnly([tag(undefined, 3)]), false);
    assert.equal(labOnly([{}]), false);
    assert.equal(labOnly([tag('Pixel 3', 0)]), false);
    assert.equal(labOnly([tag('Pixel 3', 'x')]), false);
  });

  it('counts an empty tag value as a real event, not as a lab event', () => {
    assert.equal(labOnly([tag('Pixel 3', 5), tag('', 1)]), false);
  });

  it('reads counts that Sentry sends as strings', () => {
    assert.equal(
      labOnly([tag('Pixel 3', '71'), tag('OnePlus8Pro', '1')]),
      true,
    );
    assert.equal(labOnly([tag('Pixel 3', '71'), tag('SM-S918B', '1')]), false);
  });

  it('is false when events are not accounted for by the tag values', () => {
    // 71 lab events of 72: one event has no `device` tag, or it fell outside
    // the top 10 values. Unknown is not lab.
    assert.equal(labOnly([tag('Pixel 3', 71)], 72), false);
    assert.equal(labOnly([tag('Pixel 3', 71)], '72'), false);
    assert.equal(labOnly([tag('Pixel 3', 72)], 72), true);
    // A total below the counted events changes nothing.
    assert.equal(labOnly([tag('Pixel 3', 72)], 10), true);
  });
});

describe('labShare', () => {
  it('splits lab events from all events', () => {
    assert.deepEqual(labShare([tag('Pixel 3', 6), tag('SM-S918B', 4)]), {
      lab: 6,
      total: 10,
    });
  });
  it('adds the unaccounted events to the total only', () => {
    assert.deepEqual(labShare([tag('Pixel 3', 6)], 10), {lab: 6, total: 10});
  });
  it('gives zero for an empty breakdown', () => {
    assert.deepEqual(labShare([]), {lab: 0, total: 0});
    assert.deepEqual(labShare(undefined), {lab: 0, total: 0});
  });
});

describe('isLabGated', () => {
  it('applies to an allow-listed message below error level', () => {
    assert.equal(isLabGated({level: 'warning'}, true), true);
    assert.equal(isLabGated({level: 'info'}, true), true);
    assert.equal(isLabGated({}, true), true);
  });
  it('never applies to a crash', () => {
    assert.deepEqual(CRASH_LEVELS, ['fatal', 'error']);
    assert.equal(isLabGated({level: 'fatal'}, true), false);
    assert.equal(isLabGated({level: 'error'}, true), false);
  });
  it('does not apply to a signal that is not on the allow-list', () => {
    assert.equal(isLabGated({level: 'warning'}, false), false);
    assert.equal(isLabGated({level: 'error'}, false), false);
    assert.equal(isLabGated(undefined, false), false);
  });
});

describe('applyLabGate', () => {
  const issue = (shortId, count, level = 'warning') => ({
    shortId,
    count: String(count),
    level,
  });
  const run = async (
    issues,
    devices,
    {gated = i => i.level !== 'error'} = {},
  ) => {
    const lines = [];
    const fetched = [];
    const r = await applyLabGate(issues, {
      gated,
      fetchDevice: async i => {
        fetched.push(i.shortId);
        const d = devices[i.shortId];
        if (d instanceof Error) throw d;
        return d;
      },
      log: l => lines.push(l),
    });
    return {...r, lines, fetched};
  };

  it('skips an issue whose events are all lab (QARIAHV2-3S) and logs one line', async () => {
    const r = await run([issue('QARIAHV2-3S', 72)], {
      'QARIAHV2-3S': {
        values: [tag('Pixel 3', 71), tag('OnePlus8Pro', 1)],
        total: 72,
      },
    });
    assert.deepEqual(r.kept, []);
    assert.deepEqual(r.skipped, [{shortId: 'QARIAHV2-3S', total: 72}]);
    assert.deepEqual(r.lines, [
      '  · skip QARIAHV2-3S: lab devices only (72 events)',
    ]);
  });

  it('keeps a mixed issue and reports its lab share', async () => {
    const r = await run([issue('QARIAHV2-AB', 10)], {
      'QARIAHV2-AB': {
        values: [tag('Pixel 3', 6), tag('SM-S918B', 4)],
        total: 10,
      },
    });
    assert.deepEqual(
      r.kept.map(i => i.shortId),
      ['QARIAHV2-AB'],
    );
    assert.deepEqual(r.shares.get('QARIAHV2-AB'), {lab: 6, total: 10});
    assert.deepEqual(r.lines, []);
  });

  it('keeps an issue with no lab event and gives it no share', async () => {
    const r = await run([issue('QARIAHV2-AC', 4)], {
      'QARIAHV2-AC': {values: [tag('SM-S918B', 4)], total: 4},
    });
    assert.equal(r.kept.length, 1);
    assert.equal(r.shares.size, 0);
  });

  it('does not fetch or gate a crash', async () => {
    const r = await run([issue('QARIAHV2-CR', 3, 'error')], {
      'QARIAHV2-CR': {values: [tag('Pixel 3', 3)], total: 3},
    });
    assert.equal(r.kept.length, 1);
    assert.deepEqual(r.fetched, []);
    assert.deepEqual(r.lines, []);
  });

  it('keeps an issue whose device tag cannot be read', async () => {
    const r = await run(
      [
        issue('QARIAHV2-E1', 5),
        issue('QARIAHV2-E2', 5),
        issue('QARIAHV2-E3', 5),
      ],
      {
        'QARIAHV2-E1': new Error('Sentry 500'),
        'QARIAHV2-E2': {values: [], total: 0},
        'QARIAHV2-E3': undefined,
      },
    );
    assert.equal(r.kept.length, 3);
    assert.equal(r.skipped.length, 0);
  });

  it('keeps an issue with more events than the device tag accounts for', async () => {
    const r = await run([issue('QARIAHV2-GA', 80)], {
      'QARIAHV2-GA': {values: [tag('Pixel 3', 72)], total: 72},
    });
    assert.equal(r.kept.length, 1);
    assert.deepEqual(r.shares.get('QARIAHV2-GA'), {lab: 72, total: 80});
  });

  it('handles a mixed list and keeps the order', async () => {
    const r = await run(
      [
        issue('QARIAHV2-M1', 2),
        issue('QARIAHV2-M2', 2),
        issue('QARIAHV2-M3', 2),
      ],
      {
        'QARIAHV2-M1': {values: [tag('sdk_gphone64_arm64', 2)], total: 2},
        'QARIAHV2-M2': {values: [tag('SM-S918B', 2)], total: 2},
        'QARIAHV2-M3': {values: [tag('Pixel 3', 2)], total: 2},
      },
    );
    assert.deepEqual(
      r.kept.map(i => i.shortId),
      ['QARIAHV2-M2'],
    );
    assert.deepEqual(
      r.skipped.map(s => s.shortId),
      ['QARIAHV2-M1', 'QARIAHV2-M3'],
    );
  });
});

// ---------------------------------------------------------------------------
// The real script, in a child process, with stub fetch and stub gh.
// ---------------------------------------------------------------------------
const SCRIPT = fileURLToPath(new URL('../sentry-triage.mjs', import.meta.url));

const sentryIssue = (id, shortId, title, level, count, userCount) => ({
  id,
  shortId,
  title,
  culprit: 'app/_layout',
  metadata: {value: title},
  level,
  count: String(count),
  userCount,
  firstSeen: '2026-10-01T00:00:00Z',
  lastSeen: '2026-10-20T00:00:00Z',
  permalink: `https://qariah.sentry.test/issues/${id}/`,
});

const ISSUES = [
  // 1. lab only: 71 Pixel 3 + 1 OnePlus 8 Pro (the real QARIAHV2-3S).
  sentryIssue('1', 'QARIAHV2-3S', 'deeplink-dropped', 'warning', 72, 5),
  // 2. mixed: 6 lab events, 4 from a real device.
  sentryIssue('2', 'QARIAHV2-MX', 'splash-hide-timeout', 'warning', 10, 3),
  // 3. a crash from a lab device only: still filed.
  sentryIssue('3', 'QARIAHV2-CR', 'SIGSEGV in libfoo', 'error', 3, 1),
  // 4. an allow-listed signal at error level is a crash: not gated.
  sentryIssue('4', 'QARIAHV2-SC', 'slow-cold-start', 'error', 2, 1),
  // 5. the device tag cannot be read: filed as before.
  sentryIssue('5', 'QARIAHV2-NT', 'boot-not-completed', 'warning', 4, 2),
];

const DEVICE_TAGS = {
  1: {totalValues: 72, topValues: [tag('Pixel 3', 71), tag('OnePlus8Pro', 1)]},
  2: {totalValues: 10, topValues: [tag('Pixel 3', 6), tag('SM-S918B', 4)]},
  3: {totalValues: 3, topValues: [tag('Pixel 3', 3)]},
  4: {totalValues: 2, topValues: [tag('Pixel 3', 2)]},
  // 5: no entry, the stub answers HTTP 500.
};

describe('sentry-triage.mjs --dry-run with the lab gate', () => {
  let dir;
  let out;

  before(() => {
    dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'triage-lab-test-'));
    const log = join(dir, 'gh.log');
    writeFileSync(
      join(dir, 'fetch-stub.mjs'),
      `const issues = ${JSON.stringify(ISSUES)};
const device = ${JSON.stringify(DEVICE_TAGS)};
const ok = body => ({ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body)});
const fail = status => ({ok: false, status, json: async () => ({}), text: async () => 'stub error'});
globalThis.fetch = async url => {
  const p = new URL(String(url)).pathname;
  if (p.endsWith('/projects/qariah/qariahv2/issues/')) return ok(issues);
  const m = p.match(/\\/issues\\/(\\d+)\\/tags\\/([^/]+)\\/$/);
  if (!m) return fail(404);
  const [, id, key] = m;
  if (key === 'device') return device[id] ? ok(device[id]) : fail(500);
  return ok({totalValues: 0, topValues: []});
};
`,
    );
    // The stub gh answers every GET with an empty list and records each call.
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_GH_LOG, JSON.stringify({method: a[a.indexOf('-X') + 1], path: a[a.indexOf('-X') + 2]}) + '\\n');
process.stdout.write('[]');
`,
    );
    chmodSync(join(dir, 'gh'), 0o755);
    writeFileSync(log, '');
    const env = {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      SENTRY_READ_TOKEN: 'stub',
      SENTRY_ORG: 'qariah',
      SENTRY_PROJECT: 'qariahv2',
      SENTRY_REGION_HOST: 'https://sentry.test',
      GH_REPO: 'example/repo',
      STUB_GH_LOG: log,
    };
    delete env.GITHUB_OUTPUT;
    delete env.NODE_OPTIONS;
    const r = spawnSync(
      process.execPath,
      ['--import', join(dir, 'fetch-stub.mjs'), SCRIPT, '--dry-run'],
      {encoding: 'utf8', env},
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    out = {
      stdout: r.stdout,
      gh: readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l)),
    };
  });
  after(() => rmSync(dir, {recursive: true, force: true}));

  it('skips the lab-only message issue and logs one line', () => {
    assert.match(
      out.stdout,
      /^ {2}· skip QARIAHV2-3S: lab devices only \(72 events\)$/m,
    );
    assert.doesNotMatch(out.stdout, /WOULD FILE: \[Sentry QARIAHV2-3S\]/);
  });

  it('files a mixed message issue with the lab line, and keeps its labels', () => {
    const block = out.stdout
      .split('─'.repeat(72))
      .find(b => b.includes('QARIAHV2-MX'));
    assert.ok(block, 'QARIAHV2-MX would be filed');
    assert.match(block, /labels: .*user-impacting/);
    assert.match(
      block,
      /\*\*Lab devices:\*\* 6 of 10 events come from our own test devices/,
    );
  });

  it('files a crash from a lab device, with no lab line', () => {
    for (const id of ['QARIAHV2-CR', 'QARIAHV2-SC']) {
      const block = out.stdout
        .split('─'.repeat(72))
        .find(b => b.includes(`[Sentry ${id}]`));
      assert.ok(block, `${id} would be filed`);
      assert.doesNotMatch(block, /Lab devices/);
    }
    assert.doesNotMatch(out.stdout, /skip QARIAHV2-(CR|SC)/);
  });

  it('files an issue whose device tag cannot be read', () => {
    const block = out.stdout
      .split('─'.repeat(72))
      .find(b => b.includes('[Sentry QARIAHV2-NT]'));
    assert.ok(block, 'QARIAHV2-NT would be filed');
    assert.doesNotMatch(block, /Lab devices/);
    assert.doesNotMatch(out.stdout, /skip QARIAHV2-NT/);
  });

  it('counts the lab-only issue out of the new signals', () => {
    assert.match(out.stdout, /new logical signal\(s\): 4/);
    assert.match(out.stdout, /would file 4/);
  });

  it('writes nothing to GitHub in a dry run', () => {
    assert.ok(out.gh.length > 0, 'the stub gh was used for the dedup listing');
    assert.deepEqual(
      out.gh.filter(c => c.method !== 'GET'),
      [],
    );
  });
});
