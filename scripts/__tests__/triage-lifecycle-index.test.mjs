#!/usr/bin/env node
// @ai
//
// scripts/__tests__/triage-lifecycle-index.test.mjs
// --------------------------------------------------
// Node built-in test runner (node:test + node:assert) for the recency indexes
// of scripts/triage-lifecycle.mjs and for the guard in front of the two
// closing passes.
//
// Run:  node --test scripts/__tests__/triage-lifecycle-index.test.mjs
//
// TECH_DEBT #174: sentryIndex() asked Sentry for statsPeriod=90d. Sentry
// accepts only '', '24h' and '14d', so the request returned HTTP 400 and the
// code skipped it with no message.
//
// The closing passes (resolve-on-quiet, close-on-fix) read "not in the index"
// as "quiet". So an index that is empty or partial, because the token is
// missing or a request failed, would close every issue of that source. The
// adapters now return `{idx, complete}`, and a closing pass skips a source
// whose index is incomplete. These tests prove that no close happens:
//   1. recencyForClose() returns `skip: true`, with a fake fetch for each
//      failure (token missing, one slice with HTTP 500, Play with HTTP 403).
//   2. The real script runs with a fake `gh` on PATH and a local fake Sentry.
//      The fake `gh` records every call. A control run, where the index is
//      complete, shows that the run does close a quiet issue.
//
// No test calls Sentry, Google or GitHub. Importing the module is safe: its
// main() runs only when the file is the entry point.

/* global globalThis, Response -- Node globals: the tests stub fetch and build answers with Response */
import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  playIndex,
  recencyForClose,
  resetIndexCachesForTests,
  sentryIndex,
  SENTRY_STATS_PERIOD,
} from '../triage-lifecycle.mjs';

const SCRIPT = fileURLToPath(
  new URL('../triage-lifecycle.mjs', import.meta.url),
);
const VALID_SENTRY_PERIODS = new Set(['', '24h', '14d']);
const PLAY_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// A throwaway key: the Play token request is signed, and then goes to a fake.
const {privateKey} = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
  publicKeyEncoding: {type: 'spki', format: 'pem'},
});
const PLAY_SA_JSON = JSON.stringify({
  client_email: 'bot@example.iam.gserviceaccount.com',
  private_key: privateKey,
});

let sandbox;
before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'triage-lifecycle-index-'));
});
after(() => {
  rmSync(sandbox, {recursive: true, force: true});
});

const ENV_KEYS = [
  'SENTRY_READ_TOKEN',
  'GOOGLE_PLAY_SA_JSON',
  'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
];

// Run `fn` with a fake fetch, a set of environment values, and a captured
// console.warn. Restore every global afterward, also when `fn` throws.
// `respond(url)` returns a Response (or throws).
async function withFakes({env, respond}, fn) {
  const prevEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  const prevFetch = globalThis.fetch;
  const prevWarn = console.warn;
  const urls = [];
  const warnings = [];
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  console.warn = (...args) => warnings.push(args.join(' '));
  globalThis.fetch = async url => {
    urls.push(String(url));
    return respond(new URL(url));
  };
  resetIndexCachesForTests();
  try {
    const result = await fn();
    return {result, urls, warnings};
  } finally {
    globalThis.fetch = prevFetch;
    console.warn = prevWarn;
    for (const k of ENV_KEYS) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
    resetIndexCachesForTests();
  }
}

const SENTRY_ENV = {SENTRY_READ_TOKEN: 'test-fixture-token'};
const PLAY_ENV = {GOOGLE_PLAY_SA_JSON: PLAY_SA_JSON};

// One Sentry issue in the list. A request with an invalid statsPeriod gets
// HTTP 400, like the real endpoint.
function sentryOk(url) {
  if (!VALID_SENTRY_PERIODS.has(url.searchParams.get('statsPeriod'))) {
    return new Response('{"detail":"Invalid stats_period"}', {status: 400});
  }
  return Response.json([
    {
      shortId: 'QARIAHV2-1',
      id: '101',
      lastSeen: '2026-10-01T00:00:00Z',
      status: 'unresolved',
      userCount: 3,
    },
  ]);
}

// Answers the Play token request and the Play search the way Google does.
function play(searchResponse) {
  return url =>
    url.href === PLAY_TOKEN_URL
      ? Response.json({access_token: 'test-token'})
      : searchResponse();
}

