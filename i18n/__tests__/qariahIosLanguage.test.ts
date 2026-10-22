// @ai-generated
// Qariah: the iOS per-app language follows the in-app language choice.
const mockDefaults = new Map<string, unknown>();
const mockPlatform = {OS: 'ios'};

// A partial mock: the real react-native module with only Platform and
// Settings replaced. jest-expo's setup and its global fetch getter need the
// rest of it, even after the suite ends (a full replacement left a
// post-teardown error and kept CI's Jest process from exiting cleanly).
// Properties are redefined, not spread, so no other lazy getter runs.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  Object.defineProperty(actual, 'Platform', {
    configurable: true,
    get: () => mockPlatform,
  });
  Object.defineProperty(actual, 'Settings', {
    configurable: true,
    value: {
      get: (key: string) => mockDefaults.get(key),
      set: (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) {
          if (value === null) mockDefaults.delete(key);
          else mockDefaults.set(key, value);
        }
      },
    },
  });
  return actual;
});

// The native setter writes or removes the app's AppleLanguages default.
const mockNative = {
  setPreferredLanguage: jest.fn((code: string | null) => {
    if (code) mockDefaults.set('AppleLanguages', [code]);
    else mockDefaults.delete('AppleLanguages');
  }),
  // The device's own list (the global domain): English in these tests.
  getSystemLanguages: jest.fn(() => ['en-US', 'fr-FR']),
};
let mockHasNative = true;
jest.mock('expo', () => ({
  requireOptionalNativeModule: () => (mockHasNative ? mockNative : null),
}));

import {
  deviceLanguagesWithoutOverride,
  syncIosAppLanguage,
} from '../qariahIosLanguage';

beforeEach(() => {
  mockDefaults.clear();
  mockPlatform.OS = 'ios';
  mockHasNative = true;
});

it('writes the chosen language as the per-app language', () => {
  expect(syncIosAppLanguage('ar')).toBe(true);
  expect(mockDefaults.get('AppleLanguages')).toEqual(['ar']);
  // The same choice again changes nothing.
  expect(syncIosAppLanguage('ar')).toBe(false);
  expect(syncIosAppLanguage('en')).toBe(true);
  expect(mockDefaults.get('AppleLanguages')).toEqual(['en']);
});

it('removes its own value for System default', () => {
  syncIosAppLanguage('ar');
  expect(syncIosAppLanguage('system')).toBe(true);
  expect(mockDefaults.has('AppleLanguages')).toBe(false);
  expect(syncIosAppLanguage('system')).toBe(false);
});

it('keeps a per-app language that the person set in iOS Settings', () => {
  mockDefaults.set('AppleLanguages', ['fr']);
  expect(syncIosAppLanguage('system')).toBe(false);
  expect(mockDefaults.get('AppleLanguages')).toEqual(['fr']);
  // A previous session wrote 'ar'; the person then chose English in the iOS
  // Settings app (iOS restarts the app for that).
  mockDefaults.set('qariah_apple_languages', 'ar');
  mockDefaults.set('AppleLanguages', ['en']);
  expect(syncIosAppLanguage('system')).toBe(false);
  expect(mockDefaults.get('AppleLanguages')).toEqual(['en']);
});

it('does nothing without the native setter (an older binary)', () => {
  mockHasNative = false;
  expect(syncIosAppLanguage('ar')).toBe(false);
  expect(mockDefaults.size).toBe(0);
});

it('does nothing on Android', () => {
  mockPlatform.OS = 'android';
  expect(syncIosAppLanguage('ar')).toBe(false);
  expect(mockDefaults.size).toBe(0);
});

describe('invertLtrNativeSlider', () => {
  function loadWith(languages: unknown, os = 'ios'): boolean {
    mockDefaults.set('AppleLanguages', languages);
    mockPlatform.OS = os;
    let value = false;
    jest.isolateModules(() => {
      value = (
        require('../qariahIosLanguage') as typeof import('../qariahIosLanguage')
      ).invertLtrNativeSlider;
    });
    return value;
  }

  it('is true when the first localized language is RTL', () => {
    expect(loadWith(['ar'])).toBe(true);
    expect(loadWith(['fr-FR', 'ar-SA'])).toBe(true);
  });

  it('is false for an LTR localization, without data, or on Android', () => {
    expect(loadWith(['en-US', 'ar'])).toBe(false);
    expect(loadWith(undefined)).toBe(false);
    expect(loadWith(['ar'], 'android')).toBe(false);
  });
});

it('gives the device languages, not its own value, while that value is set', () => {
  // No Qariah value: expo-localization already reports the device list.
  expect(deviceLanguagesWithoutOverride()).toBeNull();
  syncIosAppLanguage('ar');
  expect(deviceLanguagesWithoutOverride()).toEqual(['en', 'fr']);
  syncIosAppLanguage('system');
  expect(deviceLanguagesWithoutOverride()).toBeNull();
  mockPlatform.OS = 'android';
  expect(deviceLanguagesWithoutOverride()).toBeNull();
});
