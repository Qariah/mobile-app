// @ai
//
// Tests for scripts/lib/ios-url-scheme.mjs (TECH_DEBT #342): the URL scheme
// rewrite of a --beta archive and its check. The file tests run on copies of
// the committed ios/ files in a temp folder.
//
// Run:  node --test scripts/__tests__/ios-url-scheme.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {APP_URL_SCHEME, IOS_BUNDLE_ID} from '../lib/app-ids.mjs';
import {
  FILES,
  OAUTH_CALLBACK_SCHEME,
  applyUrlScheme,
  archiveSchemes,
  checkUrlScheme,
  configSchemeProblems,
  describeUrlSchemes,
  mapUrlSchemes,
  readShareSwift,
  readUrlSchemes,
  shareKeyFor,
  writeQuotedBuildSetting,
} from '../lib/ios-url-scheme.mjs';
import {readBuildSetting, readStringKey} from '../lib/ios-app-group.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PROD = IOS_BUNDLE_ID;
const BETA = `${PROD}.beta`;
const PROD_SCHEMES = archiveSchemes(PROD, PROD, APP_URL_SCHEME);
const BETA_SCHEMES = archiveSchemes(BETA, PROD, APP_URL_SCHEME);

/** A temp copy of every app-link file of the committed tree. */
function copyTree() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qariah-url-scheme-'));
  for (const rel of Object.values(FILES)) {
    mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true});
    cpSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  return dir;
}

function readRel(dir, rel) {
  return readFileSync(path.join(dir, rel), 'utf8');
}

