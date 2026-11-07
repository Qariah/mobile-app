// @ai-generated
// Qariah (GitHub #557): when the queue ends, queue the next surah by the same
// reciter and rewayah. ExpoAudioProvider calls it at the end of a track, only
// when `branding.continueToNextSurah` is on and the queue has no next item.
import type {Rewayat, Reciter} from '@/data/reciterData';
import type {Track} from '@/types/audio';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {getReciterByIdSync, getSurahById} from '@/services/dataService';
import {createTrack} from '@/utils/track';
import {useNetworkStore} from '@/store/networkStore';
import {isSurahRun, nextSurahId} from './nextSurah';
import {isFromPlaylist} from './queueSource';

/** The rewayah of the track; with no rewayah id, only a reciter's single rewayah. */
function rewayahOf(
  reciter: Reciter,
  rewayatId: string | undefined,
): Rewayat | undefined {
  if (rewayatId) return reciter.rewayat.find(r => r.id === rewayatId);
  return reciter.rewayat.length === 1 ? reciter.rewayat[0] : undefined;
}

/**
 * Appends the next surah by the reciter and rewayah of the last queue item.
 * Returns true when it appended a track; the caller then skips to it.
 *
 * It continues only a play of one reciter's surahs in surah order: a single
 * surah, or a run as the reciter profile queues it. The player keeps no queue
 * source; the queue itself decides, with the playlist mark on its tracks
 * (`queueSource.ts`). Returns false (the player stops, as before):
 * - when the current track is not the last queue item (a real queue item plays first);
 * - when a user playlist queued the tracks, also a playlist of one surah (PLY-13);
 * - when a queue track is an upload, has no surah, or has another reciter or
 *   rewayah (a user playlist, a curated playlist, Loved, a mixed queue);
 * - when the queue is not a run of the rewayah's surahs (a curated Play All
 *   with one reciter, a sorted or filtered profile list);
 * - when the catalog does not know the reciter or the rewayah;
 * - after the rewayah's last surah;
 * - offline, when the next surah is not downloaded.
 */
export async function queueNextSurah(): Promise<boolean> {
  const {queue, addToQueue} = usePlayerStore.getState();
  const last = queue.tracks[queue.currentIndex];
  if (!last || queue.currentIndex !== queue.tracks.length - 1) return false;
  if (last.isUserUpload || !last.surahId) return false;
  if (queue.tracks.some(isFromPlaylist)) return false;

  const reciter = getReciterByIdSync(last.reciterId);
  if (!reciter) return false;
  const rewayah = rewayahOf(reciter, last.rewayatId);
  if (!rewayah) return false;

  const oneRecitation = queue.tracks.every(
    t =>
      !t.isUserUpload &&
      !!t.surahId &&
      t.reciterId === reciter.id &&
      rewayahOf(reciter, t.rewayatId)?.id === rewayah.id,
  );
  if (!oneRecitation) return false;
  const available = rewayah.surah_list ?? [];
  const queueSurahs = queue.tracks.map(t => Number(t.surahId));
  if (!isSurahRun(queueSurahs, available)) return false;

  const next = nextSurahId(
    Number(last.surahId),
    available,
    new Set(queueSurahs),
  );
  if (next === null) return false;
  const surah = getSurahById(next);
  if (!surah) return false;

  let track: Track;
  try {
    track = await createTrack(reciter, surah, rewayah.id);
  } catch {
    // generateAudioUrl() throws when the rewayah is not in the catalog.
    return false;
  }
  // Offline, a stream cannot play: stop, as at the end of the queue, and do not queue (and persist) a
  // surah that cannot play. A downloaded next surah (a local file) still plays.
  if (!useNetworkStore.getState().isOnline && /^https?:/.test(track.url)) {
    return false;
  }
  // The await above: append only to the queue that was read.
  if (usePlayerStore.getState().queue.tracks !== queue.tracks) return false;
  await addToQueue([track]);
  return true;
}
