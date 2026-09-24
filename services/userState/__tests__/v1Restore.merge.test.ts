// @ai
// #388 — the merge ledger of `mergeV1IntoLocalStores`.
//
// QARIAHV2-2P fired `v1-restore-zero-merge` at level:'error' on a benign
// re-run, because an item that was ALREADY present locally hit a bare
// `continue`: not added, not skipped, invisible. The detector could not tell a
// healthy re-run from a real silent failure, so both produced the same
// all-zero ledger.
//
// These tests pin the invariant that makes the two readable apart:
//
//     added + skipped + alreadyPresent + lostToWriteError === candidateTotal
//
// per class (reciters / recitations / surahs) and in total. If a future edit
// re-introduces an unaccounted `continue`, the sum drops below the candidate
// total and one of these fails — which is the whole point, because the thing
// under repair here is trust in an alarm, and a detector regression is
// otherwise silent.
//
// #394 added the last term. The surah branch commits through one all-or-nothing
// write, and it used to count the rows BEFORE that write — so a storage failure
// reported data it never saved. The final describe block below pins that.

// react-native-mmkv + expo-crypto: the import chain reaches AnalyticsService
// (lovedStore → analyticsService) and v1Restore's own `digestStringAsync`,
// neither of which has a native module in the jest env. Same stubs as
// services/analytics/__tests__/AnalyticsService.test.ts.
const mockMmkvStorage = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => mockMmkvStorage.get(key),
    set: (key: string, value: string) => mockMmkvStorage.set(key, value),
    delete: (key: string) => mockMmkvStorage.delete(key),
    getAllKeys: () => Array.from(mockMmkvStorage.keys()),
  }),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-device-id',
}));

// The favorites store mirrors additions to QF via the services/userState
// barrel. The barrel pulls the whole user-state stack (db, syncQueue, QF SDK);
// the merge ledger does not depend on any of it.
jest.mock('@/services/userState', () => ({
  enqueueFavoritesSync: jest.fn(),
  enqueueReadingSessionSync: jest.fn(),
  enqueuePreferenceSync: jest.fn(),
}));

