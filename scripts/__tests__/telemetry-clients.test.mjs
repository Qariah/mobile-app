#!/usr/bin/env node
// @ai
//
// scripts/__tests__/telemetry-clients.test.mjs
// --------------------------------------------
// Tests for the shared script helpers added by TECH_DEBT #246:
//   scripts/lib/sentry-client.mjs
//   scripts/lib/posthog-client.mjs
//   the new parts of scripts/lib/triage-common.mjs (PALETTE, markersIn,
//   listLaneIssues, existingMarkers)
//
// No test calls Sentry, PostHog or GitHub. The two HTTP clients get a stub
// fetch. The GitHub helpers run in a child process with a stub `gh` program
// first on PATH.
//
// Run:  node --test scripts/__tests__/telemetry-clients.test.mjs

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
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  SENTRY_EU_HOST,
  createSentryClient,
  sentryConfig,
} from '../lib/sentry-client.mjs';
import {
  POSTHOG_DEFAULT_HOST,
  createPosthogClient,
  posthogConfig,
} from '../lib/posthog-client.mjs';
import {isQueryTimeout} from '../lib/posthog-window.mjs';
import {PALETTE, isShadowRun, markersIn} from '../lib/triage-common.mjs';

const TRIAGE_COMMON = pathToFileURL(
  fileURLToPath(new URL('../lib/triage-common.mjs', import.meta.url)),
).href;

// A stub fetch. `reply` is {status, body} or a function (url, init) => {status, body}.
function stubFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({url: String(url), init});
    const r = typeof reply === 'function' ? reply(String(url), init) : reply;
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
  fn.calls = calls;
  return fn;
}

describe('sentryConfig', () => {
  it('defaults to the qariah org, the qariahv2 project and the EU host', () => {
    const c = sentryConfig({env: {SENTRY_READ_TOKEN: 't'}});
    assert.deepEqual(c, {
      token: 't',
      org: 'qariah',
      project: 'qariahv2',
      host: 'https://de.sentry.io',
    });
    assert.equal(SENTRY_EU_HOST, 'https://de.sentry.io');
  });
  it('reads the overrides and removes a trailing slash from the host', () => {
    const c = sentryConfig({
      env: {
        SENTRY_READ_TOKEN: 't',
        SENTRY_ORG: 'acme',
        SENTRY_PROJECT: 'app',
        SENTRY_REGION_HOST: 'https://us.sentry.io/',
      },
    });
    assert.equal(c.org, 'acme');
    assert.equal(c.project, 'app');
    assert.equal(c.host, 'https://us.sentry.io');
  });
  it('takes the first token variable that is set', () => {
    const tokenVars = ['SENTRY_WRITE_TOKEN', 'SENTRY_READ_TOKEN'];
    assert.equal(
      sentryConfig({
        env: {SENTRY_READ_TOKEN: 'r', SENTRY_WRITE_TOKEN: 'w'},
        tokenVars,
      }).token,
      'w',
    );
    assert.equal(
      sentryConfig({
        env: {SENTRY_READ_TOKEN: 'r', SENTRY_WRITE_TOKEN: ''},
        tokenVars,
      }).token,
      'r',
    );
    assert.equal(sentryConfig({env: {}, tokenVars}).token, undefined);
  });
  it('keeps one default host per caller (daily-card uses https://sentry.io)', () => {
    assert.equal(
      sentryConfig({env: {}, defaultHost: 'https://sentry.io'}).host,
      'https://sentry.io',
    );
    assert.equal(sentryConfig({env: {}}).host, 'https://de.sentry.io');
  });
});

describe('createSentryClient', () => {
  it('sends a GET with the bearer token and returns the JSON', async () => {
    const f = stubFetch({status: 200, body: [{id: '1'}]});
    const sentry = createSentryClient({
      token: 'tok',
      host: 'https://h',
      fetchImpl: f,
    });
    assert.deepEqual(await sentry('/projects/o/p/issues/?limit=1'), [
      {id: '1'},
    ]);
    const {url, init} = f.calls[0];
    assert.equal(url, 'https://h/api/0/projects/o/p/issues/?limit=1');
    assert.equal(init.headers.Authorization, 'Bearer tok');
    assert.equal(init.headers['Content-Type'], undefined);
  });
  it('sends a PUT body as JSON', async () => {
    const f = stubFetch({status: 200, body: {ok: true}});
    const sentry = createSentryClient({
      token: 'tok',
      host: 'https://h',
      fetchImpl: f,
    });
    await sentry('/organizations/o/issues/9/', {
      method: 'PUT',
      body: JSON.stringify({status: 'resolved'}),
    });
    const {init} = f.calls[0];
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.body, '{"status":"resolved"}');
  });
  it('returns null for HTTP 204', async () => {
    const sentry = createSentryClient({
      token: 't',
      fetchImpl: stubFetch({status: 204, body: ''}),
    });
    assert.equal(await sentry('/x', {method: 'PUT', body: '{}'}), null);
  });
  it('rejects with the status, the path and the head of the body', async () => {
    const sentry = createSentryClient({
      token: 't',
      fetchImpl: stubFetch({status: 404, body: 'x'.repeat(500)}),
    });
    await assert.rejects(sentry('/a/b'), e => {
      assert.match(e.message, /^Sentry 404 on \/a\/b: x{300}$/);
      return true;
    });
  });
  it('names the method in the error of a write', async () => {
    const sentry = createSentryClient({
      token: 't',
      fetchImpl: stubFetch({status: 403, body: 'no'}),
    });
    await assert.rejects(
      sentry('/a', {method: 'PUT', body: '{}'}),
      /^Error: Sentry 403 PUT \/a: no$/,
    );
  });
});

