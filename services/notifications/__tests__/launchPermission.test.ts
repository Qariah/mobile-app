// @ai
// Divergence batch C5: the Android POST_NOTIFICATIONS request at launch moved
// from upstream's ExpoAudioProvider (audio init) to the notifications feature.
// These cases pin the moved behaviour: the same request options, the same
// "read first, ask only when not granted" rule, and the same #104 denial
// bookkeeping in `backgroundPlaybackStore`.
import {Platform} from 'react-native';

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) =>
    mockRequestPermissions(...args),
}));

const mockStore = {
  notificationsDenied: false,
  recordNotificationsDenied: jest.fn(() => {
    mockStore.notificationsDenied = true;
  }),
};
const mockSetState = jest.fn((patch: {notificationsDenied: boolean}) => {
  mockStore.notificationsDenied = patch.notificationsDenied;
});
jest.mock('@/store/backgroundPlaybackStore', () => ({
  useBackgroundPlaybackStore: {
    getState: () => mockStore,
    setState: (patch: {notificationsDenied: boolean}) => mockSetState(patch),
  },
}));

import {requestLaunchNotificationPermission} from '../launchPermission';

const ANDROID_REQUEST = {
  android: {allowAlert: true, allowBadge: false, allowSound: false},
};

let originalOS: typeof Platform.OS;

function setOS(os: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true});
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.notificationsDenied = false;
  originalOS = Platform.OS;
  setOS('android');
});

afterEach(() => {
  setOS(originalOS as 'ios' | 'android');
});

describe('requestLaunchNotificationPermission (moved from the audio provider)', () => {
  it('iOS: asks for nothing and loads nothing', async () => {
    setOS('ios');
    await requestLaunchNotificationPermission();
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('Android, not granted: asks with the same options; a grant is not a denial', async () => {
    mockGetPermissions.mockResolvedValue({status: 'undetermined'});
    mockRequestPermissions.mockResolvedValue({status: 'granted'});
    await requestLaunchNotificationPermission();
    expect(mockRequestPermissions).toHaveBeenCalledWith(ANDROID_REQUEST);
    expect(mockStore.recordNotificationsDenied).not.toHaveBeenCalled();
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it('Android, the user denies: records the denial for the #104 prompt', async () => {
    mockGetPermissions.mockResolvedValue({status: 'undetermined'});
    mockRequestPermissions.mockResolvedValue({status: 'denied'});
    await requestLaunchNotificationPermission();
    expect(mockStore.recordNotificationsDenied).toHaveBeenCalledTimes(1);
  });

  it('Android, already denied and the system cannot ask: records the denial', async () => {
    mockGetPermissions.mockResolvedValue({status: 'denied'});
    mockRequestPermissions.mockResolvedValue({status: 'denied'});
    await requestLaunchNotificationPermission();
    expect(mockRequestPermissions).toHaveBeenCalledWith(ANDROID_REQUEST);
    expect(mockStore.recordNotificationsDenied).toHaveBeenCalledTimes(1);
  });

  it('Android, granted: no request; clears an old denial', async () => {
    mockStore.notificationsDenied = true;
    mockGetPermissions.mockResolvedValue({status: 'granted'});
    await requestLaunchNotificationPermission();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockSetState).toHaveBeenCalledWith({notificationsDenied: false});
  });

  it('Android, granted with no old denial: writes nothing', async () => {
    mockGetPermissions.mockResolvedValue({status: 'granted'});
    await requestLaunchNotificationPermission();
    expect(mockSetState).not.toHaveBeenCalled();
    expect(mockStore.recordNotificationsDenied).not.toHaveBeenCalled();
  });

  it('a failed read or request never throws', async () => {
    mockGetPermissions.mockRejectedValue(new Error('no activity'));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(requestLaunchNotificationPermission()).resolves.toBe(
      undefined,
    );
    expect(mockStore.recordNotificationsDenied).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
