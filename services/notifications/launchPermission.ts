// @ai
// Qariah: at each launch on Android, ask for POST_NOTIFICATIONS when it is not
// granted (`useQariahNotifications` calls this once at the root). Android 13+
// shows the system dialog while it can still ask; Android 12 and earlier
// grants the permission at install, so nothing shows.
//
// History: Sprint 24 (S24.1) put this request in upstream's
// `services/audio/ExpoAudioProvider.tsx`, at audio init. Divergence batch C5
// moved it here without a change in what the user sees: the same system
// dialog at the first launch, for every user (the notifications holdout too),
// on Android only. The audio path does not need it (Android 13 exempts the
// media-session notification), but the notifications feature does: the
// Android notification card shows only when the permission is granted
// (`softPrompt.ts`), and the local notifications post only then.
//
// The result also feeds the notifications-blocked prompt of background
// playback (#104, `useNotificationsDeniedPrompt`): a denial is recorded in
// `backgroundPlaybackStore.notificationsDenied`, and a later grant clears it.
//
// Fire-and-forget. Never throws.
import {Platform} from 'react-native';
import {useBackgroundPlaybackStore} from '@/store/backgroundPlaybackStore';

/**
 * expo-notifications, required on first use (Android only), as the rest of
 * the notifications feature does. A `require`, not `import()`: Jest runs
 * without ESM dynamic imports.
 */
function notificationsModule(): typeof import('expo-notifications') {
  return require('expo-notifications') as typeof import('expo-notifications');
}

/** Record the permission for the #104 notifications-blocked prompt. */
function recordForBackgroundPlayback(status: string): void {
  if (status === 'denied') {
    useBackgroundPlaybackStore.getState().recordNotificationsDenied();
  } else if (
    status === 'granted' &&
    useBackgroundPlaybackStore.getState().notificationsDenied
  ) {
    useBackgroundPlaybackStore.setState({notificationsDenied: false});
  }
}

/**
 * Android: read the permission, ask for it when it is not granted (the system
 * shows a dialog only while it can still ask), and record the result. A no-op
 * on iOS: the iOS notification card asks (`softPrompt.ts`).
 */
export async function requestLaunchNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const Notifications = notificationsModule();
    const current = await Notifications.getPermissionsAsync();
    const status =
      current.status === 'granted'
        ? current
        : await Notifications.requestPermissionsAsync({
            android: {
              allowAlert: true,
              allowBadge: false,
              allowSound: false,
            },
          });
    recordForBackgroundPlayback(status.status);
  } catch (err) {
    if (__DEV__) {
      console.log(
        '[notifications] POST_NOTIFICATIONS request failed (non-fatal):',
        err,
      );
    }
  }
}
