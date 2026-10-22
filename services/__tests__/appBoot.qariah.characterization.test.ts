// @ai Qariah (Sprint 46, TECH_DEBT #253) — characterization of Qariah's boot.
//
// Upstream (Pass B) moved the boot into `services/appBoot.ts`: `bootApp()`
// runs `runBoot()` once per JS runtime. Qariah's boot steps run through the
// hooks in `services/qariahBoot.ts`. This suite pins, for the shipping flags:
//   1. the order of the boot steps and of the Qariah hooks;
//   2. the services that the Qariah flags keep out of the boot
//      (services/qariahInitConfig.ts), and that each flag is the cause;
//   3. that the car integration does not open the uploads DB while user
//      uploads are off (b7045d5e);
//   4. the slow-cold-start watchdog: armed at the start, cleared at the end;
//   5. that a throw in a Qariah hook does not stop the boot.
// The real modules: appBoot, qariahBoot, AppInitializer, qariahInitConfig,
// services/car (index) and CarSnapshotService. Every other module is mocked
// at its boundary and writes its call into `mockCalls`.
// services/__tests__/qariahInitConfig.test.ts pins the AppInitializer list.
// Upstream's AppInitializer.characterization.test.ts runs with upstream's flag
// values (test-utils/upstreamBootFeatureFlags.ts).

const mockCalls: string[] = [];
/** The font keys of each Font.loadAsync call, in call order. */
const mockFontKeys: string[][] = [];
/** Boundaries that throw when they are called. */
const mockThrowAt = new Set<string>();
/** Boundaries that return a promise that the test settles. */
const mockPending = new Map<string, Promise<void>>();
/** Flag values that replace the shipping values for one test. */
const mockFlagOverrides: Record<string, boolean> = {};
const mockDiagnosticBuild = {on: false};
const mockSentry = {
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  flush: jest.fn(() => Promise.resolve(true)),
};

function mockRecord(entry: string, boundary: string = entry): void {
  mockCalls.push(entry);
  if (mockThrowAt.has(boundary)) throw new Error(`${boundary} failed`);
}

/** An async boundary. Its throw is synchronous: the worst case for a caller. */
function mockAsync(name: string): () => Promise<void> {
  return () => {
    mockRecord(name);
    return mockPending.get(name) ?? Promise.resolve();
  };
}

function mockSync(name: string): () => void {
  return () => mockRecord(name);
}

function mockStore(state: Record<string, unknown>): {
  getState: () => Record<string, unknown>;
  subscribe: () => () => void;
} {
  return {getState: () => state, subscribe: () => () => undefined};
}

// ── Flags: the shipping values, with per-test overrides ─────────────────────
jest.mock('@/config/featureFlags', () => {
  const actual = jest.requireActual<typeof import('@/config/featureFlags')>(
    '@/config/featureFlags',
  );
  return {
    ...actual,
    isFeatureEnabled: (flag: keyof typeof actual.featureFlags): boolean =>
      flag in mockFlagOverrides
        ? mockFlagOverrides[flag]
        : actual.isFeatureEnabled(flag),
  };
});

