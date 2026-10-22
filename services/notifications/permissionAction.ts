// @ai-generated
// Qariah (Sprint 48, S48.7): what the Notifications page does about the
// system permission.
//
// A pure function over the result of `expo-notifications`
// `getPermissionsAsync()`. The type below is the part of
// `NotificationPermissionsStatus` that it reads, so this module makes no
// native import.

/** The fields of `NotificationPermissionsStatus` that the decision reads. */
export interface NotificationPermissionSnapshot {
  /** `'granted'`, `'denied'` or `'undetermined'` (expo's `PermissionStatus`). */
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  ios?: {status: number} | null;
}

/** `IosAuthorizationStatus.PROVISIONAL` of expo-notifications. */
const IOS_PROVISIONAL = 3;

/**
 * - `none`: notifications are allowed; show no banner.
 * - `ask`: show the banner; its button shows the system dialog
 *   (`requestPermissionsAsync()`).
 * - `openSettings`: show the banner; its button opens the system settings of
 *   the app (`Linking.openSettings()`), because the system shows no dialog.
 */
export type NotificationPermissionAction = 'none' | 'ask' | 'openSettings';

export function notificationPermissionAction(
  permission: NotificationPermissionSnapshot,
): NotificationPermissionAction {
  if (permission.status === 'granted') return 'none';
  // A provisional iOS grant delivers quietly to the Notification Center. The
  // app never asks for it, but the user can choose it in the iOS settings.
  if (permission.ios?.status === IOS_PROVISIONAL) return 'none';
  // Android 13+: `granted` is the POST_NOTIFICATIONS permission, and `status`
  // is "denied" when the user turned the notifications of the app off in the
  // system settings. With the permission granted, a request shows no dialog,
  // so only the system settings can turn them on again.
  if (permission.canAskAgain && !permission.granted) return 'ask';
  return 'openSettings';
}
