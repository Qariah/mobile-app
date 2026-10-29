// @ai-generated
// Qariah (Sprint 51, TECH_DEBT #348): the URL choice by OS version, and the
// fallback to Linking.openSettings().
import {
  IOS_NOTIFICATION_SETTINGS_URL,
  NOTIFICATION_SETTINGS_URL_MIN_IOS,
  iosMajorVersion,
  notificationSettingsUrl,
  openNotificationSettings,
} from '../notificationSettingsLink';

describe('iosMajorVersion', () => {
  it.each([
    ['27.0.1', 27],
    ['26.0', 26],
    ['18.6', 18],
    [26, 26],
    [26.4, 26],
  ])('%p -> %p', (version, major) => {
    expect(iosMajorVersion(version)).toBe(major);
  });

  it.each([[''], ['beta'], [undefined], [null], [0], [Number.NaN]])(
    '%p -> null',
    version => {
      expect(iosMajorVersion(version)).toBeNull();
    },
  );
});

describe('notificationSettingsUrl', () => {
  it('opens the notification settings URL on iOS 27 and later', () => {
    expect(NOTIFICATION_SETTINGS_URL_MIN_IOS).toBe(27);
    expect(notificationSettingsUrl('ios', '27.0')).toBe(
      'app-settings:notifications',
    );
    expect(notificationSettingsUrl('ios', '27.0.1')).toBe(
      IOS_NOTIFICATION_SETTINGS_URL,
    );
    expect(notificationSettingsUrl('ios', '28.1')).toBe(
      IOS_NOTIFICATION_SETTINGS_URL,
    );
  });

  it('keeps Linking.openSettings() on iOS 26 and earlier (the defect was seen on iOS 27 only)', () => {
    expect(notificationSettingsUrl('ios', '26.0')).toBeNull();
    expect(notificationSettingsUrl('ios', '26.5')).toBeNull();
    expect(notificationSettingsUrl('ios', '18.6')).toBeNull();
  });

  it('keeps Linking.openSettings() when the iOS version is not known', () => {
    expect(notificationSettingsUrl('ios', undefined)).toBeNull();
    expect(notificationSettingsUrl('ios', '')).toBeNull();
  });

  it('keeps Linking.openSettings() on Android, whatever the API level', () => {
    // Android API levels are above 26 too.
    expect(notificationSettingsUrl('android', 34)).toBeNull();
    expect(notificationSettingsUrl('android', 26)).toBeNull();
  });
});

describe('openNotificationSettings', () => {
  function deps(os: string, version: unknown) {
    return {
      os,
      version,
      openURL: jest.fn().mockResolvedValue(true),
      openSettings: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('iOS 27: opens the notification settings URL, not openSettings()', async () => {
    const d = deps('ios', '27.0');
    await openNotificationSettings(d);
    expect(d.openURL).toHaveBeenCalledWith('app-settings:notifications');
    expect(d.openSettings).not.toHaveBeenCalled();
  });

  it.each([['26.5'], ['18.6']])(
    'iOS %s: opens the settings of the app',
    async version => {
      const d = deps('ios', version);
      await openNotificationSettings(d);
      expect(d.openURL).not.toHaveBeenCalled();
      expect(d.openSettings).toHaveBeenCalledTimes(1);
    },
  );

  it('Android: opens the settings of the app', async () => {
    const d = deps('android', 34);
    await openNotificationSettings(d);
    expect(d.openURL).not.toHaveBeenCalled();
    expect(d.openSettings).toHaveBeenCalledTimes(1);
  });

  it('falls back to openSettings() when the system declines the URL', async () => {
    const d = deps('ios', '27.1');
    d.openURL.mockRejectedValue(new Error('declined'));
    await openNotificationSettings(d);
    expect(d.openURL).toHaveBeenCalledTimes(1);
    expect(d.openSettings).toHaveBeenCalledTimes(1);
  });

  it('rejects only when the fallback rejects', async () => {
    const d = deps('ios', '18.0');
    d.openSettings.mockRejectedValue(new Error('no settings'));
    await expect(openNotificationSettings(d)).rejects.toThrow('no settings');
  });
});
