// @ai
// Qariah (Sprint 33): the Android "Background playback" row of the Settings
// index. Divergence batch C3 (SHT-S6) moved it out of the inherited
// `app/(tabs)/(d.settings)/index.tsx`, like `notificationsSettingsItem.ts`.
//
// Android only. OEM battery restriction (Samsung "Sleeping apps" etc.) can
// stop background audio. This row keeps the fix discoverable beyond the
// bounded kill-triggered prompt (hooks/useBackgroundPlaybackPrompt).
import {Platform} from 'react-native';
import type {TFunction} from 'i18next';
import {showBackgroundPlaybackGuide} from '@/hooks/useBackgroundPlaybackPrompt';
import {
  LITE_MODE_SETTINGS_TYPE,
  showLiteModeChooser,
} from '@/components/settings/liteModeSettingsItem';

/** The `type` of the row. */
export const BACKGROUND_PLAYBACK_SETTINGS_TYPE = 'backgroundPlayback';

/** The shape of the other rows of `getSettingsSections` (settingsItems.ts). */
export interface BackgroundPlaybackSettingsItem {
  title: string;
  type: typeof BACKGROUND_PLAYBACK_SETTINGS_TYPE;
  description: string;
  icon: string;
  iconType: 'feather';
}

/** The row on Android; no row on iOS. */
export function getBackgroundPlaybackSettingsItems(
  t: TFunction<['settings', 'common', 'qariah']>,
): BackgroundPlaybackSettingsItem[] {
  if (Platform.OS !== 'android') return [];
  return [
    {
      title: t('qariah:settings.backgroundPlayback'),
      type: BACKGROUND_PLAYBACK_SETTINGS_TYPE,
      description: t('qariah:settings.backgroundPlaybackDesc'),
      icon: 'battery-charging',
      iconType: 'feather',
    },
  ];
}

/**
 * The press of the Android Qariah rows (Background playback, Lite mode);
 * `openQariahSettingsItem` (qariahSettingsSections.ts) calls it. Does nothing
 * for any other `type`.
 */
export function handleQariahSettingPress(type: string): void {
  if (type === BACKGROUND_PLAYBACK_SETTINGS_TYPE) showBackgroundPlaybackGuide();
  // Lite mode (step 1): Automatic / On / Off.
  if (type === LITE_MODE_SETTINGS_TYPE) showLiteModeChooser();
}
