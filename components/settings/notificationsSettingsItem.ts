// @ai-generated
// Qariah (Sprint 48, S48.7): the "Notifications" row of the Settings index.
//
// The row lives here, not inline in a Settings screen, so that a test can
// check the row and the holdout without a render of the whole screen. Since
// Sprint 52 Task 5, `qariahSettingsSections.ts` adds it to the Settings list
// of the phone and the iPad, and `branding.settingsRouteNames` routes it.
import {useCallback, useEffect, useState} from 'react';
import {useFocusEffect} from 'expo-router';
import type {TFunction} from 'i18next';
import {isNotificationsHoldout} from '@/services/notifications/holdout';

/** The `type` of the row; `openSettingsItem` opens the page for it. */
export const NOTIFICATIONS_SETTINGS_TYPE = 'notifications';

/** The route of the Notifications page (the soft prompt opens it too). */
export const NOTIFICATIONS_SETTINGS_ROUTE = '/(d.settings)/notifications';

/** The shape of the other rows of `getSettingsSections` (settingsItems.ts). */
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
 *
 * `rereadKey` (Sprint 52 Task 5): the holdout is also read again each time
 * the key changes. The iPad split keeps its list on screen while the pages
 * beside it change, and the focus of the Settings tab does not change then;
 * the list passes the current page as the key.
 */
export function useNotificationsHoldout(rereadKey?: string): boolean {
  const [holdout, setHoldout] = useState(isNotificationsHoldout);
  useFocusEffect(
    useCallback(() => {
      setHoldout(isNotificationsHoldout());
    }, []),
  );
  useEffect(() => {
    if (rereadKey !== undefined) setHoldout(isNotificationsHoldout());
  }, [rereadKey]);
  return holdout;
}
