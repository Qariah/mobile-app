// @ai-generated
// Qariah (Sprint 48, S48.6): the body of the background catalog check and of
// the foreground run (`runQariahCatalogTask`), with fakes for the network,
// MMKV, the preferences, the favorites and the notifier.
import type {Reciter, Rewayat} from '@/data/reciterData';
import {CATALOG_SNAPSHOT_KEY, createCatalogSnapshotStore} from '../catalogDiff';
import {
  CATALOG_CHECK_PENDING_KEY,
  LAST_CATALOG_VERSION_KEY,
  readFavoriteReciterIds,
  runQariahCatalogTask,
  type CatalogTaskDeps,
} from '../catalogTask';
import {localDay} from '../localDay';
import {DEFAULT_NOTIFICATION_TYPE_PREFS} from '../prefsStore';
import {
  BACKGROUND_RUNS_SINCE_REPORT_KEY,
  LAST_BACKGROUND_RUN_AT_KEY,
  LAST_BACKGROUND_STATUS_KEY,
} from '../backgroundRunReport';
import type {
  KeyValueStorage,
  NotificationCandidate,
  NotificationPermissionStatus,
  NotificationPrefsSnapshot,
  Notifier,
} from '../types';

// The factory runs when `../catalogTask` is imported (before this file's
// constants exist), so the mock lives in the factory.
jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
const mockSentry = jest.requireMock('@sentry/react-native') as {
  captureMessage: jest.Mock;
  addBreadcrumb: jest.Mock;
};

