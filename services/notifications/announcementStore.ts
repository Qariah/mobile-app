// @ai-generated
// Qariah (Sprint 48, S48.8): the stored state of the announcement rule.
//
// - The last announced id: MMKV id `qariah-notifications`, key
//   `last_announced_id`.
// - The fresh-install test: no app version was recorded before this start.
// - The foreground record: when the user opens the app, record the id of this
//   build, so the background task does not post the `whats_new` notice after
//   the user saw the update pages; and remove the notice of this id from the
//   notification list (`clearAnnouncementNotice`).
// - The background half: `backgroundAnnouncementCandidate` gives the
//   `whats_new` candidate to the catalog check, and `recordPostedAnnouncement`
//   records the id after the notice posted.
//
// The rule itself is `announcementAction` in `announcement.ts`. Nothing here
// throws into its caller.
import {QARIAH_ANNOUNCEMENT_ID} from '@/config/qariahAnnouncement';
import {getLastSeenVersion} from '@/utils/versionUtils';
import {
  announcementAction,
  announcementCandidate,
  whatsNewCandidate,
  type AnnouncementAction,
} from './announcement';
import {notificationsStorage} from './catalogDiff';
import type {KeyValueStorage, NotificationCandidate, Notifier} from './types';

export const LAST_ANNOUNCED_ID_KEY = 'last_announced_id';

function storageAvailable(storage: KeyValueStorage): boolean {
  try {
    return storage.isAvailable ? storage.isAvailable() : true;
  } catch {
    return false;
  }
}

/**
 * The last announced id, `null` when there is none, or `undefined` when the
 * storage cannot be read. On `undefined`, decide nothing: a missing value
 * would make an announcement that was already made look new.
 */
export function readLastAnnouncedId(
  storage: KeyValueStorage = notificationsStorage,
): string | null | undefined {
  if (!storageAvailable(storage)) return undefined;
  try {
    const value = storage.getString(LAST_ANNOUNCED_ID_KEY);
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return undefined;
  }
}

/** Keeps `id`. `true` only when a read-back gives the written value. */
export function writeLastAnnouncedId(
  id: string,
  storage: KeyValueStorage = notificationsStorage,
): boolean {
  if (!id || !storageAvailable(storage)) return false;
  try {
    storage.set(LAST_ANNOUNCED_ID_KEY, id);
    return storage.getString(LAST_ANNOUNCED_ID_KEY) === id;
  } catch {
    return false;
  }
}

/**
 * `true` when no earlier start recorded an app version: a fresh install.
 *
 * The source is the last seen version of `utils/versionUtils.ts` (AsyncStorage),
 * which every earlier v2 build wrote. A marker of this build cannot tell an
 * install from the upgrade to the first build with announcements, and that
 * upgrade must announce. The What's New onboarding writes the version when the
 * user closes the tour or the update pages; `hasVersionChanged` writes it on a
 * patch update, but only over an existing value. So read it at the start,
 * before the user can close the onboarding.
 *
 * A failed read counts as a fresh install (`getLastSeenVersion` gives `null`):
 * the start records the id and announces nothing, a missed notice and never a
 * wrong one.
 */
export async function readIsFreshInstall(
  readLastSeenVersion: () => Promise<string | null> = getLastSeenVersion,
): Promise<boolean> {
  try {
    return (await readLastSeenVersion()) === null;
  } catch {
    return true;
  }
}

export interface ForegroundAnnouncementInput {
  isFreshInstall: boolean;
  /** Default: `QARIAH_ANNOUNCEMENT_ID`. */
  currentId?: string | null;
  /** Default: the notifications MMKV. */
  storage?: KeyValueStorage;
}

export interface ForegroundAnnouncementResult {
  /** What the rule gave; `null` when the storage could not be read. */
  action: AnnouncementAction | null;
  /** `true` when this call stored the id (written and read back). */
  recorded: boolean;
}