// ── appBoot.ts and qariahBoot.ts boundaries ─────────────────────────────────
jest.mock('@sentry/react-native', () => mockSentry);
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      if (mockThrowAt.has('constants')) throw new Error('constants failed');
      return {extra: {version: {semanticVersion: '3.2.2', buildNumber: 2620}}};
    },
  },
}));
jest.mock('expo-font', () => ({
  loadAsync: (fonts: Record<string, unknown>): Promise<void> => {
    mockFontKeys.push(Object.keys(fonts));
    return mockAsync('fonts.loadAsync')();
  },
}));
jest.mock('@/services/diagnostics/bootSentinel', () => ({
  markBootStarted: (version: string, build: string) =>
    mockRecord(`sentinel.started ${version} (${build})`, 'sentinel.started'),
  markBootStep: (step: string) =>
    mockRecord(`sentinel.step ${step}`, 'sentinel.step'),
  markBootCompleted: () => mockRecord('sentinel.completed'),
}));
jest.mock('@/services/diagnostics/diagnostics', () => ({
  get DIAGNOSTIC_BUILD_FLAG() {
    return mockDiagnosticBuild.on;
  },
}));
jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {initialize: mockAsync('expoAudio.initialize')},
}));
jest.mock('@/services/dataService', () => ({
  getAllReciters: mockAsync('catalog.getAllReciters'),
  refetchCatalogToVersion: jest.fn(),
}));
jest.mock('@/services/catalogVersionPoll', () => ({
  initCatalogVersionPolling: mockSync('catalogPoll.init'),
}));
// Qariah (Sprint 48, S48.6): the local notifications start after the poll.
jest.mock('@/services/notifications/backgroundTask', () => ({
  startQariahNotifications: mockSync('notifications.start'),
}));
jest.mock('@/services/player/utils/restoreSession', () => ({
  restoreSession: mockAsync('restoreSession'),
}));
jest.mock('@/services/car/sessionGate', () => ({
  markSessionRestored: mockSync('car.markSessionRestored'),
  // The car snapshot's first write waits for it (Sprint 46 review).
  waitForSessionRestored: () => Promise.resolve(),
}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: mockStore({}),
}));
jest.mock('@/services/player/store/downloadStore', () => ({
  useDownloadStore: mockStore({downloads: []}),
}));

// ── AppInitializer service boundaries (as qariahInitConfig.test.ts) ─────────
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {initialize: mockAsync('analytics.initialize')},
}));
jest.mock('@/services/database/DatabaseService', () => ({
  databaseService: {initialize: mockAsync('database.initialize')},
}));
jest.mock('@/services/adhkar/AdhkarService', () => ({
  adhkarService: {initialize: mockAsync('adhkar.initialize')},
}));
jest.mock('@/services/playlist/PlaylistService', () => ({
  playlistService: {initialize: mockAsync('playlist.initialize')},
}));
jest.mock('@/services/uploads/UploadsService', () => ({
  uploadsService: {
    initialize: mockAsync('uploads.initialize'),
    maybeRunOrphanCleanup: mockAsync('uploads.maybeRunOrphanCleanup'),
  },
}));
jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {initialize: mockAsync('annotations.initialize')},
}));
jest.mock('@/services/mushaf/MushafPreloadService', () => ({
  mushafPreloadService: {initialize: mockAsync('mushafPreload.initialize')},
}));
jest.mock('@/services/mushaf/QulDataService', () => ({
  qulDataService: {initialize: mockAsync('qul.initialize')},
}));
jest.mock('@/services/translation/TranslationDbService', () => ({
  translationDbService: {initialize: mockAsync('translationDb.initialize')},
}));
jest.mock('@/services/tafseer/TafseerDbService', () => ({
  tafseerDbService: {
    initialize: mockAsync('tafseerDb.initialize'),
    importBundledIbnKathir: mockAsync('tafseerDb.importBundledIbnKathir'),
  },
}));
jest.mock('@/store/tafseerStore', () => ({
  useTafseerStore: mockStore({
    loadDownloadedMeta: mockAsync('tafseerStore.loadDownloadedMeta'),
  }),
}));
jest.mock('@/services/wbw/WBWDataService', () => ({
  wbwDataService: {initialize: mockAsync('wbw.initialize')},
}));
jest.mock('@/components/mushaf/BookmarkChips', () => ({
  warmBookmarkCache: mockAsync('bookmarkChips.warmBookmarkCache'),
}));
jest.mock('@/services/timestamps/TimestampService', () => ({
  timestampService: {initialize: mockAsync('timestamps.initialize')},
}));
jest.mock('@/services/mushaf/ThemeDataService', () => ({
  themeDataService: {init: mockSync('themeData.init')},
}));
jest.mock('@/store/timestampStore', () => ({
  useTimestampStore: mockStore({
    loadFollowAlongRegistry: mockSync('timestampStore.loadFollowAlongRegistry'),
  }),
}));
jest.mock('@/store/adhkarStore', () => ({
  useAdhkarStore: mockStore({
    loadCategories: mockAsync('adhkarStore.loadCategories'),
  }),
}));
jest.mock('@/store/playlistsStore', () => ({
  usePlaylistsStore: mockStore({
    playlists: [],
    getPlaylistItems: jest.fn(),
    loadPlaylists: mockAsync('playlistsStore.loadPlaylists'),
  }),
}));
jest.mock('@/store/uploadsStore', () => ({
  useUploadsStore: mockStore({
    // The store's initial state: nothing loaded yet.
    loading: true,
    isLoading: false,
    recitations: [],
    customReciters: [],
    loadRecitations: mockAsync('uploadsStore.loadRecitations'),
    loadCustomReciters: mockAsync('uploadsStore.loadCustomReciters'),
  }),
}));
jest.mock('@/store/reciterStore', () => ({
  useReciterStore: mockStore({defaultReciter: {id: ''}}),
}));
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
  useLovedStore: mockStore({tracks: []}),
}));
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: mockStore({recentTracks: []}),
}));
jest.mock('@/services/player/store/favoriteRecitersStore', () => ({
  useFavoriteRecitersStore: mockStore({favoriteReciterIds: []}),
}));