// RECITERS is an empty array until dataService populates it in-place at
// runtime, so `findReciter` matches nothing in jest unless the catalog is
// stubbed. Two reciters is enough: one reachable by slug, one only by name.
jest.mock('@/data/reciterData', () => ({
  RECITERS: [
    {
      id: 'r-alpha',
      name: 'Alpha Reciter',
      slug: 'alpha-reciter',
      date: null,
      image_url: null,
      rewayat: [
        {
          id: 'rw-alpha-hafs',
          reciter_id: 'r-alpha',
          name: "Hafs A'n Assem",
          style: 'murattal',
          server: 'https://example.invalid/alpha/',
          surah_total: 114,
          surah_list: [],
          source_type: 'test',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
    {
      id: 'r-beta',
      name: 'Beta Reciter',
      slug: null,
      date: null,
      image_url: null,
      rewayat: [
        {
          id: 'rw-beta-hafs',
          reciter_id: 'r-beta',
          name: "Hafs A'n Assem",
          style: 'murattal',
          server: 'https://example.invalid/beta/',
          surah_total: 114,
          surah_list: [],
          source_type: 'test',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  ],
}));

// The Sentry SDK registers a module-level setInterval at import time
// (AsyncExpiringMap), which keeps the jest worker alive and forces a hard
// exit. Nothing here reports to Sentry. Same stub as
// services/diagnostics/__tests__/memoryWatch.budget.test.ts.
jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
  setContext: jest.fn(),
  flush: () => Promise.resolve(true),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  mergeV1IntoLocalStores,
  V1_FAVORITE_SURAHS_KEY,
  V1_RESTORE_FLAG_KEY,
  type RestoreMergeResult,
} from '../v1Restore';
import {emptyQariahUserStateV1, type QariahUserStateV1} from '../schema';
import {useFavoriteRecitersStore} from '@/services/player/store/favoriteRecitersStore';
import {useLovedStore} from '@/services/player/store/lovedStore';
import {RECITERS} from '@/data/reciterData';

const ALPHA = RECITERS[0];
const BETA = RECITERS[1];
const AT = '2026-01-01T00:00:00.000Z';

function stateWith(
  favorites: Partial<QariahUserStateV1['favorites']>,
): QariahUserStateV1 {
  const base = emptyQariahUserStateV1('v1-extractor');
  return {...base, favorites: {...base.favorites, ...favorites}};
}

function reciterRow(slug: string | null, name: string) {
  return {legacyId: `l-${name}`, slug, name, addedAt: AT};
}

function recitationRow(
  reciterSlug: string | null,
  reciterName: string,
  surahNumber: number | null,
) {
  return {
    legacyId: `l-${reciterName}-${surahNumber}`,
    legacyReciterId: 'l-reciter',
    reciterSlug,
    reciterName,
    surahNumber,
    surahName: 'Test Surah',
    rewayah: "Hafs A'n Assem",
    addedAt: AT,
  };
}

/** The candidate denominator, computed exactly as V1RestoreModal computes it. */
function candidateTotalOf(state: QariahUserStateV1): number {
  return (
    state.favorites.reciters.length +
    state.favorites.surahs.length +
    state.favorites.recitations.length
  );
}

function recitersLedger(r: RestoreMergeResult): number {
  return r.recitersAdded + r.recitersSkippedNoSlug + r.recitersAlreadyPresent;
}

function recitationsLedger(r: RestoreMergeResult): number {
  return (
    r.recitationsAdded +
    r.recitationsSkippedNoSlug +
    r.recitationsSkippedNoSurah +
    r.recitationsSkippedNoReciter +
    r.recitationsSkippedNoRewayat +
    r.recitationsAlreadyPresent
  );
}

function surahsLedger(r: RestoreMergeResult): number {
  return r.surahsAdded + r.surahsAlreadyPresent + r.surahsLostToWriteError;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useFavoriteRecitersStore.getState().reset();
  useLovedStore.getState().clearLoved();
});

const storageRestores: Array<() => void> = [];

afterEach(() => {
  while (storageRestores.length > 0) storageRestores.pop()?.();
});

/**
 * Make ONE AsyncStorage method reject for the sidecar surah key only.
 *
 * Scoped to that key on purpose: `mergeV1IntoLocalStores` also writes the
 * done-flag through the same API, and a blanket failure would exercise a
 * different path than the one under test. This reproduces QARIAHV2-20, where
 * the device is out of storage and the write — not the app — is what fails.
 *
 * The package's jest mock is already a `jest.fn`, and `jest.spyOn` hands back
 * that SAME function rather than wrapping it — so delegating to a captured
 * reference recurses forever. Swap the implementation and put the previous one
 * back by hand instead.
 */
function failSidecar(method: 'getItem' | 'setItem', message: string) {
  const mock = AsyncStorage[method] as unknown as jest.Mock;
  const original = mock.getMockImplementation();
  mock.mockImplementation((key: string, ...rest: unknown[]) => {
    if (key === V1_FAVORITE_SURAHS_KEY) {
      return Promise.reject(new Error(message));
    }
    return original?.(key, ...rest);
  });
  storageRestores.push(() => {
    if (original) mock.mockImplementation(original);
  });
}

describe('mergeV1IntoLocalStores — the merge ledger', () => {
  it('accounts for every offered item across all three classes', async () => {
    // Seed the local state a returning user would already have.
    useFavoriteRecitersStore.getState().addFavoriteReciter(ALPHA);
    useLovedStore.getState().toggleLoved(ALPHA.id, '1', ALPHA.rewayat[0].id);
    await AsyncStorage.setItem(
      V1_FAVORITE_SURAHS_KEY,
      JSON.stringify([{surahNumber: 36, addedAt: AT}]),
    );

    const state = stateWith({
      reciters: [
        reciterRow('alpha-reciter', 'Alpha Reciter'), // already a favorite
        reciterRow(null, 'Beta Reciter'), // new, resolved by name
        reciterRow('ghost-reciter', 'Ghost Reciter'), // no v2 match
      ],
      recitations: [
        recitationRow('alpha-reciter', 'Alpha Reciter', 1), // already loved
        recitationRow('alpha-reciter', 'Alpha Reciter', 2), // new
        recitationRow('alpha-reciter', 'Alpha Reciter', null), // no surah
        recitationRow('ghost-reciter', 'Ghost Reciter', 3), // slug, no match
        recitationRow(null, 'Ghost Reciter', 4), // no slug, no match
      ],
      surahs: [
        {surahNumber: 36, addedAt: AT}, // already in the sidecar key
        {surahNumber: 67, addedAt: AT}, // new
      ],
    });

    const result = await mergeV1IntoLocalStores(state);

    expect(result).toMatchObject({
      recitersAdded: 1,
      recitersAlreadyPresent: 1,
      recitersSkippedNoSlug: 1,
      recitationsAdded: 1,
      recitationsAlreadyPresent: 1,
      recitationsSkippedNoSurah: 1,
      recitationsSkippedNoReciter: 1,
      recitationsSkippedNoSlug: 1,
      surahsAdded: 1,
      surahsAlreadyPresent: 1,
    });

    // Per-class reconciliation — this is the invariant, not the numbers above.
    expect(recitersLedger(result)).toBe(state.favorites.reciters.length);
    expect(recitationsLedger(result)).toBe(state.favorites.recitations.length);
    expect(surahsLedger(result)).toBe(state.favorites.surahs.length);

    // …and in total, against the denominator the modal actually uses.
    expect(
      recitersLedger(result) + recitationsLedger(result) + surahsLedger(result),
    ).toBe(candidateTotalOf(state));
  });

  it('counts a repeated surah row as already-present, not a second append', async () => {
    // Two v1 rows for the SAME surah. The sidecar `have` Set is seeded from
    // stored contents only, so without marking each append the second row
    // misses the Set, gets pushed again, and lands in the sidecar twice.
    const state = stateWith({
      surahs: [
        {surahNumber: 18, addedAt: AT},
        {surahNumber: 18, addedAt: AT},
      ],
    });

    const result = await mergeV1IntoLocalStores(state);

    expect(result.surahsAdded).toBe(1);
    expect(result.surahsAlreadyPresent).toBe(1);
    expect(surahsLedger(result)).toBe(candidateTotalOf(state));

    const stored = JSON.parse(
      (await AsyncStorage.getItem(V1_FAVORITE_SURAHS_KEY)) ?? '[]',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].surahNumber).toBe(18);
  });

  it('accounts for two v1 reciter rows that collapse onto one v2 reciter', async () => {
    // Nothing is favorited locally: both rows are genuinely new, but they
    // resolve to the SAME catalog reciter, so the batch add can only take one.
    // Without the queued-id bookkeeping the second row lands nowhere and the
    // ledger silently loses an item.
    const state = stateWith({
      reciters: [
        reciterRow('alpha-reciter', 'Alpha Reciter'),
        reciterRow(null, 'Alpha Reciter'), // same reciter, resolved by name
      ],
    });

    const result = await mergeV1IntoLocalStores(state);

    expect(result.recitersAdded).toBe(1);
    expect(result.recitersAlreadyPresent).toBe(1);
    expect(result.recitersSkippedNoSlug).toBe(0);
    expect(recitersLedger(result)).toBe(candidateTotalOf(state));
    expect(
      useFavoriteRecitersStore.getState().isFavoriteReciter(ALPHA.id),
    ).toBe(true);
  });

  it('reports the benign re-run as wholly already-present, not as a zero merge', async () => {
    // The QARIAHV2-2P shape: a device that already merged, re-running the
    // restore from Settings → Your Data. Before #388 this produced
    // restored 0 with every skip counter 0 — the exact ledger of a real
    // silent failure.
    useFavoriteRecitersStore.getState().addFavoriteReciter(BETA);
    useLovedStore.getState().toggleLoved(BETA.id, '67', BETA.rewayat[0].id);
    await AsyncStorage.setItem(
      V1_FAVORITE_SURAHS_KEY,
      JSON.stringify([{surahNumber: 36, addedAt: AT}]),
    );

    const state = stateWith({
      reciters: [reciterRow(null, 'Beta Reciter')],
      recitations: [recitationRow(null, 'Beta Reciter', 67)],
      surahs: [{surahNumber: 36, addedAt: AT}],
    });

    const result = await mergeV1IntoLocalStores(state);

    const restored =
      result.recitersAdded + result.recitationsAdded + result.surahsAdded;
    const alreadyPresent =
      result.recitersAlreadyPresent +
      result.recitationsAlreadyPresent +
      result.surahsAlreadyPresent;

    expect(restored).toBe(0);
    expect(alreadyPresent).toBe(candidateTotalOf(state));
  });
});

// #394 — the surah write is the one merge in this function that can fail after
// the rows were counted. QARIAHV2-20 makes that failure real in production on
// both platforms (iOS NSCocoaErrorDomain 640 / Android SQLITE_FULL). The
// branch used to raise `surahsAdded` inside the loop, ahead of the write, so a
// full device reported rows it never saved — and because `restored` is the sum
// of the three `*Added` fields, the loss then hid behind `restored > 0`, where
// the zero-merge alarm cannot look.
describe('mergeV1IntoLocalStores — a failed sidecar write', () => {
  it('does not count surahs the write never saved', async () => {
    failSidecar('setItem', 'SQLITE_FULL');

    const state = stateWith({
      surahs: [
        {surahNumber: 18, addedAt: AT},
        {surahNumber: 67, addedAt: AT},
      ],
    });

    const result = await mergeV1IntoLocalStores(state);

    // The claim the user is shown. Nothing reached disk, so it must be zero.
    expect(result.surahsAdded).toBe(0);
    // …and the rows are reported as lost rather than dropped from the ledger.
    expect(result.surahsLostToWriteError).toBe(2);
    expect(surahsLedger(result)).toBe(candidateTotalOf(state));

    // Nothing was written: the merge must not have half-committed either.
    expect(await AsyncStorage.getItem(V1_FAVORITE_SURAHS_KEY)).toBeNull();
  });

  it('keeps the loss visible when the other two classes merged fine', async () => {
    // The alarm-blind shape. Reciters and recitations land, so `restored > 0`
    // and every condition in `shouldReportZeroMerge` is excluded — the surah
    // loss can only report through its own counter.
    failSidecar('setItem', 'SQLITE_FULL');

    const state = stateWith({
      reciters: [reciterRow('alpha-reciter', 'Alpha Reciter')],
      recitations: [recitationRow('alpha-reciter', 'Alpha Reciter', 2)],
      surahs: [{surahNumber: 18, addedAt: AT}],
    });

    const result = await mergeV1IntoLocalStores(state);

    const restored =
      result.recitersAdded + result.recitationsAdded + result.surahsAdded;
    expect(restored).toBe(2); // > 0 — the zero-merge alarm stays silent here
    expect(result.surahsAdded).toBe(0);
    expect(result.surahsLostToWriteError).toBe(1);
    expect(surahsLedger(result)).toBe(state.favorites.surahs.length);
  });

  it('counts only the additions as lost — already-present rows are still on disk', async () => {
    // The write threw, but the rows it read back came FROM disk and survive
    // it. Calling those lost would over-report the damage.
    await AsyncStorage.setItem(
      V1_FAVORITE_SURAHS_KEY,
      JSON.stringify([{surahNumber: 36, addedAt: AT}]),
    );
    failSidecar('setItem', 'NSCocoaErrorDomain 640');

    const state = stateWith({
      surahs: [
        {surahNumber: 36, addedAt: AT}, // already in the sidecar
        {surahNumber: 67, addedAt: AT}, // new — lost
      ],
    });

    const result = await mergeV1IntoLocalStores(state);

    expect(result.surahsAdded).toBe(0);
    expect(result.surahsAlreadyPresent).toBe(1);
    expect(result.surahsLostToWriteError).toBe(1);
    expect(surahsLedger(result)).toBe(candidateTotalOf(state));
  });

  it.each([
    ['null', 'null'],
    ['a number', '5'],
    ['a string', '"corrupt"'],
    ['an object', '{"a":1}'],
  ])(
    'writes the surahs over a corrupt sidecar holding %s, instead of losing them',
    async (_label, raw) => {
      // A sidecar value that PARSES but is not an array has no rows to
      // preserve. Before the Array.isArray coercion, `existing.map` threw
      // AFTER `readSucceeded` had been set, so the catch took the "write
      // threw" branch with pendingAdded still 0 — every counter landed on 0,
      // the surahs vanished from the ledger, and shouldReportWriteLoss(0)
      // returned false. A silent loss, in the one branch the readSucceeded
      // split exists to classify.
      await AsyncStorage.setItem(V1_FAVORITE_SURAHS_KEY, raw);

      const state = stateWith({
        surahs: [
          {surahNumber: 36, addedAt: AT},
          {surahNumber: 67, addedAt: AT},
        ],
      });

      const result = await mergeV1IntoLocalStores(state);

      // The write is healthy here, so the honest outcome is that both surahs
      // are SAVED — not reported as lost.
      expect(result.surahsAdded).toBe(2);
      expect(result.surahsAlreadyPresent).toBe(0);
      expect(result.surahsLostToWriteError).toBe(0);
      expect(surahsLedger(result)).toBe(candidateTotalOf(state));

      const onDisk = JSON.parse(
        (await AsyncStorage.getItem(V1_FAVORITE_SURAHS_KEY)) ?? '[]',
      );
      expect(onDisk.map((e: {surahNumber: number}) => e.surahNumber)).toEqual([
        36, 67,
      ]);
    },
  );

  it('still accounts for every row when a corrupt sidecar meets a failed write', async () => {
    // Both faults at once: the stored value is corrupt AND the device is
    // full. The surahs cannot be saved, so they must be REPORTED lost rather
    // than silently dropped from the ledger.
    await AsyncStorage.setItem(V1_FAVORITE_SURAHS_KEY, 'null');
    failSidecar('setItem', 'SQLITE_FULL');

    const state = stateWith({surahs: [{surahNumber: 67, addedAt: AT}]});

    const result = await mergeV1IntoLocalStores(state);

    expect(result.surahsAdded).toBe(0);
    expect(result.surahsLostToWriteError).toBe(1);
    expect(surahsLedger(result)).toBe(candidateTotalOf(state));
  });

  it('counts every offered row as lost when the read itself failed', async () => {
    // A failed read classified nothing, so the merge cannot say which rows it
    // already had. Reporting all of them as lost is the honest floor.
    failSidecar('getItem', 'NSCocoaErrorDomain 257');

    const state = stateWith({
      surahs: [
        {surahNumber: 18, addedAt: AT},
        {surahNumber: 67, addedAt: AT},
      ],
    });

    const result = await mergeV1IntoLocalStores(state);

    expect(result.surahsAdded).toBe(0);
    expect(result.surahsAlreadyPresent).toBe(0);
    expect(result.surahsLostToWriteError).toBe(2);
    expect(surahsLedger(result)).toBe(candidateTotalOf(state));
  });

  it('still finishes the restore — a lost sidecar does not fail the merge', async () => {
    // The original catch existed for a reason: the reciter and recitation
    // favorites already merged, and the done-flag write must still happen.
    failSidecar('setItem', 'SQLITE_FULL');

    const state = stateWith({
      reciters: [reciterRow('alpha-reciter', 'Alpha Reciter')],
      surahs: [{surahNumber: 18, addedAt: AT}],
    });

    await expect(mergeV1IntoLocalStores(state)).resolves.toMatchObject({
      recitersAdded: 1,
    });
    expect(await AsyncStorage.getItem(V1_RESTORE_FLAG_KEY)).toBe('1');
  });
});
