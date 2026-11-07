#!/usr/bin/env node
// @ai
//
// scripts/__tests__/asc-phased-gate.test.mjs
// ------------------------------------------
// `asc-phased-release.mjs status --require` refuses an App Store version that
// has no phased release (TECH_DEBT #188). The rules are pure, so they run here
// with no network. A last group runs the real script for the argument and
// environment errors, which exit before any request.
//
// Run:  node --test scripts/__tests__/asc-phased-gate.test.mjs

import {after, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  evaluateRequire,
  isReleasedState,
  parseArgs,
  runRequire,
} from '../lib/asc-phased-gate.mjs';

const SCRIPT = fileURLToPath(
  new URL('../asc-phased-release.mjs', import.meta.url),
);

const live = (versionString, state = 'READY_FOR_SALE') => ({
  versionString,
  state,
  phased: {attributes: {phasedReleaseState: 'COMPLETE'}},
});
const waiting = (versionString, state, phased = null) => ({
  versionString,
  state,
  phased,
});

describe('isReleasedState', () => {
  it('knows the states of a version that is out', () => {
    for (const s of [
      'READY_FOR_SALE',
      'READY_FOR_DISTRIBUTION',
      'REPLACED_WITH_NEW_VERSION',
    ]) {
      assert.equal(isReleasedState(s), true, s);
    }
  });

  it('counts every other state, and an unknown state, as not released', () => {
    for (const s of [
      'PREPARE_FOR_SUBMISSION',
      'WAITING_FOR_REVIEW',
      'IN_REVIEW',
      'PENDING_DEVELOPER_RELEASE',
      'REJECTED',
      'SOMETHING_NEW_FROM_APPLE',
      undefined,
    ]) {
      assert.equal(isReleasedState(s), false, String(s));
    }
  });
});