// ── Car integration boundaries (CarSnapshotService is real) ─────────────────
jest.mock('@/modules/bayaan-car', () => ({
  BayaanCar: {
    isAvailable: true,
    writeSnapshot: jest.fn(),
    // startCarSnapshotService() calls this once, so it marks the start.
    addConnectionListener: () => {
      mockRecord('car.snapshotService.start');
      return () => undefined;
    },
  },
}));
jest.mock('@/services/car/CarPlaybackBridge', () => ({
  startCarPlaybackBridge: () => {
    mockRecord('car.playbackBridge.start');
    return () => undefined;
  },
}));
jest.mock('@/config/branding', () => ({}));
jest.mock('@/data/reciterData', () => ({RECITERS: []}));
jest.mock('@/data/surahData', () => ({SURAHS: []}));
jest.mock('@/data/systemPlaylists', () => ({getSystemPlaylists: () => []}));
jest.mock('@/data/juzData', () => ({SURAH_TO_JUZ: {}}));
jest.mock('@/utils/reciterImages', () => ({reciterImages: {}}));
jest.mock('@/utils/artworkUtils', () => ({formatReciterName: jest.fn()}));
jest.mock('@/services/analytics/LocalAggregationStore', () => ({
  localAggregationStore: {getDailyAggregate: () => null},
}));
jest.mock('@/services/car/snapshot/buildCarSnapshot', () => ({
  buildCarSnapshot: () => ({topReciterId: null}),
}));

type BootApp = typeof import('../appBoot').bootApp;

/** A fresh appBoot (and AppInitializer): bootApp() runs once per module. */
function freshBoot(): BootApp {
  let boot: BootApp | undefined;
  jest.isolateModules(() => {
    boot = require('../appBoot').bootApp;
  });
  if (!boot) throw new Error('appBoot not loaded');
  return boot;
}

/** Let the fire-and-forget work (car snapshot, deferred preload) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function deferred(): {promise: Promise<void>; resolve: () => void} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return {promise, resolve};
}

const BOOT_STEPS = [
  'start',
  'expo-audio-ready',
  'catalog-fetch-start',
  'catalog-ready',
  'app-initializer-ready',
  'session-restored',
  'ready',
];

const UPSTREAM_FONTS = [
  'ScheherazadeNew-Regular',
  'ScheherazadeNew-Medium',
  'ScheherazadeNew-Bold',
  'ScheherazadeNew-SemiBold',
  'Uthmani',
  'QPC',
];

/** The calls of the services that the shipping flags keep out of the boot. */
const SKIPPED_AT_BOOT: Record<string, string[]> = {
  adhkar: ['adhkar.initialize', 'adhkarStore.loadCategories'],
  deferNonCriticalBootServices: [
    'uploads.initialize',
    'uploadsStore.loadRecitations',
    'annotations.initialize',
    'bookmarkChips.warmBookmarkCache',
  ],
  lazyOpenFeatureDbs: [
    'qul.initialize',
    'translationDb.initialize',
    'tafseerDb.initialize',
    'wbw.initialize',
  ],
};

