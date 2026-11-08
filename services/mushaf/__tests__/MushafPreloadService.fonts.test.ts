// @ai-generated
/**
 * The fonts of the Mushaf preload: one sequential loader for the first load and
 * for a later try. A failed load recovers in the service, so every reader of
 * the service gets the fonts (SkiaPage reads quranCommonTypeface from it).
 */
import * as ReactNative from 'react-native';

const mockDk = {
  rewayah: 'hafs',
  initialized: false,
  initialize: jest.fn(async () => {
    mockDk.initialized = true;
  }),
  switchRewayah: jest.fn(() => Promise.resolve()),
  onRewayahChange: jest.fn(() => () => undefined),
};
// Pass D: expo-localization 58 loads `expo`, whose asset effect needs the
// Image.resolveAssetSource that the font tests replace with a spy.
jest.mock('expo-localization', () => ({
  getLocales: () => [{languageCode: 'en', languageTag: 'en-US'}],
}));
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
jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const mockFromURI = jest.fn();
const mockMakeTypeface = jest.fn();
const mockMakeProvider = jest.fn();
jest.mock('@shopify/react-native-skia', () => ({
  Skia: {
    Data: {fromURI: (uri: string) => mockFromURI(uri)},
    Typeface: {
      MakeFreeTypeFaceFromData: (data: unknown) => mockMakeTypeface(data),
    },
    TypefaceFontProvider: {Make: () => mockMakeProvider()},
  },
}));

// Each asset is its own number (metro-style require), so a test can fail one
// family by its order in FONT_ASSETS.
const FAMILIES = [
  'DigitalKhattV1',
  'DigitalKhattV2',
  'DigitalKhattIndoPak',
  'QuranCommon',
  'SurahNameV4',
  'SurahNameQCF',
  'ManropeSemiBold',
  'ManropeRegular',
  'PlexSansArabicSemiBold',
];
const QURAN_COMMON = FAMILIES.indexOf('QuranCommon');
const SURAH_NAME_QCF = FAMILIES.indexOf('SurahNameQCF');

type Service =
  (typeof import('../MushafPreloadService'))['mushafPreloadService'];

function loadService(): Service {
  let service!: Service;
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ReactNative);
    service = require('../MushafPreloadService').mushafPreloadService;
  });
  return service;
}

// A pass reads the families in order, so the index of a read names its family.
let reads = 0;
let failing = new Set<number>();
function typefaceForNextRead() {
  const family = reads % FAMILIES.length;
  reads += 1;
  return failing.has(family) ? null : {family: FAMILIES[family]};
}

async function advance(ms: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
}

