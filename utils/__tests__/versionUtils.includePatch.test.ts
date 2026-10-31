// @ai-generated
// Qariah (TECH_DEBT #390): `hasVersionChanged({includePatch: true})` also
// reports a patch update, so a patch release (3.2.1 → 3.2.3) can show its
// update pages. Without the option, upstream's rule stays: minor or major only.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {hasVersionChanged} from '../versionUtils';

let mockVersion = '3.2.3';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {version: mockVersion};
    },
  },
}));

const KEY = '@bayaan_last_seen_version';

async function lastSeen(value: string | null) {
  await AsyncStorage.clear();
  if (value !== null) await AsyncStorage.setItem(KEY, value);
}

describe('hasVersionChanged', () => {
  beforeEach(() => {
    mockVersion = '3.2.3';
  });

  it('reports a patch update only with includePatch', async () => {
    await lastSeen('3.2.1');
    expect(await hasVersionChanged({includePatch: true})).toBe(true);
    // The update pages mark the version as seen when they close, not before.
    expect(await AsyncStorage.getItem(KEY)).toBe('3.2.1');
  });

  it('keeps the upstream rule without the option: a patch is marked seen silently', async () => {
    await lastSeen('3.2.1');
    expect(await hasVersionChanged()).toBe(false);
    expect(await AsyncStorage.getItem(KEY)).toBe('3.2.3');
  });

  it('reports a minor update with or without the option', async () => {
    mockVersion = '3.3.0';
    await lastSeen('3.2.1');
    expect(await hasVersionChanged()).toBe(true);
    expect(await hasVersionChanged({includePatch: true})).toBe(true);
  });

  it('reports nothing for the same version or a downgrade', async () => {
    await lastSeen('3.2.3');
    expect(await hasVersionChanged({includePatch: true})).toBe(false);
    await lastSeen('3.3.0');
    expect(await hasVersionChanged({includePatch: true})).toBe(false);
  });

  it('reports a first launch (no version seen)', async () => {
    await lastSeen(null);
    expect(await hasVersionChanged({includePatch: true})).toBe(true);
  });
});
