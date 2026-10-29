// @ai
//
// config/appUrlScheme.js
// ----------------------
// Qariah (TECH_DEBT #342, Sprint 51): the URL scheme of an iOS build. This
// file is the one source of the rule. It is CommonJS with no React Native
// import, so app.config.js (Expo CLI), the scripts (plain Node) and Jest can
// load it.
//
// The rule: the scheme of an app comes from its bundle id.
//   - Production `com.qariah.app`         -> `qariah`      (branding.urlScheme)
//   - Public beta (production bundle id)  -> `qariah`
//   - Internal beta `com.qariah.app.beta` -> `qariah-beta` (`<scheme>-<suffix>`)
// The Expo dev client scheme is `exp+<scheme>`.
//
// Why: until Sprint 51 the internal beta also registered `qariah://`. With
// both apps on one iPhone, iOS could open the production app for a link that
// the beta started (the share extension hand-off), and the production app
// cannot read the beta App Group (TECH_DEBT #289).
//
// Users of the rule:
//   - app.config.js builds `scheme[0]` from the bundle id in the environment
//     variable ARCHIVE_BUNDLE_ID_ENV. Only scripts/qariah-ios-archive.sh sets
//     it, in the environment of the archive. The app config that the build
//     embeds (Constants.expoConfig.scheme) then names the scheme of that app.
//     expo-share-intent reads `scheme[0]` for the hand-off URL and its key.
//   - scripts/ios-archive.sh --beta rewrites the committed native files to the
//     beta scheme (scripts/lib/ios-url-scheme.mjs) and restores them on exit.
// Android has no variant app (android-archive.sh), so Android always uses
// the production scheme.
//
// The QF OAuth callback scheme is NOT an app URL scheme on iOS (it breaks
// ASWebAuthenticationSession; withIosRemoveOAuthCallbackScheme.js), but it
// MUST be one on Android (the Custom Tabs intent filter). It stays the same in
// every variant, because the QF OAuth clients name that redirect URI.

/** The environment variable that names the app bundle id of an iOS archive. */
const ARCHIVE_BUNDLE_ID_ENV = 'QARIAH_IOS_ARCHIVE_BUNDLE_ID';

/** The QF OAuth callback scheme (`com.qariah.app:/quranoauth2redirect`). */
const OAUTH_CALLBACK_SCHEME = 'com.qariah.app';

const BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*$/;
const SUFFIX_PATTERN = /^[A-Za-z0-9]+$/;

function assertBundleId(bundleId, name) {
  if (typeof bundleId !== 'string' || !BUNDLE_ID_PATTERN.test(bundleId)) {
    throw new Error(
      `[appUrlScheme] ${name} must be a reverse-DNS bundle id, got ${JSON.stringify(
        bundleId,
      )}`,
    );
  }
}

/**
 * The URL scheme of the app with this bundle id.
 * @param {string} bundleId the APP bundle id of the build (not an extension id)
 * @param {string} productionBundleId the production APP bundle id
 * @param {string} productionScheme the production scheme (branding.urlScheme)
 * @returns {string}
 */
function urlSchemeForBundleId(bundleId, productionBundleId, productionScheme) {
  assertBundleId(bundleId, 'bundleId');
  assertBundleId(productionBundleId, 'productionBundleId');
  if (
    typeof productionScheme !== 'string' ||
    !SCHEME_PATTERN.test(productionScheme)
  ) {
    throw new Error(
      `[appUrlScheme] productionScheme must be a URL scheme, got ${JSON.stringify(
        productionScheme,
      )}`,
    );
  }
  if (bundleId === productionBundleId) return productionScheme;
  const prefix = `${productionBundleId}.`;
  const suffix = bundleId.startsWith(prefix)
    ? bundleId.slice(prefix.length)
    : '';
  if (!SUFFIX_PATTERN.test(suffix)) {
    throw new Error(
      `[appUrlScheme] ${bundleId} is not ${productionBundleId} or a variant ${prefix}<name>`,
    );
  }
  return `${productionScheme}-${suffix.toLowerCase()}`;
}

/** The Expo dev client scheme of an app scheme: `exp+<scheme>`. */
function devClientScheme(scheme) {
  return `exp+${scheme}`;
}

module.exports = {
  ARCHIVE_BUNDLE_ID_ENV,
  OAUTH_CALLBACK_SCHEME,
  urlSchemeForBundleId,
  devClientScheme,
};