describe('posthogConfig', () => {
  it('defaults to the US host and removes a trailing slash', () => {
    assert.equal(POSTHOG_DEFAULT_HOST, 'https://us.posthog.com');
    assert.deepEqual(
      posthogConfig({
        env: {POSTHOG_PERSONAL_API_TOKEN: 't', POSTHOG_PROJECT_ID: '9'},
      }),
      {token: 't', project: '9', host: 'https://us.posthog.com'},
    );
    assert.equal(
      posthogConfig({env: {POSTHOG_HOST: 'https://eu.posthog.com/'}}).host,
      'https://eu.posthog.com',
    );
  });
});

describe('createPosthogClient.hogql', () => {
  const make = (reply, extra = {}) => {
    const f = stubFetch(reply);
    const ph = createPosthogClient({
      token: 'tok',
      project: '42',
      host: 'https://ph',
      fetchImpl: f,
      ...extra,
    });
    return {f, ph};
  };

  it('posts the query and returns the rows', async () => {
    const {f, ph} = make({status: 200, body: {results: [[1], [2]]}});
    assert.deepEqual(await ph.hogql('SELECT 1'), [[1], [2]]);
    const {url, init} = f.calls[0];
    assert.equal(url, 'https://ph/api/projects/42/query/');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer tok');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), {
      query: {kind: 'HogQLQuery', query: 'SELECT 1'},
    });
    assert.equal(init.signal, undefined, 'no timeout unless asked');
  });

  it('returns [] when the answer has no results', async () => {
    const {ph} = make({status: 200, body: {}});
    assert.deepEqual(await ph.hogql('SELECT 1'), []);
  });

  it('destructures: the functions do not need `this`', async () => {
    const {ph} = make({status: 200, body: {results: [[3]]}});
    const {hogql} = ph;
    assert.deepEqual(await hogql('SELECT 3'), [[3]]);
  });

  it('adds a timeout signal when timeoutMs is set', async () => {
    const {f, ph} = make(
      {status: 200, body: {results: []}},
      {timeoutMs: 90_000},
    );
    await ph.hogql('SELECT 1');
    assert.ok(f.calls[0].init.signal instanceof AbortSignal);
  });

  it('rejects with "PostHog <status>: <body>", the text the retry code matches', async () => {
    const {ph} = make({
      status: 504,
      body: '{"detail":"Query has hit the max execution time"}',
    });
    await assert.rejects(ph.hogql('SELECT 1'), e => {
      assert.match(e.message, /^PostHog 504: \{"detail"/);
      assert.equal(isQueryTimeout(e), true);
      return true;
    });
  });

  describe('limit mode (rollout-engagement)', () => {
    it('appends the LIMIT to the query', async () => {
      const {f, ph} = make({status: 200, body: {results: [[1]]}});
      await ph.hogql('SELECT 1', {limit: 100_000});
      assert.equal(
        JSON.parse(f.calls[0].init.body).query.query,
        'SELECT 1\nLIMIT 100000',
      );
    });
    it('refuses a query that already carries a LIMIT, before any request', async () => {
      const {f, ph} = make({status: 200, body: {results: []}});
      await assert.rejects(
        ph.hogql('SELECT 1 LIMIT 5', {limit: 10}),
        /already carries a LIMIT/,
      );
      assert.equal(f.calls.length, 0);
    });
    it('throws when the result fills the limit, with the caller message', async () => {
      const rows = Array.from({length: 3}, (_, i) => [i]);
      const {ph} = make({status: 200, body: {results: rows}});
      await assert.rejects(
        ph.hogql('SELECT 1', {
          limit: 3,
          capMessage: (n, cap) => `full: ${n} of ${cap}`,
        }),
        /^Error: full: 3 of 3$/,
      );
    });
    it('returns the rows when the result is under the limit', async () => {
      const {ph} = make({status: 200, body: {results: [[1], [2]]}});
      assert.deepEqual(await ph.hogql('SELECT 1', {limit: 3}), [[1], [2]]);
    });
  });

  describe('cap mode (daily-card)', () => {
    it('leaves the query as it is and throws at the cap', async () => {
      const rows = Array.from({length: 5}, (_, i) => [i]);
      const {f, ph} = make({status: 200, body: {results: rows}});
      await assert.rejects(
        ph.hogql('SELECT 1 LIMIT 5', {
          cap: 5,
          capMessage: () => 'hit ROW_CAP — refusing to report truncated data',
        }),
        /^Error: hit ROW_CAP — refusing to report truncated data$/,
      );
      assert.equal(
        JSON.parse(f.calls[0].init.body).query.query,
        'SELECT 1 LIMIT 5',
      );
    });
    it('has a default message that says the result is truncated', async () => {
      const {ph} = make({status: 200, body: {results: [[1]]}});
      await assert.rejects(ph.hogql('SELECT 1', {cap: 1}), /truncated/);
    });
  });
});