const PLAY_OK = () =>
  Response.json({
    errorIssues: [
      {
        name: 'apps/com.example/errorIssues/abc123',
        lastErrorReportTime: '2026-10-01T00:00:00Z',
        lastAppVersion: {versionCode: '2027'},
        distinctUsers: '4',
      },
    ],
  });

// ---------------------------------------------------------------------------
describe('sentryIndex — valid statsPeriod, visible failures, completeness', () => {
  it('asks Sentry once per status, with a statsPeriod that Sentry accepts', async () => {
    const {result, urls, warnings} = await withFakes(
      {env: SENTRY_ENV, respond: sentryOk},
      sentryIndex,
    );
    assert.equal(urls.length, 3, 'one request for each status');
    for (const u of urls) {
      const period = new URL(u).searchParams.get('statsPeriod');
      assert.ok(VALID_SENTRY_PERIODS.has(period), `invalid statsPeriod: ${u}`);
    }
    assert.equal(new Set(urls).size, urls.length, 'no request is sent twice');
    assert.deepEqual(warnings, []);
    assert.equal(result.complete, true);
    assert.equal(result.idx['QARIAHV2-1'].id, '101');
  });

  it('uses a valid statsPeriod', () => {
    assert.ok(VALID_SENTRY_PERIODS.has(SENTRY_STATS_PERIOD));
  });

  it('warns with the HTTP status and is incomplete when a response is not OK', async () => {
    const {result, warnings} = await withFakes(
      {
        env: SENTRY_ENV,
        respond: () => new Response('{"detail":"nope"}', {status: 429}),
      },
      sentryIndex,
    );
    assert.deepEqual(result.idx, {});
    assert.equal(result.complete, false);
    assert.ok(warnings.length > 0, 'expected a warning');
    assert.ok(
      warnings.every(w => w.includes('HTTP 429')),
      `warnings must name the status: ${warnings.join(' | ')}`,
    );
  });

  it('is incomplete when one slice fails and the others work', async () => {
    const {result, warnings} = await withFakes(
      {
        env: SENTRY_ENV,
        respond: url =>
          url.searchParams.get('query') === 'is:resolved'
            ? new Response('boom', {status: 500})
            : sentryOk(url),
      },
      sentryIndex,
    );
    assert.equal(result.complete, false);
    assert.equal(result.idx['QARIAHV2-1'].id, '101', 'keeps what it read');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /HTTP 500/);
  });

  it('warns and is incomplete when the request throws', async () => {
    const {result, warnings} = await withFakes(
      {
        env: SENTRY_ENV,
        respond: () => {
          throw new Error('network down');
        },
      },
      sentryIndex,
    );
    assert.equal(result.complete, false);
    assert.ok(
      warnings.length > 0 && warnings.every(w => /network down/.test(w)),
    );
  });

  it('is incomplete, and sends no request, when the token is missing', async () => {
    const {result, urls, warnings} = await withFakes(
      {env: {}, respond: sentryOk},
      sentryIndex,
    );
    assert.equal(result.complete, false);
    assert.deepEqual(urls, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /SENTRY_READ_TOKEN unset/);
    // The text must be true: the passes close nothing for this source.
    assert.match(warnings[0], /close and reopen no Sentry issue/);
  });
});

