// @ai Qariah (TECH_DEBT #342): types for config/appUrlScheme.js (CommonJS, so
// that app.config.js and the scripts can load it). See that file.

/** The environment variable that names the app bundle id of an iOS archive. */
export declare const ARCHIVE_BUNDLE_ID_ENV: 'QARIAH_IOS_ARCHIVE_BUNDLE_ID';

/** The QF OAuth callback scheme (`com.qariah.app:/quranoauth2redirect`). */
export declare const OAUTH_CALLBACK_SCHEME: 'com.qariah.app';

/** The URL scheme of the app with this bundle id. */
export declare function urlSchemeForBundleId(
  bundleId: string,
  productionBundleId: string,
  productionScheme: string,
): string;

/** The Expo dev client scheme of an app scheme: `exp+<scheme>`. */
export declare function devClientScheme(scheme: string): string;
