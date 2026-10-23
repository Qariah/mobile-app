// @ai
//
// config/iosAppGroup.js
// ---------------------
// Qariah (TECH_DEBT #289, Sprint 50): the iOS App Group of a build. This file
// is the one source of the rule. It is CommonJS with no React Native import,
// so app.config.ts (Expo CLI), the scripts (plain Node) and Jest can load it.
//
// The rule: the App Group of an app is `group.<app bundle id>`.
//   - Production `com.qariah.app`         -> `group.com.qariah.app`
//   - Public beta (production bundle id)  -> `group.com.qariah.app`
//   - Internal beta `com.qariah.app.beta` -> `group.com.qariah.app.beta`
// The app, the share extension and the widget use the group of the APP (an
// extension bundle id has a suffix, so it does not derive the group itself).
//
// Users of the rule:
//   - app.config.ts gives the production value to the prebuild plugins
//     (`BayaanAppGroup`, and expo-share-intent `iosAppGroupIdentifier`, which
//     writes the app and share extension entitlements, `AppGroupIdentifier`
//     and the share extension source).
//   - scripts/ios-archive.sh --beta rewrites the committed native files to the
//     beta group (scripts/lib/ios-app-group.mjs) and restores them on exit.
//
// Until Sprint 50 the internal beta kept the production group, so a beta
// widget command could run in the production app, and the two apps shared
// MMKV data. For ONE beta release, a beta build also lists the production
// group in its app entitlements, and at its first launch it copies its data
// from that group (modules/qariah-app-group). It never writes to that group.
// The next release sets MOVE_DATA_FROM_PRODUCTION_GROUP to false (TECH_DEBT
// follow-up of #289). Then the beta entitlements list only the beta group.

/** True for the one beta release that moves the beta data (TECH_DEBT #289). */
const MOVE_DATA_FROM_PRODUCTION_GROUP = true;

/** The Info.plist key that names the group to move data from (beta only). */
const LEGACY_APP_GROUP_INFO_PLIST_KEY = 'QariahLegacyAppGroup';

const BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function assertBundleId(bundleId, name) {
  if (typeof bundleId !== 'string' || !BUNDLE_ID_PATTERN.test(bundleId)) {
    throw new Error(
      `[iosAppGroup] ${name} must be a reverse-DNS bundle id, got ${JSON.stringify(
        bundleId,
      )}`,
    );
  }
}

/**
 * The App Group of the app with this bundle id: `group.<bundle id>`.
 * @param {string} bundleId the APP bundle id (not an extension id)
 * @returns {string}
 */
function appGroupForBundleId(bundleId) {
  assertBundleId(bundleId, 'bundleId');
  return `group.${bundleId}`;
}

/**
 * The group a build moves its data from at its first launch, or null.
 * Only a variant app (a bundle id that is not the production id, that is the
 * internal beta) moves data, and only while MOVE_DATA_FROM_PRODUCTION_GROUP
 * is true. The production build and the public beta move nothing.
 * @param {string} bundleId the APP bundle id of the build
 * @param {string} productionBundleId the production APP bundle id
 * @param {{moveData?: boolean}} [options] for tests; defaults to the constant
 * @returns {string | null}
 */
function legacyAppGroupForBundleId(
  bundleId,
  productionBundleId,
  {moveData = MOVE_DATA_FROM_PRODUCTION_GROUP} = {},
) {
  assertBundleId(bundleId, 'bundleId');
  assertBundleId(productionBundleId, 'productionBundleId');
  if (!moveData || bundleId === productionBundleId) return null;
  return appGroupForBundleId(productionBundleId);
}

module.exports = {
  MOVE_DATA_FROM_PRODUCTION_GROUP,
  LEGACY_APP_GROUP_INFO_PLIST_KEY,
  appGroupForBundleId,
  legacyAppGroupForBundleId,
};
