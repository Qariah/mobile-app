// @ai Qariah (Lite mode, step 1) — the switch: which phones get Lite, the
// owner's override, and that a broken store never throws into the boot.

const mockDevice: {
  totalMemory: number | null;
  supportedCpuArchitectures: string[] | null;
} = {
  totalMemory: null,
  supportedCpuArchitectures: null,
};
// Getters: a namespace import copies plain properties once.
jest.mock('expo-device', () => ({
  __esModule: true,
  get totalMemory() {
    return mockDevice.totalMemory;
  },
  get supportedCpuArchitectures() {
    return mockDevice.supportedCpuArchitectures;
  },
}));

const mockStore = new Map<string, string>();
const mockCreate = {fail: false};
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    if (mockCreate.fail) throw new Error('mmkv unavailable');
    return {
      getString: (key: string) => {
        const value = mockStore.get(key);
        return typeof value === 'string' ? value : undefined;
      },
      set: (key: string, value: string) => mockStore.set(key, value),
    };
  },
}));

const mockPlatform = {OS: 'android'};
jest.mock('react-native', () => ({
  get Platform() {
    return mockPlatform;
  },
}));

import {
  getLiteModeSetting,
  isLiteMode,
  isLowEndDevice,
  deviceRamGb,
  liteImageProps,
  ramGbFromBytes,
  resetLiteModeForTests,
  resolveLiteMode,
  setLiteModeSetting,
  withoutShadowInLite,
} from '../liteMode';

const GB = 1024 * 1024 * 1024;
const A10S = {
  os: 'android',
  totalMemory: 1.8 * GB,
  abis: ['armeabi-v7a', 'armeabi'],
};
const PIXEL_3 = {
  os: 'android',
  totalMemory: 3.7 * GB,
  abis: ['arm64-v8a', 'armeabi-v7a'],
};

beforeEach(() => {
  mockStore.clear();
  mockCreate.fail = false;
  mockPlatform.OS = 'android';
  mockDevice.totalMemory = null;
  mockDevice.supportedCpuArchitectures = null;
  resetLiteModeForTests();
});

describe('isLowEndDevice', () => {
  it('is true for a 2 GB, 32-bit phone (the Samsung A10s)', () => {
    expect(isLowEndDevice(A10S)).toBe(true);
  });

  it('is false for a 4 GB, 64-bit phone (the Pixel 3)', () => {
    expect(isLowEndDevice(PIXEL_3)).toBe(false);
  });

  it('is true for a 32-bit-only phone with enough RAM', () => {
    expect(
      isLowEndDevice({
        os: 'android',
        totalMemory: 4 * GB,
        abis: ['armeabi-v7a'],
      }),
    ).toBe(true);
  });

  it('is false when nothing is known, and always on iOS', () => {
    expect(isLowEndDevice({os: 'android', totalMemory: null, abis: null})).toBe(
      false,
    );
    expect(isLowEndDevice({...A10S, os: 'ios'})).toBe(false);
  });
});

describe('resolveLiteMode', () => {
  it('follows the device on auto, and the owner on on/off', () => {
    expect(resolveLiteMode('auto', A10S)).toBe(true);
    expect(resolveLiteMode('auto', PIXEL_3)).toBe(false);
    expect(resolveLiteMode('on', PIXEL_3)).toBe(true);
    expect(resolveLiteMode('off', A10S)).toBe(false);
  });
});

describe('isLiteMode', () => {
  it('turns on by itself on a low-end Android phone', () => {
    mockDevice.totalMemory = 1.8 * GB;
    expect(isLiteMode()).toBe(true);
  });

  it('keeps the first answer for the whole process', () => {
    mockDevice.totalMemory = 1.8 * GB;
    expect(isLiteMode()).toBe(true);
    setLiteModeSetting('off');
    expect(isLiteMode()).toBe(true);
    expect(getLiteModeSetting()).toBe('off');
  });

  it('applies a saved choice at the next launch', () => {
    mockDevice.totalMemory = 1.8 * GB;
    setLiteModeSetting('off');
    resetLiteModeForTests();
    expect(isLiteMode()).toBe(false);
  });

  it('reads auto, and does not throw, when the store cannot open', () => {
    mockCreate.fail = true;
    mockDevice.totalMemory = 1.8 * GB;
    expect(getLiteModeSetting()).toBe('auto');
    expect(() => setLiteModeSetting('on')).not.toThrow();
    expect(isLiteMode()).toBe(true);
  });
});

describe('the Lite helpers', () => {
  it('give image and shadow changes only in Lite mode', () => {
    const card = {elevation: 2, shadowOpacity: 0.5, borderRadius: 8};
    mockDevice.totalMemory = 4 * GB;
    expect(liteImageProps()).toEqual({});
    expect(withoutShadowInLite(card)).toBe(card);

    resetLiteModeForTests();
    mockDevice.totalMemory = 1.8 * GB;
    expect(liteImageProps()).toEqual({transition: 0, decodeFormat: 'rgb'});
    expect(withoutShadowInLite(card)).toEqual({borderRadius: 8});
  });
});

describe('the RAM group', () => {
  it('rounds up to the size that the phone is sold with', () => {
    expect(ramGbFromBytes(1.8 * GB)).toBe(2);
    expect(ramGbFromBytes(2.8 * GB)).toBe(3);
    expect(ramGbFromBytes(3.6 * GB)).toBe(4);
    expect(ramGbFromBytes(7.4 * GB)).toBe(8);
  });

  it('is null when the phone does not report it', () => {
    expect(ramGbFromBytes(null)).toBeNull();
    expect(ramGbFromBytes(0)).toBeNull();
    mockDevice.totalMemory = null;
    expect(deviceRamGb()).toBeNull();
  });

  it('reads this phone', () => {
    mockDevice.totalMemory = 3.6 * GB;
    expect(deviceRamGb()).toBe(4);
  });
});
