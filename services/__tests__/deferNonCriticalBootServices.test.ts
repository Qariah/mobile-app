// @ai
// Sprint 38 (S38.2) — `deferNonCriticalBootServices` flag tests.
//
// Verifies:
//   1. The flag is on by default (the cold-start lever is active).
//   2. When the flag is on, 'Uploads Service' and 'Verse Annotations' are NOT
//      registered in AppInitializer (so they don't run in the boot batch).
//   3. When the flag is off, both services ARE registered.
//   4. VerseAnnotationDatabaseService.ensureReady() self-initializes lazily
//      instead of throwing when the DB hasn't been explicitly opened yet.
//
// Field evidence: Sentry QARIAHV2-G `slow-cold-start` + QARIAHV2-S
// `splash-hide-timeout` on OnePlus 8 Pro / Android 11 builds 1345/1353,
// with `slow_init_service` naming 'Uploads Service' + 'Verse Annotations'.

import {featureFlags, isFeatureEnabled} from '../../config/featureFlags';

// ── Mock expo-sqlite so VerseAnnotationDatabaseService can be imported in Jest ──
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    runAsync: jest.fn().mockResolvedValue(undefined),
  }),
}));

// ── Mock expo-file-system so UploadsService can be imported ──
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/',
  getInfoAsync: jest.fn().mockResolvedValue({exists: true}),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// ── Lightweight store mock (only the shapes used by AppInitializer) ──
