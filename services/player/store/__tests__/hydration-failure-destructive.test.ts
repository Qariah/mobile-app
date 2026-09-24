/**
 * Regression guard for GitHub #329 / Sentry QARIAHV2-20 — a FAILED hydrating
 * read must never lead to the store's defaults being written over the user's
 * real data.
 *
 * `favoriteRecitersStore` is the store under test because it is one of the two
 * landing sites for the v1 -> v2 migration (the other is `lovedStore`), so a
 * silent overwrite here destroys data the migration just successfully restored.
 * The guard itself is shared by all 17 persisted stores
 * (`services/storage/hydrationGuardedStorage.ts`), so this covers the class.
 * "one store's failure does not block another store" is asserted separately
 * against a second real store (`hooks/useSettings.ts`), because a shared/global
 * flag would pass every single-store test here while silently stopping the
 * whole app from saving.
 *
 * Before the fix, "overwrites seeded data after a failed read" FAILED: zustand's
 * persist middleware calls `setItem()` on every `set()` with no hydration check,
 * and a rejected read leaves the store at its defaults.
 *
 * The fresh-install case is tested alongside deliberately: gating writes on a
 * successful read would be far worse than the bug it fixes if it also blocked
 * first-run persistence. `AsyncStorage.getItem` RESOLVES with `null` for an
 * absent key, so that path must stay fully writable.
 *
 * @ai Authored with AI assistance.
 */

import type {Reciter} from '@/data/reciterData';

const STORAGE_KEY = 'player-favorite-reciters-storage';
/** A SECOND real persisted store, for the cross-store isolation test. */
const SETTINGS_KEY = 'settings-storage';

/**
 * The exact iOS data-protection failure seen in production (QARIAHV2-20).
 * `mock`-prefixed so jest permits the module factory below to reference it.
 */
const mockReadError = Object.assign(
  new Error(
    'Failed to read storage file.Error Domain=NSCocoaErrorDomain Code=257 ' +
      '"The file “manifest.json” couldn’t be opened because you don’t have ' +
      'permission to view it."',
  ),
  {code: '257', domain: 'NSCocoaErrorDomain'},
);

// `mock`-prefixed names: jest hoists `jest.mock()` above the file body and only
// permits a factory to close over out-of-scope bindings named this way. Safe
// here because nothing requires the mocked module until `loadStore()` runs.
let mockDisk: Record<string, string> = {};
// 'none' | 'all' | a set of keys. The per-key form exists so one store's read
// can fail while another's succeeds, which is what the isolation test needs.
let mockFailReadsFor: 'none' | 'all' | Set<string> = 'none';
/**
 * Hold every read open, so a write can be made to arrive DURING hydration —
 * the boot race of GitHub #457. `mockReleaseReads()` lets them resolve.
 */
let mockHoldReads = false;
let mockHeldReads: Array<() => void> = [];

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => {
      if (
        mockFailReadsFor === 'all' ||
        (mockFailReadsFor instanceof Set && mockFailReadsFor.has(key))
      ) {
        return Promise.reject(mockReadError);
      }
      // Snapshot at CALL time: AsyncStorage is FIFO, so a read issued before a
      // write returns the pre-write bytes.
      const snapshot = Object.prototype.hasOwnProperty.call(mockDisk, key)
        ? mockDisk[key]
        : null;
      if (!mockHoldReads) return Promise.resolve(snapshot);
      return new Promise<string | null>(resolve => {
        mockHeldReads.push(() => resolve(snapshot));
      });
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      mockDisk[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete mockDisk[key];
    }),
  },
}));

// The favourites store fires an auth-gated QF sync side-effect; irrelevant here
// and it would drag the user-state SQLite layer into the test.
jest.mock('@/services/userState', () => ({
  enqueueFavoritesSync: jest.fn(),
  enqueueReadingSessionSync: jest.fn(),
  enqueuePreferenceSync: jest.fn(),
}));

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

function seedDisk(ids: string[]): void {
  mockDisk[STORAGE_KEY] = JSON.stringify({
    state: {
      favoriteReciterIds: ids,
      favoriteReciters: Object.fromEntries(
        ids.map(id => [id, {id, name: id, favoritedAt: 1}]),
      ),
    },
    version: 0,
  });
}

/**
 * A blob written by an OLDER build: the ids are there, the `favoriteReciters`
 * map the current build also persists is not. That is the shape where a
 * pre-hydration write carries a key storage lacks, so dropping it loses data
 * (GitHub #457).
 */
