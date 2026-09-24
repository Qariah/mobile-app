/**
 * Guards the anonymous debug ID.
 *
 * The privacy assertions are the point of this file: the block must never carry
 * an email, a sha256 digest, or a QF OAuth subject. The fixtures below are the
 * shapes a regression would re-introduce.
 */

const mockStorage = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
    delete: (key: string) => mockStorage.delete(key),
    getAllKeys: () => Array.from(mockStorage.keys()),
  }),
}));

const TEST_DEVICE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
jest.mock('expo-crypto', () => ({
  randomUUID: () => '7c9e6679-7425-40de-944b-e07fc1f90ae7',
}));

jest.mock('expo-device', () => ({osName: 'iOS', osVersion: '26.5'}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        version: {semanticVersion: '3.2.0', buildNumber: 1725},
      },
    },
  },
}));

import {
  getDebugId,
  getDebugIdBlock,
  isVersionInfo,
  readVersionInfo,
  DEBUG_INFO_HEADING,
} from '../debugId';

/** Values a regression must never put in the block. */
const PII_FIXTURES = {
  email: 'omarzarka@gmail.com',
  // A sha256(email) digest — the lookup key into a PUBLIC R2 bucket.
  sha256: 'a'.repeat(64),
  // A QF OAuth subject (Hydra `sub`).
  oauthSubject: '9f8b7c6d-1234-5678-9abc-def012345678',
};

describe('getDebugId', () => {
  it('returns the anonymous device id', () => {
    expect(getDebugId()).toBe(TEST_DEVICE_ID);
  });

  it('is stable across calls', () => {
    expect(getDebugId()).toBe(getDebugId());
  });
});

describe('isVersionInfo', () => {
  it('accepts a string build number', () => {
    expect(isVersionInfo({semanticVersion: '3.2.0', buildNumber: '1725'})).toBe(
      true,
    );
  });

  it('accepts a numeric build number', () => {
    expect(isVersionInfo({semanticVersion: '3.2.0', buildNumber: 1725})).toBe(
      true,
    );
  });

  it.each([null, undefined, 'x', 42, {}, {semanticVersion: '3.2.0'}])(
    'rejects %p',
    value => {
      expect(isVersionInfo(value)).toBe(false);
    },
  );
});

describe('readVersionInfo', () => {
  it('reads the build-time version from the Expo manifest', () => {
    expect(readVersionInfo()).toEqual({
      semanticVersion: '3.2.0',
      buildNumber: 1725,
    });
  });
});

describe('getDebugIdBlock', () => {
  const block = getDebugIdBlock();

  it('starts with the diagnostic heading', () => {
    expect(block.split('\n')[0]).toBe(DEBUG_INFO_HEADING);
  });

  it('contains the device id', () => {
    expect(block).toContain(TEST_DEVICE_ID);
    expect(block).toContain(`Debug ID: ${TEST_DEVICE_ID}`);
  });

  it('contains the app version and the build number', () => {
    expect(block).toContain('3.2.0');
    expect(block).toContain('1725');
    expect(block).toContain('App: 3.2.0 (1725)');
  });

  it('contains the platform and the OS version', () => {
    expect(block).toContain('Platform: iOS 26.5');
  });

  it('is a short, readable block', () => {
    expect(block.split('\n')).toHaveLength(5);
  });

  it('names the device model — the most actionable support field', () => {
    expect(block).toMatch(/^Device: /m);
  });

  // --- privacy guards ---

  it('contains no email address', () => {
    expect(block).not.toContain(PII_FIXTURES.email);
    expect(block).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('contains no sha256-like digest', () => {
    expect(block).not.toContain(PII_FIXTURES.sha256);
    expect(block).not.toMatch(/\b[0-9a-f]{64}\b/i);
  });

  it('contains no identifier other than the device id', () => {
    expect(block).not.toContain(PII_FIXTURES.oauthSubject);
    const uuids =
      block.match(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      ) ?? [];
    expect(uuids).toEqual([TEST_DEVICE_ID]);
  });
});
