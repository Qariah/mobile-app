#!/usr/bin/env node
// @ai
//
// scripts/__tests__/widget-fonts-npm-scripts.test.mjs
// ---------------------------------------------------
// The widget fonts are git-ignored copies (scripts/sync-widget-fonts.js).
// A build that does not make them has no Quran font in the Home Screen
// widgets (betas 3203, 3490 and 3506). The archive scripts copy them; this
// test checks that the local dev builds and EAS copy them too (TECH_DEBT #363).
//
// Run:  node --test scripts/__tests__/widget-fonts-npm-scripts.test.mjs

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

for (const name of ['android', 'ios', 'prebuild']) {
  test(`npm script "${name}" copies the widget fonts first`, () => {
    assert.match(pkg.scripts[name], /^node scripts\/sync-widget-fonts\.js && /);
  });
}

// EAS runs this npm hook after the install, before the Gradle or Xcode build.
// Not eas-build-pre-install: upstream's rewayahDataManifest.test.ts requires
// that hook to be the manifest check and nothing else.
test('npm script "eas-build-post-install" copies the widget fonts', () => {
  assert.equal(
    pkg.scripts['eas-build-post-install'],
    'node scripts/sync-widget-fonts.js',
  );
});
