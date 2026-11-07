// @ai-generated
/**
 * The mushaf preload waits for the `mushaf-settings` store to hydrate, so the
 * text loads in the saved rewayah. When the hydrating read REJECTS (a full
 * device, QARIAHV2-20) the hydration-guarded storage keeps `hasHydrated()`
 * false for the whole process. The wait must end anyway: the preload reaches
 * a terminal state, reports the timeout once, and writes no setting.
 *
 * Runs against the real settings store and its real guarded storage, with
 * AsyncStorage replaced by a mock whose read rejects.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.reject(new Error('NSCocoaErrorDomain 640'))),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const mockDk = {
  rewayah: 'hafs',
  initialize: jest.fn(() => Promise.resolve()),
  switchRewayah: jest.fn((_rewayah: string) => Promise.resolve()),
  onRewayahChange: jest.fn(() => () => undefined),
};
jest.mock('../DigitalKhattDataService', () => ({
  get digitalKhattDataService() {
    return mockDk;
  },
}));
jest.mock('../QuranTextService', () => ({
  quranTextService: {clearCaches: jest.fn()},
}));
jest.mock('../RewayahDiffService', () => ({
  rewayahDiffService: {loadForRewayah: jest.fn()},
}));

jest.mock('@shopify/react-native-skia', () => ({
  Skia: {
    TypefaceFontProvider: {Make: () => ({registerFont: jest.fn()})},
    Data: {fromURI: jest.fn(() => Promise.resolve({}))},
    Typeface: {MakeFreeTypeFaceFromData: jest.fn(() => ({}))},
  },
}));

import {
  mushafPreloadService,
  SETTINGS_HYDRATION_TIMEOUT_MS,
} from '../MushafPreloadService';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
const captureMessage = Sentry.captureMessage as jest.Mock;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('stops waiting for a failed settings read and settles read-only', async () => {
  await flush();
  // The store's hydrating read rejected: it can never report hydration.
  expect(useMushafSettingsStore.persist.hasHydrated()).toBe(false);

  const init = mushafPreloadService.initialize();
  await flush();
  expect(mushafPreloadService.state).toBe('loading');
  expect(mockDk.initialize).not.toHaveBeenCalled();

  jest.advanceTimersByTime(SETTINGS_HYDRATION_TIMEOUT_MS);
  await init;

  expect(mushafPreloadService.state).toBe('ready');
  expect(mockDk.initialize).toHaveBeenCalledTimes(1);
  const timeoutReports = captureMessage.mock.calls.filter(
    ([message]) => message === 'mushaf-settings-hydration-timeout',
  );
  expect(timeoutReports).toEqual([
    [
      'mushaf-settings-hydration-timeout',
      expect.objectContaining({
        fingerprint: ['mushaf-settings-hydration-timeout'],
      }),
    ],
  ]);
  // Nothing wrote the defaults over the unreadable saved settings.
  expect(setItem).not.toHaveBeenCalled();

  // A read that was only slow finishes later: the text follows the saved
  // rewayah.
  getItem.mockImplementationOnce(() =>
    Promise.resolve(
      JSON.stringify({
        state: {rewayah: 'shubah', mushafRenderer: 'dk_v2'},
        version: 18,
      }),
    ),
  );
  await useMushafSettingsStore.persist.rehydrate();
  await flush();
  const hydrated = useMushafSettingsStore.getState().rewayah;
  expect(hydrated).not.toBe('hafs');
  expect(mockDk.switchRewayah).toHaveBeenCalledWith(hydrated);
});
