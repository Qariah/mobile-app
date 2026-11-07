// @ai-generated
// Qariah (Sprint 48, S48.7, Task 17): the holdout accessor and the permission
// decision of the Notifications page.
import {
  isNotificationsHoldout,
  NOTIFICATIONS_HOLDOUT_ARM_KEY,
  readNotificationsHoldoutArm,
} from '../holdout';
import {notificationPermissionAction} from '../permissionAction';
import type {KeyValueStorage} from '../types';

function storageWith(value: string | undefined): KeyValueStorage {
  return {
    getString: key =>
      key === NOTIFICATIONS_HOLDOUT_ARM_KEY ? value : undefined,
    set: jest.fn(),
    remove: jest.fn(),
  };
}

const throwing: KeyValueStorage = {
  getString: () => {
    throw new Error('MMKV is not readable');
  },
  set: jest.fn(),
  remove: jest.fn(),
};

describe('isNotificationsHoldout', () => {
  it('uses the key that Task 16 writes', () => {
    expect(NOTIFICATIONS_HOLDOUT_ARM_KEY).toBe('holdout_arm');
  });

  it('follows a written arm, in a release and in a DEV build', () => {
    for (const isDev of [false, true]) {
      expect(isNotificationsHoldout(storageWith('holdout'), isDev)).toBe(true);
      expect(isNotificationsHoldout(storageWith('notify'), isDev)).toBe(false);
    }
  });

  it('counts an unknown arm as the holdout in a release build', () => {
    expect(isNotificationsHoldout(storageWith(undefined), false)).toBe(true);
    expect(isNotificationsHoldout(storageWith('control'), false)).toBe(true);
    expect(isNotificationsHoldout(throwing, false)).toBe(true);
  });

  it('counts an unknown arm as "notify" in a DEV build', () => {
    expect(isNotificationsHoldout(storageWith(undefined), true)).toBe(false);
    expect(isNotificationsHoldout(throwing, true)).toBe(false);
  });

  it('reads only the two known values', () => {
    expect(readNotificationsHoldoutArm(storageWith('holdout'))).toBe('holdout');
    expect(readNotificationsHoldoutArm(storageWith('notify'))).toBe('notify');
    expect(readNotificationsHoldoutArm(storageWith('HOLDOUT'))).toBeNull();
    expect(readNotificationsHoldoutArm(storageWith(undefined))).toBeNull();
    expect(readNotificationsHoldoutArm(throwing)).toBeNull();
  });
});

describe('notificationPermissionAction', () => {
  it('shows no banner when notifications are allowed', () => {
    expect(
      notificationPermissionAction({
        status: 'granted',
        granted: true,
        canAskAgain: true,
      }),
    ).toBe('none');
  });

  it('shows no banner for a provisional iOS grant', () => {
    expect(
      notificationPermissionAction({
        status: 'denied',
        granted: false,
        canAskAgain: false,
        ios: {status: 3},
      }),
    ).toBe('none');
  });

  it('asks when the system was never asked (iOS) or can ask again (Android)', () => {
    expect(
      notificationPermissionAction({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
        ios: {status: 0},
      }),
    ).toBe('ask');
    // Android 13+ after the first denial.
    expect(
      notificationPermissionAction({
        status: 'denied',
        granted: false,
        canAskAgain: true,
      }),
    ).toBe('ask');
  });

  it('opens the settings when the system cannot ask', () => {
    // iOS after "Don't Allow"; Android after the second denial.
    expect(
      notificationPermissionAction({
        status: 'denied',
        granted: false,
        canAskAgain: false,
        ios: {status: 1},
      }),
    ).toBe('openSettings');
  });

  it('opens the settings when Android has the permission but the app notifications are off', () => {
    expect(
      notificationPermissionAction({
        status: 'denied',
        granted: true,
        canAskAgain: true,
      }),
    ).toBe('openSettings');
  });
});
