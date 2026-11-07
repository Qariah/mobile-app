// @ai-generated
// Qariah (Sprint 51, TECH_DEBT #348): open the notification settings of the
// app from the Notifications page (its "Open Settings" banner button).
//
// iOS 27 (the test iPhone, Sprint 50, NTF-01): when the Settings app is not
// running, `Linking.openSettings()` opens the "Apps" list, and only a second
// call opens the page of the app. On iOS 27 and later this module opens the
// notification settings URL of the app instead
// (`UIApplication.openNotificationSettingsURLString`; its value in UIKitCore
// is `app-settings:notifications`). Android, iOS 26 and earlier, and a URL
// that the system declines keep `Linking.openSettings()`.
//
// Only iOS 27 and later (review of Sprint 51, Lane N): the defect was seen on
// iOS 27 only, and the URL string is not public API (the app writes the value,
// not the UIKit constant). On an older iOS, `openURL` could resolve and open
// another page, and no fallback would run. Lower the minimum only after a test
// on that iOS version.
//
// The OS-version choice is the pure `notificationSettingsUrl`.
import {Linking, Platform} from 'react-native';

/** The value of `UIApplication.openNotificationSettingsURLString` (iOS 15.4+). */
export const IOS_NOTIFICATION_SETTINGS_URL = 'app-settings:notifications';

/** The first iOS major version that opens the notification settings URL. */
export const NOTIFICATION_SETTINGS_URL_MIN_IOS = 27;

/** The major version of an iOS `Platform.Version` ("27.0.1" -> 27), or null. */
export function iosMajorVersion(version: unknown): number | null {
  const major =
    typeof version === 'number'
      ? Math.trunc(version)
      : typeof version === 'string'
        ? parseInt(version, 10)
        : NaN;
  return Number.isFinite(major) && major > 0 ? major : null;
}

/**
 * The URL that opens the notification settings of the app on this OS, or
 * null when the caller must use `Linking.openSettings()`.
 * @param os `Platform.OS`
 * @param version `Platform.Version` (a string on iOS, a number on Android)
 */
export function notificationSettingsUrl(
  os: string,
  version: unknown,
): string | null {
  if (os !== 'ios') return null;
  const major = iosMajorVersion(version);
  return major !== null && major >= NOTIFICATION_SETTINGS_URL_MIN_IOS
    ? IOS_NOTIFICATION_SETTINGS_URL
    : null;
}

export interface OpenNotificationSettingsDeps {
  os?: string;
  version?: unknown;
  openURL?: (url: string) => Promise<unknown>;
  openSettings?: () => Promise<unknown>;
}

/**
 * Opens the notification settings of the app (see the file header). Rejects
 * only when the `Linking.openSettings()` fallback rejects.
 */
export async function openNotificationSettings(
  deps: OpenNotificationSettingsDeps = {},
): Promise<void> {
  const url = notificationSettingsUrl(
    deps.os ?? Platform.OS,
    deps.version ?? Platform.Version,
  );
  if (url !== null) {
    try {
      await (deps.openURL ?? (u => Linking.openURL(u)))(url);
      return;
    } catch (error) {
      if (__DEV__) {
        console.warn('[notifications] notification settings URL failed', error);
      }
    }
  }
  await (deps.openSettings ?? (() => Linking.openSettings()))();
}
