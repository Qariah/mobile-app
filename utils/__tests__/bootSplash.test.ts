// @ai Qariah (ANR WS-C) — the boot-splash seam must keep expo-splash-screen's
// behaviour and add only the overlay dismiss, and the module wrapper must be a
// safe no-op where the native module is absent (iOS, web, jest).

const mockHideAsync = jest.fn(() => Promise.resolve());
const mockPreventAutoHideAsync = jest.fn(() => Promise.resolve(true));
jest.mock('expo-splash-screen', () => ({
  hideAsync: mockHideAsync,
  preventAutoHideAsync: mockPreventAutoHideAsync,
}));

describe('utils/bootSplash with the native module present (Android)', () => {
  const calls: string[] = [];
  const native = {
    dismiss: jest.fn(() => calls.push('dismiss')),
    setEnabledForNextLaunch: jest.fn(),
    getMode: jest.fn(() => 'treatment'),
  };

  beforeEach(() => {
    jest.resetModules();
    calls.length = 0;
    mockHideAsync.mockImplementation(() => {
      calls.push('expoHide');
      return Promise.resolve();
    });
    jest.doMock('expo', () => ({
      requireOptionalNativeModule: () => native,
    }));
  });

  it('dismisses the overlay, then hides the expo splash', async () => {
    const SplashScreen = require('../bootSplash');
    await SplashScreen.hideAsync();
    expect(calls).toEqual(['dismiss', 'expoHide']);
  });

  it('passes preventAutoHideAsync through unchanged', async () => {
    const SplashScreen = require('../bootSplash');
    await expect(SplashScreen.preventAutoHideAsync()).resolves.toBe(true);
    expect(mockPreventAutoHideAsync).toHaveBeenCalled();
  });

  it('still hides the expo splash when the native dismiss throws', async () => {
    native.dismiss.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const SplashScreen = require('../bootSplash');
    await SplashScreen.hideAsync();
    expect(calls).toEqual(['expoHide']);
  });

  it('reports the native mode and forwards the next-launch flag', () => {
    const mod = require('../../modules/qariah-boot-splash');
    expect(mod.getBootSplashMode()).toBe('treatment');
    mod.setNonBlockingSplashForNextLaunch(true);
    expect(native.setEnabledForNextLaunch).toHaveBeenCalledWith(true);
  });
});

describe('modules/qariah-boot-splash without the native module (iOS/web)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('expo', () => ({requireOptionalNativeModule: () => null}));
  });

  it('is a no-op and reports unavailable', async () => {
    const mod = require('../../modules/qariah-boot-splash');
    expect(() => mod.dismissBootOverlay()).not.toThrow();
    expect(() => mod.setNonBlockingSplashForNextLaunch(true)).not.toThrow();
    expect(mod.getBootSplashMode()).toBe('unavailable');
    const SplashScreen = require('../bootSplash');
    mockHideAsync.mockClear();
    await SplashScreen.hideAsync();
    expect(mockHideAsync).toHaveBeenCalledTimes(1);
  });
});
