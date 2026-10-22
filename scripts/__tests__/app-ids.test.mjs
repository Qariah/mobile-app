#!/usr/bin/env node
// @ai
//
// scripts/__tests__/app-ids.test.mjs
// ----------------------------------
// The scripts read the Android package and the App Store id from
// config/branding.js (TECH_DEBT #246), and no .mjs script writes them again.
//
// Run:  node --test scripts/__tests__/app-ids.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

describe('app ids come from config/branding.js', () => {
  it('exports the Android package and the App Store id of the branding config', async () => {
    const {default: branding} = await import('../../config/branding.js');
    const ids = await import('../lib/app-ids.mjs');
    assert.equal(ids.ANDROID_PACKAGE_NAME, branding.bundleId.android);
    assert.equal(ids.IOS_BUNDLE_ID, branding.bundleId.ios);
    assert.equal(ids.APP_SLUG, branding.appSlug);
    assert.equal(ids.APP_STORE_ID, branding.appStoreId);
    assert.match(
      ids.ANDROID_PACKAGE_NAME,
      /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
    );
    assert.match(ids.APP_STORE_ID, /^\d+$/);
  });

  it('no .mjs script writes the app package or the App Store id as a literal', () => {
    const SCRIPTS = fileURLToPath(new URL('..', import.meta.url));
    const walk = dir =>
      readdirSync(dir, {withFileTypes: true}).flatMap(e => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
        return e.name.endsWith('.mjs') ? [p] : [];
      });
    const lit = /['"`]com\.qariah\.app['"`]|['"`]1594917787['"`]/;
    const isComment = line => /^\s*(\/\/|\/?\*)/.test(line);
    const hits = walk(SCRIPTS)
      .filter(f => !f.endsWith('lib/app-ids.mjs'))
      .filter(f =>
        readFileSync(f, 'utf8')
          .split('\n')
          .some(line => !isComment(line) && lit.test(line)),
      )
      .map(f => f.slice(SCRIPTS.length));
    assert.deepEqual(hits, []);
  });
});