/** The favorites store for `readFavoriteReciterIds` (its `persist` API). */
const mockFavorites = {
  hydrated: true,
  ids: ['fav'],
  listeners: new Set<() => void>(),
};
jest.mock('@/services/player/store/favoriteRecitersStore', () => ({
  useFavoriteRecitersStore: {
    getState: () => ({favoriteReciterIds: mockFavorites.ids}),
    persist: {
      hasHydrated: () => mockFavorites.hydrated,
      onFinishHydration: (listener: () => void) => {
        mockFavorites.listeners.add(listener);
        return () => mockFavorites.listeners.delete(listener);
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Fixtures

function rewayah(id: string, surahs: number[]): Rewayat {
  return {
    id,
    reciter_id: 'unused',
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: surahs.length,
    surah_list: surahs,
    source_type: 'qariah',
    created_at: '2026-01-01T00:00:00Z',
    surah_metadata: surahs.map(surah => ({
      surah,
      is_full: true,
      added_at: '2026-10-20',
    })),
  };
}

function reciter(id: string, surahs: number[]): Reciter {
  return {
    id,
    name: `Reciter ${id}`,
    slug: id,
    date: null,
    image_url: null,
    rewayat: [rewayah(`${id}-w`, surahs)],
  };
}

const BASE: Reciter[] = [reciter('fav', [1]), reciter('other', [2])];
const WITH_KAHF: Reciter[] = [reciter('fav', [1, 18]), reciter('other', [2])];

const VERSION_URL = 'https://catalog.example.invalid/catalog-version.json';
const LIVE_URL = 'https://catalog.example.invalid/catalog-v1.json';
const VERSIONED_URL = 'https://catalog.example.invalid/history/v6.json';

const DAY1 = new Date(2026, 9, 20, 10, 0);
const DAY2 = new Date(2026, 9, 21, 10, 0);

function memoryStorage(): KeyValueStorage & {data: Map<string, string>} {
  const data = new Map<string, string>();
  return {
    data,
    getString: key => data.get(key),
    set: (key, value) => {
      data.set(key, value);
    },
    remove: key => {
      data.delete(key);
    },
  };
}

/** A server: `catalog-version.json` and the catalog at each URL. */
function server(initial: {version: number | null; url?: string}) {
  const state = {
    version: initial.version as number | null,
    url: initial.url,
    catalogs: new Map<string, Reciter[] | null>([[LIVE_URL, BASE]]),
    failVersion: false,
  };
  const fetchFn = jest.fn(async (url: string) => {
    if (url === VERSION_URL) {
      if (state.failVersion) throw new Error('offline');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          version: state.version,
          ...(state.url ? {url: state.url} : {}),
        }),
      };
    }
    const catalog = state.catalogs.get(url);
    if (catalog === undefined)
      return {ok: false, status: 404, json: async () => null};
    if (catalog === null) throw new Error('offline');
    return {ok: true, status: 200, json: async () => catalog};
  });
  const catalogFetches = () =>
    fetchFn.mock.calls
      .filter(([url]) => url !== VERSION_URL)
      .map(([url]) => url);
  return {state, fetchFn, catalogFetches};
}

function fakeNotifier(): Notifier & {
  schedule: jest.Mock;
  getPermission: jest.Mock;
} {
  return {
    schedule: jest.fn(
      async (candidate: NotificationCandidate) => candidate.dedupeKey,
    ),
    cancel: jest.fn(async () => undefined),
    cancelByType: jest.fn(async () => undefined),
    getPermission: jest.fn(
      async (): Promise<NotificationPermissionStatus> => 'granted',
    ),
  };
}

function fakePrefs(initial: Partial<NotificationPrefsSnapshot> = {}) {
  const state: NotificationPrefsSnapshot = {
    ...DEFAULT_NOTIFICATION_TYPE_PREFS,
    lastNotifiedDay: null,
    ...initial,
  };
  return {
    state,
    read: jest.fn(async () => ({...state})),
    markNotifiedToday: jest.fn(async (now: Date) => {
      state.lastNotifiedDay = localDay(now);
      return true;
    }),
  };
}

/** One device: its storage, prefs and notifier across runs. */
function device(options: {prefs?: Partial<NotificationPrefsSnapshot>} = {}) {
  const storage = memoryStorage();
  const prefs = fakePrefs(options.prefs);
  const notifier = fakeNotifier();
  const srv = server({version: 5});
  const deps = (
    extra: Partial<CatalogTaskDeps> = {},
    now = DAY1,
  ): CatalogTaskDeps => ({
    storage,
    fetchFn: srv.fetchFn as unknown as typeof fetch,
    versionEndpoint: VERSION_URL,
    liveUrl: LIVE_URL,
    readFavorites: async () => ['fav'],
    isHoldout: () => false,
    notifier,
    checkDeps: {snapshotStore: createCatalogSnapshotStore(storage), prefs, now},
    ...extra,
  });
  const background = (extra?: Partial<CatalogTaskDeps>, now?: Date) =>
    runQariahCatalogTask('background', deps(extra, now));
  const foreground = (
    catalog: Reciter[],
    extra?: Partial<CatalogTaskDeps>,
    now?: Date,
  ) => runQariahCatalogTask('foreground', deps({catalog, ...extra}, now));
  const snapshot = () => createCatalogSnapshotStore(storage).load();
  return {storage, prefs, notifier, srv, background, foreground, snapshot};
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFavorites.hydrated = true;
  mockFavorites.ids = ['fav'];
  mockFavorites.listeners.clear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('runQariahCatalogTask (background)', () => {
  it('the first run records the snapshot and the version, and posts nothing', async () => {
    const d = device();
    const result = await d.background();
    expect(result).toMatchObject({
      source: 'background',
      status: 'first_check',
      catalogVersion: 5,
    });
    expect(d.srv.catalogFetches()).toEqual([LIVE_URL]);
    expect(d.storage.data.get(LAST_CATALOG_VERSION_KEY)).toBe('5');
    expect(d.storage.data.has(CATALOG_CHECK_PENDING_KEY)).toBe(false);
    expect(d.snapshot()?.size).toBe(2);
    expect(d.notifier.schedule).not.toHaveBeenCalled();
  });

  it('then reports nothing_new on a new version with the same recitations', async () => {
    const d = device();
    await d.background();
    d.srv.state.version = 6;
    const result = await d.background();
    expect(result).toMatchObject({status: 'nothing_new', catalogVersion: 6});
    expect(d.storage.data.get(LAST_CATALOG_VERSION_KEY)).toBe('6');
  });

  it('does not fetch the catalog when the version did not change', async () => {
    const d = device();
    await d.background();
    const result = await d.background();
    expect(result).toMatchObject({
      status: 'version_unchanged',
      catalogVersion: 5,
    });
    expect(d.srv.catalogFetches()).toEqual([LIVE_URL]);
    expect(result.check).toBeUndefined();
  });

  it('posts a new recitation of a followed reciter after a version change', async () => {
    const d = device();
    await d.background();
    d.srv.state.version = 6;
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    const result = await d.background();
    expect(result.status).toBe('posted');
    expect(d.notifier.schedule).toHaveBeenCalledTimes(1);
    const [posted, trigger] = d.notifier.schedule.mock.calls[0];
    expect(trigger).toEqual({kind: 'immediate'});
    expect(posted).toMatchObject({
      type: 'followed_recitation',
      dedupeKey: 'followed_recitation:fav|fav-w|18||',
      target: {kind: 'recitation', reciterId: 'fav', surah: 18},
    });
    expect(d.prefs.state.lastNotifiedDay).toBe(localDay(DAY1));
  });

  it('queues the notification_scheduled event of a background post for the next start', async () => {
    const d = device();
    await d.background();
    d.srv.state.version = 6;
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    await d.background();
    const queue = JSON.parse(
      d.storage.data.get('pending_scheduled_events') ?? '[]',
    ) as Record<string, unknown>[];
    expect(queue).toEqual([
      expect.objectContaining({
        type: 'followed_recitation',
        trigger: 'immediate',
        source: 'background',
        announcement_id: null,
      }),
    ]);
  });

  it('reports each posted notice with its source', async () => {
    const d = device();
    const reportPosted = jest.fn();
    await d.background({reportPosted});
    expect(reportPosted).not.toHaveBeenCalled();
    d.srv.state.version = 6;
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    await d.background({reportPosted});
    expect(reportPosted).toHaveBeenCalledWith(
      expect.objectContaining({type: 'followed_recitation'}),
      'background',
    );
  });

  it('announces a recitation that is missing from the stored snapshot (the forgotten-key path)', async () => {
    const d = device();
    await d.background();
    // Remove ONE key from the stored snapshot, as a DEV helper would.
    const raw = JSON.parse(
      d.storage.data.get(CATALOG_SNAPSHOT_KEY) ?? '{}',
    ) as {
      v: number;
      keys: string[];
    };
    d.storage.data.set(
      CATALOG_SNAPSHOT_KEY,
      JSON.stringify({
        ...raw,
        keys: raw.keys.filter(key => key !== 'other|other-w|2||'),
      }),
    );
    d.srv.state.version = 6;
    const result = await d.background();
    expect(result.status).toBe('posted');
    expect(result.check?.newKeys).toEqual(['other|other-w|2||']);
    expect(d.notifier.schedule.mock.calls[0][0]).toMatchObject({
      type: 'new_recitation',
    });
  });

  it('uses the per-version URL of catalog-version.json before the live URL', async () => {
    const d = device();
    d.srv.state.url = VERSIONED_URL;
    d.srv.state.catalogs.set(VERSIONED_URL, BASE);
    await d.background();
    expect(d.srv.catalogFetches()).toEqual([VERSIONED_URL]);
  });

  it('fetches the catalog on each run when no version endpoint is configured', async () => {
    const d = device();
    await d.background({versionEndpoint: null});
    const result = await d.background({versionEndpoint: null});
    expect(result.status).toBe('nothing_new');
    expect(result.catalogVersion).toBeUndefined();
    expect(d.srv.catalogFetches()).toEqual([LIVE_URL, LIVE_URL]);
  });

  it('reports no_catalog_source with no URL at all', async () => {
    const d = device();
    const result = await d.background({versionEndpoint: null, liveUrl: null});
    expect(result.status).toBe('no_catalog_source');
    expect(d.srv.fetchFn).not.toHaveBeenCalled();
  });

  it('reports version_unavailable offline, and fetches nothing else', async () => {
    const d = device();
    d.srv.state.failVersion = true;
    const result = await d.background();
    expect(result.status).toBe('version_unavailable');
    expect(d.srv.catalogFetches()).toEqual([]);
  });

  it('reports version_unavailable for a document without a numeric version', async () => {
    const d = device();
    d.srv.state.version = null;
    expect((await d.background()).status).toBe('version_unavailable');
  });

  it('reports catalog_unavailable, and records no version, when the catalog does not load', async () => {
    const d = device();
    d.srv.state.catalogs.set(LIVE_URL, null);
    const result = await d.background();
    expect(result).toMatchObject({
      status: 'catalog_unavailable',
      catalogVersion: 5,
    });
    expect(d.storage.data.has(LAST_CATALOG_VERSION_KEY)).toBe(false);
    expect(d.snapshot()).toBeNull();
  });

  it('reports catalog_unavailable for an empty catalog', async () => {
    const d = device();
    d.srv.state.catalogs.set(LIVE_URL, []);
    expect((await d.background()).status).toBe('catalog_unavailable');
  });

  it('gives up on a fetch after the time limit', async () => {
    const d = device();
    const hanging = jest.fn(
      (_url: string, init?: {signal?: AbortSignal}) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const result = await d.background({
      fetchFn: hanging as unknown as typeof fetch,
      fetchTimeoutMs: 5,
    });
    expect(result.status).toBe('version_unavailable');
  });

  it('skips with favorites_unavailable, downloads and saves nothing when the favorites cannot be read', async () => {
    const d = device();
    const result = await d.background({readFavorites: async () => null});
    expect(result.status).toBe('favorites_unavailable');
    expect(d.srv.fetchFn).not.toHaveBeenCalled();
    expect(d.snapshot()).toBeNull();
    expect(d.storage.data.has(LAST_CATALOG_VERSION_KEY)).toBe(false);
  });

  it('keeps the version unrecorded when the prefs cannot be read, so the next run checks again', async () => {
    const d = device();
    d.prefs.read.mockResolvedValueOnce(null as never);
    expect((await d.background()).status).toBe('prefs_unavailable');
    expect(d.srv.fetchFn).not.toHaveBeenCalled();
    expect(d.storage.data.has(LAST_CATALOG_VERSION_KEY)).toBe(false);
    expect((await d.background()).status).toBe('first_check');
  });

  it('checks again with the same version while keys are held back by the daily limit', async () => {
    const d = device();
    await d.background(); // first check, day 1
    d.prefs.state.lastNotifiedDay = localDay(DAY1); // a notice already went out today
    d.srv.state.version = 6;
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    const held = await d.background();
    expect(held.status).toBe('not_posted');
    expect(held.check?.heldBackKeys).toEqual(['fav|fav-w|18||']);
    expect(d.storage.data.get(CATALOG_CHECK_PENDING_KEY)).toBe('1');

    // The next day, the same version: the run fetches again and posts.
    const next = await d.background({}, DAY2);
    expect(next.status).toBe('posted');
    expect(d.srv.catalogFetches()).toHaveLength(3);
    expect(d.storage.data.has(CATALOG_CHECK_PENDING_KEY)).toBe(false);

    // Then the version is unchanged and nothing waits: no fetch.
    expect((await d.background({}, DAY2)).status).toBe('version_unchanged');
  });

  it('stops before any download for a holdout user, and removes the snapshot', async () => {
    const d = device();
    await d.background();
    d.srv.state.version = 6;
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    d.srv.fetchFn.mockClear();
    const result = await d.background({isHoldout: () => true});
    expect(result.status).toBe('holdout');
    expect(d.srv.fetchFn).not.toHaveBeenCalled();
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    expect(d.snapshot()).toBeNull();
    expect(d.storage.data.has(LAST_CATALOG_VERSION_KEY)).toBe(false);
  });

  it('stops before any download without permission; the first run after a yes is a first check', async () => {
    const d = device();
    await d.background(); // the baseline at version 5
    d.notifier.getPermission.mockResolvedValue('denied');
    d.srv.fetchFn.mockClear();
    const denied = await d.background();
    expect(denied.status).toBe('no_permission');
    expect(d.srv.fetchFn).not.toHaveBeenCalled();
    expect(d.snapshot()).toBeNull();

    // Months later, a new recitation, then the user allows notifications:
    // the same version still downloads (no snapshot), and announces nothing.
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    d.notifier.getPermission.mockResolvedValue('granted');
    const again = await d.background();
    expect(again.status).toBe('first_check');
    expect(d.srv.catalogFetches()).toEqual([LIVE_URL]);
    expect(d.notifier.schedule).not.toHaveBeenCalled();
  });

  it('reports permission_unavailable when the permission read fails, and downloads nothing', async () => {
    const d = device();
    d.notifier.getPermission.mockRejectedValueOnce(new Error('no module'));
    expect((await d.background()).status).toBe('permission_unavailable');
    expect(d.srv.fetchFn).not.toHaveBeenCalled();
  });

  it('reports storage_unavailable when MMKV did not open, and downloads nothing', async () => {
    const d = device();
    const closed = {...memoryStorage(), isAvailable: () => false};
    const result = await d.background({
      storage: closed,
      checkDeps: {
        snapshotStore: createCatalogSnapshotStore(closed),
        prefs: d.prefs,
        now: DAY1,
      },
    });
    expect(result.status).toBe('storage_unavailable');
    expect(d.srv.fetchFn).not.toHaveBeenCalled();
  });

  it('downloads again with the same version when the snapshot is gone', async () => {
    const d = device();
    await d.background();
    d.storage.data.delete(CATALOG_SNAPSHOT_KEY);
    const result = await d.background();
    expect(result.status).toBe('first_check');
    expect(d.srv.catalogFetches()).toEqual([LIVE_URL, LIVE_URL]);
  });

  it('records the version after a post that failed on a missing text key, so it does not download again', async () => {
    const d = device();
    await d.background();
    d.srv.state.version = 6;
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    const missing = Object.assign(new Error('No text'), {
      name: 'NotificationTextMissingError',
    });
    d.notifier.schedule.mockRejectedValue(missing);
    const failed = await d.background();
    expect(failed).toMatchObject({status: 'post_failed', textMissing: true});
    expect(d.storage.data.get(LAST_CATALOG_VERSION_KEY)).toBe('6');
    expect(d.storage.data.has(CATALOG_CHECK_PENDING_KEY)).toBe(false);
    // The key stays out of the snapshot, so a later check finds it again.
    expect(d.snapshot()?.has('fav|fav-w|18||')).toBe(false);
    expect(mockSentry.addBreadcrumb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({text_missing: true}),
      }),
    );

    expect((await d.background()).status).toBe('version_unchanged');
    expect(d.srv.catalogFetches()).toHaveLength(2);

    // With the text (a new build), the foreground check posts it.
    d.notifier.schedule.mockImplementation(
      async (candidate: NotificationCandidate) => candidate.dedupeKey,
    );
    expect((await d.foreground(WITH_KAHF)).status).toBe('posted');
  });

  it('still waits for another failed post (not a missing text): the next run downloads again', async () => {
    const d = device();
    await d.background();
    d.srv.state.version = 6;
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    d.notifier.schedule.mockRejectedValueOnce(new Error('native'));
    const failed = await d.background();
    expect(failed.status).toBe('post_failed');
    expect(failed.textMissing).toBeUndefined();
    expect(d.storage.data.get(CATALOG_CHECK_PENDING_KEY)).toBe('1');
    expect((await d.background()).status).toBe('posted');
  });

  it('records each background run for the field report, and not a foreground run', async () => {
    const d = device();
    await d.background({}, DAY1);
    expect(d.storage.data.get(LAST_BACKGROUND_STATUS_KEY)).toBe('first_check');
    expect(d.storage.data.get(LAST_BACKGROUND_RUN_AT_KEY)).toBe(
      DAY1.toISOString(),
    );
    await d.background();
    expect(d.storage.data.get(LAST_BACKGROUND_STATUS_KEY)).toBe(
      'version_unchanged',
    );
    expect(d.storage.data.get(BACKGROUND_RUNS_SINCE_REPORT_KEY)).toBe('2');
    await d.foreground(BASE);
    expect(d.storage.data.get(BACKGROUND_RUNS_SINCE_REPORT_KEY)).toBe('2');
  });

  it('checks with the same version when an extra candidate waits (Task 18)', async () => {
    const d = device();
    await d.background();
    const whatsNew: NotificationCandidate = {
      type: 'whats_new',
      title: {text: 'New'},
      target: {kind: 'listen'},
      dedupeKey: 'whats_new:2026-10-sprint48',
      coveredKeys: [],
    };
    const snapshotBefore = d.storage.data.get(CATALOG_SNAPSHOT_KEY);
    const result = await d.background({extraCandidates: () => [whatsNew]});
    expect(result.status).toBe('posted');
    expect(d.notifier.schedule.mock.calls[0][0]).toBe(whatsNew);
    // The announcement needs no catalog: no second download, no diff, and
    // the stored snapshot stays as it was.
    expect(d.srv.catalogFetches()).toEqual([LIVE_URL]);
    expect(result.check?.newKeys).toEqual([]);
    expect(d.storage.data.get(CATALOG_SNAPSHOT_KEY)).toBe(snapshotBefore);
    expect(d.prefs.state.lastNotifiedDay).toBe(localDay(DAY1));
  });

  it('downloads for an announcement when the version changed', async () => {
    const d = device();
    await d.background();
    d.srv.state.version = 6;
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    const whatsNew: NotificationCandidate = {
      type: 'whats_new',
      title: {text: 'New'},
      target: {kind: 'listen'},
      dedupeKey: 'whats_new:2026-10-sprint48',
      coveredKeys: [],
    };
    const result = await d.background({extraCandidates: () => [whatsNew]});
    expect(d.srv.catalogFetches()).toEqual([LIVE_URL, LIVE_URL]);
    // The followed recitation wins the day; the announcement waits.
    expect(result.status).toBe('posted');
    expect(result.check?.posted?.type).toBe('followed_recitation');
  });

  it('gives failed, and does not throw, when a dependency throws', async () => {
    const d = device();
    const result = await d.background({
      readFavorites: async () => {
        throw new Error('boom');
      },
    });
    expect(result.status).toBe('failed');
  });

  it('runs one check at a time in a process', async () => {
    const d = device();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const first = d.background({
      readFavorites: async () => {
        await gate;
        return ['fav'];
      },
    });
    const second = await d.background();
    expect(second.status).toBe('already_running');
    release();
    expect((await first).status).toBe('first_check');
    // After the first run ends, a new run goes ahead.
    expect((await d.background()).status).toBe('version_unchanged');
  });

  it('leaves one breadcrumb for each run, and no Sentry event', async () => {
    const d = device();
    await d.background();
    expect(mockSentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'notifications',
        message: 'catalog check (background): first_check',
      }),
    );
    expect(mockSentry.captureMessage).not.toHaveBeenCalled();
  });
});

describe('runQariahCatalogTask (foreground)', () => {
  it('checks the given catalog with no fetch, and records no version', async () => {
    const d = device();
    const first = await d.foreground(BASE);
    expect(first).toMatchObject({source: 'foreground', status: 'first_check'});
    expect(first.catalogVersion).toBeUndefined();
    expect(d.srv.fetchFn).not.toHaveBeenCalled();
    expect(d.storage.data.has(LAST_CATALOG_VERSION_KEY)).toBe(false);

    const second = await d.foreground(WITH_KAHF);
    expect(second.status).toBe('posted');
    expect(d.srv.fetchFn).not.toHaveBeenCalled();
  });

  it('shares the snapshot with the background run', async () => {
    const d = device();
    await d.foreground(BASE);
    d.srv.state.catalogs.set(LIVE_URL, WITH_KAHF);
    const result = await d.background();
    expect(result.status).toBe('posted');
  });
});

describe('readFavoriteReciterIds', () => {
  it('gives the ids of a hydrated store', async () => {
    mockFavorites.ids = ['a', 'b'];
    await expect(readFavoriteReciterIds()).resolves.toEqual(['a', 'b']);
  });

  it('waits for the hydration', async () => {
    mockFavorites.hydrated = false;
    const ids = readFavoriteReciterIds(1000);
    expect(mockFavorites.listeners.size).toBe(1);
    mockFavorites.hydrated = true;
    mockFavorites.listeners.forEach(listener => listener());
    await expect(ids).resolves.toEqual(['fav']);
    expect(mockFavorites.listeners.size).toBe(0);
  });

  it('gives null when the store does not hydrate in time', async () => {
    jest.useFakeTimers();
    mockFavorites.hydrated = false;
    const ids = readFavoriteReciterIds(5000);
    jest.advanceTimersByTime(5000);
    await expect(ids).resolves.toBeNull();
    expect(mockFavorites.listeners.size).toBe(0);
  });
});
