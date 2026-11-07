// @ai-generated
// Qariah (Sprint 50, S50.3, TECH_DEBT #330): the play of the pending
// "continue listening" notice, kept in MMKV.
//
// Android removes the alarms of a force-stopped app (Settings → Force stop,
// or an OEM task killer). The `expo-notifications` store keeps the request,
// so `getAllScheduledNotificationsAsync()` still lists the notice, but no
// alarm fires it. The boot step (`notificationScheduling.ts`,
// `setNotificationSchedulingReady`) reads this record and schedules the notice
// again with the same id, so the notice comes back after a force-stop.
//
// MMKV id `qariah-notifications`, key `continue_listening_last_play`: JSON
// `{v: 1, track, playedAt, fireAt}`. `track` is the `PlayedTrack` of the play,
// `playedAt` is the time of the play and `fireAt` is the time of the notice
// (epoch milliseconds, from `continueListeningTrigger`).
//
// The record is written only when a schedule of the notice succeeded. It is
// removed where the engine cancels the notice: the switch goes OFF, the sync
// finds the switch off or no permission, and the holdout sync. So the record
// is there only while the app wants the notice to be pending.
//
// One notice a day (Sprint 51, TECH_DEBT #328): a record whose time is past
// when a new play replaces it, or when the engine removes it, was a notice
// that fired. Its local day goes to the key `continue_listening_fired_day`
// (`YYYY-MM-DD`), so the app posts no second notice that day
// (`continueNoticeDays`). A notice that Android lost to a force-stop also
// counts: that day then gets no notice, never two.
//
// Nothing here throws into its caller.
import {notificationsStorage} from './catalogDiff';
import {localDay} from './localDay';
import type {PlayedTrack} from './notificationScheduling';
import type {KeyValueStorage} from './types';

export const CONTINUE_LISTENING_LAST_PLAY_KEY = 'continue_listening_last_play';

/** The local day of the last "continue listening" notice that fired (TECH_DEBT #328). */
export const CONTINUE_LISTENING_FIRED_DAY_KEY = 'continue_listening_fired_day';

/** The format of the stored value. A value in another format is no record. */
const RECORD_FORMAT = 1;

/** The number of surahs; a surah id out of 1–114 is not valid. */
const SURAH_COUNT = 114;

export interface PersistedContinuePlay {
  track: PlayedTrack;
  /** The time of the play (epoch milliseconds). */
  playedAt: number;
  /** The time of the notice (epoch milliseconds). */
  fireAt: number;
}

function isPlayedTrack(value: unknown): value is PlayedTrack {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track.reciterId === 'string' &&
    track.reciterId !== '' &&
    typeof track.reciterName === 'string' &&
    typeof track.surahId === 'number' &&
    Number.isInteger(track.surahId) &&
    track.surahId >= 1 &&
    track.surahId <= SURAH_COUNT &&
    (track.rewayatId === null || typeof track.rewayatId === 'string')
  );
}

function parseRecord(raw: string): PersistedContinuePlay | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const {playedAt, fireAt} = record;
  if (
    record.v !== RECORD_FORMAT ||
    !isPlayedTrack(record.track) ||
    typeof playedAt !== 'number' ||
    typeof fireAt !== 'number' ||
    !Number.isFinite(playedAt) ||
    !Number.isFinite(fireAt) ||
    fireAt <= playedAt
  ) {
    return null;
  }
  const track = record.track;
  return {
    track: {
      reciterId: track.reciterId,
      reciterName: track.reciterName,
      surahId: track.surahId,
      rewayatId: track.rewayatId,
    },
    playedAt,
    fireAt,
  };
}

/**
 * The stored play, or `null` when there is none or the storage cannot be
 * read. A stored value that is not a valid record is removed (it can never
 * become valid).
 */
export function readContinuePlay(
  storage: KeyValueStorage = notificationsStorage,
): PersistedContinuePlay | null {
  let raw: string | undefined;
  try {
    raw = storage.getString(CONTINUE_LISTENING_LAST_PLAY_KEY);
  } catch {
    return null;
  }
  if (typeof raw !== 'string') return null;
  const record = parseRecord(raw);
  if (!record) clearContinuePlay(storage);
  return record;
}

/**
 * Before the record changes: when the stored notice is due at `now` or
 * earlier, it fired; keep its local day (TECH_DEBT #328).
 */
function rememberFiredNotice(storage: KeyValueStorage, now: number): void {
  let raw: string | undefined;
  try {
    raw = storage.getString(CONTINUE_LISTENING_LAST_PLAY_KEY);
  } catch {
    return;
  }
  if (typeof raw !== 'string') return;
  const record = parseRecord(raw);
  if (!record || record.fireAt > now) return;
  try {
    storage.set(
      CONTINUE_LISTENING_FIRED_DAY_KEY,
      localDay(new Date(record.fireAt)),
    );
  } catch {
    // Best effort: the day can get a second notice.
  }
}

/**
 * The local days (`YYYY-MM-DD`) that have a "continue listening" notice: the
 * day of the stored notice (pending, or past and not removed yet) and the day
 * of the last one that fired. The app posts nothing on these days.
 */
export function continueNoticeDays(
  storage: KeyValueStorage = notificationsStorage,
): string[] {
  const days: string[] = [];
  const record = readContinuePlay(storage);
  if (record) days.push(localDay(new Date(record.fireAt)));
  let fired: string | undefined;
  try {
    fired = storage.getString(CONTINUE_LISTENING_FIRED_DAY_KEY);
  } catch {
    fired = undefined;
  }
  if (typeof fired === 'string' && fired !== '') days.push(fired);
  return days;
}

/**
 * Keeps `play` (it replaces the last one). Gives `false` when the write
 * throws. A replaced notice that was due at `now` or earlier keeps its day.
 */
export function writeContinuePlay(
  play: PersistedContinuePlay,
  storage: KeyValueStorage = notificationsStorage,
  now: number = Date.now(),
): boolean {
  rememberFiredNotice(storage, now);
  const {track} = play;
  const value = JSON.stringify({
    v: RECORD_FORMAT,
    track: {
      reciterId: track.reciterId,
      reciterName: track.reciterName,
      surahId: track.surahId,
      rewayatId: track.rewayatId,
    },
    playedAt: play.playedAt,
    fireAt: play.fireAt,
  });
  try {
    storage.set(CONTINUE_LISTENING_LAST_PLAY_KEY, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the stored play when the time of its notice is `now` or earlier.
 * A stored play with a later time (a newer play) stays.
 */
export function clearContinuePlayIfPast(
  now: number,
  storage: KeyValueStorage = notificationsStorage,
): void {
  const record = readContinuePlay(storage);
  if (record && record.fireAt <= now) clearContinuePlay(storage, now);
}

/** Removes the stored play. A notice that was due at `now` or earlier keeps its day. */
export function clearContinuePlay(
  storage: KeyValueStorage = notificationsStorage,
  now: number = Date.now(),
): void {
  rememberFiredNotice(storage, now);
  try {
    storage.remove(CONTINUE_LISTENING_LAST_PLAY_KEY);
  } catch {
    // Best effort: the boot step does not post a notice whose time is past.
  }
}
