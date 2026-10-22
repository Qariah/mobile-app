#!/usr/bin/env node
// @ai
//
// scripts/__tests__/google-play-auth.test.mjs
// -------------------------------------------
// Tests for scripts/lib/google-play-auth.mjs (TECH_DEBT #234). No test calls
// Google: every token request goes to a stub fetch, and the key is a throwaway
// RSA key made in memory.
//
// Run:  node --test scripts/__tests__/google-play-auth.test.mjs

import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createVerify, generateKeyPairSync} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  PLAY_SCOPES,
  PlayAuthError,
  TOKEN_URL,
  getPlayAccessToken,
  loadServiceAccount,
  main,
  mintPlayToken,
  resolveScope,
  serviceAccountPath,
} from '../lib/google-play-auth.mjs';

const LIB = fileURLToPath(
  new URL('../lib/google-play-auth.mjs', import.meta.url),
);

const {privateKey, publicKey} = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
  publicKeyEncoding: {type: 'spki', format: 'pem'},
});
const SA = {
  client_email: 'bot@example.iam.gserviceaccount.com',
  private_key: privateKey,
};

let dir;
before(() => {
  dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'play-auth-test-'));
});
after(() => rmSync(dir, {recursive: true, force: true}));

const saFile = (name, content) => {
  const p = join(dir, name);
  writeFileSync(
    p,
    typeof content === 'string' ? content : JSON.stringify(content),
  );
  return p;
};

// A stub fetch that records its call and answers with `status` + `body`.
function stubFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({url, init});
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {ok: status >= 200 && status < 300, status, text: async () => text};
  };
  fn.calls = calls;
  return fn;
}

const decode = part =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('resolveScope', () => {
  it('maps the two aliases to the Google scope URLs', () => {
    assert.equal(
      resolveScope('publisher'),
      'https://www.googleapis.com/auth/androidpublisher',
    );
    assert.equal(
      resolveScope('reporting'),
      'https://www.googleapis.com/auth/playdeveloperreporting',
    );
  });
  it('passes a full Google scope URL through', () => {
    assert.equal(
      resolveScope('https://www.googleapis.com/auth/androidpublisher'),
      PLAY_SCOPES.publisher,
    );
  });
  it('refuses an unknown alias and a foreign URL, with code bad-scope', () => {
    for (const bad of [
      'writer',
      '',
      undefined,
      'https://evil.example/auth/x',
    ]) {
      assert.throws(
        () => resolveScope(bad),
        e => e instanceof PlayAuthError && e.code === 'bad-scope',
      );
    }
  });
});

describe('serviceAccountPath', () => {
  it('prefers the explicit file, then the env path, then the default', () => {
    const env = {GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '/from/env.json'};
    assert.equal(
      serviceAccountPath({saFile: '/explicit.json', env}),
      '/explicit.json',
    );
    assert.equal(serviceAccountPath({env}), '/from/env.json');
    assert.equal(
      serviceAccountPath({env: {}}),
      join(homedir(), '.android', 'play-service-account.json'),
    );
  });
  it('expands a leading ~ to the home directory', () => {
    assert.equal(
      serviceAccountPath({
        env: {GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '~/keys/sa.json'},
      }),
      join(homedir(), 'keys', 'sa.json'),
    );
  });
});

describe('loadServiceAccount', () => {
  it('reads the inline JSON from GOOGLE_PLAY_SA_JSON', () => {
    const sa = loadServiceAccount({
      env: {GOOGLE_PLAY_SA_JSON: JSON.stringify(SA)},
    });
    assert.equal(sa.client_email, SA.client_email);
  });
  it('reads a file named by GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', () => {
    const p = saFile('env-path.json', SA);
    const sa = loadServiceAccount({env: {GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: p}});
    assert.equal(sa.client_email, SA.client_email);
  });
  it('lets the inline JSON win over the env path', () => {
    const p = saFile('other.json', {...SA, client_email: 'file@example.com'});
    const sa = loadServiceAccount({
      env: {
        GOOGLE_PLAY_SA_JSON: JSON.stringify(SA),
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: p,
      },
    });
    assert.equal(sa.client_email, SA.client_email);
  });
  it('treats a blank GOOGLE_PLAY_SA_JSON as not set', () => {
    const p = saFile('blank.json', SA);
    const sa = loadServiceAccount({
      env: {GOOGLE_PLAY_SA_JSON: '  \n', GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: p},
    });
    assert.equal(sa.client_email, SA.client_email);
  });
  it('lets an explicit saFile win over everything in the env', () => {
    const p = saFile('explicit.json', {
      ...SA,
      client_email: 'explicit@example.com',
    });
    const sa = loadServiceAccount({
      saFile: p,
      env: {GOOGLE_PLAY_SA_JSON: JSON.stringify(SA)},
    });
    assert.equal(sa.client_email, 'explicit@example.com');
  });
  it('says no-service-account when the file is missing, and names the path', () => {
    const p = join(dir, 'no-such.json');
    assert.throws(
      () => loadServiceAccount({saFile: p, env: {}}),
      e =>
        e.code === 'no-service-account' &&
        e.message.includes(p) &&
        /^No service account/.test(e.message),
    );
  });
  it('says invalid-service-account for bad JSON and never echoes the inline value', () => {
    const secret = 'PRIVATE-KEY-MATERIAL-{{{';
    assert.throws(
      () => loadServiceAccount({env: {GOOGLE_PLAY_SA_JSON: secret}}),
      e => e.code === 'invalid-service-account' && !e.message.includes(secret),
    );
    const p = saFile('garbage.json', 'not json at all');
    assert.throws(
      () => loadServiceAccount({saFile: p, env: {}}),
      e => e.code === 'invalid-service-account',
    );
  });
  it('requires client_email and private_key', () => {
    assert.throws(
      () =>
        loadServiceAccount({
          env: {GOOGLE_PLAY_SA_JSON: JSON.stringify({client_email: 'x'})},
        }),
      e =>
        e.code === 'invalid-service-account' &&
        /client_email and private_key/.test(e.message),
    );
  });
});