describe('playIndex — completeness', () => {
  it('is complete and holds the issue when Play answers 200', async () => {
    const {result, warnings} = await withFakes(
      {env: PLAY_ENV, respond: play(PLAY_OK)},
      playIndex,
    );
    assert.equal(result.complete, true);
    assert.equal(result.idx.abc123.newestVersionCode, 2027);
    assert.deepEqual(warnings, []);
  });

  it('is incomplete, with the status in the warning, when Play answers 403', async () => {
    const {result, warnings} = await withFakes(
      {
        env: PLAY_ENV,
        respond: play(() => new Response('{"error":"denied"}', {status: 403})),
      },
      playIndex,
    );
    assert.equal(result.complete, false);
    assert.deepEqual(result.idx, {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /HTTP 403/);
  });

  it('is incomplete when the service account is missing', async () => {
    const {result, urls} = await withFakes(
      {
        env: {
          GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: join(sandbox, 'no-such-file.json'),
        },
        respond: play(PLAY_OK),
      },
      playIndex,
    );
    assert.equal(result.complete, false);
    assert.deepEqual(urls, []);
  });

  it('is incomplete when the request throws', async () => {
    const {result} = await withFakes(
      {
        env: PLAY_ENV,
        respond: play(() => {
          throw new Error('network down');
        }),
      },
      playIndex,
    );
    assert.equal(result.complete, false);
  });
});

// ---------------------------------------------------------------------------
describe('recencyForClose — an incomplete index never lets a pass close', () => {
  const sentryMarker = {source: 'sentry', id: 'QARIAHV2-1'};
  const unknownSentry = {source: 'sentry', id: 'QARIAHV2-NOPE'};
  const playMarker = {source: 'play-vitals', id: 'abc123'};

  it('skips every Sentry issue when the token is missing', async () => {
    const {result, warnings} = await withFakes(
      {env: {}, respond: sentryOk},
      async () => [
        await recencyForClose(sentryMarker),
        await recencyForClose(unknownSentry),
      ],
    );
    assert.deepEqual(result, [
      {rec: null, skip: true},
      {rec: null, skip: true},
    ]);
    // The unset-token line, plus ONE "incomplete" line for the whole run.
    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /sentry recency is incomplete/);
  });

  it('skips every Sentry issue, also a known one, when one slice fails', async () => {
    const {result, warnings} = await withFakes(
      {
        env: SENTRY_ENV,
        respond: url =>
          url.searchParams.get('query') === 'is:unresolved'
            ? new Response('boom', {status: 503})
            : sentryOk(url),
      },
      async () => [
        await recencyForClose(sentryMarker),
        await recencyForClose(unknownSentry),
      ],
    );
    assert.deepEqual(result, [
      {rec: null, skip: true},
      {rec: null, skip: true},
    ]);
    assert.equal(
      warnings.filter(w => /sentry recency is incomplete/.test(w)).length,
      1,
    );
  });

  it('skips every Play issue when Play answers 403', async () => {
    const {result, warnings} = await withFakes(
      {
        env: PLAY_ENV,
        respond: play(() => new Response('denied', {status: 403})),
      },
      async () => recencyForClose(playMarker),
    );
    assert.deepEqual(result, {rec: null, skip: true});
    assert.ok(warnings.some(w => /play-vitals recency is incomplete/.test(w)));
  });

  it('skips every Play issue when the service account is missing', async () => {
    const {result} = await withFakes(
      {
        env: {GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: join(sandbox, 'none.json')},
        respond: play(PLAY_OK),
      },
      async () => recencyForClose(playMarker),
    );
    assert.deepEqual(result, {rec: null, skip: true});
  });

  it('does not skip when the index is complete (control)', async () => {
    const {result, warnings} = await withFakes(
      {env: SENTRY_ENV, respond: sentryOk},
      async () => [
        await recencyForClose(sentryMarker),
        await recencyForClose(unknownSentry),
      ],
    );
    assert.equal(result[0].skip, false);
    assert.equal(result[0].rec.id, '101');
    // A complete index may say "quiet" about an id it does not hold.
    assert.deepEqual(result[1], {rec: null, skip: false});
    assert.deepEqual(warnings, []);
  });

  it('does not skip a source that has no index (PostHog)', async () => {
    const {result, urls} = await withFakes(
      {env: {}, respond: sentryOk},
      async () => recencyForClose({source: 'posthog', id: 'fault:x:3.1.8'}),
    );
    assert.deepEqual(result, {rec: null, skip: false});
    assert.deepEqual(urls, []);
  });
});

