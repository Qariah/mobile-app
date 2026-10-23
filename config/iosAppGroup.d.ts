// @ai Qariah (TECH_DEBT #289): types for config/iosAppGroup.js (CommonJS, so
// that app.config.ts and the scripts can load it). See that file.

/** True for the one beta release that moves the beta data (TECH_DEBT #289). */
export declare const MOVE_DATA_FROM_PRODUCTION_GROUP: boolean;

/** The Info.plist key that names the group to move data from (beta only). */
export declare const LEGACY_APP_GROUP_INFO_PLIST_KEY: 'QariahLegacyAppGroup';

/** The App Group of the app with this bundle id: `group.<bundle id>`. */
export declare function appGroupForBundleId(bundleId: string): string;

/** The group a build moves its data from at its first launch, or null. */
export declare function legacyAppGroupForBundleId(
  bundleId: string,
  productionBundleId: string,
  options?: {moveData?: boolean},
): string | null;