describe('the Mushaf preload fonts', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    reads = 0;
    failing = new Set();
    mockDk.initialized = false;
    mockDk.initialize.mockClear();
    mockFromURI.mockReset().mockResolvedValue({});
    mockMakeTypeface.mockReset().mockImplementation(typefaceForNextRead);
    mockMakeProvider.mockReset().mockImplementation(() => ({
      registerFont: jest.fn(),
    }));
    jest
      .spyOn(ReactNative.Image, 'resolveAssetSource')
      .mockReturnValue({uri: 'asset://font', width: 0, height: 0, scale: 1});
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('loads every font once, one read at a time, on a normal launch', async () => {
    let reading = 0;
    let mostAtOnce = 0;
    mockFromURI.mockImplementation(async () => {
      reading += 1;
      mostAtOnce = Math.max(mostAtOnce, reading);
      await Promise.resolve();
      reading -= 1;
      return {};
    });
    const service = loadService();

    await service.initialize();
    await advance(60000);

    expect(service.state).toBe('ready');
    expect(service.loadError).toBe(false);
    expect(mockMakeProvider).toHaveBeenCalledTimes(1);
    expect(mockFromURI).toHaveBeenCalledTimes(FAMILIES.length);
    expect(mostAtOnce).toBe(1);
    expect(
      service.fontMgr &&
        (service.fontMgr.registerFont as jest.Mock).mock.calls.map(
          ([, family]: [unknown, string]) => family,
        ),
    ).toEqual(FAMILIES);
    expect(service.quranCommonTypeface).toEqual({family: 'QuranCommon'});
    expect(service.surahNameTypeface).toEqual({family: 'SurahNameV4'});
  });

  it('publishes nothing before the run ends', async () => {
    let finishData!: () => void;
    mockDk.initialize.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishData = () => {
            mockDk.initialized = true;
            resolve();
          };
        }),
    );
    const service = loadService();

    const done = service.initialize();
    await advance(0);
    expect(mockFromURI).toHaveBeenCalledTimes(FAMILIES.length);
    expect(service.fontMgr).toBeNull();
    expect(service.quranCommonTypeface).toBeNull();

    finishData();
    await done;
    expect(service.fontMgr).not.toBeNull();
  });

  it('accepts a missing ornamental font, after one more pass at once', async () => {
    failing = new Set([SURAH_NAME_QCF]);
    const service = loadService();

    await service.initialize();
    await advance(60000);

    expect(service.state).toBe('ready');
    expect(service.fontMgr).not.toBeNull();
    expect(mockMakeProvider).toHaveBeenCalledTimes(2);
  });

  describe('after a critical font fails', () => {
    it('recovers for every reader of the service, and notifies them', async () => {
      failing = new Set([QURAN_COMMON]);
      const service = loadService();
      const listener = jest.fn();
      service.subscribe(listener);

      await service.initialize();
      expect(service.state).toBe('failed');
      expect(service.fontMgr).toBeNull();
      expect(service.quranCommonTypeface).toBeNull();
      expect(listener).toHaveBeenCalledTimes(1);

      failing = new Set();
      await advance(3000);

      expect(service.state).toBe('ready');
      expect(service.loadError).toBe(false);
      expect(service.fontMgr).not.toBeNull();
      expect(service.quranCommonTypeface).toEqual({family: 'QuranCommon'});
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('stops after three more tries, whatever mounts', async () => {
      failing = new Set([QURAN_COMMON]);
      const service = loadService();

      await service.initialize();
      const unsubscribers = Array.from({length: 20}, () =>
        service.subscribe(() => undefined),
      );
      await advance(60000);

      expect(service.state).toBe('failed');
      expect(service.fontMgr).toBeNull();
      // The first load is two passes.
      expect(mockMakeProvider).toHaveBeenCalledTimes(5);
      for (const unsubscribe of unsubscribers) unsubscribe();
    });

    it('stays failed after a font recovery while the data has failed', async () => {
      failing = new Set([QURAN_COMMON]);
      mockDk.initialize.mockImplementationOnce(() =>
        Promise.reject(new Error('no storage')),
      );
      const service = loadService();

      await service.initialize();
      failing = new Set();
      await advance(3000);

      expect(service.fontMgr).not.toBeNull();
      expect(service.state).toBe('failed');
    });

    it('a retry of the whole load starts the tries again, with one timer', async () => {
      failing = new Set([QURAN_COMMON]);
      const service = loadService();

      await service.initialize();
      failing = new Set();
      await service.initialize();
      expect(service.state).toBe('ready');
      const passes = mockMakeProvider.mock.calls.length;
      const provider = service.fontMgr;

      await advance(60000);

      expect(mockMakeProvider).toHaveBeenCalledTimes(passes);
      expect(service.fontMgr).toBe(provider);
    });
  });

  describe('after the data fails', () => {
    function failDataOnce(): void {
      mockDk.initialize.mockImplementationOnce(() =>
        Promise.reject(new Error('no storage')),
      );
    }

    it('the failed run waits for its fonts before its final state', async () => {
      failDataOnce();
      let finishRead!: () => void;
      mockFromURI.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishRead = () => resolve({});
          }),
      );
      const service = loadService();

      const done = service.initialize();
      await advance(0);
      expect(service.state).toBe('loading');

      finishRead();
      await done;
      expect(service.state).toBe('failed');
      expect(service.fontMgr).not.toBeNull();
    });

    it('a retry keeps the provider, loads no font, and readers keep it', async () => {
      failDataOnce();
      const service = loadService();

      await service.initialize();
      expect(service.state).toBe('failed');
      const provider = service.fontMgr;
      const passes = mockMakeProvider.mock.calls.length;

      const done = service.initialize();
      expect(service.state).toBe('loading');
      expect(service.fontMgr).toBe(provider);
      await done;

      expect(service.state).toBe('ready');
      expect(service.fontMgr).toBe(provider);
      expect(mockMakeProvider).toHaveBeenCalledTimes(passes);
    });
  });
});
