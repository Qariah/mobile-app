// @ai-generated
// Qariah (Sprint 48, S48.7): the "Notifications" row of the Settings index.
//
// The row lives here, not inline in `app/(tabs)/(d.settings)/index.tsx`
// (upstream), so that the upstream file changes by a few lines (one spread,
// one hook call, the memo, one import and one `handleSettingPress` case), and
// so that a test can check the row and the holdout without a render of the
// whole Settings screen.
import {useCallback, useState} from 'react';
import {useFocusEffect} from 'expo-router';
import type {TFunction} from 'i18next';
import {isNotificationsHoldout} from '@/services/notifications/holdout';

/** The `type` of the row; `handleSettingPress` opens the page for it. */
export const NOTIFICATIONS_SETTINGS_TYPE = 'notifications';

/** The route of the Notifications page. */
export const NOTIFICATIONS_SETTINGS_ROUTE = '/(d.settings)/notifications';

/** The shape of the other rows of `getSettingsSections` in the upstream file. */
export interface NotificationsSettingsItem {
  title: string;
  type: typeof NOTIFICATIONS_SETTINGS_TYPE;
  description: string;
  icon: string;
  iconType: 'feather';
}

/**
 * The row, or no row for a user in the notifications holdout (S48.6: a
 * holdout user has no Notifications page).
 */
export function getNotificationsSettingsItems(
  t: TFunction<['settings', 'common', 'qariah']>,
  holdout: boolean = isNotificationsHoldout(),
): NotificationsSettingsItem[] {
  if (holdout) return [];
  return [
    {
      title: t('qariah:settings.screens.notifications'),
      type: NOTIFICATIONS_SETTINGS_TYPE,
      description: t('qariah:settings.notifications.rowDesc'),
      icon: 'bell',
      iconType: 'feather',
    },
  ];
}

/**
 * The holdout, read again each time the screen gets the focus. The arm is
 * written after the PostHog flag arrives (`holdoutEnrollment.ts`), which can
 * be after the Settings screen first rendered; a value read once would keep
 * the row (and the page) in the wrong state until the next start.
 */
export function useNotificationsHoldout(): boolean {
  const [holdout, setHoldout] = useState(isNotificationsHoldout);
  useFocusEffect(
    useCallback(() => {
      setHoldout(isNotificationsHoldout());
    }, []),
  );
  return holdout;
}
