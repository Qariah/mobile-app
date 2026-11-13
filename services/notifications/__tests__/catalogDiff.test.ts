// @ai-generated
// Qariah (Sprint 48, S48.6): the recitation keys, the diff and the snapshot
// store of the notification engine.
import type {Reciter, Rewayat, SurahMetadata} from '@/data/reciterData';
import {
  CATALOG_SNAPSHOT_KEY,
  TIMING_SNAPSHOT_KEY,
  createCatalogSnapshotStore,
  createTimingSnapshotStore,
  diffCatalog,
  diffTimingCoverage,
  listRecitations,
  listTimingCoverage,
  recitationKey,
  recitationKeysOf,
  snapshotAfter,
  timingKey,
  timingKeyOfRecitation,
  timingKeysOf,
} from '../catalogDiff';
import type {KeyValueStorage} from '../types';

function rewayah(
  id: string,
  surahList: (number | null)[],
  metadata?: SurahMetadata[],
): Rewayat {
  return {
    id,
    reciter_id: 'unused',
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: surahList.length,
    surah_list: surahList,
    source_type: 'qariah',
    created_at: '2026-01-01T00:00:00Z',
    ...(metadata ? {surah_metadata: metadata} : {}),
  };
}

function reciter(id: string, rewayat: Rewayat[], name = id): Reciter {
  return {id, name, date: null, image_url: null, rewayat};
}

