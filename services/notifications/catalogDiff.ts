// @ai-generated
// Qariah (Sprint 48, S48.6): which recitations are new since the last catalog
// check.
//
// A snapshot is the set of recitation keys of a catalog (`RecitationKey`). The
// background check compares the keys of the catalog that it just read with the
// last snapshot, and keeps the new snapshot in MMKV.
//
// The follow-along notice (#845) has a second snapshot with the same rules:
// the surahs with follow-along (`TimingKey`), in its own MMKV key
// (`TIMING_SNAPSHOT_KEY`). See "Follow-along coverage" below.
import {createMMKV, type MMKV} from 'react-native-mmkv';
import type {Reciter, Rewayat, SurahMetadata} from '@/data/reciterData';
import type {KeyValueStorage, RecitationKey, TimingKey} from './types';

const ADDED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** One listed surah of one rewayah of one reciter. */
export interface RecitationEntry {
  key: RecitationKey;
  reciter: Reciter;
  rewayah: Rewayat;
  surah: number;
  /** Set only for a partial recording (`is_full === false` and a `range`). */
  range?: {from: number; to: number};
  /** The `added_at` (`YYYY-MM-DD`, UTC) of the first row, when it is valid. */
  addedAt?: string;
}

/** The key of one recitation (see `RecitationKey`). */
export function recitationKey(
  reciterId: string,
  rewayahId: string,
  surah: number,
  range?: {from: number; to: number},
): RecitationKey {
  return range
    ? `${reciterId}|${rewayahId}|${surah}|${range.from}|${range.to}`
    : `${reciterId}|${rewayahId}|${surah}||`;
}

/**
 * Each recitation of the catalog, in catalog order, each key once.
 *
 * Walks the LISTED surahs of each rewayah (`surah_list`; integers only, each
 * once) and takes the FIRST `surah_metadata` row of each surah for its range,
 * as the ops console (and the Sprint 48 added_at backfill) do. A row alone (a
 * surah that is not listed) never makes a recitation.
 */
export function listRecitations(
  reciters: readonly Reciter[],
): RecitationEntry[] {
  const out: RecitationEntry[] = [];
  const seen = new Set<RecitationKey>();
  for (const reciter of reciters ?? []) {
    if (!reciter || typeof reciter.id !== 'string') continue;
    for (const rewayah of reciter.rewayat ?? []) {
      if (!rewayah || typeof rewayah.id !== 'string') continue;
      const firstRows = new Map<number, SurahMetadata>();
      for (const row of rewayah.surah_metadata ?? []) {
        if (row && Number.isInteger(row.surah) && !firstRows.has(row.surah)) {
          firstRows.set(row.surah, row);
        }
      }
      for (const surah of rewayah.surah_list ?? []) {
        if (typeof surah !== 'number' || !Number.isInteger(surah)) continue;
        const row = firstRows.get(surah);
        const range =
          row && row.is_full === false && row.range ? row.range : undefined;
        const key = recitationKey(reciter.id, rewayah.id, surah, range);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          key,
          reciter,
          rewayah,
          surah,
          ...(range ? {range: {from: range.from, to: range.to}} : {}),
          ...(typeof row?.added_at === 'string' &&
          ADDED_AT_PATTERN.test(row.added_at)
            ? {addedAt: row.added_at}
            : {}),
        });
      }
    }
  }
  return out;
}

/** The snapshot of a catalog: the key of each recitation. */
export function recitationKeysOf(
  reciters: readonly Reciter[],
): Set<RecitationKey> {
  return new Set(listRecitations(reciters).map(entry => entry.key));
}

export interface CatalogDiff {
  /** The keys of `next` that are not in `prev`, in the order of `next`. */
  newKeys: RecitationKey[];
  /**
   * No usable previous snapshot: the first check after an install or after the
   * upgrade to the first build with notifications. The caller records `next`
   * and announces nothing.
   */
  isFirstCheck: boolean;
}

/**
 * Compares two snapshots. With no previous snapshot, or an empty one, nothing
 * is new: an empty snapshot is not a baseline (a failed catalog load gives
 * one), and a diff against it would announce the whole catalog.
 */
export function diffCatalog(
  prev: ReadonlySet<RecitationKey> | null,
  next: ReadonlySet<RecitationKey>,
): CatalogDiff {
  if (!prev || prev.size === 0) return {newKeys: [], isFirstCheck: true};
  const newKeys: RecitationKey[] = [];
  for (const key of next) {
    if (!prev.has(key)) newKeys.push(key);
  }
  return {newKeys, isFirstCheck: false};
}