beforeEach(() => {
  mockCalls.length = 0;
  mockFontKeys.length = 0;
  mockThrowAt.clear();
  mockPending.clear();
  for (const flag of Object.keys(mockFlagOverrides)) {
    delete mockFlagOverrides[flag];
  }
  mockDiagnosticBuild.on = false;
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Qariah boot (characterization, shipping flags)', () => {
  it('runs with the shipping values of the boot flags', () => {
    const {featureFlags} = jest.requireActual<
      typeof import('@/config/featureFlags')
    >('@/config/featureFlags');
    expect(featureFlags).toMatchObject({
      adhkar: false,
      userUploads: false,
      deferMushafPreload: true,
      deferNonCriticalBootServices: true,
      lazyOpenFeatureDbs: true,
    });
  });

  it('runs the boot steps and the Qariah hooks in this order', async () => {
    await freshBoot()();
    await settle();
    expect(mockCalls).toEqual([
      // qariahBootStarted(): the sentinel, before any await.
      'sentinel.started 3.2.2 (2620)',
      'sentinel.step start',
      'expoAudio.initialize',
      'sentinel.step expo-audio-ready',
      // qariahAfterAudioReady(): the deferred Mushaf preload, not awaited.
      'mushafPreload.initialize',
      'fonts.loadAsync',
      'sentinel.step catalog-fetch-start',
      'catalog.getAllReciters',
      'sentinel.step catalog-ready',
      // qariahAfterCatalogReady(): the RFC-010 catalog-version poll, then
      // the local notifications (Sprint 48; timers only, not awaited).
      'catalogPoll.init',
      'notifications.start',
      // AppInitializer: the critical services in order, then the
      // non-critical services that the Qariah flags keep.
      'database.initialize',
      'playlist.initialize',
      'analytics.initialize',
      'playlistsStore.loadPlaylists',
      'timestamps.initialize',
      'themeData.init',
      'fonts.loadAsync',
      'timestampStore.loadFollowAlongRegistry',
      // AppInitializer starts the car integration after the services.
      'car.snapshotService.start',
      'car.playbackBridge.start',
      'sentinel.step app-initializer-ready',
      'restoreSession',
      'sentinel.step session-restored',
      'car.markSessionRestored',
      'sentinel.step ready',
      // qariahBootCompleted(): clears the sentinel after 'ready'.
      'sentinel.completed',
    ]);
  });

  it('calls qariahBootStarted() before the first await', () => {
    const boot = freshBoot()();
    // Only the synchronous part of runBoot() has run.
    expect(mockCalls).toEqual([
      'sentinel.started 3.2.2 (2620)',
      'sentinel.step start',
      'expoAudio.initialize',
    ]);
    return boot;
  });

  it('leaves a Sentry breadcrumb trail of the boot steps', async () => {
    await freshBoot()();
    const trail = mockSentry.addBreadcrumb.mock.calls
      .map(([crumb]) => crumb as {category: string; message: string})
      .filter(crumb => crumb.category === 'boot')
      .map(crumb => crumb.message);
    expect(trail).toEqual([
      'start',
      'expo-audio-ready',
      'catalog-fetch-start',
      'catalog-ready',
      'init:Database',
      'init:Playlist Service',
      'init:non-critical-batch',
      'app-initializer-ready',
      'session-restored',
      'ready',
    ]);
  });

  it('loads the DigitalKhatt fonts with the deferred preload, and the other Arabic fonts in AppInitializer', async () => {
    await freshBoot()();
    expect(mockFontKeys).toEqual([
      ['DigitalKhattV1', 'DigitalKhattV2'],
      UPSTREAM_FONTS,
    ]);
  });

  it('does not wait for the deferred Mushaf preload', async () => {
    mockPending.set('mushafPreload.initialize', new Promise(() => undefined));
    await expect(freshBoot()()).resolves.toBeUndefined();
    expect(mockCalls).toContain('sentinel.completed');
  });

  it('keeps the flag-gated services out of the boot', async () => {
    await freshBoot()();
    await settle();
    for (const call of Object.values(SKIPPED_AT_BOOT).flat()) {
      expect(mockCalls).not.toContain(call);
    }
    // deferMushafPreload: the preload runs once, from qariahAfterAudioReady(),
    // not as the AppInitializer 'Mushaf Preload' service.
    expect(mockCalls.filter(c => c === 'mushafPreload.initialize')).toEqual([
      'mushafPreload.initialize',
    ]);
    expect(mockCalls.indexOf('mushafPreload.initialize')).toBeLessThan(
      mockCalls.indexOf('catalog.getAllReciters'),
    );
  });

  it.each([
    ['adhkar', true],
    ['deferNonCriticalBootServices', false],
    ['lazyOpenFeatureDbs', false],
  ])(
    'runs the skipped services again when %s is %s',
    async (flag: string, value: boolean) => {
      mockFlagOverrides[flag] = value;
      await freshBoot()();
      await settle();
      for (const call of SKIPPED_AT_BOOT[flag]) {
        expect(mockCalls).toContain(call);
      }
    },
  );

  it('runs the Mushaf preload inside AppInitializer when deferMushafPreload is off', async () => {
    mockFlagOverrides.deferMushafPreload = false;
    await freshBoot()();
    const preload = mockCalls.indexOf('mushafPreload.initialize');
    expect(preload).toBeGreaterThan(mockCalls.indexOf('database.initialize'));
    expect(mockFontKeys).toEqual([
      [...UPSTREAM_FONTS, 'DigitalKhattV1', 'DigitalKhattV2'],
    ]);
  });
});

