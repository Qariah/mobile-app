import {analyticsService} from '@/services/analytics/AnalyticsService';
import {databaseService} from '@/services/database/DatabaseService';
import {adhkarService} from '@/services/adhkar/AdhkarService';
import {playlistService} from '@/services/playlist/PlaylistService';
import {uploadsService} from '@/services/uploads/UploadsService';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {mushafPreloadService} from '@/services/mushaf/MushafPreloadService';
import {qulDataService} from '@/services/mushaf/QulDataService';
import {translationDbService} from '@/services/translation/TranslationDbService';
import {tafseerDbService} from '@/services/tafseer/TafseerDbService';
import {useTafseerStore} from '@/store/tafseerStore';
import {wbwDataService} from '@/services/wbw/WBWDataService';
import {warmBookmarkCache} from '@/components/mushaf/BookmarkChips';
import {timestampService} from '@/services/timestamps/TimestampService';
import {themeDataService} from '@/services/mushaf/ThemeDataService';
import {useTimestampStore} from '@/store/timestampStore';
import {useAdhkarStore} from '@/store/adhkarStore';
import {usePlaylistsStore} from '@/store/playlistsStore';
import {useUploadsStore} from '@/store/uploadsStore';
import {useReciterStore} from '@/store/reciterStore';
import {useAmbientStore} from '@/store/ambientStore';
import {useAdhkarSettingsStore} from '@/store/adhkarSettingsStore';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import {useThemeStore} from '@/store/themeStore';
import {usePlayCountStore} from '@/store/playCountStore';
import {useLovedStore} from '@/services/player/store/lovedStore';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {useFavoriteRecitersStore} from '@/services/player/store/favoriteRecitersStore';
import {startCarIntegration} from '@/services/car';
import * as Font from 'expo-font';
// Qariah: the Qariah-only imports (TECH_DEBT #243).
import * as Sentry from '@sentry/react-native';
import {raceInitTimeout, INIT_TIMED_OUT} from '@/services/initTimeout';
import {applyQariahInitConfig} from '@/services/qariahInitConfig';

// Qariah (#53): splash-blocking init budgets. Generous vs the measured healthy
// path (the slowest service, the bundled Tafseer/translation DB import, runs
// ~1.4s on a Pixel 3 release build — Sprint 30) but finite, so a wedged SQLite
// open / IO stall degrades the boot instead of holding the splash forever.
const CRITICAL_SERVICE_TIMEOUT_MS = 10000;
const NON_CRITICAL_BATCH_TIMEOUT_MS = 10000;

interface ServiceInitializer {
  name: string;
  initialize: () => Promise<void>;
  priority?: number; // Lower number = higher priority
  critical?: boolean; // If true, failure will prevent app startup
}

/**
 * AppInitializer - Centralized service initialization system
 *
 * This class manages the initialization of all SQLite-based services
 * and other critical app services. It ensures:
 * - Services are initialized in the correct order
 * - Initialization is idempotent (safe to call multiple times)
 * - Concurrent initialization requests are handled gracefully
 * - Non-critical services can fail without breaking the app
 *
 * @example
 * ```typescript
 * // In app startup (_layout.tsx)
 * await appInitializer.initialize();
 *
 * // To add a new service (in AppInitializer.ts)
 * appInitializer.registerService({
 *   name: 'Bookmarks',
 *   priority: 4,
 *   critical: false,
 *   initialize: async () => {
 *     await bookmarksService.initialize();
 *     await useBookmarksStore.getState().loadBookmarks();
 *   },
 * });
 * ```
 */
class AppInitializer {
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private services: ServiceInitializer[] = [];
  // Sprint 34 (S34.1) — REPORT-ONLY cold-start init timing. Records each
  // service's completion ms + the set still in-flight, so the slow-cold-start
  // watchdog (services/qariahBoot.ts) and the batch-timeout capture can name the slow
  // service(s) in the field instead of an opaque `non-critical-batch`. Field
  // evidence (Sentry boot_step=catalog-ready 95%) localized the cold-start
  // hangs to this method but couldn't decompose the parallel batch; this probe
  // closes that gap so a future sprint builds the right lever (likely lazy-open
  // the off-Listen-path feature DBs) with data. NO behavior change.
  // See planning/v1-v2-fleet-compatibility-analysis-2026-06-12.md.
  // review-by: 2027-01-15 (TECH_DEBT #234) — remove if nobody reads the `slow_init_service` tag
  private completedTimings: Array<{name: string; ms: number}> = [];
  private inFlight = new Set<string>();