function withTree(fn) {
  const dir = copyTree();
  try {
    fn(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

/** The lines of `after` that are not in `before` (a cheap line diff). */
function addedLines(before, after) {
  const old = new Set(before.split('\n'));
  return after.split('\n').filter(line => !old.has(line));
}

describe('archiveSchemes', () => {
  it('keeps the production scheme for production and the public beta', () => {
    assert.deepEqual(PROD_SCHEMES, {
      scheme: 'qariah',
      devClientScheme: 'exp+qariah',
      productionScheme: 'qariah',
      productionDevClientScheme: 'exp+qariah',
    });
  });

  it('gives the internal beta its own scheme', () => {
    assert.equal(BETA_SCHEMES.scheme, 'qariah-beta');
    assert.equal(BETA_SCHEMES.devClientScheme, 'exp+qariah-beta');
    assert.equal(shareKeyFor(BETA_SCHEMES.scheme), 'qariah-betaShareKey');
  });
});

describe('the committed tree (production)', () => {
  it('passes the production check, with no OAuth callback URL type', () => {
    assert.deepEqual(checkUrlScheme(ROOT, PROD_SCHEMES), []);
    const types = readUrlSchemes(readRel(ROOT, FILES.appInfoPlist));
    assert.deepEqual(types, ['qariah', 'exp+qariah']);
    assert.equal(types.includes(OAUTH_CALLBACK_SCHEME), false);
  });

  it('fails the beta check', () => {
    const problems = checkUrlScheme(ROOT, BETA_SCHEMES);
    assert.ok(problems.some(p => p.includes('have no qariah-beta')));
    assert.ok(problems.some(p => p.includes('still have qariah ')));
    assert.ok(problems.some(p => p.includes('shareProtocol is qariah,')));
    assert.ok(problems.some(p => p.includes('BAYAAN_URL_SCHEME')));
  });

  it('a production apply changes nothing', () => {
    withTree(dir => {
      assert.deepEqual(applyUrlScheme(dir, PROD_SCHEMES), []);
    });
  });
});

describe('applyUrlScheme (--beta)', () => {
  it('rewrites the URL types, the key, the hand-off and the widget setting', () => {
    withTree(dir => {
      const before = Object.fromEntries(
        Object.values(FILES).map(rel => [rel, readRel(dir, rel)]),
      );
      const changed = applyUrlScheme(dir, BETA_SCHEMES);
      assert.deepEqual(
        changed.sort(),
        [FILES.appInfoPlist, FILES.pbxproj, FILES.shareSwift].sort(),
      );

      const plist = readRel(dir, FILES.appInfoPlist);
      assert.deepEqual(readUrlSchemes(plist), [
        'qariah-beta',
        'exp+qariah-beta',
      ]);
      assert.equal(readStringKey(plist, 'BayaanURLScheme'), 'qariah-beta');
      assert.deepEqual(readShareSwift(readRel(dir, FILES.shareSwift)), {
        protocol: 'qariah-beta',
        key: 'qariah-betaShareKey',
      });
      const pbxproj = readRel(dir, FILES.pbxproj);
      assert.deepEqual(
        [...new Set(readBuildSetting(pbxproj, 'BAYAAN_URL_SCHEME'))],
        ['qariah-beta'],
      );
      // Xcode quotes a value with a `-`.
      assert.ok(pbxproj.includes('BAYAAN_URL_SCHEME = "qariah-beta";'));
      // The widget Info.plist only expands the setting.
      assert.equal(
        readRel(dir, FILES.widgetInfoPlist),
        before[FILES.widgetInfoPlist],
      );

      assert.deepEqual(checkUrlScheme(dir, BETA_SCHEMES), []);
      assert.ok(checkUrlScheme(dir, PROD_SCHEMES).length > 0);

      // Only the scheme lines change: BayaanURLScheme, then the two URL types.
      assert.deepEqual(
        addedLines(before[FILES.appInfoPlist], plist).map(l => l.trim()),
        [
          '<string>qariah-beta</string>',
          '<string>qariah-beta</string>',
          '<string>exp+qariah-beta</string>',
        ],
      );
      assert.deepEqual(
        addedLines(before[FILES.pbxproj], pbxproj).map(l => l.trim()),
        [
          'BAYAAN_URL_SCHEME = "qariah-beta";',
          'BAYAAN_URL_SCHEME = "qariah-beta";',
        ],
      );
    });
  });

  it('is idempotent', () => {
    withTree(dir => {
      applyUrlScheme(dir, BETA_SCHEMES);
      assert.deepEqual(applyUrlScheme(dir, BETA_SCHEMES), []);
    });
  });

  it('keeps the OAuth callback scheme out of the URL types', () => {
    withTree(dir => {
      applyUrlScheme(dir, BETA_SCHEMES);
      const types = readUrlSchemes(readRel(dir, FILES.appInfoPlist));
      assert.equal(types.includes(OAUTH_CALLBACK_SCHEME), false);
    });
  });
});

describe('checkUrlScheme (the OAuth rule)', () => {
  it('reports the OAuth callback scheme as an iOS URL type', () => {
    withTree(dir => {
      const file = path.join(dir, FILES.appInfoPlist);
      const xml = readFileSync(file, 'utf8').replace(
        '<string>exp+qariah</string>',
        `<string>exp+qariah</string>\n\t\t\t\t<string>${OAUTH_CALLBACK_SCHEME}</string>`,
      );
      writeFileSync(file, xml);
      const problems = checkUrlScheme(dir, PROD_SCHEMES);
      assert.equal(problems.length, 1);
      assert.match(problems[0], /OAuth callback scheme com\.qariah\.app/);
    });
  });
});

describe('configSchemeProblems', () => {
  it('accepts a config whose first scheme is the archive scheme', () => {
    const config = {expo: {scheme: ['qariah-beta', OAUTH_CALLBACK_SCHEME]}};
    assert.deepEqual(configSchemeProblems(config, BETA_SCHEMES), []);
  });

  it('reports a config that names another scheme or drops the OAuth scheme', () => {
    const problems = configSchemeProblems(
      {expo: {scheme: 'qariah'}},
      BETA_SCHEMES,
    );
    assert.equal(problems.length, 2);
    assert.match(problems[0], /scheme\[0\] is qariah, not qariah-beta/);
    assert.match(problems[1], /no com\.qariah\.app/);
  });
});

describe('text helpers', () => {
  it('mapUrlSchemes leaves other plist strings alone', () => {
    const xml =
      '<key>BayaanURLScheme</key>\n<string>qariah</string>\n' +
      '<key>CFBundleURLSchemes</key>\n<array>\n<string>qariah</string>\n</array>';
    const out = mapUrlSchemes(xml, {qariah: 'qariah-beta'});
    assert.equal(readStringKey(out, 'BayaanURLScheme'), 'qariah');
    assert.deepEqual(readUrlSchemes(out), ['qariah-beta']);
  });

  it('writeQuotedBuildSetting quotes only when Xcode would', () => {
    const text = '\t\t\t\tBAYAAN_URL_SCHEME = qariah;\n';
    assert.equal(
      writeQuotedBuildSetting(text, 'BAYAAN_URL_SCHEME', 'qariah'),
      text,
    );
    assert.equal(
      writeQuotedBuildSetting(text, 'BAYAAN_URL_SCHEME', 'qariah-beta'),
      '\t\t\t\tBAYAAN_URL_SCHEME = "qariah-beta";\n',
    );
  });

  it('readShareSwift needs exactly one of each constant', () => {
    assert.throws(() => readShareSwift('let x = 1'), /shareProtocol/);
  });

  it('describeUrlSchemes prints the committed values', () => {
    assert.deepEqual(describeUrlSchemes(ROOT), [
      '      app URL types: qariah, exp+qariah',
      '      app BayaanURLScheme: qariah',
      '      share extension hand-off: qariah://dataUrl=qariahShareKey',
      '      widget BAYAAN_URL_SCHEME: qariah',
    ]);
  });
});
