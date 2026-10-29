// @ai-generated
// Qariah (Sprint 48, S48.6): one catalog check, in the required order.
//
// The background task (Task 15) and the foreground catalog refresh (Task 16)
// call `runCatalogCheck`. Do not do the steps by hand: the order is what keeps
// a failure from posting a notice twice or losing it.
//
//   1. Read the preferences. Not readable → stop (nothing saved, nothing posted).
//   2. Diff the catalog with the last snapshot.
//   3. Build the candidates and pick at most one.
//   4. Save the snapshot: the previous one, plus each new key that was not held
//      back. The save must verify; when it does not, stop WITHOUT a post (a
//      post with an unsaved snapshot would post the same notice again on the
//      next check).
//   5. Post the picked candidate. When the post fails, save the snapshot again
//      with its keys held back, so the next check tries again.
//   6. Record today (`markNotifiedToday`).
//
// The daily limit counts the OS-scheduled notices too (TECH_DEBT #328): on a
// Friday with the Al-Kahf reminder on, and on the day of a "continue
// listening" notice, step 3 picks nothing (`scheduledNoticeOnDay`).
//
// The cap (review of Sprint 51, Lane N): the first local day on which a
// taken day held a catalog notice back is in MMKV
// (`CATALOG_NOTICE_HELD_SINCE_KEY`). From `CATALOG_NOTICE_HOLD_CAP_DAYS` days
// after it, a taken day does not hold the notice back (`holdCapReached`); the
// app still posts at most one notice that day. A post removes the day, and so
// does a check with nothing to hold back.
import type {Reciter} from '@/data/reciterData';
import {continueNoticeDays} from './continueListeningStore';
import {
  createCatalogSnapshotStore,
  diffCatalog,
  notificationsStorage,
  recitationKeysOf,
  snapshotAfter,
  type CatalogSnapshotStore,
} from './catalogDiff';
import {localDay} from './localDay';
import {notificationPrefsSource} from './prefsStore';
import {
  buildRecitationCandidates,
  heldBackKeys,
  holdCapReached,
  pickNotification,
  scheduledNoticeOnDay,
  type PickNotificationInput,
} from './scheduler';
import type {
  KeyValueStorage,
  NotificationCandidate,
  NotificationPrefsSource,
  Notifier,
  RecitationKey,
} from './types';

/** The first local day (`YYYY-MM-DD`) on which a taken day held a catalog notice back. */
export const CATALOG_NOTICE_HELD_SINCE_KEY = 'catalog_notice_held_since';

const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