describe('mintPlayToken', () => {
  it('sends a signed JWT-bearer request and returns the access token', async () => {
    const f = stubFetch(200, {access_token: 'tok-123', expires_in: 3600});
    const nowMs = 1_800_000_000_000;
    const tok = await mintPlayToken(SA, {
      scope: 'reporting',
      fetchImpl: f,
      nowMs,
    });
    assert.equal(tok, 'tok-123');

    assert.equal(f.calls.length, 1);
    const {url, init} = f.calls[0];
    assert.equal(url, TOKEN_URL);
    assert.equal(init.method, 'POST');
    assert.equal(
      init.headers['Content-Type'],
      'application/x-www-form-urlencoded',
    );
    const form = new URLSearchParams(String(init.body));
    assert.equal(
      form.get('grant_type'),
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );

    const [h, p, s] = form.get('assertion').split('.');
    assert.deepEqual(decode(h), {alg: 'RS256', typ: 'JWT'});
    assert.deepEqual(decode(p), {
      iss: SA.client_email,
      scope: PLAY_SCOPES.reporting,
      aud: TOKEN_URL,
      exp: 1_800_000_000 + 3600,
      iat: 1_800_000_000,
    });
    const ok = createVerify('RSA-SHA256')
      .update(`${h}.${p}`)
      .verify(publicKey, s, 'base64url');
    assert.equal(ok, true, 'the signature verifies with the public key');
  });

  it('uses the publisher scope and a custom ttl when asked', async () => {
    const f = stubFetch(200, {access_token: 't'});
    await mintPlayToken(SA, {
      scope: 'publisher',
      ttlSeconds: 600,
      fetchImpl: f,
      nowMs: 5_000_000,
    });
    const claim = decode(
      new URLSearchParams(String(f.calls[0].init.body))
        .get('assertion')
        .split('.')[1],
    );
    assert.equal(claim.scope, PLAY_SCOPES.publisher);
    assert.equal(claim.exp - claim.iat, 600);
  });

  it('passes an abort signal to fetch', async () => {
    const f = stubFetch(200, {access_token: 't'});
    const signal = AbortSignal.timeout(5000);
    await mintPlayToken(SA, {scope: 'publisher', fetchImpl: f, signal});
    assert.equal(f.calls[0].init.signal, signal);
  });

  it('throws token-mint-failed with the status and a non-secret detail', async () => {
    const f = stubFetch(400, {
      error: 'invalid_grant',
      error_description: 'Invalid JWT Signature.',
    });
    await assert.rejects(
      mintPlayToken(SA, {scope: 'reporting', fetchImpl: f}),
      e => {
        assert.ok(e instanceof PlayAuthError);
        assert.equal(e.code, 'token-mint-failed');
        assert.equal(e.status, 400);
        assert.equal(e.detail, 'invalid_grant Invalid JWT Signature.');
        assert.match(
          e.message,
          /Play token mint failed \(invalid_grant Invalid JWT Signature\.\)/,
        );
        assert.match(e.bodyText, /invalid_grant/);
        assert.equal(e.message.includes(SA.private_key), false);
        return true;
      },
    );
  });

  it('falls back to HTTP <status> when the body is not JSON', async () => {
    const f = stubFetch(502, '<html>bad gateway</html>');
    await assert.rejects(
      mintPlayToken(SA, {scope: 'reporting', fetchImpl: f}),
      e =>
        e.code === 'token-mint-failed' &&
        e.status === 502 &&
        e.detail === 'HTTP 502',
    );
  });

  it('fails when a 200 answer carries no access_token', async () => {
    const f = stubFetch(200, {token_type: 'Bearer'});
    await assert.rejects(
      mintPlayToken(SA, {scope: 'reporting', fetchImpl: f}),
      e => e.code === 'token-mint-failed' && e.status === 200,
    );
  });

  it('lets a network failure through unchanged', async () => {
    const boom = new TypeError('fetch failed');
    const f = async () => {
      throw boom;
    };
    await assert.rejects(
      mintPlayToken(SA, {scope: 'reporting', fetchImpl: f}),
      e => e === boom,
    );
  });

  it('rejects a bad scope before it signs or calls fetch', async () => {
    const f = stubFetch(200, {access_token: 't'});
    await assert.rejects(
      mintPlayToken(SA, {scope: 'nope', fetchImpl: f}),
      e => e.code === 'bad-scope',
    );
    assert.equal(f.calls.length, 0);
  });
});

