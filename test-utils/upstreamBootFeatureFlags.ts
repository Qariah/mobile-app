/**
 * Qariah-only test helper: upstream Bayaan's flag values for the boot.
 *
 * The same values as test-utils/upstreamFeatureFlags.ts, and also Qariah's
 * boot levers OFF. Upstream has no such levers, so with them off
 * AppInitializer registers and runs upstream's full service list
 * (services/qariahInitConfig.ts applies no skip). Upstream's boot suite
 * services/__tests__/AppInitializer.characterization.test.ts runs with it:
 *
 *   jest.mock('@/config/featureFlags', () =>
 *     jest.requireActual('@/test-utils/upstreamBootFeatureFlags'),
 *   );
 *
 * Qariah's own boot (the shipping flags) is pinned by
 * services/__tests__/appBoot.qariah.characterization.test.ts (TECH_DEBT #253).
 */
type FlagsModule = typeof import('@/config/featureFlags');
type Flag = keyof FlagsModule['featureFlags'];

const upstream = jest.requireActual<
  typeof import('@/test-utils/upstreamFeatureFlags')
>('@/test-utils/upstreamFeatureFlags');

/** The Qariah-only flags that change the AppInitializer service list. */
const QARIAH_BOOT_LEVERS: readonly Flag[] = [
  'deferMushafPreload',
  'deferNonCriticalBootServices',
  'lazyOpenFeatureDbs',
];

export const featureFlags: Record<Flag, boolean> = {
  ...upstream.featureFlags,
  ...Object.fromEntries(QARIAH_BOOT_LEVERS.map(flag => [flag, false])),
};

export function isFeatureEnabled(flag: Flag): boolean {
  return featureFlags[flag];
}