function fakeStorage(): KeyValueStorage & {data: Map<string, string>} {
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

describe('recitationKeysOf', () => {
  it('gives a complete surah empty range fields', () => {
    const keys = recitationKeysOf([reciter('r1', [rewayah('w1', [18])])]);
    expect([...keys]).toEqual(['r1|w1|18||']);
    expect(recitationKey('r1', 'w1', 18)).toBe('r1|w1|18||');
  });

  it('gives a partial row (is_full false and a range) its range', () => {
    const keys = recitationKeysOf([
      reciter('r1', [
        rewayah(
          'w1',
          [2],
          [{surah: 2, is_full: false, range: {from: 1, to: 141}}],
        ),
      ]),
    ]);
    expect([...keys]).toEqual(['r1|w1|2|1|141']);
  });

  it('treats a row as complete unless is_full is false AND it has a range', () => {
    const keys = recitationKeysOf([
      reciter('r1', [
        rewayah(
          'w1',
          [1, 2, 3],
          [
            {surah: 1, is_full: true, range: {from: 1, to: 3}},
            {surah: 2, is_full: false},
            {surah: 3, is_full: true},
          ],
        ),
      ]),
    ]);
    expect([...keys]).toEqual(['r1|w1|1||', 'r1|w1|2||', 'r1|w1|3||']);
  });

  it('takes the FIRST row of a surah for its range', () => {
    const keys = recitationKeysOf([
      reciter('r1', [
        rewayah(
          'w1',
          [36],
          [
            {surah: 36, is_full: false, range: {from: 1, to: 40}},
            {surah: 36, is_full: false, range: {from: 41, to: 83}},
          ],
        ),
      ]),
    ]);
    expect([...keys]).toEqual(['r1|w1|36|1|40']);
  });

  it('walks only the listed surahs, once each, and skips null entries', () => {
    const keys = recitationKeysOf([
      reciter('r1', [
        rewayah(
          'w1',
          [18, null, 18, 67],
          // 112 has a row but is not listed: a row alone is no recitation.
          [{surah: 112, is_full: true, added_at: '2026-10-01'}],
        ),
      ]),
    ]);
    expect([...keys]).toEqual(['r1|w1|18||', 'r1|w1|67||']);
  });

  it('keeps reciters and rewayat apart', () => {
    const keys = recitationKeysOf([
      reciter('r1', [rewayah('w1', [1]), rewayah('w2', [1])]),
      reciter('r2', [rewayah('w3', [1])]),
    ]);
    expect([...keys]).toEqual(['r1|w1|1||', 'r1|w2|1||', 'r2|w3|1||']);
  });

  it('gives an empty set for an empty catalog', () => {
    expect(recitationKeysOf([]).size).toBe(0);
  });
});

describe('listRecitations', () => {
  it('carries the range and a valid added_at of the first row', () => {
    const [entry, undated] = listRecitations([
      reciter('r1', [
        rewayah(
          'w1',
          [2, 3],
          [
            {
              surah: 2,
              is_full: false,
              range: {from: 1, to: 20},
              added_at: '2026-10-19',
            },
            {surah: 3, is_full: true, added_at: '19-10-2026'},
          ],
        ),
      ]),
    ]);
    expect(entry.range).toEqual({from: 1, to: 20});
    expect(entry.addedAt).toBe('2026-10-19');
    expect(undated.range).toBeUndefined();
    expect(undated.addedAt).toBeUndefined();
  });
});

describe('diffCatalog', () => {
  const v1 = recitationKeysOf([reciter('r1', [rewayah('w1', [1, 2])])]);

  it('first check (no snapshot): nothing is new', () => {
    expect(diffCatalog(null, v1)).toEqual({newKeys: [], isFirstCheck: true});
  });

  it('an empty snapshot is no baseline: nothing is new', () => {
    expect(diffCatalog(new Set(), v1)).toEqual({
      newKeys: [],
      isFirstCheck: true,
    });
  });

  it('gives the keys of the new catalog that the snapshot does not have', () => {
    const v2 = recitationKeysOf([
      reciter('r1', [rewayah('w1', [1, 2, 18])]),
      reciter('r2', [rewayah('w9', [36])]),
    ]);
    expect(diffCatalog(v1, v2)).toEqual({
      newKeys: ['r1|w1|18||', 'r2|w9|36||'],
      isFirstCheck: false,
    });
  });

  it('a range change is a new recitation', () => {
    const before = recitationKeysOf([
      reciter('r1', [
        rewayah(
          'w1',
          [2],
          [{surah: 2, is_full: false, range: {from: 1, to: 20}}],
        ),
      ]),
    ]);
    const after = recitationKeysOf([
      reciter('r1', [
        rewayah(
          'w1',
          [2],
          [{surah: 2, is_full: false, range: {from: 1, to: 40}}],
        ),
      ]),
    ]);
    expect(diffCatalog(before, after).newKeys).toEqual(['r1|w1|2|1|40']);

    // A partial recording that becomes the complete surah is new too.
    const complete = recitationKeysOf([
      reciter('r1', [rewayah('w1', [2], [{surah: 2, is_full: true}])]),
    ]);
    expect(diffCatalog(after, complete).newKeys).toEqual(['r1|w1|2||']);
  });

  it('does not report a removed recitation', () => {
    const fewer = recitationKeysOf([reciter('r1', [rewayah('w1', [1])])]);
    expect(diffCatalog(v1, fewer)).toEqual({newKeys: [], isFirstCheck: false});
  });
});

describe('snapshotAfter', () => {
  const prev = new Set(['a', 'b']);
  const next = new Set(['a', 'b', 'c', 'd']);

  it('adds each new key that is not held back', () => {
    expect(snapshotAfter(prev, next, [])).toEqual(
      new Set(['a', 'b', 'c', 'd']),
    );
    expect(snapshotAfter(prev, next, ['d'])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('a held-back key comes again in the next diff', () => {
    const saved = snapshotAfter(prev, next, ['c', 'd']);
    expect(diffCatalog(saved, next).newKeys).toEqual(['c', 'd']);
  });

  it('keeps each key of the previous snapshot, also one that the catalog no longer lists', () => {
    const incomplete = new Set(['a', 'c']);
    const saved = snapshotAfter(prev, incomplete, []);
    expect(saved).toEqual(new Set(['a', 'b', 'c']));
    // So 'b' is not "new" when the full catalog comes back.
    expect(diffCatalog(saved, next).newKeys).toEqual(['d']);
  });

  it('never removes a key of the previous snapshot, even when it is in the held list', () => {
    expect(snapshotAfter(prev, next, ['a'])).toEqual(
      new Set(['a', 'b', 'c', 'd']),
    );
  });

  it('with no previous snapshot, gives the catalog minus the held-back keys', () => {
    expect(snapshotAfter(null, next, ['d'])).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('createCatalogSnapshotStore', () => {
  it('has no snapshot at first', () => {
    expect(createCatalogSnapshotStore(fakeStorage()).load()).toBeNull();
  });

  it('keeps a snapshot under its key', () => {
    const storage = fakeStorage();
    const store = createCatalogSnapshotStore(storage);
    expect(store.isAvailable()).toBe(true);
    expect(store.save(new Set(['r1|w1|1||', 'r1|w1|2|1|5']))).toBe(true);
    expect(storage.data.has(CATALOG_SNAPSHOT_KEY)).toBe(true);
    expect(CATALOG_SNAPSHOT_KEY).toBe('qariah-notif-catalog-snapshot');
    expect(createCatalogSnapshotStore(storage).load()).toEqual(
      new Set(['r1|w1|1||', 'r1|w1|2|1|5']),
    );
  });

  it('does not keep an empty snapshot', () => {
    const storage = fakeStorage();
    const store = createCatalogSnapshotStore(storage);
    store.save(new Set(['r1|w1|1||']));
    expect(store.save(new Set())).toBe(false);
    expect(store.load()).toEqual(new Set(['r1|w1|1||']));
  });

  it('reads an unknown format or bad JSON as no snapshot', () => {
    const storage = fakeStorage();
    const store = createCatalogSnapshotStore(storage);
    storage.data.set(CATALOG_SNAPSHOT_KEY, '{not json');
    expect(store.load()).toBeNull();
    storage.data.set(CATALOG_SNAPSHOT_KEY, JSON.stringify(['r1|w1|1||']));
    expect(store.load()).toBeNull();
    storage.data.set(
      CATALOG_SNAPSHOT_KEY,
      JSON.stringify({v: 2, keys: ['r1|w1|1||']}),
    );
    expect(store.load()).toBeNull();
  });

  it('clear removes the snapshot', () => {
    const storage = fakeStorage();
    const store = createCatalogSnapshotStore(storage);
    store.save(new Set(['r1|w1|1||']));
    store.clear();
    expect(store.load()).toBeNull();
  });

  it('never throws when the storage throws', () => {
    const broken: KeyValueStorage = {
      getString: () => {
        throw new Error('not readable before the first unlock');
      },
      set: () => {
        throw new Error('disk full');
      },
      remove: () => {
        throw new Error('disk full');
      },
    };
    const store = createCatalogSnapshotStore(broken);
    expect(store.load()).toBeNull();
    expect(store.save(new Set(['r1|w1|1||']))).toBe(false);
    expect(() => store.clear()).not.toThrow();
  });

  it('save gives false when the read-back differs (a full disk drops the write)', () => {
    const storage = fakeStorage();
    const store = createCatalogSnapshotStore(storage);
    expect(store.save(new Set(['old||||']))).toBe(true);
    const full: KeyValueStorage = {...storage, set: () => undefined};
    expect(createCatalogSnapshotStore(full).save(new Set(['new||||']))).toBe(
      false,
    );
    expect(store.load()).toEqual(new Set(['old||||']));
  });

  it('save gives false, and writes nothing, when the storage is not available', () => {
    const storage = fakeStorage();
    const set = jest.fn(storage.set);
    const store = createCatalogSnapshotStore({
      ...storage,
      set,
      isAvailable: () => false,
    });
    expect(store.isAvailable()).toBe(false);
    expect(store.save(new Set(['r1|w1|1||']))).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it('a storage whose isAvailable throws is not available', () => {
    const store = createCatalogSnapshotStore({
      ...fakeStorage(),
      isAvailable: () => {
        throw new Error('native module missing');
      },
    });
    expect(store.isAvailable()).toBe(false);
  });

  it('the first check after a failed read announces nothing', () => {
    const store = createCatalogSnapshotStore({
      getString: () => {
        throw new Error('not readable');
      },
      set: () => undefined,
      remove: () => undefined,
    });
    const next = recitationKeysOf([reciter('r1', [rewayah('w1', [1, 2])])]);
    expect(diffCatalog(store.load(), next)).toEqual({
      newKeys: [],
      isFirstCheck: true,
    });
  });
});

// ---------------------------------------------------------------------------
// #845: the follow-along coverage

/** A rewayah with `has_timestamps` and `timestamps_surah_list` (undefined: no list). */
function timed(
  id: string,
  surahList: (number | null)[],
  hasTimestamps: boolean | undefined,
  list?: number[],
): Rewayat {
  return {
    ...rewayah(id, surahList),
    ...(hasTimestamps === undefined ? {} : {has_timestamps: hasTimestamps}),
    ...(list === undefined ? {} : {timestamps_surah_list: list}),
  };
}

describe('timingKeysOf (the rule of r2HasSurah)', () => {
  it('keys a covered surah as rewayahId|surah', () => {
    expect(timingKey('w1', 18)).toBe('w1|18');
    expect([
      ...timingKeysOf([reciter('r1', [timed('w1', [1, 18], true, [18])])]),
    ]).toEqual(['w1|18']);
  });

  it('an empty timestamps_surah_list means every listed surah', () => {
    expect([
      ...timingKeysOf([reciter('r1', [timed('w1', [1, 2, 114], true, [])])]),
    ]).toEqual(['w1|1', 'w1|2', 'w1|114']);
  });

  it('a missing timestamps_surah_list means every listed surah too', () => {
    expect([
      ...timingKeysOf([reciter('r1', [timed('w1', [36, 67], true)])]),
    ]).toEqual(['w1|36', 'w1|67']);
  });

  it('no has_timestamps, or has_timestamps false: no key, whatever the list says', () => {
    expect(
      timingKeysOf([
        reciter('r1', [
          timed('w1', [1, 2], false, [1, 2]),
          timed('w2', [1, 2], undefined, [1]),
        ]),
      ]).size,
    ).toBe(0);
  });

  it('a timed surah that the rewayah does not list gives no key (nothing to follow)', () => {
    expect([
      ...timingKeysOf([reciter('r1', [timed('w1', [1, 18], true, [18, 36])])]),
    ]).toEqual(['w1|18']);
  });

  it('skips null and repeated entries, and keeps rewayat apart', () => {
    const coverage = listTimingCoverage([
      reciter('r1', [timed('w1', [1, null, 1, 2], true, [])]),
      reciter('r2', [timed('w2', [1], true, [1])]),
    ]);
    expect(coverage.map(entry => entry.key)).toEqual(['w1|1', 'w1|2', 'w2|1']);
    expect(coverage[2]).toMatchObject({surah: 1});
    expect(coverage[2].reciter.id).toBe('r2');
    expect(coverage[2].rewayah.id).toBe('w2');
  });

  it('maps a recitation key to the timing key of its surah', () => {
    expect(timingKeyOfRecitation('r1|w1|18||')).toBe('w1|18');
    expect(timingKeyOfRecitation('r1|w1|2|1|141')).toBe('w1|2');
    expect(timingKeyOfRecitation('not-a-key')).toBeNull();
  });
});

describe('diffTimingCoverage', () => {
  it('first check (no snapshot): nothing is new', () => {
    expect(diffTimingCoverage(null, new Set(['w1|1']))).toEqual({
      newKeys: [],
      isFirstCheck: true,
    });
  });

  it('an empty snapshot IS a baseline (unlike the recitations)', () => {
    expect(diffTimingCoverage(new Set(), new Set(['w1|1', 'w1|2']))).toEqual({
      newKeys: ['w1|1', 'w1|2'],
      isFirstCheck: false,
    });
  });

  it('add, remove, re-add: only the first add is new (with snapshotAfter)', () => {
    let snapshot: Set<string> = new Set(['w1|1']);
    const added = new Set(['w1|1', 'w1|2']);
    expect(diffTimingCoverage(snapshot, added).newKeys).toEqual(['w1|2']);
    snapshot = snapshotAfter(snapshot, added, []);
    const removed = new Set(['w1|1']);
    expect(diffTimingCoverage(snapshot, removed).newKeys).toEqual([]);
    snapshot = snapshotAfter(snapshot, removed, []);
    expect(snapshot.has('w1|2')).toBe(true);
    expect(diffTimingCoverage(snapshot, added).newKeys).toEqual([]);
  });
});

describe('createTimingSnapshotStore', () => {
  it('keeps its snapshot under its own key, apart from the recitations', () => {
    const storage = fakeStorage();
    const recitations = createCatalogSnapshotStore(storage);
    const timing = createTimingSnapshotStore(storage);
    expect(TIMING_SNAPSHOT_KEY).not.toBe(CATALOG_SNAPSHOT_KEY);
    expect(recitations.save(new Set(['r1|w1|1||']))).toBe(true);
    expect(timing.load()).toBeNull();
    expect(timing.save(new Set(['w1|1']))).toBe(true);
    expect(storage.data.has(TIMING_SNAPSHOT_KEY)).toBe(true);
    expect(timing.load()).toEqual(new Set(['w1|1']));
    expect(recitations.load()).toEqual(new Set(['r1|w1|1||']));
    timing.clear();
    expect(timing.load()).toBeNull();
    expect(recitations.load()).toEqual(new Set(['r1|w1|1||']));
  });

  it('keeps an empty snapshot (a baseline with no follow-along)', () => {
    const storage = fakeStorage();
    const timing = createTimingSnapshotStore(storage);
    expect(timing.save(new Set())).toBe(true);
    expect(timing.load()).toEqual(new Set());
  });

  it('save gives false when the storage is not available', () => {
    const storage = fakeStorage();
    const timing = createTimingSnapshotStore({
      ...storage,
      isAvailable: () => false,
    });
    expect(timing.save(new Set())).toBe(false);
    expect(storage.data.size).toBe(0);
  });
});