describe('the car integration and the uploads DB (b7045d5e)', () => {
  const UPLOADS_CALLS = [
    'uploads.initialize',
    'uploadsStore.loadRecitations',
    'uploadsStore.loadCustomReciters',
  ];

  it('does not open the uploads DB at boot while user uploads are off', async () => {
    await freshBoot()();
    await settle();
    expect(mockCalls).toContain('car.snapshotService.start');
    for (const call of UPLOADS_CALLS) expect(mockCalls).not.toContain(call);
  });

  it('loads the uploads from the car snapshot service when user uploads are on', async () => {
    // The control case: this suite sees the car's load when it happens.
    mockFlagOverrides.userUploads = true;
    await freshBoot()();
    await settle();
    expect(mockCalls).not.toContain('uploads.initialize');
    expect(mockCalls.indexOf('uploadsStore.loadRecitations')).toBe(
      mockCalls.indexOf('car.snapshotService.start') - 1,
    );
    expect(mockCalls).toContain('uploadsStore.loadCustomReciters');
  });
});

describe('the slow-cold-start watchdog', () => {
  function slowColdStartCalls(): unknown[][] {
    return mockSentry.captureMessage.mock.calls.filter(
      ([message]) => message === 'slow-cold-start',
    );
  }

  it('fires at 8 s and names the boot step and the slow service', async () => {
    jest.useFakeTimers();
    const timestamps = deferred();
    mockPending.set('timestamps.initialize', timestamps.promise);
    const boot = freshBoot()();
    await jest.advanceTimersByTimeAsync(7999);
    expect(slowColdStartCalls()).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(slowColdStartCalls()).toEqual([
      [
        'slow-cold-start',
        {
          level: 'warning',
          tags: {
            scope: 'cold-start',
            boot_step: 'catalog-ready',
            slow_init_service: 'Timestamps',
          },
          extra: {
            init_in_flight: ['Timestamps'],
            init_completed: expect.any(Array),
          },
        },
      ],
    ]);
    expect(mockSentry.flush).not.toHaveBeenCalled();
    timestamps.resolve();
    await jest.advanceTimersByTimeAsync(0);
    await boot;
    expect(mockCalls).toContain('sentinel.completed');
  });

  it('is cleared when the boot completes', async () => {
    jest.useFakeTimers();
    await freshBoot()();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(slowColdStartCalls()).toHaveLength(0);
  });

  it('is cleared when the boot fails, and the sentinel stays set', async () => {
    jest.useFakeTimers();
    mockThrowAt.add('database.initialize');
    await expect(freshBoot()()).rejects.toThrow('database.initialize failed');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(slowColdStartCalls()).toHaveLength(0);
    // The next launch reports this boot as incomplete.
    expect(mockCalls).not.toContain('sentinel.completed');
  });

  it('fires at 5 s and flushes at once in a diagnostic build', async () => {
    jest.useFakeTimers();
    mockDiagnosticBuild.on = true;
    const catalog = deferred();
    mockPending.set('catalog.getAllReciters', catalog.promise);
    const boot = freshBoot()();
    await jest.advanceTimersByTimeAsync(4999);
    expect(slowColdStartCalls()).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(slowColdStartCalls()).toHaveLength(1);
    expect(slowColdStartCalls()[0][1]).toMatchObject({
      tags: {boot_step: 'catalog-fetch-start', slow_init_service: 'none'},
    });
    expect(mockSentry.flush).toHaveBeenCalledTimes(1);
    catalog.resolve();
    await jest.advanceTimersByTimeAsync(0);
    await boot;
  });
});

