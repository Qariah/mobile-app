// @ai Qariah (TECH_DEBT #289): the one rule for the iOS App Group of a build,
// and the build-time decision which build moves data from the old group.

import fs from 'fs';
import path from 'path';

import branding from '../branding';
import {
  LEGACY_APP_GROUP_INFO_PLIST_KEY,
  MOVE_DATA_FROM_PRODUCTION_GROUP,
  appGroupForBundleId,
  legacyAppGroupForBundleId,
} from '../iosAppGroup';

const PROD = branding.bundleId.ios;
const BETA = `${PROD}.beta`;
const ROOT = path.join(__dirname, '..', '..');

describe('appGroupForBundleId', () => {
  it('derives group.<bundle id> for production, the public beta and the beta', () => {
    // The public beta archive keeps the production bundle id.
    expect(appGroupForBundleId(PROD)).toBe('group.com.qariah.app');
    expect(appGroupForBundleId(BETA)).toBe('group.com.qariah.app.beta');
  });

  it('rejects a value that is not a bundle id', () => {
    expect(() => appGroupForBundleId('')).toThrow();
    expect(() => appGroupForBundleId('group.com.qariah.app beta')).toThrow();
    expect(() => appGroupForBundleId(undefined as unknown as string)).toThrow();
  });
});

describe('legacyAppGroupForBundleId (which build moves data at its first launch)', () => {
  it('production and the public beta move nothing', () => {
    expect(legacyAppGroupForBundleId(PROD, PROD)).toBeNull();
    expect(legacyAppGroupForBundleId(PROD, PROD, {moveData: true})).toBeNull();
  });

  it('the beta moves its data from the production group during the move release', () => {
    expect(legacyAppGroupForBundleId(BETA, PROD, {moveData: true})).toBe(
      'group.com.qariah.app',
    );
  });

  it('the beta moves nothing after the move release', () => {
    expect(legacyAppGroupForBundleId(BETA, PROD, {moveData: false})).toBeNull();
  });

  it('defaults to the release switch', () => {
    expect(legacyAppGroupForBundleId(BETA, PROD)).toBe(
      MOVE_DATA_FROM_PRODUCTION_GROUP ? 'group.com.qariah.app' : null,
    );
  });
});

describe('app.config.ts and the committed native tree', () => {
  const configModule = require('../../app.config.ts');
  const expo = (configModule.default ?? configModule).expo;

  // The widget key in infoPlist has the same value: the plugin test
  // (plugins/__tests__/withBayaanWidgets.test.js) and
  // scripts/__tests__/ios-app-group.test.mjs check it against the committed
  // files.
  it('gives the production group to expo-share-intent', () => {
    const shareIntent = expo.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === 'expo-share-intent',
    );
    expect(shareIntent[1].iosAppGroupIdentifier).toBe(
      appGroupForBundleId(PROD),
    );
  });

  it('keeps the production group and no legacy key in the committed Info.plist', () => {
    const plist = fs.readFileSync(
      path.join(ROOT, 'ios', 'Qariah', 'Info.plist'),
      'utf8',
    );
    expect(plist).toContain(
      `<key>AppGroupIdentifier</key>\n    <string>${appGroupForBundleId(PROD)}</string>`,
    );
    expect(plist).not.toContain(LEGACY_APP_GROUP_INFO_PLIST_KEY);
  });
});