  /**
   * Register a service to be initialized
   * Services are executed in priority order (lower number = higher priority)
   *
   * @param service - Service configuration
   */
  registerService(service: ServiceInitializer) {
    this.services.push(service);
    // Sort by priority (lower number first)
    this.services.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /**
   * Initialize all registered services
   * This is idempotent and safe to call multiple times
   *
   * @returns Promise that resolves when all services are initialized
   * @throws Error if any critical service fails to initialize
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[AppInitializer] Already initialized');
      return;
    }

    if (this.initPromise) {
      console.log('[AppInitializer] Initialization in progress, waiting...');
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        console.log('[AppInitializer] Starting initialization...');
        const startTime = Date.now();

        // Split into critical (sequential) and non-critical (parallel)
        const critical = this.services.filter(s => s.critical);
        const nonCritical = this.services.filter(s => !s.critical);

        // Run critical services sequentially (order matters).
        // Qariah (#53): each await is BOUNDED. Every captured field boot-hang
        // (Sentry QARIAHV2-G/-N, OnePlus 8 Pro + Xiaomi, builds 1277-1293)
        // wedged inside this method while the splash was held — an unbounded
        // critical init must never be able to hold the splash forever. On
        // timeout we log + breadcrumb and CONTINUE degraded; the service's
        // promise is not cancelled, so if it settles late its work still
        // lands. The per-service breadcrumb means the next field stall names
        // the exact service instead of the whole method.
        for (const service of critical) {
          const serviceStartTime = Date.now();
          console.log(`[AppInitializer] Initializing ${service.name}...`);
          Sentry.addBreadcrumb({
            category: 'boot',
            message: `init:${service.name}`,
            level: 'info',
          });
          this.inFlight.add(service.name);
          const result = await raceInitTimeout(
            service.initialize(),
            CRITICAL_SERVICE_TIMEOUT_MS,
          );
          const serviceTime = Date.now() - serviceStartTime;
          this.inFlight.delete(service.name);
          this.completedTimings.push({name: service.name, ms: serviceTime});
          if (result === INIT_TIMED_OUT) {
            console.warn(
              `[AppInitializer] ⏱ ${service.name} exceeded ${CRITICAL_SERVICE_TIMEOUT_MS}ms — continuing boot degraded (#53)`,
            );
            Sentry.captureMessage('app-init-service-timeout', {
              level: 'warning',
              tags: {scope: 'cold-start', init_service: service.name},
              extra: {timeout_ms: CRITICAL_SERVICE_TIMEOUT_MS},
            });
            continue;
          }
          console.log(
            `[AppInitializer] ✓ ${service.name} initialized (${serviceTime}ms)`,
          );
        }

        // Run non-critical services in parallel.
        // Qariah (#53): bounded as a batch. `Promise.allSettled` absorbs
        // rejections but NOT hangs — one never-settling non-critical service
        // used to hold the splash forever, which contradicts "non-critical".
        if (nonCritical.length > 0) {
          console.log(
            `[AppInitializer] Running ${nonCritical.length} non-critical services in parallel...`,
          );
          Sentry.addBreadcrumb({
            category: 'boot',
            message: 'init:non-critical-batch',
            level: 'info',
          });
          const settled = await raceInitTimeout(
            Promise.allSettled(
              nonCritical.map(async service => {
                const serviceStartTime = Date.now();
                this.inFlight.add(service.name);
                console.log(`[AppInitializer] Initializing ${service.name}...`);
                try {
                  await service.initialize();
                  const serviceTime = Date.now() - serviceStartTime;
                  console.log(
                    `[AppInitializer] ✓ ${service.name} initialized (${serviceTime}ms)`,
                  );
                } finally {
                  // S34.1 — record completion ms (success OR throw) + clear
                  // in-flight, so a watchdog firing mid-batch names the slow
                  // service via what's still in-flight. allSettled still sees
                  // the rejection (re-thrown after finally) — behavior intact.
                  this.inFlight.delete(service.name);
                  this.completedTimings.push({
                    name: service.name,
                    ms: Date.now() - serviceStartTime,
                  });
                }
              }),
            ),
            NON_CRITICAL_BATCH_TIMEOUT_MS,
          );

          if (settled === INIT_TIMED_OUT) {
            console.warn(
              `[AppInitializer] ⏱ non-critical batch exceeded ${NON_CRITICAL_BATCH_TIMEOUT_MS}ms — continuing boot degraded (#53)`,
            );
            // S34.1 — decompose the opaque `non-critical-batch` timeout: the
            // still-in-flight services at the 10s mark are the culprits.
            const snap = this.getInitSnapshot();
            Sentry.captureMessage('app-init-service-timeout', {
              level: 'warning',
              tags: {
                scope: 'cold-start',
                init_service: 'non-critical-batch',
                slow_init_service: snap.inFlight[0] ?? 'none',
              },
              extra: {
                timeout_ms: NON_CRITICAL_BATCH_TIMEOUT_MS,
                init_in_flight: snap.inFlight,
                init_completed: snap.completed,
              },
            });
          } else {
            settled.forEach((result, index) => {
              if (result.status === 'rejected') {
                console.warn(
                  `[AppInitializer] Non-critical service ${nonCritical[index].name} failed, continuing...`,
                  result.reason,
                );
              }
            });
          }
        }

        this.initialized = true;
        // @ai Qariah (Sprint 46, Pass B review): the car integration is
        // optional. A synchronous throw from its setup must not fail the boot
        // of a phone that never connects a car.
        try {
          startCarIntegration();
        } catch (error) {
          console.warn(
            '[AppInitializer] Car integration failed to start:',
            error,
          );
          Sentry.captureException(error, {
            tags: {scope: 'cold-start', boot_hook: 'startCarIntegration'},
          });
        }
        const totalTime = Date.now() - startTime;
        console.log(
          `[AppInitializer] All services initialized successfully (${totalTime}ms total)`,
        );
      } catch (error) {
        console.error('[AppInitializer] Initialization failed:', error);
        this.initPromise = null; // Allow retry
        throw error;
      }
    })();

    return this.initPromise;
  }

  /**
   * Reset initialization state
   * Useful for testing or development
   */
  reset() {
    this.initialized = false;
    this.initPromise = null;
    console.log('[AppInitializer] Reset');
  }

  /**
   * Check if all services have been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get list of registered services
   */
  getServices(): ReadonlyArray<Readonly<ServiceInitializer>> {
    return this.services;
  }

  /**
   * Sprint 34 (S34.1) — REPORT-ONLY snapshot of cold-start init progress, read
   * by the slow-cold-start watchdog (services/qariahBoot.ts) when it fires so the
   * field event names the slow service(s). `completed` = finished services +
   * their ms (slowest-first); `inFlight` = started-but-not-done at read time
   * (the likely culprits when the watchdog trips mid-batch). No behavior change.
   */
  getInitSnapshot(): {
    completed: Array<{name: string; ms: number}>;
    inFlight: string[];
  } {
    return {
      completed: [...this.completedTimings].sort((a, b) => b.ms - a.ms),
      inFlight: [...this.inFlight],
    };
  }

  /**
   * @ai Qariah (TECH_DEBT #243) — remove a registered service by name. The
   * other services keep their order. Used by services/qariahInitConfig.ts, so
   * the upstream registerService() blocks below stay byte-identical.
   */
  unregisterService(name: string): void {
    this.services = this.services.filter(s => s.name !== name);
  }

  /**
   * @ai Qariah (TECH_DEBT #243) — replace the initialize() of a registered
   * service. The service keeps its name, priority, critical flag and slot.
   */
  replaceServiceInitializer(
    name: string,
    initialize: () => Promise<void>,
  ): void {
    const service = this.services.find(s => s.name === name);
    if (service) service.initialize = initialize;
  }
}

// Create singleton instance
export const appInitializer = new AppInitializer();

// ============================================================================
// SERVICE REGISTRATION
// Register all services that need initialization here
// Priority order: 0 = highest priority (initialized first)
// ============================================================================

/**
 * Analytics Service (Priority 0)
 * Initializes device ID and session tracking for analytics
 * Non-critical - app functions without analytics
 */
appInitializer.registerService({
  name: 'Analytics',
  priority: 0,
  critical: false,
  initialize: async () => {
    await analyticsService.initialize();
  },
});

/**
 * Database Service (Priority 1)
 * Initializes the SQLite database connection and creates tables
 * This is critical - app cannot function without it
 */
appInitializer.registerService({
  name: 'Database',
  priority: 1,
  critical: true,
  initialize: async () => {
    await databaseService.initialize();
  },
});

/**
 * Playlist Service (Priority 2)
 * Initializes the playlist service (depends on Database)
 * This is critical for playlist functionality
 */
appInitializer.registerService({
  name: 'Playlist Service',
  priority: 2,
  critical: true,
  initialize: async () => {
    await playlistService.initialize();
  },
});

/**
 * Playlists Data (Priority 3)
 * Loads playlist data from database into Zustand store
 * Non-critical - can be loaded later if fails
 */
appInitializer.registerService({
  name: 'Playlists Data',
  priority: 3,
  critical: false,
  initialize: async () => {
    await usePlaylistsStore.getState().loadPlaylists();
  },
});

/**
 * Adhkar Service (Priority 4)
 * Initializes the Adhkar database and seeds data (depends on Database)
 * Non-critical - app can function without adhkar
 */
appInitializer.registerService({
  name: 'Adhkar Service',
  priority: 4,
  critical: false,
  initialize: async () => {
    await adhkarService.initialize();
  },
});

/**
 * Mushaf Preload (Priority 5)
 * Loads DigitalKhatt data, Skia typefaces (V1+V2), and surah header font.
 * Eliminates loading screens in the Mushaf tab by having everything ready
 * before the user navigates there.
 * Non-critical - Mushaf tab will render empty frames until ready (rare race).
 */
appInitializer.registerService({
  name: 'Mushaf Preload',
  priority: 5,
  critical: false,
  initialize: async () => {
    await mushafPreloadService.initialize();
  },
});

/**
 * Adhkar Store Data (Priority 6)
 * Loads adhkar categories from database into Zustand store
 * Non-critical - can be loaded later if fails
 */
appInitializer.registerService({
  name: 'Adhkar Store Data',
  priority: 6,
  critical: false,
  initialize: async () => {
    await useAdhkarStore.getState().loadCategories();
  },
});

/**
 * Uploads Service (Priority 7)
 * Initializes the uploads database and loads recitations into store
 * Non-critical - app can function without uploads
 */
appInitializer.registerService({
  name: 'Uploads Service',
  priority: 6,
  critical: false,
  initialize: async () => {
    await uploadsService.initialize();
    await useUploadsStore.getState().loadRecitations();
    await useUploadsStore.getState().loadCustomReciters();
    await uploadsService.maybeRunOrphanCleanup();
  },
});

/**
 * Verse Annotations Service (Priority 7)
 * Initializes the verse annotations database for bookmarks, notes, highlights
 * Non-critical - app can function without verse annotations
 */
appInitializer.registerService({
  name: 'Verse Annotations',
  priority: 7,
  critical: false,
  initialize: async () => {
    await verseAnnotationService.initialize();
    await warmBookmarkCache();
  },
});

/**
 * Timestamp Service (Priority 9)
 * Opens/creates local timestamp cache DB
 * Non-critical - app can function without ayah timestamps
 */
appInitializer.registerService({
  name: 'Timestamps',
  priority: 9,
  critical: false,
  initialize: async () => {
    await timestampService.initialize();
    useTimestampStore.getState().loadFollowAlongRegistry();
  },
});

/**
 * Theme Data (Priority 10)
 * Pre-builds verse→theme lookup map for thematic highlighting.
 * Non-critical - lazy init on first access if this fails.
 */
appInitializer.registerService({
  name: 'Theme Data',
  priority: 10,
  critical: false,
  initialize: async () => {
    themeDataService.init();
  },
});

/**
 * Arabic Fonts (Priority 10)
 * Loads Arabic/Quran fonts during initialization (while splash is showing)
 * instead of after splash hides, preventing text flashes.
 * Non-critical - fonts can still be loaded lazily if this fails.
 */
appInitializer.registerService({
  name: 'Arabic Fonts',
  priority: 10,
  critical: false,
  initialize: async () => {
    await Font.loadAsync({
      'ScheherazadeNew-Regular': require('@/assets/fonts/ScheherazadeNew-Regular.ttf'),
      'ScheherazadeNew-Medium': require('@/assets/fonts/ScheherazadeNew-Medium.ttf'),
      'ScheherazadeNew-Bold': require('@/assets/fonts/ScheherazadeNew-Bold.ttf'),
      'ScheherazadeNew-SemiBold': require('@/assets/fonts/ScheherazadeNew-SemiBold.ttf'),
      Uthmani: require('@/assets/fonts/Uthmani.otf'),
      QPC: require('@/assets/fonts/UthmanicHafs1Ver18.ttf'),
      DigitalKhattV1: require('@/data/mushaf/legacy/DigitalKhattQuranicV1.otf'),
      DigitalKhattV2: require('@/data/mushaf/digitalkhatt/DigitalKhattFont.otf'),
    });
  },
});

/**
 * QUL Data Service (Priority 10)
 * Opens ayah-themes, matching-ayah, and mutashabihat SQLite databases.
 * Used for verse themes, similar ayahs, and shared phrases in mushaf sheets.
 * Non-critical - similar verses features degrade gracefully without it.
 */
appInitializer.registerService({
  name: 'QUL Data',
  priority: 10,
  critical: false,
  initialize: async () => {
    await qulDataService.initialize();
  },
});

/**
 * Translation DB Service (Priority 10)
 * Opens translations.db for downloaded remote translations.
 * Non-critical — bundled translations work without it.
 */
appInitializer.registerService({
  name: 'Translation DB',
  priority: 10,
  critical: false,
  initialize: async () => {
    await translationDbService.initialize();
  },
});

/**
 * Tafseer DB Service (Priority 10)
 * Opens tafaseer.db for downloaded tafaseer.
 * Non-critical — tafseer features degrade gracefully without it.
 */
appInitializer.registerService({
  name: 'Tafseer DB',
  priority: 10,
  critical: false,
  initialize: async () => {
    await tafseerDbService.initialize();
    await tafseerDbService.importBundledIbnKathir();
    await useTafseerStore.getState().loadDownloadedMeta();
  },
});

/**
 * WBW Data Service (Priority 10)
 * Opens wbw-en.db for word-by-word translations.
 * Non-critical — WBW features degrade gracefully without it.
 */
appInitializer.registerService({
  name: 'WBW Data',
  priority: 10,
  critical: false,
  initialize: async () => {
    await wbwDataService.initialize();
  },
});

/**
 * Store Hydration (Priority 3)
 * Pre-warms all persisted Zustand stores so AsyncStorage reads complete
 * before the user interacts with the app.
 * Non-critical - stores will hydrate lazily on first access if this fails.
 * Note: useDownloadStore and usePlayerStore are already pre-warmed in prepare().
 */
appInitializer.registerService({
  name: 'Store Hydration',
  priority: 3,
  critical: false,
  initialize: async () => {
    useReciterStore.getState();
    useAmbientStore.getState();
    useAdhkarSettingsStore.getState();
    useMushafSettingsStore.getState();
    useThemeStore.getState();
    usePlayCountStore.getState();
    useLovedStore.getState();
    useRecentlyPlayedStore.getState();
    useFavoriteRecitersStore.getState();
  },
});

// ============================================================================
// QARIAH (TECH_DEBT #243)
// Qariah's skips and overrides of the registrations above, in one place. It
// runs at module load, after every upstream registration and before anything
// can call initialize(). Details: services/qariahInitConfig.ts.
// ============================================================================
applyQariahInitConfig(appInitializer);