describe('triage-lifecycle.mjs — both closing passes use the guard', () => {
  const text = readFileSync(SCRIPT, 'utf8');
  const closing = text.slice(
    text.indexOf("if (RUN('resolve-on-quiet'))"),
    text.indexOf("if (RUN('reopen-on-recurrence'))"),
  );

  it('resolve-on-quiet and close-on-fix call recencyForClose and honour skip', () => {
    assert.ok(closing.length > 500, 'could not find the closing passes');
    assert.equal((closing.match(/await recencyForClose\(/g) || []).length, 2);
    assert.equal((closing.match(/if \(skip\) continue;/g) || []).length, 2);
  });

  it('the closing passes never call recencyFor directly', () => {
    assert.doesNotMatch(closing, /await recencyFor\(/);
  });
});

// ---------------------------------------------------------------------------
// End to end: run the real script with a fake `gh` first on PATH and a local
// fake Sentry. The fake `gh` records each call as one JSON line.
// ---------------------------------------------------------------------------
const OPEN_ISSUES = [
  {
    number: 9001,
    title: '[Sentry] quiet one',
    labels: [],
    body: '<!-- sentry-triage-id:QARIAHV2-ZZ -->',
  },
  {
    number: 9002,
    title: '[Sentry] fixed one',
    labels: [{name: 'fixed-in:2027'}],
    body: '<!-- sentry-triage-id:QARIAHV2-YY -->',
  },
  {
    number: 9003,
    title: '[Play Crash] fixed one',
    labels: [{name: 'fixed-in:2027'}],
    body: '<!-- play-vitals-id:abc123 -->',
  },
].map(i => ({
  ...i,
  state: 'OPEN',
  stateReason: '',
  createdAt: '2026-09-01T00:00:00Z',
  closedAt: null,
}));

const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'issue' && args[1] === 'list') {
  const state = args[args.indexOf('--state') + 1];
  process.stdout.write(state === 'open' ? process.env.FAKE_GH_OPEN : '[]');
}
`;

// Run the script. `sentry` is 'ok' (every list is empty), 'one-500' (the
// unresolved list answers HTTP 500) or 'no-token'. Resolves with the output
// and the numbers of the issues that the script closed.
async function runScript({sentry, passes}) {
  const dir = mkdtempSync(join(sandbox, 'run-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  const log = join(dir, 'gh.log');
  writeFileSync(log, '');

  const server = createServer((req, res) => {
    const query = new URL(req.url, 'http://127.0.0.1').searchParams.get(
      'query',
    );
    if (sentry === 'one-500' && query === 'is:unresolved') {
      res.writeHead(500).end('boom');
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'}).end('[]');
    }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    FAKE_GH_LOG: log,
    FAKE_GH_OPEN: JSON.stringify(OPEN_ISSUES),
    GH_REPO: 'example/example',
    SENTRY_REGION_HOST: `http://127.0.0.1:${server.address().port}`,
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: join(dir, 'no-such-file.json'),
  };
  delete env.GOOGLE_PLAY_SA_JSON;
  delete env.GITHUB_OUTPUT;
  if (sentry === 'no-token') delete env.SENTRY_READ_TOKEN;
  else env.SENTRY_READ_TOKEN = 'test-fixture-token';

  try {
    const out = await new Promise((ok, fail) => {
      const child = spawn(process.execPath, [SCRIPT, `--pass=${passes}`], {
        env,
      });
      let text = '';
      child.stdout.on('data', d => (text += d));
      child.stderr.on('data', d => (text += d));
      child.on('error', fail);
      child.on('close', code => ok({code, text}));
    });
    const calls = readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    // The script keeps its list of open issues for the whole run, so a second
    // pass can close an issue again. A Set names each issue once.
    const closed = [
      ...new Set(
        calls
          .filter(a => a[0] === 'issue' && a[1] === 'close')
          .map(a => Number(a[2])),
      ),
    ].sort();
    return {...out, closed};
  } finally {
    server.close();
  }
}

describe('triage-lifecycle.mjs end to end — an incomplete index closes nothing', () => {
  it('control: a complete Sentry index closes the quiet Sentry issues, never the Play issue', async () => {
    const r = await runScript({
      sentry: 'ok',
      passes: 'resolve-on-quiet,close-on-fix',
    });
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(r.closed, [9001, 9002]);
    assert.match(r.text, /play-vitals recency is incomplete/);
  });

  it('control: close-on-fix alone closes the fixed-in Sentry issue', async () => {
    const r = await runScript({sentry: 'ok', passes: 'close-on-fix'});
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(r.closed, [9002]);
  });

  for (const passes of ['resolve-on-quiet', 'close-on-fix']) {
    it(`${passes}: closes nothing when one Sentry list fails with HTTP 500`, async () => {
      const r = await runScript({sentry: 'one-500', passes});
      assert.equal(r.code, 0, r.text);
      assert.deepEqual(r.closed, []);
      assert.match(r.text, /HTTP 500/);
      assert.match(r.text, /sentry recency is incomplete/);
    });

    it(`${passes}: closes nothing when the Sentry token is missing`, async () => {
      const r = await runScript({sentry: 'no-token', passes});
      assert.equal(r.code, 0, r.text);
      assert.deepEqual(r.closed, []);
      assert.match(r.text, /SENTRY_READ_TOKEN unset/);
    });
  }
});
