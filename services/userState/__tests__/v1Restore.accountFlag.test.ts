// @ai
// TECH_DEBT #244 (M4 + Low) — the v1-restore flag is per account.
//
// Before M4 the flag was device-wide: a second account never got its v1
// check. The first M4 fix cleared the flag at sign-out, so the same account
// saw the v1 prompt again after a sign-out and a sign-in (the Low). Now the
// flag is `@qariah:v1RestoreDone:<account hash>` and sign-out keeps it.
// The account check, `/userinfo`, the hash and the R2 fetch are mocks.

import AsyncStorage from '@react-native-async-storage/async-storage';

// The import chain reaches the player stores and AnalyticsService; same stubs
// as v1Restore.merge.test.ts.
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: () => undefined,
    set: () => undefined,
    delete: () => undefined,
    getAllKeys: () => [],
  }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-device-id',
  CryptoDigestAlgorithm: {SHA256: 'SHA-256'},
  CryptoEncoding: {HEX: 'hex'},
  digestStringAsync: async () => 'email-hash-0123456789',
}));
jest.mock('@/services/userState', () => ({
  enqueueFavoritesSync: jest.fn(),
  enqueueReadingSessionSync: jest.fn(),
  enqueuePreferenceSync: jest.fn(),
}));
jest.mock('@/data/reciterData', () => ({RECITERS: []}));

const mockEnsureAccountVerified = jest.fn();

jest.mock('../accountCleanup', () => ({
  ensureAccountVerified: () => mockEnsureAccountVerified(),
}));

const mockFetchQfUserInfo = jest.fn();

jest.mock('../qfUserInfo', () => ({
  fetchQfUserInfo: () => mockFetchQfUserInfo(),
}));

import {
  checkForV1Restore,
  isV1RestoreDone,
  skipV1Restore,
  V1_RESTORE_FLAG_KEY,
} from '../v1Restore';

const fetchMock = jest.fn();

async function asAccount(hash: string): Promise<void> {
  mockEnsureAccountVerified.mockResolvedValue({
    kind: 'ok',
    accountHash: hash,
    change: 'same',
  });
  await AsyncStorage.setItem('@qariah:qfAccountHash', hash);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (globalThis as {fetch: unknown}).fetch = fetchMock;
  fetchMock.mockReset();
  mockFetchQfUserInfo.mockResolvedValue({
    email: 'user@example.invalid',
    first_name: '',
    last_name: '',
    sub: 'sub',
  });
});

describe('M4 — per-account v1-restore flag', () => {
  it('does not ask the same account again after a sign-out and sign-in', async () => {
    await asAccount('hash-a');
    await skipV1Restore();

    // Sign-out keeps the flag; the same account signs in again.
    const result = await checkForV1Restore();

    expect(result).toEqual({kind: 'already-done'});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs the check for a second account on the device', async () => {
    await asAccount('hash-a');
    await skipV1Restore();
    fetchMock.mockResolvedValue({status: 404, ok: false});

    await asAccount('hash-b');
    const result = await checkForV1Restore();

    expect(result).toMatchObject({kind: 'not-found'});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(`${V1_RESTORE_FLAG_KEY}:hash-b`)).toBe(
      '1',
    );
  });

  it('writes the device-wide key before any account check (an import while signed out)', async () => {
    await skipV1Restore();

    expect(await AsyncStorage.getItem(V1_RESTORE_FLAG_KEY)).toBe('1');
    expect(await isV1RestoreDone()).toBe(true);
  });

  it('reports a failed account check as a closed-set reason', async () => {
    mockEnsureAccountVerified.mockResolvedValue({
      kind: 'error',
      stage: 'cleanup',
      detail: 'SQLITE_FULL',
    });

    const result = await checkForV1Restore();

    expect(result).toMatchObject({
      kind: 'network-error',
      reason: 'account-check-failed',
    });
    expect(mockFetchQfUserInfo).not.toHaveBeenCalled();
  });
});