function seedLegacyDisk(ids: string[]): void {
  mockDisk[STORAGE_KEY] = JSON.stringify({
    state: {favoriteReciterIds: ids},
    version: 0,
  });
}

function releaseHeldReads(): void {
  const held = mockHeldReads;
  mockHeldReads = [];
  held.forEach(release => release());
}

function persistedFavourites(): Record<string, unknown> {
  const raw = mockDisk[STORAGE_KEY];
  if (!raw) return {};
  return JSON.parse(raw).state.favoriteReciters ?? {};
}

function persistedIds(): string[] {
  const raw = mockDisk[STORAGE_KEY];
  if (!raw) return [];
  return JSON.parse(raw).state.favoriteReciterIds;
}

function seedSettings(preferences: Record<string, string>): void {
  mockDisk[SETTINGS_KEY] = JSON.stringify({
    state: {reciterPreferences: preferences},
    version: 0,
  });
}

function persistedPreferences(): Record<string, string> {
  const raw = mockDisk[SETTINGS_KEY];
  if (!raw) return {};
  return JSON.parse(raw).state.reciterPreferences;
}

/** Fresh module registry per test — persist hydrates once, at module load. */
function loadStore() {
  let store: typeof import('../favoriteRecitersStore').useFavoriteRecitersStore;
  jest.isolateModules(() => {
    store = require('../favoriteRecitersStore').useFavoriteRecitersStore;
  });
  // @ts-expect-error assigned synchronously inside isolateModules
  return store;
}

/**
 * Load TWO real persisted stores into ONE module registry — the same shape the
 * running app has, where every store shares a single AsyncStorage.
 */
function loadBothStores() {
  let favorites: typeof import('../favoriteRecitersStore').useFavoriteRecitersStore;
  let settings: typeof import('@/hooks/useSettings').useSettings;
  jest.isolateModules(() => {
    favorites = require('../favoriteRecitersStore').useFavoriteRecitersStore;
    settings = require('@/hooks/useSettings').useSettings;
  });
  // @ts-expect-error both assigned synchronously inside isolateModules
  return {favorites, settings};
}