describe('createPosthogClient.request', () => {
  it('sends a GET without a body or a content type', async () => {
    const f = stubFetch({status: 200, body: {id: 7}});
    const ph = createPosthogClient({
      token: 't',
      project: '9',
      host: 'https://ph',
      fetchImpl: f,
    });
    assert.deepEqual(await ph.request('/feature_flags/7/'), {id: 7});
    const {url, init} = f.calls[0];
    assert.equal(url, 'https://ph/api/projects/9/feature_flags/7/');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.headers['Content-Type'], undefined);
  });
  it('rejects with the status and the path', async () => {
    const f = stubFetch({status: 401, body: 'bad token'});
    const ph = createPosthogClient({token: 't', project: '9', fetchImpl: f});
    await assert.rejects(
      ph.request('/feature_flags/7/'),
      /^Error: PostHog 401 on \/feature_flags\/7\/: bad token$/,
    );
  });
});

describe('triage-common PALETTE', () => {
  it('has the colour of each label the three telemetry lanes create', () => {
    assert.deepEqual(
      Object.fromEntries(
        [
          'sentry',
          'user-impacting',
          'posthog',
          'investigate',
          'regression',
          'anr',
        ].map(k => [k, PALETTE[k]]),
      ),
      {
        sentry: '5319e7',
        'user-impacting': 'e11d21',
        posthog: '1d4aff',
        investigate: '0e8a16',
        regression: 'b60205',
        anr: 'd93f0b',
      },
    );
  });
  it('keeps play-store green for every lane', () => {
    assert.equal(PALETTE['play-store'], '3ddc84');
  });
});

describe('markersIn', () => {
  const issues = [
    {
      title: 'a',
      body: 'text\n<!-- play-vitals-id:abc123 -->\n<!-- play-vitals-sig:s1 -->',
    },
    {title: 'play-vitals-id:in-title', body: ''},
    {title: 'b', body: null},
    {title: 'c', body: '<!-- play-vitals-id:abc123 -->'},
  ];
  it('collects each id after the exact prefix, once', () => {
    assert.deepEqual([...markersIn(issues, 'play-vitals-id:')].sort(), [
      'abc123',
      'in-title',
    ]);
    assert.deepEqual([...markersIn(issues, 'play-vitals-sig:')], ['s1']);
  });
  it('treats regex characters in the prefix as plain text', () => {
    assert.equal(
      markersIn([{title: '', body: 'xa.b:1'}], 'a.b:').has('1'),
      true,
    );
    assert.equal(markersIn([{title: '', body: 'xaXb:1'}], 'a.b:').size, 0);
  });
  it('returns an empty set for no issues', () => {
    assert.equal(markersIn([], 'x:').size, 0);
  });
});

