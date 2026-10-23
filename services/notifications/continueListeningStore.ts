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
// Nothing here throws into its caller.
import {notificationsStorage} from './catalogDiff';
import type {PlayedTrack} from './notificationScheduling';
import type {KeyValueStorage} from './types';

export const CONTINUE_LISTENING_LAST_PLAY_KEY = 'continue_listening_last_play';

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

/** Keeps `play` (it replaces the last one). Gives `false` when the write throws. */
export function writeContinuePlay(
  play: PersistedContinuePlay,
  storage: KeyValueStorage = notificationsStorage,
): boolean {
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
  if (record && record.fireAt <= now) clearContinuePlay(storage);
}

/** Removes the stored play. */
export function clearContinuePlay(
  storage: KeyValueStorage = notificationsStorage,
): void {
  try {
    storage.remove(CONTINUE_LISTENING_LAST_PLAY_KEY);
  } catch {
    // Best effort: the boot step does not post a notice whose time is past.
  }
}