describe('evaluateRequire', () => {
  it('refuses a waiting version that has no phased release', () => {
    const r = evaluateRequire([
      waiting('3.2.2', 'PREPARE_FOR_SUBMISSION'),
      live('3.2.1'),
    ]);
    assert.equal(r.exitCode, 1);
    const text = r.lines.join('\n');
    assert.match(
      text,
      /REFUSED: iOS 3\.2\.2 \(state=PREPARE_FOR_SUBMISSION\) has NO phased release/,
    );
    assert.match(text, /--allow-no-phased-release/);
    assert.match(text, /#188/);
  });

  it('passes a waiting version that has a phased release, whatever its state', () => {
    for (const phasedReleaseState of [
      'INACTIVE',
      'ACTIVE',
      'PAUSED',
      'COMPLETE',
    ]) {
      const r = evaluateRequire([
        waiting('3.2.2', 'WAITING_FOR_REVIEW', {
          attributes: {phasedReleaseState},
        }),
        live('3.2.1'),
      ]);
      assert.equal(r.exitCode, 0, phasedReleaseState);
      assert.match(
        r.lines.join('\n'),
        new RegExp(`phased release \\(${phasedReleaseState}\\)`),
      );
    }
  });

  it('ignores a released version that has no phased release (history)', () => {
    const r = evaluateRequire([
      waiting('3.2.2', 'IN_REVIEW', {
        attributes: {phasedReleaseState: 'INACTIVE'},
      }),
      {versionString: '3.0.1', state: 'READY_FOR_SALE', phased: null},
    ]);
    assert.equal(r.exitCode, 0);
    assert.doesNotMatch(r.lines.join('\n'), /3\.0\.1/);
  });

  it('refuses when ANY waiting version has no phased release', () => {
    const r = evaluateRequire([
      waiting('3.2.3', 'PREPARE_FOR_SUBMISSION'),
      waiting('3.2.2', 'REJECTED', {
        attributes: {phasedReleaseState: 'INACTIVE'},
      }),
    ]);
    assert.equal(r.exitCode, 1);
    assert.match(r.lines.join('\n'), /REFUSED: iOS 3\.2\.3/);
  });

  it('refuses an unknown state without a phased release (fails closed)', () => {
    const r = evaluateRequire([waiting('3.2.2', 'SOMETHING_NEW_FROM_APPLE')]);
    assert.equal(r.exitCode, 1);
  });

  it('passes with a warning when --allow-no-phased-release is set', () => {
    const r = evaluateRequire(
      [waiting('3.2.2', 'PREPARE_FOR_SUBMISSION'), live('3.2.1')],
      {allowNone: true},
    );
    assert.equal(r.exitCode, 0);
    const text = r.lines.join('\n');
    assert.match(text, /WARNING: iOS 3\.2\.2/);
    assert.match(text, /100%/);
    assert.doesNotMatch(text, /REFUSED/);
  });

  it('refuses when no version is waiting, and says why', () => {
    const r = evaluateRequire([live('3.2.1')]);
    assert.equal(r.exitCode, 1);
    const text = r.lines.join('\n');
    assert.match(
      text,
      /REFUSED: no App Store version is waiting for release \(newest: 3\.2\.1, state=READY_FOR_SALE\)/,
    );
    // The way out for a TestFlight public beta is named.
    assert.match(text, /TestFlight public beta.*--allow-no-phased-release/);
  });

  it('passes with a WARNING when no version is waiting and the allow flag is set (a TestFlight public beta)', () => {
    const r = evaluateRequire([live('3.2.1')], {allowNone: true});
    assert.equal(r.exitCode, 0);
    const text = r.lines.join('\n');
    assert.match(
      text,
      /WARNING: no App Store version is waiting for release \(newest: 3\.2\.1, state=READY_FOR_SALE\)/,
    );
    assert.match(text, /TestFlight public beta/);
    assert.doesNotMatch(text, /REFUSED/);
  });

  it('refuses an empty version list, and passes it with the allow flag', () => {
    const r = evaluateRequire([]);
    assert.equal(r.exitCode, 1);
    assert.match(
      r.lines.join('\n'),
      /no App Store version is waiting for release\./,
    );
    assert.equal(evaluateRequire([], {allowNone: true}).exitCode, 0);
  });

  it('cannot say (exit 2) when the page has no released version and a next page exists', () => {
    // Every version on the page is waiting. An older waiting version may be on the next page.
    for (const allowNone of [false, true]) {
      const r = evaluateRequire(
        [
          waiting('3.2.3', 'PREPARE_FOR_SUBMISSION', {
            attributes: {phasedReleaseState: 'INACTIVE'},
          }),
          waiting('3.2.2', 'REJECTED', {
            attributes: {phasedReleaseState: 'INACTIVE'},
          }),
        ],
        {allowNone, hasNextPage: true},
      );
      assert.equal(r.exitCode, 2);
      assert.match(
        r.lines.join('\n'),
        /^the check did not run: the first page/,
      );
    }
    assert.equal(evaluateRequire([], {hasNextPage: true}).exitCode, 2);
  });

  it('judges the page as before when it has a released version, or no next page', () => {
    const page = [waiting('3.2.2', 'PREPARE_FOR_SUBMISSION'), live('3.2.1')];
    // A released version is on the page, so every newer version is on it too.
    assert.equal(evaluateRequire(page, {hasNextPage: true}).exitCode, 1);
    assert.equal(evaluateRequire(page, {hasNextPage: false}).exitCode, 1);
    const ok = [
      waiting('3.2.2', 'IN_REVIEW', {
        attributes: {phasedReleaseState: 'ACTIVE'},
      }),
    ];
    assert.equal(evaluateRequire(ok, {hasNextPage: false}).exitCode, 0);
  });
});

describe('runRequire', () => {
  const version = (id, versionString, state) => ({
    id,
    attributes: {versionString, appStoreState: state},
  });
  // A fake API: path pieces map to {status, body}, or to a function that throws.
  const api = routes => async path => {
    for (const [needle, res] of Object.entries(routes)) {
      if (path.includes(needle)) {
        if (typeof res === 'function') return res();
        return res;
      }
    }
    throw new Error(`unexpected request ${path}`);
  };
  const listOf = (data, links = {}) => ({
    status: 200,
    body: {data, links},
  });
  const OPTS = {appId: '123'};

  it('passes a waiting version that has a phased release', async () => {
    const r = await runRequire(
      api({
        'appStoreVersions?': listOf([
          version('v2', '3.2.2', 'WAITING_FOR_REVIEW'),
          version('v1', '3.2.1', 'READY_FOR_SALE'),
        ]),
        'v2/appStoreVersionPhasedRelease': {
          status: 200,
          body: {data: {attributes: {phasedReleaseState: 'INACTIVE'}}},
        },
      }),
      OPTS,
    );
    assert.equal(r.exitCode, 0);
  });

  it('refuses a waiting version when the phased-release read gives data null or 404', async () => {
    for (const phased of [
      {status: 200, body: {data: null}},
      {status: 404, body: {errors: []}},
    ]) {
      const r = await runRequire(
        api({
          'appStoreVersions?': listOf([
            version('v2', '3.2.2', 'PREPARE_FOR_SUBMISSION'),
            version('v1', '3.2.1', 'READY_FOR_SALE'),
          ]),
          'v2/appStoreVersionPhasedRelease': phased,
        }),
        OPTS,
      );
      assert.equal(r.exitCode, 1, String(phased.status));
    }
  });

  it('exits 2 when a request throws (a network error, a body that is not JSON)', async () => {
    for (const thrown of [
      new TypeError('fetch failed', {cause: {code: 'ENOTFOUND'}}),
      new SyntaxError('Unexpected token < in JSON at position 0'),
      'a string, not an Error',
    ]) {
      const r = await runRequire(
        api({
          'appStoreVersions?': () => {
            throw thrown;
          },
        }),
        OPTS,
      );
      assert.equal(r.exitCode, 2);
      assert.match(r.lines[0], /^the check did not run: /);
    }
    const r = await runRequire(
      api({
        'appStoreVersions?': () => {
          throw new TypeError('fetch failed', {cause: {code: 'ENOTFOUND'}});
        },
      }),
      OPTS,
    );
    assert.equal(r.lines[0], 'the check did not run: fetch failed (ENOTFOUND)');
  });

  it('exits 2 when the second request throws', async () => {
    const r = await runRequire(
      api({
        'appStoreVersions?': listOf([
          version('v2', '3.2.2', 'PREPARE_FOR_SUBMISSION'),
          version('v1', '3.2.1', 'READY_FOR_SALE'),
        ]),
        'v2/appStoreVersionPhasedRelease': () => {
          throw new Error('socket hang up');
        },
      }),
      OPTS,
    );
    assert.equal(r.exitCode, 2);
    assert.match(r.lines[0], /socket hang up/);
  });

  it('exits 2 on an HTTP error, never as "no phased release"', async () => {
    const list5xx = await runRequire(
      api({'appStoreVersions?': {status: 503, body: null}}),
      OPTS,
    );
    assert.equal(list5xx.exitCode, 2);
    assert.match(list5xx.lines[0], /HTTP 503/);

    const badShape = await runRequire(
      api({'appStoreVersions?': {status: 200, body: {errors: []}}}),
      OPTS,
    );
    assert.equal(badShape.exitCode, 2);

    const phased5xx = await runRequire(
      api({
        'appStoreVersions?': listOf([
          version('v2', '3.2.2', 'PREPARE_FOR_SUBMISSION'),
          version('v1', '3.2.1', 'READY_FOR_SALE'),
        ]),
        'v2/appStoreVersionPhasedRelease': {status: 500, body: null},
      }),
      OPTS,
    );
    assert.equal(phased5xx.exitCode, 2);
    assert.match(phased5xx.lines[0], /phased release of 3\.2\.2 \(HTTP 500\)/);
  });

  it('exits 2 when the page has no released version and links.next exists', async () => {
    const page = [version('v3', '3.2.3', 'PREPARE_FOR_SUBMISSION')];
    const r = await runRequire(
      api({
        'appStoreVersions?': listOf(page, {next: 'https://example.test/next'}),
        'v3/appStoreVersionPhasedRelease': {
          status: 200,
          body: {data: {attributes: {phasedReleaseState: 'INACTIVE'}}},
        },
      }),
      OPTS,
    );
    assert.equal(r.exitCode, 2);
    assert.match(r.lines[0], /^the check did not run: the first page/);
    // The same page without links.next is judged normally.
    const last = await runRequire(
      api({
        'appStoreVersions?': listOf(page),
        'v3/appStoreVersionPhasedRelease': {
          status: 200,
          body: {data: {attributes: {phasedReleaseState: 'INACTIVE'}}},
        },
      }),
      OPTS,
    );
    assert.equal(last.exitCode, 0);
  });
});

describe('parseArgs', () => {
  it('defaults to status', () => {
    assert.deepEqual(parseArgs([]), {
      cmd: 'status',
      require: false,
      allowNone: false,
      error: null,
    });
  });

  it('reads status --require and the allow flag, in any order', () => {
    for (const argv of [
      ['status', '--require'],
      ['--require', 'status'],
      ['--require'],
    ]) {
      const a = parseArgs(argv);
      assert.equal(a.error, null, argv.join(' '));
      assert.equal(a.cmd, 'status');
      assert.equal(a.require, true);
    }
    const b = parseArgs(['status', '--require', '--allow-no-phased-release']);
    assert.equal(b.error, null);
    assert.equal(b.allowNone, true);
  });

  it('keeps pause, resume and complete as they were', () => {
    for (const cmd of ['pause', 'resume', 'complete']) {
      assert.equal(parseArgs([cmd]).error, null, cmd);
    }
  });

  it('rejects an unknown command, an unknown flag and an extra word', () => {
    assert.match(parseArgs(['launch']).error, /usage/);
    assert.match(
      parseArgs(['status', '--bogus']).error,
      /unknown option: --bogus/,
    );
    assert.match(
      parseArgs(['status', 'pause']).error,
      /unexpected argument: pause/,
    );
  });

  it('rejects the require flags on a command that changes state', () => {
    for (const cmd of ['pause', 'resume', 'complete']) {
      assert.match(
        parseArgs([cmd, '--require']).error,
        /belong to "status"/,
        cmd,
      );
    }
  });

  it('rejects the allow flag without --require', () => {
    assert.match(
      parseArgs(['status', '--allow-no-phased-release']).error,
      /only works together with --require/,
    );
  });
});

describe('the script', () => {
  // These runs exit before any network request.
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...env,
      },
    });

  it('exits 2 with a usage message on a bad option', () => {
    const r = run(['status', '--bogus']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown option: --bogus/);
  });

  it('exits 2 when --require has no App Store Connect key set', () => {
    const r = run(['status', '--require']);
    assert.equal(r.status, 2);
    assert.match(
      r.stderr,
      /the check did not run: APP_STORE_CONNECT_API_KEY_ID/,
    );
  });
});

