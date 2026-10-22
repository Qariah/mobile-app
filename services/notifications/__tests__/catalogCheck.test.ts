// @ai-generated
// Qariah (Sprint 48, S48.6): `runCatalogCheck`, the required order of one
// catalog check: diff → candidates → pick → save the snapshot (no post when it
// does not save) → post → record today.
import type {Reciter, Rewayat} from '@/data/reciterData';
import {whatsNewCandidate} from '../announcement';
import {runCatalogCheck, type CatalogCheckDeps} from '../catalogCheck';
import {
  CATALOG_SNAPSHOT_KEY,
  createCatalogSnapshotStore,
  recitationKeysOf,
} from '../catalogDiff';
import {localDay} from '../localDay';
import {DEFAULT_NOTIFICATION_TYPE_PREFS} from '../prefsStore';
import type {
  KeyValueStorage,
  NotificationPermissionStatus,
  NotificationPrefsSnapshot,
  NotificationPrefsSource,
  NotificationType,
  Notifier,
} from '../types';

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
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

const FAVORITE = 'fav';
const OTHER = 'other';
const BASE: Reciter[] = [reciter(FAVORITE, [1]), reciter(OTHER, [2])];

// Tuesday 2026-10-20, 10:00 local; the next day 2026-10-21.
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

function fakePrefs(initial: Partial<NotificationPrefsSnapshot> = {}) {
  const state: NotificationPrefsSnapshot = {
    ...DEFAULT_NOTIFICATION_TYPE_PREFS,
    lastNotifiedDay: null,
    ...initial,
  };
  const source = {
    state,
    read: jest.fn(
      async (): Promise<NotificationPrefsSnapshot | null> => ({...state}),
    ),
    markNotifiedToday: jest.fn(async (now: Date) => {
      state.lastNotifiedDay = localDay(now);
      return true;
    }),
  };
  return source satisfies NotificationPrefsSource & {
    state: NotificationPrefsSnapshot;
  };
}

function fakeNotifier(permission: NotificationPermissionStatus = 'granted') {
  const notifier = {
    schedule: jest.fn(async (candidate: {dedupeKey: string}) => {
      return candidate.dedupeKey;
    }),
    cancel: jest.fn(async () => undefined),
    cancelByType: jest.fn(async (_type: NotificationType) => undefined),
    getPermission: jest.fn(async () => permission),
  };
  return notifier satisfies Notifier;
}

/** A device: one storage, one prefs source and one notifier across checks. */
function device(
  options: {
    prefs?: Partial<NotificationPrefsSnapshot>;
    permission?: NotificationPermissionStatus;
  } = {},
) {
  const storage = memoryStorage();
  const prefs = fakePrefs(options.prefs);
  const notifier = fakeNotifier(options.permission);
  const check = (
    reciters: Reciter[],
    now: Date,
    extra: Partial<CatalogCheckDeps> = {},
  ) =>
    runCatalogCheck({
      reciters,
      favoriteReciterIds: [FAVORITE],
      holdout: false,
      notifier,
      snapshotStore: createCatalogSnapshotStore(storage),
      prefs,
      now,
      ...extra,
    });
  const snapshot = () => createCatalogSnapshotStore(storage).load();
  return {storage, prefs, notifier, check, snapshot};
}

/** A device after its first check of `BASE` (the baseline). */
async function deviceWithBaseline(options: Parameters<typeof device>[0] = {}) {
  const d = device(options);
  const first = await d.check(BASE, DAY1);
  expect(first.status).toBe('first_check');
  return d;
}

// ---------------------------------------------------------------------------

