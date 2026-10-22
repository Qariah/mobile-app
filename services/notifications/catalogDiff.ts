// @ai-generated
// Qariah (Sprint 48, S48.6): which recitations are new since the last catalog
// check.
//
// A snapshot is the set of recitation keys of a catalog (`RecitationKey`). The
// background check compares the keys of the catalog that it just read with the
// last snapshot, and keeps the new snapshot in MMKV.
import {createMMKV, type MMKV} from 'react-native-mmkv';
import type {Reciter, Rewayat, SurahMetadata} from '@/data/reciterData';
import type {KeyValueStorage, RecitationKey} from './types';

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
 * as `scripts/catalog-added-at.mjs` and the ops console do. A row alone (a
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
// The snapshot store

export const CATALOG_SNAPSHOT_KEY = 'qariah-notif-catalog-snapshot';
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
   * Gives `false` for an empty set (not kept, see `diffCatalog`), when the
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
        raw = storage.getString(CATALOG_SNAPSHOT_KEY);
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
      if (keys.size === 0 || !isAvailable()) return false;
      const value = JSON.stringify({v: SNAPSHOT_FORMAT, keys: [...keys]});
      try {
        storage.set(CATALOG_SNAPSHOT_KEY, value);
        return storage.getString(CATALOG_SNAPSHOT_KEY) === value;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage.remove(CATALOG_SNAPSHOT_KEY);
      } catch {
        // Nothing to do.
      }
    },
  };
}