// The real script, with a test key and a fake `fetch` (a preloaded module), so
// that no request leaves this machine. This is the glue around runRequire:
// the key file read, the token, and the exit code.
describe('the script with a fake API', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asc-gate-'));
  const home = join(dir, 'home');
  const emptyHome = join(dir, 'empty-home');
  const keyDir = join(home, '.appstoreconnect', 'private_keys');
  mkdirSync(keyDir, {recursive: true});
  mkdirSync(emptyHome, {recursive: true});
  const {privateKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  writeFileSync(
    join(keyDir, 'AuthKey_TESTKEY.p8'),
    privateKey.export({type: 'pkcs8', format: 'pem'}),
  );
  // The routes come from STUB_ROUTES: a path piece -> {status, text} or {reject: true}.
  const stub = join(dir, 'fake-fetch.mjs');
  writeFileSync(
    stub,
    `const routes = JSON.parse(process.env.STUB_ROUTES || '{}');
globalThis.fetch = async url => {
  for (const [needle, res] of Object.entries(routes)) {
    if (String(url).includes(needle)) {
      if (res.reject) throw new TypeError('fetch failed', {cause: {code: 'ECONNRESET'}});
      return {status: res.status, text: async () => res.text};
    }
  }
  throw new Error('unexpected request ' + url);
};
`,
  );

  after(() => rmSync(dir, {recursive: true, force: true}));

  const run = (args, {routes = {}, home: h = home} = {}) =>
    spawnSync(
      process.execPath,
      ['--import', pathToFileURL(stub).href, SCRIPT, ...args],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: h,
          APP_STORE_CONNECT_API_KEY_ID: 'TESTKEY',
          APP_STORE_CONNECT_ISSUER_ID: 'test-issuer',
          STUB_ROUTES: JSON.stringify(routes),
        },
      },
    );
  const json = body => ({status: 200, text: JSON.stringify(body)});
  const versionList = (data, links = {}) => json({data, links, meta: {}});
  const ver = (id, versionString, appStoreState) => ({
    id,
    attributes: {versionString, appStoreState},
  });

  it('exits 2 (not 1) when the key file is missing', () => {
    const r = run(['status', '--require'], {home: emptyHome});
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^the check did not run: ENOENT/);
  });

  it('exits 2 (not 1) when fetch rejects', () => {
    const r = run(['status', '--require'], {
      routes: {'appStoreVersions?': {reject: true}},
    });
    assert.equal(r.status, 2);
    assert.match(
      r.stderr,
      /^the check did not run: fetch failed \(ECONNRESET\)/,
    );
  });

  it('exits 2 (not 1) on a 5xx whose body is not JSON', () => {
    const r = run(['status', '--require'], {
      routes: {
        'appStoreVersions?': {status: 502, text: '<html>Bad Gateway</html>'},
      },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^the check did not run: /);
  });

  it('exits 1 for a waiting version with no phased release, and 0 with the allow flag', () => {
    const routes = {
      'appStoreVersions?': versionList([
        ver('v2', '3.2.2', 'PREPARE_FOR_SUBMISSION'),
        ver('v1', '3.2.1', 'READY_FOR_SALE'),
      ]),
      'v2/appStoreVersionPhasedRelease': json({data: null}),
    };
    const refused = run(['status', '--require'], {routes});
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /REFUSED: iOS 3\.2\.2/);
    const allowed = run(['status', '--require', '--allow-no-phased-release'], {
      routes,
    });
    assert.equal(allowed.status, 0);
    assert.match(allowed.stdout, /WARNING: iOS 3\.2\.2/);
  });

  it('exits 0 with a WARNING when no version waits and the allow flag is set', () => {
    const routes = {
      'appStoreVersions?': versionList([ver('v1', '3.2.1', 'READY_FOR_SALE')]),
    };
    assert.equal(run(['status', '--require'], {routes}).status, 1);
    const r = run(['status', '--require', '--allow-no-phased-release'], {
      routes,
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /WARNING: no App Store version is waiting/);
  });

  it('exits 2 when the page has no released version and links.next exists', () => {
    const r = run(['status', '--require'], {
      routes: {
        'appStoreVersions?': versionList(
          [ver('v3', '3.2.3', 'PREPARE_FOR_SUBMISSION')],
          {next: 'https://api.appstoreconnect.apple.com/v1/next'},
        ),
        'v3/appStoreVersionPhasedRelease': json({
          data: {attributes: {phasedReleaseState: 'INACTIVE'}},
        }),
      },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^the check did not run: the first page/);
  });
});