describe('runCatalogCheck', () => {
  it('with no catalog (reciters: null), compares nothing, keeps the snapshot and posts an extra candidate', async () => {
    const d = await deviceWithBaseline();
    const before = d.storage.data.get(CATALOG_SNAPSHOT_KEY);
    const whatsNew = whatsNewCandidate('2026-10-sprint48');
    const result = await d.check(BASE, DAY2, {
      reciters: null,
      extraCandidates: [whatsNew],
    });
    expect(result).toMatchObject({status: 'posted', newKeys: []});
    expect(result.posted).toBe(whatsNew);
    expect(d.storage.data.get(CATALOG_SNAPSHOT_KEY)).toBe(before);
    expect(d.prefs.markNotifiedToday).toHaveBeenCalledWith(DAY2);
  });

  it('with no catalog and no extra candidate, reports nothing_new and writes nothing', async () => {
    const d = await deviceWithBaseline();
    const before = d.storage.data.get(CATALOG_SNAPSHOT_KEY);
    const result = await d.check(BASE, DAY2, {reciters: null});
    expect(result.status).toBe('nothing_new');
    expect(d.storage.data.get(CATALOG_SNAPSHOT_KEY)).toBe(before);
    expect(d.notifier.schedule).not.toHaveBeenCalled();
  });

  it('with no catalog, a failed post leaves the snapshot as it was', async () => {
    const d = await deviceWithBaseline();
    const before = d.storage.data.get(CATALOG_SNAPSHOT_KEY);
    d.notifier.schedule.mockRejectedValueOnce(new Error('native'));
    const result = await d.check(BASE, DAY2, {
      reciters: null,
      extraCandidates: [whatsNewCandidate('2026-10-sprint48')],
    });
    expect(result.status).toBe('post_failed');
    expect(d.storage.data.get(CATALOG_SNAPSHOT_KEY)).toBe(before);
  });

  it('the first check records the snapshot and announces nothing', async () => {
    const d = device();
    const result = await d.check(BASE, DAY1);
    expect(result).toMatchObject({
      status: 'first_check',
      posted: null,
      newKeys: [],
    });
    expect(d.snapshot()).toEqual(recitationKeysOf(BASE));
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    expect(d.prefs.markNotifiedToday).not.toHaveBeenCalled();
  });

  it('scenario A: 2 new surahs of a followed reciter give ONE notice that covers both', async () => {
    const d = await deviceWithBaseline();
    const next = [reciter(FAVORITE, [1, 18, 36]), reciter(OTHER, [2])];

    const result = await d.check(next, DAY1);
    expect(result.status).toBe('posted');
    expect(d.notifier.schedule).toHaveBeenCalledTimes(1);
    const [posted, trigger] = d.notifier.schedule.mock.calls[0] as unknown as [
      {type: string; coveredKeys: string[]},
      unknown,
    ];
    expect(trigger).toEqual({kind: 'immediate'});
    expect(posted.type).toBe('followed_recitation');
    expect([...posted.coveredKeys].sort()).toEqual([
      'fav|fav-w|18||',
      'fav|fav-w|36||',
    ]);
    expect(result.heldBackKeys).toEqual([]);
    expect(d.snapshot()).toEqual(recitationKeysOf(next));
    expect(d.prefs.markNotifiedToday).toHaveBeenCalledWith(DAY1);
    expect(result.markedToday).toBe(true);

    // Nothing comes again on the next day.
    const again = await d.check(next, DAY2);
    expect(again.status).toBe('nothing_new');
    expect(d.notifier.schedule).toHaveBeenCalledTimes(1);
  });

  it('scenario B: a whats_new notice earlier the same day holds the recitation back to the next day', async () => {
    // The announcement posted at 08:00 today, so the daily limit is used.
    const d = await deviceWithBaseline({
      prefs: {lastNotifiedDay: localDay(DAY1)},
    });
    const next = [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])];

    const today = await d.check(next, DAY1);
    expect(today.status).toBe('not_posted');
    expect(today.heldBackKeys).toEqual(['fav|fav-w|18||']);
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    // The held-back key is not in the snapshot …
    expect(d.snapshot()?.has('fav|fav-w|18||')).toBe(false);

    // … so the next day's check finds it again and posts it.
    const tomorrow = await d.check(next, DAY2);
    expect(tomorrow.status).toBe('posted');
    expect(tomorrow.posted?.coveredKeys).toEqual(['fav|fav-w|18||']);
    expect(d.snapshot()?.has('fav|fav-w|18||')).toBe(true);
    expect(d.prefs.state.lastNotifiedDay).toBe(localDay(DAY2));
  });

  it('scenario B in one check: whats_new wins the day, the new recitation comes the next day', async () => {
    const d = await deviceWithBaseline();
    const next = [reciter(FAVORITE, [1]), reciter(OTHER, [2, 67])];
    const extraCandidates = [whatsNewCandidate('2026-10-sprint48')];

    const today = await d.check(next, DAY1, {extraCandidates});
    expect(today.status).toBe('posted');
    expect(today.posted?.type).toBe('whats_new');
    expect(today.heldBackKeys).toEqual(['other|other-w|67||']);

    // The caller recorded the announcement id, so no extra candidate now.
    const tomorrow = await d.check(next, DAY2);
    expect(tomorrow.status).toBe('posted');
    expect(tomorrow.posted?.type).toBe('new_recitation');
    expect(tomorrow.posted?.coveredKeys).toEqual(['other|other-w|67||']);
  });

  it('a type that is off drops its recitations: no notice now, none when it is on again', async () => {
    const d = await deviceWithBaseline({prefs: {new_recitation: false}});
    const next = [reciter(FAVORITE, [1]), reciter(OTHER, [2, 67])];

    const off = await d.check(next, DAY1);
    expect(off.status).toBe('not_posted');
    expect(off.heldBackKeys).toEqual([]);
    expect(d.snapshot()?.has('other|other-w|67||')).toBe(true);

    d.prefs.state.new_recitation = true;
    expect((await d.check(next, DAY2)).status).toBe('nothing_new');
    expect(d.notifier.schedule).not.toHaveBeenCalled();
  });

  it('a holdout user gets nothing, and the recitations are dropped', async () => {
    const d = await deviceWithBaseline();
    const next = [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])];
    const result = await d.check(next, DAY1, {holdout: true});
    expect(result.status).toBe('not_posted');
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    expect(d.snapshot()).toEqual(recitationKeysOf(next));
  });

  it('without permission nothing posts, and the recitations are dropped', async () => {
    const d = await deviceWithBaseline({permission: 'denied'});
    const next = [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])];
    const result = await d.check(next, DAY1);
    expect(result.status).toBe('not_posted');
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    expect(d.snapshot()).toEqual(recitationKeysOf(next));
  });

  it('a full disk (the save does not verify): no post, and the next check tries again', async () => {
    const d = await deviceWithBaseline();
    const next = [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])];
    const fullDisk = createCatalogSnapshotStore({
      ...d.storage,
      set: () => undefined, // MMKV drops the write
    });

    const result = await d.check(next, DAY1, {snapshotStore: fullDisk});
    expect(result.status).toBe('save_failed');
    expect(result.posted).toBeNull();
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    expect(d.prefs.markNotifiedToday).not.toHaveBeenCalled();
    expect(d.snapshot()).toEqual(recitationKeysOf(BASE));

    // The disk has room again: the same recitation posts once.
    expect((await d.check(next, DAY1)).status).toBe('posted');
    expect(d.notifier.schedule).toHaveBeenCalledTimes(1);
  });

  it('a save that throws: no post', async () => {
    const d = await deviceWithBaseline();
    const throwing = createCatalogSnapshotStore({
      ...d.storage,
      set: () => {
        throw new Error('No space left on device');
      },
    });
    const next = [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])];
    const result = await d.check(next, DAY1, {snapshotStore: throwing});
    expect(result.status).toBe('save_failed');
    expect(d.notifier.schedule).not.toHaveBeenCalled();
  });

  it('MMKV not available: silent, with a status to log', async () => {
    const d = device();
    const unavailable = createCatalogSnapshotStore({
      ...d.storage,
      isAvailable: () => false,
    });
    const result = await d.check(
      [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])],
      DAY1,
      {snapshotStore: unavailable, extraCandidates: [whatsNewCandidate('x')]},
    );
    expect(result).toEqual({
      status: 'storage_unavailable',
      posted: null,
      newKeys: [],
      heldBackKeys: [],
    });
    expect(d.prefs.read).not.toHaveBeenCalled();
    expect(d.notifier.getPermission).not.toHaveBeenCalled();
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    expect(d.storage.data.has(CATALOG_SNAPSHOT_KEY)).toBe(false);
  });

  it('preferences that cannot be read: nothing saved, nothing posted', async () => {
    const d = await deviceWithBaseline();
    d.prefs.read.mockResolvedValueOnce(null);
    const next = [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])];
    const result = await d.check(next, DAY1);
    expect(result.status).toBe('prefs_unavailable');
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    expect(d.snapshot()).toEqual(recitationKeysOf(BASE));
  });

  it('preferences that throw count as not readable', async () => {
    const d = await deviceWithBaseline();
    d.prefs.read.mockRejectedValueOnce(new Error('boom'));
    const result = await d.check(BASE, DAY1);
    expect(result.status).toBe('prefs_unavailable');
  });

  it('an empty catalog (a failed load): nothing saved, nothing posted', async () => {
    const d = await deviceWithBaseline();
    const result = await d.check([], DAY1, {
      extraCandidates: [whatsNewCandidate('x')],
    });
    expect(result.status).toBe('empty_catalog');
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    expect(d.snapshot()).toEqual(recitationKeysOf(BASE));
  });

  it('a permission check that fails: nothing saved, nothing posted', async () => {
    const d = await deviceWithBaseline();
    d.notifier.getPermission.mockRejectedValueOnce(new Error('native'));
    const next = [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])];
    const result = await d.check(next, DAY1);
    expect(result.status).toBe('permission_unavailable');
    expect(result.newKeys).toEqual(['fav|fav-w|18||']);
    expect(d.notifier.schedule).not.toHaveBeenCalled();
    expect(d.snapshot()).toEqual(recitationKeysOf(BASE));
  });

  it('a post that fails holds its keys back, so the next check posts it', async () => {
    const d = await deviceWithBaseline();
    d.notifier.schedule.mockRejectedValueOnce(new Error('native'));
    const next = [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])];

    const failed = await d.check(next, DAY1);
    expect(failed.status).toBe('post_failed');
    expect(failed.heldBackKeys).toEqual(['fav|fav-w|18||']);
    expect(d.snapshot()?.has('fav|fav-w|18||')).toBe(false);
    expect(d.prefs.markNotifiedToday).not.toHaveBeenCalled();

    const retry = await d.check(next, DAY1);
    expect(retry.status).toBe('posted');
    expect(d.snapshot()?.has('fav|fav-w|18||')).toBe(true);
  });

  it('reports a day that could not be recorded', async () => {
    const d = await deviceWithBaseline();
    d.prefs.markNotifiedToday.mockResolvedValueOnce(false);
    const result = await d.check(
      [reciter(FAVORITE, [1, 18]), reciter(OTHER, [2])],
      DAY1,
    );
    expect(result).toMatchObject({status: 'posted', markedToday: false});
  });

  it('the first check can still post another candidate (the announcement)', async () => {
    const d = device();
    const result = await d.check(BASE, DAY1, {
      extraCandidates: [whatsNewCandidate('2026-10-sprint48')],
    });
    expect(result.status).toBe('posted');
    expect(result.posted?.type).toBe('whats_new');
    expect(d.snapshot()).toEqual(recitationKeysOf(BASE));
  });

  it('uses the app storage and preferences by default', async () => {
    const notifier = fakeNotifier();
    let result: Awaited<ReturnType<typeof runCatalogCheck>> | undefined;
    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(() => {
        const mod: typeof import('../catalogCheck') = require('../catalogCheck');
        mod
          .runCatalogCheck({
            reciters: BASE,
            favoriteReciterIds: [],
            holdout: false,
            notifier,
            now: DAY1,
          })
          .then(r => {
            result = r;
            resolve();
          }, reject);
      });
    });
    expect(result?.status).toBe('first_check');
  });
});
