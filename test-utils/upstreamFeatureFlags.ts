/**
 * Qariah-only test helper: upstream Bayaan's feature-flag values.
 *
 * Bayaan ships every upstream feature on (its config/featureFlags.ts sets all
 * flags true except the deprecated `backgroundVideoOverlay`). Qariah hides
 * some of them (hard-rule #2: flags, not deletions), so an upstream suite that
 * drives a hidden feature (for example the Highlight row of the verse actions
 * sheet) fails against Qariah's values. Such a suite mocks the flags with this
 * module, which keeps the inherited code path under test:
 *
 *   jest.mock('@/config/featureFlags', () =>
 *     jest.requireActual('@/test-utils/upstreamFeatureFlags'),
 *   );
 *
 * Qariah-only flags keep their Qariah values.
 */
type FlagsModule = typeof import('@/config/featureFlags');

const actual = jest.requireActual<FlagsModule>('@/config/featureFlags');

const UPSTREAM_ON = [
  'adhkar',
  'ambientAudioOverlay',
  'userUploads',
  'wordByWordTransliteration',
  'pushNotifications',
  'coloredHighlights',
  'verseNotes',
  'multiTranslation',
  'tafsir',
  'sleepTimer',
] as const;

export const featureFlags: Record<keyof FlagsModule['featureFlags'], boolean> =
  {
    ...actual.featureFlags,
    ...Object.fromEntries(UPSTREAM_ON.map(flag => [flag, true])),
  };

export function isFeatureEnabled(
  flag: keyof FlagsModule['featureFlags'],
): boolean {
  return featureFlags[flag];
}
