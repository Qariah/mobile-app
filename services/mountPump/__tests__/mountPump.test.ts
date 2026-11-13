// @ai Tests for the switch of the mount pump (ANR floor work, class B).

const mockSetEnabled = jest.fn();
const mockBuildFlag = jest.fn((_flag: string) => true);

const mockTrack = jest.fn();
const mockBreadcrumb = jest.fn();
let mockReturnListener: ((e: unknown) => void) | null = null;
const mockRemove = jest.fn();

jest.mock('@/modules/qariah-mount-pump', () => ({
  setMountPumpEnabled: (on: boolean) => mockSetEnabled(on),
  getMountPumpState: () => 'on',
  addReturnFrameListener: (cb: (e: unknown) => void) => {
    mockReturnListener = cb;
    return mockRemove;
  },
}));
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: (b: unknown) => mockBreadcrumb(b),
}));
jest.mock('@/services/analytics/qariahEvents', () => ({
  qariahAnalytics: {trackAppReturnSlow: (p: unknown) => mockTrack(p)},
}));
jest.mock('@/config/qariahFeatureFlags', () => ({
  isQariahFeatureEnabled: (flag: string) => mockBuildFlag(flag),
}));

import {
  applyMountPump,
  labMountPumpOverride,
  mountPumpWanted,
  MOUNT_PUMP_DEFAULT_ON,
  MOUNT_PUMP_FLAG,
  reportReturnFrame,
  RETURN_SLOW_MS,
  startReturnFrameReport,
} from '../index';

beforeEach(() => {
  mockSetEnabled.mockClear();
  mockTrack.mockClear();
  mockBreadcrumb.mockClear();
  mockRemove.mockClear();
  mockReturnListener = null;
  mockBuildFlag.mockReset();
  mockBuildFlag.mockReturnValue(true);
});

describe('mountPumpWanted', () => {
  it.each([
    // build flag, remote, default → wanted
    [true, undefined, true, true],
    [true, undefined, false, false],
    [true, 'other', true, true],
    [true, true, false, true],
    [true, 'on', false, true],
    [true, 'treatment', false, true],
    [true, false, true, false],
    [true, 'off', true, false],
    [true, 'control', true, false],
    [false, undefined, true, false],
    [false, true, true, false],
  ] as const)(
    'build flag %p, remote %p, default %p → %p',
    (build, remote, defaultOn, wanted) => {
      expect(mountPumpWanted(build, remote, defaultOn)).toBe(wanted);
    },
  );
});

describe('labMountPumpOverride', () => {
  it.each([
    ['on', true],
    ['off', false],
    [undefined, undefined],
    ['', undefined],
    ['1', undefined],
  ] as const)('%p → %p', (value, expected) => {
    expect(labMountPumpOverride(value)).toBe(expected);
  });

  it('a store build has no override', () => {
    expect(process.env.EXPO_PUBLIC_QARIAH_LAB_MOUNT_PUMP).toBeUndefined();
    expect(labMountPumpOverride()).toBeUndefined();
  });
});

describe('applyMountPump', () => {
  it('uses the default before any flag response', () => {
    applyMountPump(undefined);
    expect(mockBuildFlag).toHaveBeenCalledWith('backgroundMountPump');
    expect(mockSetEnabled).toHaveBeenLastCalledWith(MOUNT_PUMP_DEFAULT_ON);
  });

  it('is off by default: the field must show its value first', () => {
    expect(MOUNT_PUMP_DEFAULT_ON).toBe(false);
    applyMountPump(undefined);
    expect(mockSetEnabled).toHaveBeenLastCalledWith(false);
  });

  it('follows the remote flag in both directions', () => {
    applyMountPump(true);
    expect(mockSetEnabled).toHaveBeenLastCalledWith(true);
    applyMountPump(false);
    expect(mockSetEnabled).toHaveBeenLastCalledWith(false);
    applyMountPump('treatment');
    expect(mockSetEnabled).toHaveBeenLastCalledWith(true);
  });

  it('stays off when the build flag is off', () => {
    mockBuildFlag.mockReturnValue(false);
    applyMountPump(true);
    expect(mockSetEnabled).toHaveBeenLastCalledWith(false);
  });

  it('never throws when the native call throws', () => {
    mockSetEnabled.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => applyMountPump(undefined)).not.toThrow();
  });

  it('names the PostHog flag', () => {
    expect(MOUNT_PUMP_FLAG).toBe('background_mount_pump');
  });
});

describe('the return-frame report', () => {
  it('leaves a breadcrumb for each return frame and no event below the limit', () => {
    reportReturnFrame({frameMs: 900, backgroundSeconds: 60, pump: 'on'});
    expect(mockBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockBreadcrumb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: 'diag.return-frame',
        level: 'info',
        data: {frame_ms: 900, background_s: 60, mount_pump: 'on'},
      }),
    );
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('sends app_return_slow from the limit', () => {
    reportReturnFrame({
      frameMs: RETURN_SLOW_MS,
      backgroundSeconds: 1500.4,
      pump: 'off',
    });
    expect(mockTrack).toHaveBeenCalledWith({
      frame_ms: RETURN_SLOW_MS,
      background_s: 1500,
      mount_pump: 'off',
    });
    expect(mockBreadcrumb).toHaveBeenLastCalledWith(
      expect.objectContaining({level: 'warning'}),
    );
  });

  it('drops a bad payload and never throws', () => {
    expect(() =>
      reportReturnFrame({
        frameMs: Number.NaN,
        backgroundSeconds: 1,
        pump: 'on',
      }),
    ).not.toThrow();
    expect(mockTrack).not.toHaveBeenCalled();
    expect(mockBreadcrumb).not.toHaveBeenCalled();
    mockBreadcrumb.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() =>
      reportReturnFrame({frameMs: 5000, backgroundSeconds: 1, pump: 'on'}),
    ).not.toThrow();
  });

  it('startReturnFrameReport connects the native listener and returns its remover', () => {
    const stop = startReturnFrameReport();
    expect(mockReturnListener).not.toBeNull();
    mockReturnListener?.({frameMs: 2000, backgroundSeconds: 10, pump: 'on'});
    expect(mockTrack).toHaveBeenCalledTimes(1);
    stop();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
