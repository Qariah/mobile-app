#!/usr/bin/env node
// @ai
//
// scripts/__tests__/testflight-public-beta.test.mjs
// -------------------------------------------------
// scripts/testflight-public-beta.mjs, the TestFlight step of the Promoter.
//
// 1. The group lookup. On 2026-11-08 (public beta 4419) App Store Connect refused
//    `/v1/apps/{id}/betaGroups?filter[name]=...` with HTTP 400, so `--apply` set
//    the What to Test text and then stopped before the group and Beta App Review.
// 2. The key settings. On 2026-11-12 (public beta 4487) the script read the
//    App Store Connect key names from the environment only. The scheduled shell
//    has none, and the publish guard admits the `--apply` step only as the plain
//    `node scripts/testflight-public-beta.mjs ...` command. So the build stayed
//    out of the Public Beta group (#865). The script now finds the settings
//    itself: the environment, then `.env.local` of its checkout, then of the
//    main checkout.
//
// Run:  node --test scripts/__tests__/testflight-public-beta.test.mjs
//
// The end-to-end tests copy the script into temporary git repos and replace
// `fetch` with a stub, so no test reads a real `.env.local` or calls Apple.

import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {betaGroupPath, trainClosed} from '../testflight-public-beta.mjs';
import {
  ASC_KEY_VARS,
  ascJwtFromSettings,
  ascKeySettings,
  envLocalFiles,
  readEnvText,
} from '../lib/asc-client.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const NAMES = Object.values(ASC_KEY_VARS);

describe('betaGroupPath', () => {
  it('uses the top-level betaGroups endpoint with an app filter', () => {
    const p = betaGroupPath('1234567890', 'Public Beta');
    assert.ok(p.startsWith('/v1/betaGroups?'), p);
    assert.match(p, /filter\[app\]=1234567890/);
    assert.match(p, /filter\[name\]=Public%20Beta/);
  });
  it('never uses the app relationship path that answers HTTP 400', () => {
    assert.doesNotMatch(betaGroupPath('1', 'Public Beta'), /\/v1\/apps\//);
  });
});

describe('trainClosed', () => {
  it('reads an approved version as closed and a version in review as open', () => {
    assert.equal(trainClosed('READY_FOR_SALE'), true);
    assert.equal(trainClosed('WAITING_FOR_REVIEW'), false);
    assert.equal(trainClosed(undefined), false);
  });
});

describe('readEnvText', () => {
  it('reads the lines that `set -a && . .env.local` reads', () => {
    const text = [
      '# a comment',
      'APP_STORE_CONNECT_API_KEY_ID=KEY1',
      'export APP_STORE_CONNECT_ISSUER_ID="issuer-1" # the team',
      'OTHER_SECRET=not-wanted',
      '',
    ].join('\n');
    assert.deepEqual(readEnvText(text, NAMES), {
      APP_STORE_CONNECT_API_KEY_ID: 'KEY1',
      APP_STORE_CONNECT_ISSUER_ID: 'issuer-1',
    });
  });
  it('keeps a # inside quotes, and the last line for a name wins', () => {
    const text =
      "APP_STORE_CONNECT_API_KEY_ID=OLD\nAPP_STORE_CONNECT_API_KEY_ID='a # b'\n";
    assert.equal(
      readEnvText(text, NAMES).APP_STORE_CONNECT_API_KEY_ID,
      'a # b',
    );
  });
  it('reads an empty value as no value', () => {
    const text =
      'APP_STORE_CONNECT_API_KEY_ID=KEY1\nAPP_STORE_CONNECT_API_KEY_ID=\n';
    assert.deepEqual(readEnvText(text, NAMES), {});
  });
});

describe('ascKeySettings', () => {
  const files = {
    '/own/.env.local': 'APP_STORE_CONNECT_API_KEY_ID=OWNKEY\n',
    '/main/.env.local':
      'APP_STORE_CONNECT_API_KEY_ID=MAINKEY\nAPP_STORE_CONNECT_ISSUER_ID=main-issuer\n',
  };
  const read = p => {
    if (!(p in files)) throw new Error(`ENOENT ${p}`);
    return files[p];
  };

  it('takes each name from the environment first', () => {
    const s = ascKeySettings({
      env: {
        APP_STORE_CONNECT_API_KEY_ID: 'ENVKEY',
        APP_STORE_CONNECT_ISSUER_ID: 'env-issuer',
      },
      files: ['/own/.env.local', '/main/.env.local'],
      read,
    });
    assert.equal(s.keyId, 'ENVKEY');
    assert.equal(s.issuer, 'env-issuer');
    assert.equal(s.from.APP_STORE_CONNECT_API_KEY_ID, 'env');
  });
  it('then from the first .env.local that has the name', () => {
    const s = ascKeySettings({
      env: {},
      files: ['/own/.env.local', '/main/.env.local'],
      read,
    });
    assert.equal(s.keyId, 'OWNKEY');
    assert.equal(s.issuer, 'main-issuer');
    assert.equal(s.from.APP_STORE_CONNECT_API_KEY_ID, '/own/.env.local');
    assert.equal(s.from.APP_STORE_CONNECT_ISSUER_ID, '/main/.env.local');
  });
  it('skips a missing file (a worktree has no .env.local)', () => {
    const s = ascKeySettings({
      env: {},
      files: ['/wt/.env.local', '/main/.env.local'],
      read,
    });
    assert.equal(s.keyId, 'MAINKEY');
  });
  it('names the source of a setting, never its value', () => {
    const s = ascKeySettings({env: {}, files: ['/main/.env.local'], read});
    assert.doesNotMatch(JSON.stringify(s.from), /MAINKEY|main-issuer/);
  });
});

describe('ascJwtFromSettings', () => {
  it('names the places it looked, and no value, when a name is missing', () => {
    assert.throws(
      () =>
        ascJwtFromSettings({
          keyId: 'SECRETKEY',
          issuer: undefined,
          files: ['/wt/.env.local', '/main/.env.local'],
        }),
      e => {
        assert.match(e.message, /APP_STORE_CONNECT_ISSUER_ID/);
        assert.match(e.message, /\/wt\/\.env\.local, \/main\/\.env\.local/);
        assert.doesNotMatch(e.message, /SECRETKEY/);
        return true;
      },
    );
  });
});

// ---- end to end: the script in temporary git repos -------------------------------
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args],
    {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']},
  );

