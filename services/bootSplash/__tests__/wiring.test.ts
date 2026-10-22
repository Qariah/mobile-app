// @ai ANR hotfix v2 — tests for the wiring module (services/bootSplash/index.ts).
// The native module and the Qariah analytics events are mocks.

let mockMarkerSet = false;
const mockNative = {
  setNonBlockingSplashForNextLaunch: jest.fn(),
  setNonBlockingSplashOffKeepGuard: jest.fn(),
  getBootSplashMode: jest.fn(() => 'control'),
  setBootRisk: jest.fn(() => {
    mockMarkerSet = true;
  }),
  getBootRisk: jest.fn(() => mockMarkerSet),
  getPreviousProcessInfo: jest.fn(() => Promise.resolve(null)),
};
jest.mock('@/modules/qariah-boot-splash', () => mockNative);

const mockTrackBootRiskEnrolled = jest.fn();
jest.mock('@/services/analytics/qariahEvents', () => ({
  qariahAnalytics: {trackBootRiskEnrolled: mockTrackBootRiskEnrolled},
}));

type WiringModule = typeof import('../index');

function loadWiring(os: 'android' | 'ios'): WiringModule {
  let mod: WiringModule | undefined;
  jest.isolateModules(() => {
    // isolateModules gives a fresh module registry, so set the platform on
    // the react-native instance that the wiring module will import.
    const rn = require('react-native') as typeof import('react-native');
    Object.defineProperty(rn.Platform, 'OS', {value: os, configurable: true});
    mod = require('../index') as WiringModule;
  });
  if (!mod) throw new Error('wiring module did not load');
  return mod;
}

beforeEach(() => {
  mockMarkerSet = false;
  jest.clearAllMocks();
});

describe('services/bootSplash wiring', () => {
  it('is active on Android when the native module reports a mode', () => {
    const {bootSplashExperiment} = loadWiring('android');
    expect(bootSplashExperiment.active).toBe(true);
  });

  it('sends boot_risk_enrolled only on a new enrolment', () => {
    const {enrolBootRisk} = loadWiring('android');
    enrolBootRisk('splash_stalled');
    expect(mockNative.setBootRisk).toHaveBeenCalledTimes(1);
    expect(mockTrackBootRiskEnrolled).toHaveBeenCalledTimes(1);
    // Review M1: the event carries THIS process's mode explicitly.
    expect(mockTrackBootRiskEnrolled).toHaveBeenCalledWith({
      reason: 'splash_stalled',
      boot_splash_mode: 'control',
    });
    enrolBootRisk('boot_not_completed');
    expect(mockTrackBootRiskEnrolled).toHaveBeenCalledTimes(1);
  });

  it('does not send boot_risk_enrolled when the marker is already set', () => {
    mockMarkerSet = true;
    const {enrolBootRisk} = loadWiring('android');
    enrolBootRisk('boot_not_completed');
    expect(mockTrackBootRiskEnrolled).not.toHaveBeenCalled();
  });

  it('does nothing on iOS', () => {
    const {bootSplashExperiment, enrolBootRisk} = loadWiring('ios');
    expect(bootSplashExperiment.active).toBe(false);
    enrolBootRisk('splash_stalled');
    expect(mockNative.setBootRisk).not.toHaveBeenCalled();
    expect(mockTrackBootRiskEnrolled).not.toHaveBeenCalled();
  });

  it('does not throw when the analytics call throws', () => {
    const {enrolBootRisk} = loadWiring('android');
    mockTrackBootRiskEnrolled.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => enrolBootRisk('splash_stalled')).not.toThrow();
  });

  it('bootSplashModeProp gives the mode on Android and undefined when unavailable', () => {
    const {bootSplashModeProp} = loadWiring('android');
    expect(bootSplashModeProp()).toBe('control');
    mockNative.getBootSplashMode.mockReturnValueOnce('unavailable');
    expect(bootSplashModeProp()).toBeUndefined();
    mockNative.getBootSplashMode.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(bootSplashModeProp()).toBeUndefined();
  });
});