/**
 * The foreground half of the S48.8 rule: the user opened the app. Call it once
 * for each process, when the app first becomes active (not for a background
 * launch). `record` (a fresh install) and `record_and_cancel_pending` (an
 * upgrade) both store the id; the foreground never gives a candidate.
 */
export function recordForegroundAnnouncement(
  input: ForegroundAnnouncementInput,
): ForegroundAnnouncementResult {
  const storage = input.storage ?? notificationsStorage;
  const currentId =
    input.currentId === undefined ? QARIAH_ANNOUNCEMENT_ID : input.currentId;
  const lastAnnouncedId = readLastAnnouncedId(storage);
  if (lastAnnouncedId === undefined) return {action: null, recorded: false};

  const action = announcementAction({
    currentId,
    lastAnnouncedId,
    isFreshInstall: input.isFreshInstall,
    context: 'foreground',
  });
  if (
    !currentId ||
    (action !== 'record' && action !== 'record_and_cancel_pending')
  ) {
    return {action, recorded: false};
  }
  // The caller removes a pending or a shown notice of this id after this
  // (`clearAnnouncementNotice`, `useForegroundAnnouncementRecord.ts`). The id
  // is stored first: the stored id stops a new post, also when the removal
  // fails.
  return {action, recorded: writeLastAnnouncedId(currentId, storage)};
}

/**
 * Removes the `whats_new` notice of `announcementId`: a scheduled one that
 * is not shown yet, and a shown one in the notification list (the user opened
 * the app, so the update pages do the work). Never throws.
 */
export async function clearAnnouncementNotice(
  announcementId: string,
  notifier: Notifier,
): Promise<void> {
  const id = whatsNewCandidate(announcementId).dedupeKey;
  try {
    await notifier.cancel(id);
  } catch {
    // Best effort.
  }
  try {
    await notifier.dismissDelivered?.(id);
  } catch {
    // Best effort.
  }
}

export interface BackgroundAnnouncementDeps {
  /** Default: `QARIAH_ANNOUNCEMENT_ID`. */
  currentId?: string | null;
  /** Default: the notifications MMKV. */
  storage?: KeyValueStorage;
  /** Default: `readIsFreshInstall`. */
  readFreshInstall?: () => Promise<boolean>;
}

/**
 * The `whats_new` candidate of a background run, or `null` (no id, the id is
 * recorded, an older id, a fresh install, or the storage cannot be read).
 * Give it to the catalog check (`extraCandidates`); after the run, call
 * `recordPostedAnnouncement`. Never throws.
 */
export async function backgroundAnnouncementCandidate(
  deps: BackgroundAnnouncementDeps = {},
): Promise<NotificationCandidate | null> {
  try {
    const storage = deps.storage ?? notificationsStorage;
    const currentId =
      deps.currentId === undefined ? QARIAH_ANNOUNCEMENT_ID : deps.currentId;
    const lastAnnouncedId = readLastAnnouncedId(storage);
    if (lastAnnouncedId === undefined) return null;
    const isFreshInstall = await (
      deps.readFreshInstall ?? readIsFreshInstall
    )();
    return announcementCandidate({currentId, lastAnnouncedId, isFreshInstall});
  } catch {
    return null;
  }
}

/**
 * Records the id of `candidate` when the run posted it (`posted` is the
 * candidate that posted). `true` when it recorded the id.
 */
export function recordPostedAnnouncement(
  candidate: NotificationCandidate | null,
  posted: NotificationCandidate | null | undefined,
  storage: KeyValueStorage = notificationsStorage,
): boolean {
  if (!candidate || !posted || posted.dedupeKey !== candidate.dedupeKey) {
    return false;
  }
  const prefix = 'whats_new:';
  if (!candidate.dedupeKey.startsWith(prefix)) return false;
  return writeLastAnnouncedId(
    candidate.dedupeKey.slice(prefix.length),
    storage,
  );
}