describe('getPlayAccessToken', () => {
  it('loads the key from a file and mints', async () => {
    const f = stubFetch(200, {access_token: 'from-file'});
    const p = saFile('get.json', SA);
    assert.equal(
      await getPlayAccessToken({
        scope: 'publisher',
        saFile: p,
        env: {},
        fetchImpl: f,
      }),
      'from-file',
    );
  });
  it('loads the key from the inline env and mints', async () => {
    const f = stubFetch(200, {access_token: 'from-inline'});
    const env = {GOOGLE_PLAY_SA_JSON: JSON.stringify(SA)};
    assert.equal(
      await getPlayAccessToken({scope: 'reporting', env, fetchImpl: f}),
      'from-inline',
    );
  });
  it('uses a service-account object you pass in', async () => {
    const f = stubFetch(200, {access_token: 'from-object'});
    assert.equal(
      await getPlayAccessToken({
        scope: 'reporting',
        sa: SA,
        env: {},
        fetchImpl: f,
      }),
      'from-object',
    );
  });
  it('fails on a bad scope before it reads any file', async () => {
    await assert.rejects(
      getPlayAccessToken({
        scope: 'x',
        saFile: join(dir, 'never-read.json'),
        env: {},
      }),
      e => e.code === 'bad-scope',
    );
  });
});

describe('CLI main()', () => {
  const sink = () => {
    const chunks = [];
    return {write: s => chunks.push(s), text: () => chunks.join('')};
  };
  const withFetch = async (stub, fn) => {
    const real = globalThis.fetch;
    globalThis.fetch = stub;
    try {
      return await fn();
    } finally {
      globalThis.fetch = real;
    }
  };

  it('prints only the token on stdout, and nothing on stderr', async () => {
    const out = sink();
    const err = sink();
    const p = saFile('cli.json', SA);
    const code = await withFetch(
      stubFetch(200, {access_token: 'cli-token'}),
      () =>
        main(['--print-token', '--scope=publisher', `--sa-file=${p}`], {
          stdout: out,
          stderr: err,
        }),
    );
    assert.equal(code, 0);
    assert.equal(out.text(), 'cli-token\n');
    assert.equal(err.text(), '');
  });

  it('exits 1, prints nothing on stdout, and explains on stderr when Google refuses', async () => {
    const out = sink();
    const err = sink();
    const p = saFile('cli2.json', SA);
    const code = await withFetch(
      stubFetch(401, {error: 'unauthorized_client'}),
      () =>
        main(['--print-token', '--scope=reporting', `--sa-file=${p}`], {
          stdout: out,
          stderr: err,
        }),
    );
    assert.equal(code, 1);
    assert.equal(out.text(), '');
    assert.match(
      err.text(),
      /^google-play-auth: Play token mint failed \(unauthorized_client\)\n$/,
    );
  });

  it('exits 2 with usage when --print-token or --scope is missing, or the scope is unknown', async () => {
    for (const argv of [
      [],
      ['--scope=publisher'],
      ['--print-token'],
      ['--print-token', '--scope=nope'],
    ]) {
      const out = sink();
      const err = sink();
      const code = await main(argv, {stdout: out, stderr: err});
      assert.equal(code, 2, JSON.stringify(argv));
      assert.equal(out.text(), '');
      assert.ok(err.text().length > 0);
    }
  });

  it('prints the usage and exits 0 for --help', async () => {
    const out = sink();
    assert.equal(await main(['--help'], {stdout: out, stderr: sink()}), 0);
    assert.match(out.text(), /--print-token --scope=publisher\|reporting/);
  });

  it('runs as a program: exit 1 and an empty stdout when the key file is missing', () => {
    const r = spawnSync(
      process.execPath,
      [
        LIB,
        '--print-token',
        '--scope=publisher',
        `--sa-file=${join(dir, 'absent.json')}`,
      ],
      {encoding: 'utf8', env: {...process.env, GOOGLE_PLAY_SA_JSON: ''}},
    );
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^google-play-auth: No service account/);
  });

  it('runs as a program: --help exits 0', () => {
    const r = spawnSync(process.execPath, [LIB, '--help'], {encoding: 'utf8'});
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^usage: node scripts\/lib\/google-play-auth\.mjs/);
  });
});