/**
 * The snapshot to save after a check: the previous snapshot, plus each key of
 * `next` that is not held back. A held-back key (`heldBackKeys` in
 * `scheduler.ts`: its notice lost to the daily limit or to the order) stays
 * out, so the next check finds it again. A key that the previous snapshot has
 * always stays in.
 *
 * The keys of the previous snapshot stay in even when `next` does not list
 * them: a catalog that came back incomplete must not make its missing
 * recitations "new" when they come back. The cost: a recitation that the
 * catalog removes and lists again later is not announced again.
 */
export function snapshotAfter(
  prev: ReadonlySet<RecitationKey> | null,
  next: ReadonlySet<RecitationKey>,
  heldBack: Iterable<RecitationKey>,
): Set<RecitationKey> {
  const held = new Set(heldBack);
  const out = new Set<RecitationKey>(prev ?? []);
  for (const key of next) {
    if (!held.has(key)) out.add(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Follow-along coverage (#845)
//
// The same rules as the recitations: the first check saves a baseline and
// announces nothing; a key that the snapshot has is never new again, also
// after the catalog removed it and lists it again (`snapshotAfter`); a
// held-back key stays out of the saved snapshot. One difference: an empty
// coverage IS a baseline. The check runs only on a catalog with recitations
// (`empty_catalog` stops it before), and the live catalog has no follow-along
// before the first surah gets it: without an empty baseline, that first
// surah would only make the baseline, and nobody would hear of it.

/** One surah with follow-along. */
export interface TimingEntry {
  key: TimingKey;
  reciter: Reciter;
  rewayah: Rewayat;
  surah: number;
}

/** The key of one surah with follow-along (see `TimingKey`). */
export function timingKey(rewayahId: string, surah: number): TimingKey {
  return `${rewayahId}|${surah}`;
}

/** The rewayah and the surah of a recitation key (`reciterId|rewayahId|surah|from|to`). */
export function timingKeyOfRecitation(key: RecitationKey): TimingKey | null {
  const parts = key.split('|');
  if (parts.length !== 5) return null;
  const surah = Number(parts[2]);
  return Number.isInteger(surah) ? timingKey(parts[1], surah) : null;
}

/**
 * Each surah with follow-along, in catalog order, each key once. The listed
 * surahs of each rewayah (`surah_list`; integers only) that `r2HasSurah` of
 * `services/timestamps/TimestampFetchService.ts` accepts: the rewayah has
 * `has_timestamps: true`, and its `timestamps_surah_list` names the surah or
 * is missing or empty (then every listed surah has follow-along).
 */
export function listTimingCoverage(
  reciters: readonly Reciter[],
): TimingEntry[] {
  const out: TimingEntry[] = [];
  const seen = new Set<TimingKey>();
  for (const reciter of reciters ?? []) {
    if (!reciter || typeof reciter.id !== 'string') continue;
    for (const rewayah of reciter.rewayat ?? []) {
      if (!rewayah || typeof rewayah.id !== 'string') continue;
      if (rewayah.has_timestamps !== true) continue;
      const list = Array.isArray(rewayah.timestamps_surah_list)
        ? rewayah.timestamps_surah_list
        : [];
      const covered = list.length === 0 ? null : new Set(list);
      for (const surah of rewayah.surah_list ?? []) {
        if (typeof surah !== 'number' || !Number.isInteger(surah)) continue;
        if (covered && !covered.has(surah)) continue;
        const key = timingKey(rewayah.id, surah);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({key, reciter, rewayah, surah});
      }
    }
  }
  return out;
}

/** The follow-along snapshot of a catalog: the key of each covered surah. */
export function timingKeysOf(reciters: readonly Reciter[]): Set<TimingKey> {
  return new Set(listTimingCoverage(reciters).map(entry => entry.key));
}

/**
 * Compares two follow-along snapshots. With no previous snapshot, nothing is
 * new (the first check). An empty previous snapshot is a baseline (see the
 * note above), unlike `diffCatalog`.
 */
export function diffTimingCoverage(
  prev: ReadonlySet<TimingKey> | null,
  next: ReadonlySet<TimingKey>,
): CatalogDiff {
  if (!prev) return {newKeys: [], isFirstCheck: true};
  const newKeys: TimingKey[] = [];
  for (const key of next) {
    if (!prev.has(key)) newKeys.push(key);
  }
  return {newKeys, isFirstCheck: false};
}

// ---------------------------------------------------------------------------
// The snapshot store

export const CATALOG_SNAPSHOT_KEY = 'qariah-notif-catalog-snapshot';
/** The follow-along snapshot (#845), in the same MMKV instance. */
export const TIMING_SNAPSHOT_KEY = 'qariah-notif-timing-snapshot';
/** The format of the stored value. A value in another format is no snapshot. */
const SNAPSHOT_FORMAT = 1;
const NOTIFICATIONS_MMKV_ID = 'qariah-notifications';

// Lazy and guarded, as in `services/diagnostics/bootSentinel.ts`: a module
// level `createMMKV(...)` can throw at import (the iOS Simulator has no App
// Group container), and this module must never throw into its caller.
let mmkv: MMKV | null | undefined; // undefined = not tried yet; null = failed
function notificationsMMKV(): MMKV | null {
  if (mmkv !== undefined) return mmkv;
  try {
    mmkv = createMMKV({id: NOTIFICATIONS_MMKV_ID});
  } catch {
    mmkv = null;
  }
  return mmkv;
}

/**
 * The MMKV instance of the notification engine (id `qariah-notifications`).
 * When MMKV did not open, `isAvailable()` is `false`, a read gives
 * `undefined` and a write does nothing. MMKV is opened once; a failure is not
 * tried again in the same process.
 */
export const notificationsStorage: KeyValueStorage = {
  getString: key => notificationsMMKV()?.getString(key),
  set: (key, value) => {
    notificationsMMKV()?.set(key, value);
  },
  remove: key => {
    notificationsMMKV()?.remove(key);
  },
  isAvailable: () => notificationsMMKV() !== null,
};

export interface CatalogSnapshotStore {
  /** `false` when the storage did not open: then a check must post nothing. */
  isAvailable(): boolean;
  /** The last snapshot, or `null` when there is none or it cannot be read. */
  load(): Set<RecitationKey> | null;
  /**
   * Keeps `keys`. Gives `true` only when a read-back gives the written value.
   * Gives `false` for an empty set (not kept, see `diffCatalog`; the
   * follow-along store keeps one, see `createTimingSnapshotStore`), when the
   * storage is not available, when the write throws, and when the read-back
   * differs (for example a full disk). On `false`, post nothing.
   */
  save(keys: ReadonlySet<RecitationKey>): boolean;
  clear(): void;
}

/**
 * A failed read gives `null`, so the check is a first check and announces
 * nothing. Nothing throws. (On iOS, MMKV cannot read before the first unlock
 * after a reboot, the same as AsyncStorage: the result is a missed notice,
 * never a wrong one.)
 */
export function createCatalogSnapshotStore(
  storage: KeyValueStorage = notificationsStorage,
): CatalogSnapshotStore {
  return createSnapshotStore(storage, CATALOG_SNAPSHOT_KEY, false);
}

/**
 * The follow-along snapshot (#845): the same store under
 * `TIMING_SNAPSHOT_KEY`, and an empty set is kept (an empty coverage is a
 * baseline, see `diffTimingCoverage`).
 */
export function createTimingSnapshotStore(
  storage: KeyValueStorage = notificationsStorage,
): CatalogSnapshotStore {
  return createSnapshotStore(storage, TIMING_SNAPSHOT_KEY, true);
}

function createSnapshotStore(
  storage: KeyValueStorage,
  storageKey: string,
  keepEmpty: boolean,
): CatalogSnapshotStore {
  const isAvailable = (): boolean => {
    try {
      return storage.isAvailable ? storage.isAvailable() : true;
    } catch {
      return false;
    }
  };
  return {
    isAvailable,
    load() {
      let raw: string | undefined;
      try {
        raw = storage.getString(storageKey);
      } catch {
        return null;
      }
      if (typeof raw !== 'string') return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          (parsed as {v?: unknown}).v !== SNAPSHOT_FORMAT ||
          !Array.isArray((parsed as {keys?: unknown}).keys)
        ) {
          return null;
        }
        const keys = (parsed as {keys: unknown[]}).keys.filter(
          (key): key is string => typeof key === 'string',
        );
        return new Set(keys);
      } catch {
        return null;
      }
    },
    save(keys) {
      if ((keys.size === 0 && !keepEmpty) || !isAvailable()) return false;
      const value = JSON.stringify({v: SNAPSHOT_FORMAT, keys: [...keys]});
      try {
        storage.set(storageKey, value);
        return storage.getString(storageKey) === value;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage.remove(storageKey);
      } catch {
        // Nothing to do.
      }
    },
  };
}
