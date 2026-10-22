// @ai Qariah (TECH_DEBT #243) — pins the startup sequence that Qariah's flags
// produce, so the move of Qariah's service skips out of the upstream
// registerService() blocks cannot change it. Two flag sets:
//   - SHIPPING: the real config/featureFlags.ts (adhkar off, the three
//     cold-start levers on), which is what every Qariah build runs.
//   - LEGACY: every lever off and adhkar on, which must give upstream's full
//     list (the same list as AppInitializer.characterization.test.ts).
// It also pins the 'Arabic Fonts' font set for both, which guards the
// DigitalKhatt override against upstream drift in that block.
const mockCalls: string[] = [];
const mockFontKeys: string[][] = [];

function mockStep(name: string): () => Promise<void> {
  return async (): Promise<void> => {
    mockCalls.push(name);
  };
}

function mockSyncStep(name: string): () => void {
  return (): void => {
    mockCalls.push(name);
  };
}

function mockStore(state: Record<string, unknown>): {
  getState: () => Record<string, unknown>;
} {
  return {getState: () => state};
}

jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {initialize: mockStep('analytics.initialize')},
}));
jest.mock('@/services/database/DatabaseService', () => ({
  databaseService: {initialize: mockStep('database.initialize')},
}));
jest.mock('@/services/adhkar/AdhkarService', () => ({
  adhkarService: {initialize: mockStep('adhkar.initialize')},
}));
jest.mock('@/services/playlist/PlaylistService', () => ({
  playlistService: {initialize: mockStep('playlist.initialize')},
}));
jest.mock('@/services/uploads/UploadsService', () => ({
  uploadsService: {
    initialize: mockStep('uploads.initialize'),
    maybeRunOrphanCleanup: mockStep('uploads.maybeRunOrphanCleanup'),
  },
}));
jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {initialize: mockStep('annotations.initialize')},
}));
jest.mock('@/services/mushaf/MushafPreloadService', () => ({
  mushafPreloadService: {initialize: mockStep('mushafPreload.initialize')},
}));
jest.mock('@/services/mushaf/QulDataService', () => ({
  qulDataService: {initialize: mockStep('qul.initialize')},
}));
jest.mock('@/services/translation/TranslationDbService', () => ({
  translationDbService: {initialize: mockStep('translationDb.initialize')},
}));
jest.mock('@/services/tafseer/TafseerDbService', () => ({
  tafseerDbService: {
    initialize: mockStep('tafseerDb.initialize'),
    importBundledIbnKathir: mockStep('tafseerDb.importBundledIbnKathir'),
  },
}));
jest.mock('@/store/tafseerStore', () => ({
  useTafseerStore: mockStore({
    loadDownloadedMeta: mockStep('tafseerStore.loadDownloadedMeta'),
  }),
}));
jest.mock('@/services/wbw/WBWDataService', () => ({
  wbwDataService: {initialize: mockStep('wbw.initialize')},
}));
jest.mock('@/components/mushaf/BookmarkChips', () => ({
  warmBookmarkCache: mockStep('bookmarkChips.warmBookmarkCache'),
}));
jest.mock('@/services/timestamps/TimestampService', () => ({
  timestampService: {initialize: mockStep('timestamps.initialize')},
}));
jest.mock('@/services/mushaf/ThemeDataService', () => ({
  themeDataService: {init: mockSyncStep('themeData.init')},
}));
jest.mock('@/store/timestampStore', () => ({
  useTimestampStore: mockStore({
    loadFollowAlongRegistry: mockSyncStep(
      'timestampStore.loadFollowAlongRegistry',
    ),
  }),
}));
jest.mock('@/store/adhkarStore', () => ({
  useAdhkarStore: mockStore({
    loadCategories: mockStep('adhkarStore.loadCategories'),
  }),
}));
jest.mock('@/store/playlistsStore', () => ({
  usePlaylistsStore: mockStore({
    loadPlaylists: mockStep('playlistsStore.loadPlaylists'),
  }),
}));
jest.mock('@/store/uploadsStore', () => ({
  useUploadsStore: mockStore({
    loadRecitations: mockStep('uploadsStore.loadRecitations'),
    loadCustomReciters: mockStep('uploadsStore.loadCustomReciters'),
  }),
}));
jest.mock('@/store/reciterStore', () => ({useReciterStore: mockStore({})}));
jest.mock('@/store/ambientStore', () => ({useAmbientStore: mockStore({})}));
jest.mock('@/store/adhkarSettingsStore', () => ({
  useAdhkarSettingsStore: mockStore({}),
}));
jest.mock('@/store/mushafSettingsStore', () => ({
  useMushafSettingsStore: mockStore({}),
}));
jest.mock('@/store/themeStore', () => ({useThemeStore: mockStore({})}));
jest.mock('@/store/playCountStore', () => ({
  usePlayCountStore: mockStore({}),
}));
jest.mock('@/services/player/store/lovedStore', () => ({
  useLovedStore: mockStore({}),
}));
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: mockStore({}),
}));
jest.mock('@/services/player/store/favoriteRecitersStore', () => ({
  useFavoriteRecitersStore: mockStore({}),
}));
jest.mock('expo-font', () => ({
  loadAsync: async (fonts: Record<string, unknown>): Promise<void> => {
    mockCalls.push('fonts.loadAsync');
    mockFontKeys.push(Object.keys(fonts));
  },
}));
// @ai Upstream Pass B: AppInitializer starts the car integration after the
// services (the same mock as upstream's AppInitializer suites).
jest.mock('@/services/car', () => ({startCarIntegration: jest.fn()}));

