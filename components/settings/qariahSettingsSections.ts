// @ai
// Qariah (Sprint 52 Task 5): the Qariah rows of the Settings list, from one
// source for the phone list (`app/(tabs)/(d.settings)/index.tsx`) and the
// iPad list (`components/settings/TabletSettingsList.tsx`, the split and the
// pushed list). `config/branding.js` hands these to the upstream seam in
// `components/settings/settingsItems.ts`: `useSettingsSections` adds the
// rows, and `openSettingsItem` opens the ones that Qariah opens its own way.
// `branding.settingsRouteNames` (plain data, for the app.config.js eval)
// routes the Qariah pages: `signIn`, `yourData` and `notifications`.
//
// The rows: the Account section (above Appearance), Background playback
// (Android, after "Choose reciter"), Notifications (not in the holdout) and
// Lite mode (Android), after Language. Support and Feature request open a
// mail (`openSupportEmail`) instead of the support page.
import {useMemo} from 'react';
import {useSegments} from 'expo-router';
import {useTranslation} from 'react-i18next';
import type {TFunction} from 'i18next';
import {useAuthStatus} from '@/services/auth/AuthContext';
import type {
  SettingsItem,
  SettingsSection,
} from '@/components/settings/settingsItems';
import {
  ACCOUNT_SETTINGS_TYPES,
  getAccountSettingsSection,
  openSignOutPrompt,
  useQfAccountEmail,
} from '@/components/auth/QariahAccountSection';
import {
  BACKGROUND_PLAYBACK_SETTINGS_TYPE,
  getBackgroundPlaybackSettingsItems,
  handleQariahSettingPress,
} from '@/components/settings/backgroundPlaybackSettingsItem';
import {
  getLiteModeSettingsItems,
  LITE_MODE_SETTINGS_TYPE,
} from '@/components/settings/liteModeSettingsItem';
import {
  getNotificationsSettingsItems,
  useNotificationsHoldout,
} from '@/components/settings/notificationsSettingsItem';
import {openSupportEmail} from '@/utils/openSupportEmail';

/** The upstream rows that the Qariah rows follow. */
export const QARIAH_ROW_ANCHORS = {
  audio: 'reciterChoice',
  appData: 'language',
} as const;

export interface QariahSettingsState {
  t: TFunction<['settings', 'common', 'qariah']>;
  signedIn: boolean;
  email: string | null;
  notificationsHoldout: boolean;
}

/**
 * Puts `items` after the row of type `anchor`. If an upstream sync moves or
 * drops that row, the items go to the end of the last section, so no Qariah
 * row is lost (a test checks the anchors).
 */
function insertAfter(
  sections: SettingsSection[],
  anchor: string,
  items: SettingsItem[],
): SettingsSection[] {
  if (items.length === 0) return sections;
  let index = sections.findIndex(s => s.items.some(i => i.type === anchor));
  if (index < 0) index = sections.length - 1;
  return sections.map((section, i) => {
    if (i !== index) return section;
    const at = section.items.findIndex(item => item.type === anchor);
    const next = [...section.items];
    next.splice(at < 0 ? next.length : at + 1, 0, ...items);
    return {...section, items: next};
  });
}

/** Upstream's sections with the Qariah rows added. */
export function addQariahSettingsSections(
  sections: SettingsSection[],
  {t, signedIn, email, notificationsHoldout}: QariahSettingsState,
): SettingsSection[] {
  let result = insertAfter(
    sections,
    QARIAH_ROW_ANCHORS.audio,
    getBackgroundPlaybackSettingsItems(t),
  );
  result = insertAfter(result, QARIAH_ROW_ANCHORS.appData, [
    ...getNotificationsSettingsItems(t, notificationsHoldout),
    ...getLiteModeSettingsItems(t),
  ]);
  return [getAccountSettingsSection(t, signedIn, email), ...result];
}

/** `branding.useSettingsSections`: the hook that both Settings lists call. */
export function useQariahSettingsSections(
  sections: SettingsSection[],
): SettingsSection[] {
  const {t} = useTranslation(['settings', 'common', 'qariah']);
  // The holdout is read again on each focus (S48.7), and on each page change:
  // the iPad split keeps this list on screen while its pages change.
  const segments = useSegments();
  const notificationsHoldout = useNotificationsHoldout(
    segments[segments.length - 1] ?? '',
  );
  // `'unauthenticated'` outside an <AuthProvider> (upstream's list tests).
  const status = useAuthStatus();
  const email = useQfAccountEmail(status);
  const signedIn = status === 'authenticated';
  return useMemo(
    () =>
      addQariahSettingsSections(sections, {
        t,
        signedIn,
        email,
        notificationsHoldout,
      }),
    [sections, t, signedIn, email, notificationsHoldout],
  );
}

/**
 * `branding.openSettingsItem`: opens a row that Qariah opens its own way.
 * Returns false for the rest, which `openSettingsItem` opens.
 */
export async function openQariahSettingsItem(type: string): Promise<boolean> {
  switch (type) {
    case 'support':
    case 'featureRequest':
      await openSupportEmail(type); // Sprint 32
      return true;
    case ACCOUNT_SETTINGS_TYPES.signOut:
      openSignOutPrompt();
      return true;
    case ACCOUNT_SETTINGS_TYPES.signedIn:
      return true; // A row that only shows the account.
    case BACKGROUND_PLAYBACK_SETTINGS_TYPE: // S33
    case LITE_MODE_SETTINGS_TYPE:
      handleQariahSettingPress(type);
      return true;
    default:
      return false;
  }
}