jest.mock('../../store/uploadsStore', () => ({
  useUploadsStore: {
    getState: jest.fn().mockReturnValue({
      loadRecitations: jest.fn().mockResolvedValue(undefined),
      loadCustomReciters: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Prevent other service / store imports from failing in Jest
jest.mock('../../services/analytics/AnalyticsService', () => ({
  analyticsService: {initialize: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../services/database/DatabaseService', () => ({
  databaseService: {initialize: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../services/playlist/PlaylistService', () => ({
  playlistService: {initialize: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../store/playlistsStore', () => ({
  usePlaylistsStore: {
    getState: jest
      .fn()
      .mockReturnValue({loadPlaylists: jest.fn().mockResolvedValue(undefined)}),
  },
}));
jest.mock('../../services/mushaf/MushafPreloadService', () => ({
  mushafPreloadService: {initialize: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../services/mushaf/QulDataService', () => ({
  qulDataService: {initialize: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../services/translation/TranslationDbService', () => ({
  translationDbService: {initialize: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../services/tafseer/TafseerDbService', () => ({
  tafseerDbService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    importBundledIbnKathir: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../store/tafseerStore', () => ({
  useTafseerStore: {
    getState: jest.fn().mockReturnValue({
      loadDownloadedMeta: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));
jest.mock('../../services/wbw/WBWDataService', () => ({
  wbwDataService: {initialize: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../services/timestamps/TimestampService', () => ({
  timestampService: {initialize: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../store/timestampStore', () => ({
  useTimestampStore: {
    getState: jest.fn().mockReturnValue({loadFollowAlongRegistry: jest.fn()}),
  },
}));
jest.mock('../../services/mushaf/ThemeDataService', () => ({
  themeDataService: {init: jest.fn()},
}));
jest.mock('expo-font', () => ({
  loadAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/adhkar/AdhkarService', () => ({
  adhkarService: {initialize: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../store/adhkarStore', () => ({
  useAdhkarStore: {
    getState: jest.fn().mockReturnValue({
      loadCategories: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));
jest.mock('../../store/reciterStore', () => ({
  useReciterStore: {getState: jest.fn().mockReturnValue({})},
}));
jest.mock('../../store/ambientStore', () => ({
  useAmbientStore: {getState: jest.fn().mockReturnValue({})},
}));
jest.mock('../../store/adhkarSettingsStore', () => ({
  useAdhkarSettingsStore: {getState: jest.fn().mockReturnValue({})},
}));
jest.mock('../../store/mushafSettingsStore', () => ({
  useMushafSettingsStore: {
    getState: jest.fn().mockReturnValue({rewayah: 'hafs'}),
  },
}));
jest.mock('../../store/themeStore', () => ({
  useThemeStore: {getState: jest.fn().mockReturnValue({})},
}));
jest.mock('../../store/playCountStore', () => ({
  usePlayCountStore: {getState: jest.fn().mockReturnValue({})},
}));
jest.mock('../../services/player/store/lovedStore', () => ({
  useLovedStore: {getState: jest.fn().mockReturnValue({})},
}));
jest.mock('../../services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {getState: jest.fn().mockReturnValue({})},
}));
jest.mock('../../services/player/store/favoriteRecitersStore', () => ({
  useFavoriteRecitersStore: {getState: jest.fn().mockReturnValue({})},
}));
jest.mock('../../components/mushaf/BookmarkChips', () => ({
  warmBookmarkCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock('../../services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    getAllBookmarks: jest.fn().mockResolvedValue([]),
  },
}));

// ── Helper: require AppInitializer under a controlled isFeatureEnabled mock ──
function requireAppInitializerWithFlag(deferNonCritical: boolean): {
  getServices: () => Array<{name: string}>;
} {
  // Reset module registry so the flag mock is picked up freshly.
  jest.resetModules();
  jest.doMock('../../config/featureFlags', () => ({
    isFeatureEnabled: (flag: string) => {
      if (flag === 'deferNonCriticalBootServices') return deferNonCritical;
      if (flag === 'lazyOpenFeatureDbs') return true;
      if (flag === 'deferMushafPreload') return true;
      if (flag === 'adhkar') return false;
      return false;
    },
    featureFlags: {deferNonCriticalBootServices: deferNonCritical},
  }));

  return require('../../services/AppInitializer').appInitializer;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('deferNonCriticalBootServices flag (S38.2)', () => {
  it('is enabled by default (the cold-start lever is active)', () => {
    expect(featureFlags.deferNonCriticalBootServices).toBe(true);
  });

  it('isFeatureEnabled returns true for deferNonCriticalBootServices', () => {
    expect(isFeatureEnabled('deferNonCriticalBootServices')).toBe(true);
  });

  describe('AppInitializer service registration', () => {
    afterEach(() => {
      // Restore module registry after each registration test.
      jest.resetModules();
    });

    it('does NOT register Uploads Service or Verse Annotations when flag is on', () => {
      const appInitializer = requireAppInitializerWithFlag(true);
      const names = appInitializer.getServices().map(s => s.name);

      expect(names).not.toContain('Uploads Service');
      expect(names).not.toContain('Verse Annotations');
    });

    it('DOES register Uploads Service and Verse Annotations when flag is off', () => {
      const appInitializer = requireAppInitializerWithFlag(false);
      const names = appInitializer.getServices().map(s => s.name);

      expect(names).toContain('Uploads Service');
      expect(names).toContain('Verse Annotations');
    });
  });

  describe('VerseAnnotationDatabaseService lazy-open (S38.2)', () => {
    it('self-initializes on first access instead of throwing (ensureReady() lazy-open)', async () => {
      // Use the real VerseAnnotationDatabaseService (the module-level mock for
      // VerseAnnotationService doesn't affect the database service directly).
      // expo-sqlite is already mocked at the top of this file (openDatabaseAsync
      // returns a working in-memory mock), so getAllBookmarks() should resolve.
      const {
        verseAnnotationDatabaseService,
      } = require('../../services/database/VerseAnnotationDatabaseService');

      // getAllBookmarks() calls the private ensureReady() which now calls
      // initialize() lazily when not yet ready — should resolve, not throw.
      await expect(
        verseAnnotationDatabaseService.getAllBookmarks(),
      ).resolves.toEqual([]);
    });
  });
});