type Initializer = typeof import('../AppInitializer').appInitializer;

/** Load a fresh AppInitializer. `legacy` turns every Qariah lever off. */
function freshInitializer(legacy: boolean): Initializer {
  let initializer: Initializer | undefined;
  jest.isolateModules(() => {
    if (legacy) {
      jest.doMock('@/config/featureFlags', () => ({
        isFeatureEnabled: (flag: string) => flag === 'adhkar',
      }));
    } else {
      jest.dontMock('@/config/featureFlags');
    }
    initializer = require('../AppInitializer').appInitializer;
  });
  if (!initializer) throw new Error('AppInitializer not loaded');
  return initializer;
}

function registrations(initializer: Initializer): Array<{
  name: string;
  priority?: number;
  critical?: boolean;
}> {
  return initializer.getServices().map(s => ({
    name: s.name,
    priority: s.priority,
    critical: s.critical,
  }));
}

const UPSTREAM_FONTS = [
  'ScheherazadeNew-Regular',
  'ScheherazadeNew-Medium',
  'ScheherazadeNew-Bold',
  'ScheherazadeNew-SemiBold',
  'Uthmani',
  'QPC',
];

beforeEach(() => {
  mockCalls.length = 0;
  mockFontKeys.length = 0;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.dontMock('@/config/featureFlags');
});

describe('Qariah startup sequence (shipping flags)', () => {
  it('registers only the services the Qariah flags keep, in this order', () => {
    expect(registrations(freshInitializer(false))).toEqual([
      {name: 'Analytics', priority: 0, critical: false},
      {name: 'Database', priority: 1, critical: true},
      {name: 'Playlist Service', priority: 2, critical: true},
      {name: 'Playlists Data', priority: 3, critical: false},
      {name: 'Store Hydration', priority: 3, critical: false},
      {name: 'Timestamps', priority: 9, critical: false},
      {name: 'Theme Data', priority: 10, critical: false},
      {name: 'Arabic Fonts', priority: 10, critical: false},
    ]);
  });

  it('runs critical services first, then starts the non-critical ones in order', async () => {
    await freshInitializer(false).initialize();
    expect(mockCalls.slice(0, 7)).toEqual([
      'database.initialize',
      'playlist.initialize',
      'analytics.initialize',
      'playlistsStore.loadPlaylists',
      'timestamps.initialize',
      'themeData.init',
      'fonts.loadAsync',
    ]);
    for (const skipped of [
      'adhkar.initialize',
      'adhkarStore.loadCategories',
      'mushafPreload.initialize',
      'uploads.initialize',
      'annotations.initialize',
      'qul.initialize',
      'translationDb.initialize',
      'tafseerDb.initialize',
      'wbw.initialize',
    ]) {
      expect(mockCalls).not.toContain(skipped);
    }
  });

  it('loads the Arabic fonts without the DigitalKhatt OTFs (deferred with the Mushaf preload)', async () => {
    await freshInitializer(false).initialize();
    expect(mockFontKeys).toEqual([UPSTREAM_FONTS]);
  });
});

describe('Qariah startup sequence (every lever off)', () => {
  it("registers upstream's full list", () => {
    expect(registrations(freshInitializer(true))).toEqual([
      {name: 'Analytics', priority: 0, critical: false},
      {name: 'Database', priority: 1, critical: true},
      {name: 'Playlist Service', priority: 2, critical: true},
      {name: 'Playlists Data', priority: 3, critical: false},
      {name: 'Store Hydration', priority: 3, critical: false},
      {name: 'Adhkar Service', priority: 4, critical: false},
      {name: 'Mushaf Preload', priority: 5, critical: false},
      {name: 'Adhkar Store Data', priority: 6, critical: false},
      {name: 'Uploads Service', priority: 6, critical: false},
      {name: 'Verse Annotations', priority: 7, critical: false},
      {name: 'Timestamps', priority: 9, critical: false},
      {name: 'Theme Data', priority: 10, critical: false},
      {name: 'Arabic Fonts', priority: 10, critical: false},
      {name: 'QUL Data', priority: 10, critical: false},
      {name: 'Translation DB', priority: 10, critical: false},
      {name: 'Tafseer DB', priority: 10, critical: false},
      {name: 'WBW Data', priority: 10, critical: false},
    ]);
  });

  it("loads upstream's full Arabic font set, DigitalKhatt included", async () => {
    await freshInitializer(true).initialize();
    expect(mockFontKeys).toEqual([
      [...UPSTREAM_FONTS, 'DigitalKhattV1', 'DigitalKhattV2'],
    ]);
  });

  it("keeps Qariah's Arabic font set equal to upstream's minus DigitalKhatt (drift guard)", async () => {
    await freshInitializer(true).initialize();
    const upstreamKeys = mockFontKeys[0];
    mockFontKeys.length = 0;
    await freshInitializer(false).initialize();
    expect(mockFontKeys[0]).toEqual(
      upstreamKeys.filter(k => !k.startsWith('DigitalKhatt')),
    );
  });
});