describe('triage-common with a stub gh program', () => {
  let dir;
  let log;
  before(() => {
    dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'triage-gh-test-'));
    log = join(dir, 'gh.log');
    // The stub answers `gh api -X <method> <path> [-f k=v]... [--input -]`.
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
const method = a[a.indexOf('-X') + 1];
const path = a[a.indexOf('-X') + 2];
const query = {};
for (let i = 0; i < a.length; i++) if (a[i] === '-f') { const [k, ...v] = a[i + 1].split('='); query[k] = v.join('='); }
const stdin = a.includes('--input') ? fs.readFileSync(0, 'utf8') : '';
fs.appendFileSync(process.env.STUB_GH_LOG, JSON.stringify({method, path, query, stdin}) + '\\n');
if (method === 'GET' && /\\/issues$/.test(path)) process.stdout.write(process.env.STUB_GH_ISSUES || '[]');
else if (method === 'POST' && /\\/issues$/.test(path)) process.stdout.write('{"number":7,"html_url":"https://github.example/7"}');
else process.stdout.write('{}');
`,
    );
    chmodSync(join(dir, 'gh'), 0o755);
  });
  after(() => rmSync(dir, {recursive: true, force: true}));

  // Run `body` as an ES module in a child process whose PATH holds the stub gh.
  function run(body, {issues = []} = {}) {
    writeFileSync(log, '');
    const r = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import * as tc from ${JSON.stringify(TRIAGE_COMMON)};\n${body}`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH}`,
          GH_REPO: 'example/repo',
          STUB_GH_LOG: log,
          STUB_GH_ISSUES: JSON.stringify(issues),
        },
      },
    );
    assert.equal(r.status, 0, r.stderr);
    const calls = readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
    return {out: r.stdout, calls};
  }

  const issue = (number, title, body, labels = ['sentry']) => ({
    number,
    title,
    body,
    state: 'open',
    html_url: `https://github.example/${number}`,
    labels: labels.map(name => ({name})),
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    closed_at: null,
  });

  it(
    'listLaneIssues lists by label, state=all, and makes the label first',
    {skip: isShadowRun() && 'shadow mode refuses label writes'},
    () => {
      const {out, calls} = run(
        `const rows = tc.listLaneIssues('sentry', {limit: 500});
       console.log(JSON.stringify(rows.map(r => r.number)));`,
        {issues: [issue(2, 't2', 'b2'), issue(1, 't1', 'b1')]},
      );
      assert.equal(out.trim(), '[2,1]');
      const list = calls.find(c => c.method === 'GET');
      assert.equal(list.path, 'repos/example/repo/issues');
      assert.equal(list.query.labels, 'sentry');
      assert.equal(list.query.state, 'all');
      const label = calls.find(c => c.path === 'repos/example/repo/labels');
      assert.deepEqual(JSON.parse(label.stdin), {
        name: 'sentry',
        color: '5319e7',
      });
    },
  );

  it('listLaneIssues leaves out pull requests', () => {
    const pr = {...issue(3, 'pr', 'b'), pull_request: {url: 'x'}};
    const {out} = run(
      `console.log(JSON.stringify(tc.listLaneIssues('sentry', {dryRun: true}).map(r => r.number)));`,
      {issues: [issue(1, 't', 'b'), pr]},
    );
    assert.equal(out.trim(), '[1]');
  });

  it('a dry run makes no label', () => {
    const {calls} = run(`tc.listLaneIssues('sentry', {dryRun: true});`);
    assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
  });

  it('existingMarkers reads the ids of one prefix', () => {
    const {out} = run(
      `console.log(JSON.stringify([...tc.existingMarkers('play-store', 'play-vitals-id:', {dryRun: true})].sort()));`,
      {
        issues: [
          issue(1, 't', '<!-- play-vitals-id:aa -->', ['play-store']),
          issue(
            2,
            't',
            '<!-- play-vitals-id:bb -->\n<!-- play-vitals-sig:cc -->',
            ['play-store'],
          ),
        ],
      },
    );
    assert.deepEqual(JSON.parse(out), ['aa', 'bb']);
  });

  it(
    'ensureLabels makes each label with its PALETTE colour; an unknown label is grey',
    {skip: isShadowRun() && 'shadow mode refuses label writes'},
    () => {
      const {calls} = run(
        `tc.ensureLabels(['anr', 'posthog', 'no-such-label'], false);`,
      );
      const made = calls
        .filter(c => c.method === 'POST' && c.path.endsWith('/labels'))
        .map(c => JSON.parse(c.stdin));
      assert.deepEqual(made, [
        {name: 'anr', color: 'd93f0b'},
        {name: 'posthog', color: '1d4aff'},
        {name: 'no-such-label', color: 'ededed'},
      ]);
    },
  );

  it(
    'createIssue sends the title, body and labels as one REST call and returns the URL',
    {skip: isShadowRun() && 'shadow mode refuses issue writes'},
    () => {
      const {out, calls} = run(
        `console.log(JSON.stringify(tc.createIssue({title: 'T', body: 'B', labels: ['sentry', 'bug']})));`,
      );
      assert.deepEqual(JSON.parse(out), {
        number: 7,
        url: 'https://github.example/7',
      });
      const post = calls.find(
        c => c.method === 'POST' && c.path.endsWith('/issues'),
      );
      assert.deepEqual(JSON.parse(post.stdin), {
        title: 'T',
        body: 'B',
        labels: ['sentry', 'bug'],
      });
    },
  );
});