describe('the script finds its key settings itself (#865)', () => {
  let root;
  let main;
  let wt;
  let home;
  let stub;

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'tf-public-beta-')));
    main = join(root, 'main');
    wt = join(root, 'wt');
    home = join(root, 'home');
    for (const f of [
      'scripts/testflight-public-beta.mjs',
      'scripts/lib/asc-client.mjs',
      'scripts/lib/app-ids.mjs',
      'config/branding.js',
    ]) {
      mkdirSync(dirname(join(main, f)), {recursive: true});
      copyFileSync(join(REPO, f), join(main, f));
    }
    git(main, 'init', '-q');
    git(main, 'add', '-A');
    git(main, 'commit', '-qm', 'init');
    git(main, 'worktree', 'add', '-q', '--detach', wt);
    // .env.local is not in git: the worktree has no copy, like a Promoter tree.
    writeFileSync(
      join(main, '.env.local'),
      'APP_STORE_CONNECT_API_KEY_ID=FILEKEY1\nAPP_STORE_CONNECT_ISSUER_ID=file-issuer\n',
    );
    const keys = join(home, '.appstoreconnect', 'private_keys');
    mkdirSync(keys, {recursive: true});
    for (const id of ['FILEKEY1', 'ENVKEY2']) {
      const {privateKey} = generateKeyPairSync('ec', {namedCurve: 'P-256'});
      writeFileSync(
        join(keys, `AuthKey_${id}.p8`),
        privateKey.export({type: 'pkcs8', format: 'pem'}),
      );
    }
    // The stub ends the run at the first API call, and says which key signed it.
    stub = join(root, 'stub-fetch.mjs');
    writeFileSync(
      stub,
      `globalThis.fetch = async (url, o = {}) => {
  const [h, p] = String(o.headers?.Authorization || '').replace('Bearer ', '').split('.');
  const kid = JSON.parse(Buffer.from(h, 'base64url')).kid;
  const iss = JSON.parse(Buffer.from(p, 'base64url')).iss;
  throw new Error('stub fetch kid=' + kid + ' iss=' + iss);
};\n`,
    );
  });
  after(() => rmSync(root, {recursive: true, force: true}));

  const run = (tree, env = {}) => {
    const clean = {...process.env, HOME: home};
    for (const n of NAMES) delete clean[n];
    return spawnSync(
      process.execPath,
      [
        '--import',
        stub,
        join(tree, 'scripts', 'testflight-public-beta.mjs'),
        '--build=4487',
      ],
      {cwd: tree, env: {...clean, ...env}, encoding: 'utf8'},
    );
  };

  it('a worktree with no .env.local and no variables uses the main checkout file', () => {
    const r = run(wt);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /stub fetch kid=FILEKEY1 iss=file-issuer/);
  });
  it('a variable in the environment wins over .env.local', () => {
    const r = run(main, {APP_STORE_CONNECT_API_KEY_ID: 'ENVKEY2'});
    assert.match(r.stderr, /stub fetch kid=ENVKEY2 iss=file-issuer/);
  });
  it('no variable and no .env.local: a clear error that names the files', () => {
    rmSync(join(main, '.env.local'));
    const r = run(wt);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No App Store Connect key/);
    assert.match(r.stderr, /main\/\.env\.local/);
    assert.doesNotMatch(r.stderr, /stub fetch/);
  });
  it('envLocalFiles lists the worktree first, then the main checkout', () => {
    assert.deepEqual(envLocalFiles(join(wt, 'scripts', 'lib')), [
      join(wt, '.env.local'),
      join(main, '.env.local'),
    ]);
  });
});
