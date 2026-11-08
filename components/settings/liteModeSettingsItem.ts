// @ai
// Qariah (Lite mode, step 1): the "Lite mode" row of the Settings index, the
// same shape as backgroundPlaybackSettingsItem.ts. Android only in step 1
// (planning/lite-mode-design.md). The choice applies at the next launch,
// because the mode is fixed for a process (services/lite/liteMode.ts).
import {Alert, Platform} from 'react-native';
import i18n from 'i18next';
import type {TFunction} from 'i18next';
import {
  getLiteModeSetting,
  isLiteModeAutoOn,
  setLiteModeSetting,
  type LiteModeSetting,
} from '@/services/lite/liteMode';

/** The `type` of the row. */
export const LITE_MODE_SETTINGS_TYPE = 'liteMode';

export interface LiteModeSettingsItem {
  title: string;
  type: typeof LITE_MODE_SETTINGS_TYPE;
  description: string;
  icon: string;
  iconType: 'feather';
}

/** The row on Android; no row on iOS. */
export function getLiteModeSettingsItems(
  t: TFunction<['settings', 'common', 'qariah']>,
): LiteModeSettingsItem[] {
  if (Platform.OS !== 'android') return [];
  const setting = getLiteModeSetting();
  let value: string;
  if (setting === 'on') value = t('qariah:lite.on');
  else if (setting === 'off') value = t('qariah:lite.off');
  else if (isLiteModeAutoOn()) value = t('qariah:lite.autoOnForPhone');
  else value = t('qariah:lite.autoOffForPhone');
  return [
    {
      title: t('qariah:lite.settingsTitle'),
      type: LITE_MODE_SETTINGS_TYPE,
      description: t('qariah:lite.current', {value}),
      icon: 'feather',
      iconType: 'feather',
    },
  ];
}

/** Asks for Automatic, On or Off, and saves the answer. */
export function showLiteModeChooser(): void {
  const choose = (setting: LiteModeSetting) => () =>
    setLiteModeSetting(setting);
  Alert.alert(
    i18n.t('qariah:lite.settingsTitle'),
    i18n.t('qariah:lite.chooserBody'),
    [
      {text: i18n.t('qariah:lite.auto'), onPress: choose('auto')},
      {text: i18n.t('qariah:lite.on'), onPress: choose('on')},
      {text: i18n.t('qariah:lite.off'), onPress: choose('off')},
    ],
  );
}