describe('a throw in a Qariah hook', () => {
  it.each([
    ['qariahBootStarted', 'sentinel.started'],
    ['qariahBootStarted', 'constants'],
    ['qariahBootStep', 'sentinel.step'],
    ['qariahAfterAudioReady', 'mushafPreload.initialize'],
    ['qariahAfterCatalogReady', 'catalogPoll.init'],
    ['qariahAfterCatalogReady', 'notifications.start'],
    ['qariahBootCompleted', 'sentinel.completed'],
  ])(
    'in %s (%s) does not stop the boot',
    async (_hook: string, boundary: string) => {
      mockThrowAt.add(boundary);
      await expect(freshBoot()()).resolves.toBeUndefined();
      await settle();
      expect(mockCalls).toEqual(
        expect.arrayContaining([
          'catalog.getAllReciters',
          'database.initialize',
          'car.snapshotService.start',
          'restoreSession',
          'car.markSessionRestored',
        ]),
      );
      const trail = mockSentry.addBreadcrumb.mock.calls.map(
        ([crumb]) => (crumb as {message: string}).message,
      );
      expect(trail).toEqual(expect.arrayContaining(BOOT_STEPS));
    },
  );

  it('starts the notifications when the catalog poll throws (Sprint 48)', async () => {
    mockThrowAt.add('catalogPoll.init');
    await freshBoot()();
    expect(mockCalls).toContain('notifications.start');
  });

  it('reports the throw to Sentry with the hook name', async () => {
    mockThrowAt.add('catalogPoll.init');
    await freshBoot()();
    expect(mockSentry.captureException).toHaveBeenCalledWith(
      new Error('catalogPoll.init failed'),
      {tags: {scope: 'cold-start', boot_hook: 'qariahAfterCatalogReady'}},
    );
  });

  it('in the slow-cold-start report does not throw out of the timer', async () => {
    jest.useFakeTimers();
    mockSentry.captureMessage.mockImplementationOnce(() => {
      throw new Error('captureMessage failed');
    });
    const catalog = deferred();
    mockPending.set('catalog.getAllReciters', catalog.promise);
    const boot = freshBoot()();
    await jest.advanceTimersByTimeAsync(8000);
    expect(mockSentry.captureException).toHaveBeenCalledWith(
      new Error('captureMessage failed'),
      {tags: {scope: 'cold-start', boot_hook: 'qariahReportSlowColdStart'}},
    );
    catalog.resolve();
    await jest.advanceTimersByTimeAsync(0);
    await expect(boot).resolves.toBeUndefined();
  });
});

describe('the boot sentinel and the Android Auto root (Sprint 46 review)', () => {
  type QariahBoot = typeof import('../qariahBoot');

  /** appBoot and qariahBoot from one fresh module registry. */
  function freshPair(): {boot: BootApp; qariah: QariahBoot} {
    let boot: BootApp | undefined;
    let qariah: QariahBoot | undefined;
    jest.isolateModules(() => {
      qariah = require('../qariahBoot');
      boot = require('../appBoot').bootApp;
    });
    if (!boot || !qariah) throw new Error('modules not loaded');
    return {boot, qariah};
  }

  const sentinelCalls = (): string[] =>
    mockCalls.filter(call => call.startsWith('sentinel.'));

  it('writes no sentinel when the car root boots first', async () => {
    const {boot, qariah} = freshPair();
    qariah.markCarRootBoot();
    await boot();
    await settle();
    expect(sentinelCalls()).toEqual([]);
  });

  it('keeps the phone sentinel when the car root mounts during a phone boot', async () => {
    const {boot, qariah} = freshPair();
    const running = boot();
    qariah.markCarRootBoot();
    await running;
    await settle();
    expect(sentinelCalls()[0]).toBe('sentinel.started 3.2.2 (2620)');
    expect(sentinelCalls()).toContain('sentinel.completed');
  });
});