/** Let the hydration promise chain (and any queued write) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

const gamma = {id: 'reciter-gamma', name: 'Gamma'} as unknown as Reciter;

describe('persisted store hydration failure', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDisk = {};
    mockFailReadsFor = 'none';
    mockHoldReads = false;
    mockHeldReads = [];
    // The guard warns in __DEV__ on every suppressed write; silence it here and
    // assert on it instead of letting it flood the runner output.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does not overwrite stored favourites when the hydrating read fails', async () => {
    seedDisk(['reciter-alpha', 'reciter-beta']);
    mockFailReadsFor = 'all';

    const useFavoriteRecitersStore = loadStore();
    await settle();

    // The read failed, so the store is sitting at its defaults and zustand
    // knows it never hydrated. This is the destructive precondition.
    expect(useFavoriteRecitersStore.getState().favoriteReciterIds).toEqual([]);
    expect(useFavoriteRecitersStore.persist.hasHydrated()).toBe(false);

    // One ordinary write — the kind any tap on a heart icon produces.
    useFavoriteRecitersStore.getState().addFavoriteReciter(gamma);
    await settle();

    // THE ASSERTION: alpha and beta must survive. Before the fix this read
    // ['reciter-gamma'] — the user's favourites permanently gone, with no
    // crash and no user-visible error.
    expect(persistedIds()).toEqual(['reciter-alpha', 'reciter-beta']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to write before a successful read'),
    );
  });

  it('still persists on a fresh install, where the read resolves with null', async () => {
    // No seed: an absent key RESOLVES with null. That is a SUCCESSFUL read and
    // must not be confused with a failure, or first-run users would never be
    // able to save anything.
    const useFavoriteRecitersStore = loadStore();
    await settle();

    expect(useFavoriteRecitersStore.persist.hasHydrated()).toBe(true);

    useFavoriteRecitersStore.getState().addFavoriteReciter(gamma);
    await settle();

    expect(persistedIds()).toEqual(['reciter-gamma']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('restores and appends normally when the read succeeds', async () => {
    seedDisk(['reciter-alpha', 'reciter-beta']);

    const useFavoriteRecitersStore = loadStore();
    await settle();

    expect(useFavoriteRecitersStore.getState().favoriteReciterIds).toEqual([
      'reciter-alpha',
      'reciter-beta',
    ]);

    useFavoriteRecitersStore.getState().addFavoriteReciter(gamma);
    await settle();

    expect(persistedIds()).toEqual([
      'reciter-alpha',
      'reciter-beta',
      'reciter-gamma',
    ]);
  });

  it('keeps a favourite tapped BEFORE the hydrating read resolved (GitHub #457)', async () => {
    // Boot race, not a failure: zustand issues the read at store creation and
    // the user taps a heart 0.3 s later, before it comes back. Production saw
    // this 1097 times in 24 h with zero read failures, and every one of those
    // writes was dropped.
    seedLegacyDisk(['reciter-alpha']);
    mockHoldReads = true;

    const useFavoriteRecitersStore = loadStore();
    await settle();

    // The read is still in flight, so the store sits at its defaults.
    expect(useFavoriteRecitersStore.persist.hasHydrated()).toBe(false);

    useFavoriteRecitersStore.getState().addFavoriteReciter(gamma);
    await settle();

    releaseHeldReads();
    await settle();

    expect(useFavoriteRecitersStore.persist.hasHydrated()).toBe(true);
    // The stored ids win, exactly as zustand's merge decides in memory...
    expect(persistedIds()).toEqual(['reciter-alpha']);
    // ...and THE ASSERTION: the tap is on disk. Before the fix this was `{}` —
    // the write was dropped and nothing ever wrote it again, so the next launch
    // had never heard of it.
    expect(Object.keys(persistedFavourites())).toEqual(['reciter-gamma']);
    // Disk now matches the hydrated store instead of silently diverging.
    expect(persistedFavourites()).toEqual(
      useFavoriteRecitersStore.getState().favoriteReciters,
    );
  });

  it('still self-heals a corrupt blob — an unparseable value is not an unreadable one', async () => {
    // The guard sits beneath the JSON layer on purpose. A read that RESOLVES
    // with garbage opened the gate; the stored value is already lost, and
    // overwriting it is the only recovery. If this ever starts failing, the
    // guard has been lifted above `createJSONStorage` and one corrupt blob now
    // locks its store read-only on every launch, forever.
    mockDisk[STORAGE_KEY] = '{not json';

    const useFavoriteRecitersStore = loadStore();
    await settle();

    expect(useFavoriteRecitersStore.persist.hasHydrated()).toBe(false);

    useFavoriteRecitersStore.getState().addFavoriteReciter(gamma);
    await settle();

    expect(persistedIds()).toEqual(['reciter-gamma']);
  });

  it('keeps refusing writes for the rest of the process after a failed read', async () => {
    // A recovered read is out of scope for this fix (see #329) — what matters
    // is that the refusal does not lapse and let a later write through.
    seedDisk(['reciter-alpha']);
    mockFailReadsFor = 'all';

    const useFavoriteRecitersStore = loadStore();
    await settle();

    mockFailReadsFor = 'none'; // storage becomes readable again mid-process
    useFavoriteRecitersStore.getState().addFavoriteReciter(gamma);
    await settle();

    expect(persistedIds()).toEqual(['reciter-alpha']);
  });

  it("one store's failed read does not suppress a DIFFERENT store's writes", async () => {
    // The guard state lives in a closure created per `guardedJSONStorage(name)`
    // call, so each store owns its own gate. If that ever regresses to shared
    // module-level state, a single unreadable key would silently stop the WHOLE
    // app from saving anything — a far worse outcome than the bug being fixed,
    // and one every single-store test above would still pass through.
    seedDisk(['reciter-alpha']);
    seedSettings({'reciter-alpha': 'hafs'});
    // ONLY the favourites key is unreadable.
    mockFailReadsFor = new Set([STORAGE_KEY]);

    const {favorites, settings} = loadBothStores();
    await settle();

    expect(favorites.persist.hasHydrated()).toBe(false);
    expect(settings.persist.hasHydrated()).toBe(true);
    expect(settings.getState().reciterPreferences).toEqual({
      'reciter-alpha': 'hafs',
    });

    // One ordinary write against each store.
    favorites.getState().addFavoriteReciter(gamma);
    settings.getState().setReciterPreference('reciter-beta', 'warsh');
    await settle();

    // The blocked store kept the user's stored data...
    expect(persistedIds()).toEqual(['reciter-alpha']);
    // ...and the healthy store persisted normally, keeping its existing entry.
    expect(persistedPreferences()).toEqual({
      'reciter-alpha': 'hafs',
      'reciter-beta': 'warsh',
    });
  });
});