function readHeldSince(storage: KeyValueStorage): string | null {
  try {
    const value = storage.getString(CATALOG_NOTICE_HELD_SINCE_KEY);
    return typeof value === 'string' && LOCAL_DAY.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeHeldSince(storage: KeyValueStorage, day: string | null): void {
  try {
    if (day === null) storage.remove(CATALOG_NOTICE_HELD_SINCE_KEY);
    else storage.set(CATALOG_NOTICE_HELD_SINCE_KEY, day);
  } catch {
    // Best effort: without the day, the cap starts again at the next hold.
  }
}

/**
 * What a check did. Each status is a fact that the caller can log; only
 * `posted` posted a notice.
 * - `storage_unavailable`: MMKV did not open. Nothing read, saved or posted.
 * - `prefs_unavailable`: the preferences could not be read. Nothing saved or posted.
 * - `empty_catalog`: the catalog has no recitation (a failed load). Nothing saved or posted.
 * - `permission_unavailable`: `notifier.getPermission()` failed. Nothing saved or posted.
 * - `save_failed`: the snapshot did not save. Nothing posted.
 * - `first_check`: the first snapshot is saved; no recitation is announced.
 * - `nothing_new`: no new recitation, and no other candidate posted.
 * - `not_posted`: new recitations, but no notice today (the toggles, the
 *   holdout, no permission, the daily limit, an OS-scheduled notice today).
 *   The held-back keys come again.
 * - `post_failed`: `notifier.schedule()` failed.
 * - `posted`: one notice posted.
 */
export type CatalogCheckStatus =
  | 'storage_unavailable'
  | 'prefs_unavailable'
  | 'empty_catalog'
  | 'permission_unavailable'
  | 'save_failed'
  | 'first_check'
  | 'nothing_new'
  | 'not_posted'
  | 'post_failed'
  | 'posted';

export interface CatalogCheckDeps {
  /**
   * The catalog to compare. `null`: no catalog this time (the catalog version
   * did not change, and only `extraCandidates` can post). Then nothing is
   * compared, the stored snapshot stays as it is, and the order post → mark
   * is the same.
   */
  reciters: readonly Reciter[] | null;
  /** "Follow" = favorite (`useFavoriteRecitersStore`). */
  favoriteReciterIds: readonly string[];
  /** Pass `true` when the arm is not known yet. */
  holdout: boolean;
  notifier: Notifier;
  /** Default: the MMKV snapshot store. */
  snapshotStore?: CatalogSnapshotStore;
  /** Default: `notificationPrefsSource` (the persisted store). */
  prefs?: NotificationPrefsSource;
  /** Default: the time of the call. */
  now?: Date;
  /**
   * Other candidates for the same daily notice, for example
   * `whatsNewCandidate(id)` when `announcementAction` gives `candidate`.
   */
  extraCandidates?: readonly NotificationCandidate[];
  formatReciterName?: (reciter: Reciter) => string;
  formatSurahName?: (surah: number) => string;
  /**
   * The local days of the "continue listening" notices (TECH_DEBT #328).
   * Default: `continueNoticeDays()` (the MMKV record).
   */
  continueNoticeDays?: () => readonly string[];
  /** The store of `CATALOG_NOTICE_HELD_SINCE_KEY`. Default: `notificationsStorage`. */
  heldSinceStorage?: KeyValueStorage;
}

export interface CatalogCheckResult {
  status: CatalogCheckStatus;
  /** The notice that posted (status `posted`), else `null`. */
  posted: NotificationCandidate | null;
  /** The new recitation keys of this check. */
  newKeys: RecitationKey[];
  /** The keys left out of the saved snapshot, so the next check finds them again. */
  heldBackKeys: RecitationKey[];
  /** Status `posted` only: `false` when today could not be recorded. */
  markedToday?: boolean;
}

/** One catalog check (see the steps at the top of this file). Never throws. */
export async function runCatalogCheck(
  deps: CatalogCheckDeps,
): Promise<CatalogCheckResult> {
  const snapshotStore = deps.snapshotStore ?? createCatalogSnapshotStore();
  const prefsSource = deps.prefs ?? notificationPrefsSource;
  const now = deps.now ?? new Date();
  const result = (
    status: CatalogCheckStatus,
    extra: Partial<CatalogCheckResult> = {},
  ): CatalogCheckResult => ({
    status,
    posted: null,
    newKeys: [],
    heldBackKeys: [],
    ...extra,
  });

  if (!snapshotStore.isAvailable()) return result('storage_unavailable');

  let prefs: Awaited<ReturnType<NotificationPrefsSource['read']>>;
  try {
    prefs = await prefsSource.read();
  } catch {
    prefs = null;
  }
  if (!prefs) return result('prefs_unavailable');

  // `null`: no catalog, so no diff and no snapshot write (see `reciters`).
  const catalog = deps.reciters;
  const next = catalog ? recitationKeysOf(catalog) : null;
  if (next && next.size === 0) return result('empty_catalog');

  const prev = next ? snapshotStore.load() : null;
  const {newKeys, isFirstCheck} = next
    ? diffCatalog(prev, next)
    : {newKeys: [] as RecitationKey[], isFirstCheck: false};

  let permissionGranted: boolean;
  try {
    permissionGranted = (await deps.notifier.getPermission()) === 'granted';
  } catch {
    return result('permission_unavailable', {newKeys});
  }

  const todayLocal = localDay(now);
  const heldSinceStorage = deps.heldSinceStorage ?? notificationsStorage;
  const heldSince = readHeldSince(heldSinceStorage);
  const scheduledToday = scheduledNoticeOnDay({
    now,
    kahfFridayOn: prefs.kahf_friday === true,
    continueNoticeDays: (deps.continueNoticeDays ?? continueNoticeDays)(),
  });
  const input: PickNotificationInput = {
    candidates: [
      ...buildRecitationCandidates({
        newKeys,
        reciters: catalog ?? [],
        favoriteReciterIds: deps.favoriteReciterIds,
        formatReciterName: deps.formatReciterName,
        formatSurahName: deps.formatSurahName,
      }),
      ...(deps.extraCandidates ?? []),
    ],
    prefs,
    permissionGranted,
    holdout: deps.holdout,
    todayLocal,
    lastNotifiedDay: prefs.lastNotifiedDay,
    // The cap: a notice held back for CATALOG_NOTICE_HOLD_CAP_DAYS posts.
    scheduledNoticeToday:
      scheduledToday && !holdCapReached(heldSince, todayLocal),
  };
  const picked = pickNotification(input);
  const held = heldBackKeys(input, picked);

  if (next) {
    const toSave = snapshotAfter(prev, next, held);
    // `toSave` is empty only when each key is new and held back. Then the
    // previous snapshot stays: it has none of the held-back keys either.
    if (toSave.size > 0 && !snapshotStore.save(toSave)) {
      return result('save_failed', {newKeys, heldBackKeys: held});
    }
    // The held-since day (see the file header). Only a check that compared a
    // catalog knows what is held back; a post always ends the wait (below).
    if (!picked) {
      const heldByTakenDay =
        held.length > 0 &&
        input.scheduledNoticeToday === true &&
        pickNotification({...input, scheduledNoticeToday: false}) !== null;
      if (held.length === 0) writeHeldSince(heldSinceStorage, null);
      else if (heldByTakenDay && heldSince === null) {
        writeHeldSince(heldSinceStorage, todayLocal);
      }
    }
  }

  if (!picked) {
    const status: CatalogCheckStatus = isFirstCheck
      ? 'first_check'
      : newKeys.length > 0
        ? 'not_posted'
        : 'nothing_new';
    return result(status, {newKeys, heldBackKeys: held});
  }

  try {
    await deps.notifier.schedule(picked, {kind: 'immediate'});
  } catch {
    // Best effort: hold the picked keys back too, so the next check tries
    // again. If this save fails, the keys stay in the snapshot: a missed
    // notice, never a second one.
    const retryHeld = [...held, ...picked.coveredKeys];
    if (next) {
      const retrySnapshot = snapshotAfter(prev, next, retryHeld);
      if (retrySnapshot.size > 0) snapshotStore.save(retrySnapshot);
    }
    return result('post_failed', {newKeys, heldBackKeys: retryHeld});
  }

  let markedToday: boolean;
  try {
    markedToday = await prefsSource.markNotifiedToday(now);
  } catch {
    markedToday = false;
  }
  writeHeldSince(heldSinceStorage, null);
  return result('posted', {
    posted: picked,
    newKeys,
    heldBackKeys: held,
    markedToday,
  });
}
