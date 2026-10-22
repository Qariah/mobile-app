import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {
  usePlayerStore,
  currentPlayOpId,
} from '@/services/player/store/playerStore';
import {
  getAvailableSurahsForRewayat,
  getReciterByIdSync,
  getSurahById,
} from '@/services/dataService';
import {Surah} from '@/data/surahData';
import {generateSmartAudioUrl} from '@/utils/audioUtils';
import {getReciterArtwork} from '@/utils/artworkUtils';
import {expoAudioService} from '@/services/audio/ExpoAudioService';
import {Track} from '@/types/audio';
import {useUploadsStore} from '@/store/uploadsStore';
import {createUserUploadTrack} from '@/utils/track';
import * as FileSystem from 'expo-file-system/legacy';
import {resolveFilePath} from '@/services/downloadService';
import {hasCarReplacedQueue} from '@/services/car/sessionGate';

/**
 * Waits for playerStore to finish hydrating from AsyncStorage.
 * Returns immediately if already hydrated. Falls back after a timeout
 * to prevent the splash screen from hanging indefinitely on Android
 * where AsyncStorage (SQLite-backed) can be slow or miss the event.
 */
function waitForPlayerStoreHydration(timeoutMs = 3000): Promise<void> {
  return new Promise(resolve => {
    if (usePlayerStore.persist.hasHydrated()) {
      resolve();
      return;
    }

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      // @ai Clear the timer, so a fast hydration leaves no 3 s timer behind.
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      if (__DEV__ && !settled) {
        console.warn(
          `[RestoreSession] playerStore hydration timed out after ${timeoutMs}ms, continuing`,
        );
      }
      settle();
    }, timeoutMs);

    const unsub = usePlayerStore.persist.onFinishHydration(() => {
      unsub();
      settle();
    });
  });
}

/**
 * Phase 1: Populates the player store queue and playback state from
 * persisted recentTracks[0]. This makes the floating player render
 * immediately showing the last track. Does NOT load audio.
 * @ai The persisted playerStore queue comes first (restorePersistedQueue,
 * TECH_DEBT #271). recentTracks[0] rebuilds the queue only when no queue
 * was saved.
 *
 * Phase 2: Loads the audio source and seeks to the saved position
 * so that tapping play works. Run this after app is ready.
 */
export async function restoreSession(): Promise<void> {
  try {
    // Wait for playerStore to hydrate from AsyncStorage so we can read
    // the persisted queue (important for upload tracks).
    await waitForPlayerStoreHydration();

    const persistedState = usePlayerStore.getState();
    const persistedTrack =
      persistedState.queue.tracks[persistedState.queue.currentIndex];

    // A car request (CarPlay / Android Auto) already replaced the queue.
    if (hasCarReplacedQueue()) return;

    // @ai The saved queue is the session (TECH_DEBT #271). The mini player
    // already shows its current track, and every play writes it: a playlist,
    // the downloads list, a surah link, a reciter profile, an upload. The
    // recent tracks miss some of these plays, and they keep one card for
    // each reciter, so a rebuild from them can show another track or turn a
    // playlist into a reciter's full surah list.
    if (persistedTrack?.url) {
      await restorePersistedQueue();
      return;
    }

    // @ai No saved queue (a new device, an import, Settings -> Clear cache):
    // rebuild the queue from the most recent track.
    const recentTracks = useRecentlyPlayedStore.getState().recentTracks;
    if (recentTracks.length === 0) return;

    const recent = recentTracks[0];

    // Handle upload entry in recentlyPlayedStore
    if (recent.isUserUpload && recent.userRecitationId) {
      const recitation = useUploadsStore
        .getState()
        .recitations.find(r => r.id === recent.userRecitationId);
      if (recitation) {
        const uploadTrack = createUserUploadTrack(recitation);
        const startPosition = recent.progress * recent.duration;

        const playerStore = usePlayerStore.getState();
        playerStore.updateQueueState({tracks: [uploadTrack], currentIndex: 0});
        playerStore.updatePlaybackState({
          position: startPosition,
          duration: recent.duration,
          state: 'paused',
        });

        if (__DEV__) {
          console.log('[RestoreSession] Restored upload from recentTracks', {
            title: uploadTrack.title,
            position: Math.round(startPosition),
          });
        }

        loadAudioInBackground(uploadTrack.url, startPosition);
        return;
      }
      // Upload file was deleted — fall through to next recent track or bail
      if (recentTracks.length <= 1) return;
      // Could try recentTracks[1] but keep it simple for now
      return;
    }

    const {reciter, surah, rewayatId, progress, duration} = recent;
    const startPosition = progress * duration;

    // Build the full queue for auto-advance
    const availableSurahIds = await getAvailableSurahsForRewayat(rewayatId);
    const allSurahs = availableSurahIds
      .map(id => getSurahById(id))
      .filter((s): s is Surah => s !== undefined);

    const startIndex = allSurahs.findIndex(s => s.id === surah.id);
    const artwork = getReciterArtwork(reciter);

    let tracks: Track[];
    if (startIndex !== -1 && allSurahs.length > 0) {
      const reorderedSurahs = [
        allSurahs[startIndex],
        ...allSurahs.slice(startIndex + 1),
        ...allSurahs.slice(0, startIndex),
      ];
      tracks = reorderedSurahs.map(s => ({
        id: `${reciter.id}:${s.id}`,
        url: generateSmartAudioUrl(reciter, s.id.toString(), rewayatId),
        title: s.name,
        artist: reciter.name,
        reciterId: reciter.id,
        artwork,
        surahId: s.id.toString(),
        reciterName: reciter.name,
        rewayatId,
      }));
    } else {
      // Fallback: single track
      tracks = [
        {
          id: `${reciter.id}:${surah.id}`,
          url: generateSmartAudioUrl(reciter, surah.id.toString(), rewayatId),
          title: surah.name,
          artist: reciter.name,
          reciterId: reciter.id,
          artwork,
          surahId: surah.id.toString(),
          reciterName: reciter.name,
          rewayatId,
        },
      ];
    }

    // The await above gave a car request time to take over the queue.
    if (hasCarReplacedQueue()) return;

    // Phase 1: Populate store state (floating player renders immediately)
    const playerStore = usePlayerStore.getState();
    playerStore.updateQueueState({tracks, currentIndex: 0});
    playerStore.updatePlaybackState({
      position: startPosition,
      duration,
      state: 'paused',
    });

    if (__DEV__) {
      console.log('[RestoreSession] Phase 1: Store populated', {
        reciter: reciter.name,
        surah: surah.name,
        position: Math.round(startPosition),
        queueSize: tracks.length,
      });
    }

    // Phase 2: Load audio source in background (non-blocking)
    loadAudioInBackground(tracks[0].url, startPosition);
  } catch (error) {
    console.error('[RestoreSession] Error restoring session:', error);
  }
}

// @ai-start
/**
 * Restores the persisted playerStore queue as the session (TECH_DEBT #271).
 *
 * The store hydrates this queue before the restore runs, and the mini player
 * shows its current track at once. The restore must load a source for that
 * track. If it does not, a tap on Play shows Pause and no audio plays.
 *
 * It keeps the queue, its order and its current track, and loads that track
 * at the saved position (at 0 when the saved position is at the end).
 */
async function restorePersistedQueue(): Promise<void> {
  const {tracks, currentIndex} = usePlayerStore.getState().queue;
  const saved = tracks[currentIndex];
  if (!saved) return;

  const current = withCurrentLabels(await withPlayableUrl(saved));

  // The await above gave a car request time to take over the queue.
  if (hasCarReplacedQueue()) return;

  // The await above is a file check. Write only if the queue did not change.
  const playerStore = usePlayerStore.getState();
  if (
    playerStore.queue.tracks !== tracks ||
    playerStore.queue.currentIndex !== currentIndex
  ) {
    return;
  }

  const freshTracks = tracks.map((t, i) =>
    i === currentIndex ? current : withCurrentContainer(t),
  );
  const {position, duration} = playerStore.playback;
  const atEnd = duration > 0 && position >= duration - END_MARGIN_SEC;
  const startPosition = position > 0 && !atEnd ? position : 0;

  playerStore.updateQueueState({tracks: freshTracks});
  playerStore.updatePlaybackState({
    state: 'paused',
    position: startPosition,
    duration,
  });

  if (__DEV__) {
    console.log('[RestoreSession] Restored the persisted queue', {
      title: current.title,
      position: Math.round(startPosition),
      queueSize: freshTracks.length,
    });
  }

  loadAudioInBackground(current.url, startPosition);
}

/** A saved position this close to the end starts the track at 0. */
const END_MARGIN_SEC = 2;

function isLocalFile(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('/');
}

/**
 * A playable URL for the restored current track.
 * - An upload: the file of its recitation, when the recitation still exists.
 * - A local file (a download): the same file in the current app container
 *   (iOS can move the container on an update), when the file exists. The
 *   download record is not used: it can be missing (the download store has
 *   not hydrated) or keyed by another rewayah ('' for some download paths).
 * - Otherwise, or when the file is gone: the URL that the play paths build
 *   (generateSmartAudioUrl). When the reciter or the rewayah is not in the
 *   catalog, the track keeps its URL.
 */
async function withPlayableUrl(track: Track): Promise<Track> {
  try {
    if (track.isUserUpload) {
      const recitation = useUploadsStore
        .getState()
        .recitations.find(r => r.id === track.userRecitationId);
      return recitation
        ? {...track, url: createUserUploadTrack(recitation).url}
        : track;
    }
    if (isLocalFile(track.url)) {
      const local = resolveFilePath(track.url);
      if ((await FileSystem.getInfoAsync(local)).exists) {
        return {...track, url: local};
      }
    }
    const reciter = getReciterByIdSync(track.reciterId);
    if (!reciter || !track.surahId) return track;
    return {
      ...track,
      url: generateSmartAudioUrl(reciter, track.surahId, track.rewayatId),
    };
  } catch {
    // generateAudioUrl() throws when the rewayah is not in the catalog.
    return track;
  }
}

/**
 * The other queue tracks keep their URLs. Only a download path moves to the
 * current app container. A file check for each track would slow the splash.
 */
function withCurrentContainer(track: Track): Track {
  return !track.isUserUpload && isLocalFile(track.url)
    ? {...track, url: resolveFilePath(track.url)}
    : track;
}

/**
 * The title, artist and artwork in the current language and catalog, as the
 * recent-track path builds them. An upload keeps its own labels.
 */
function withCurrentLabels(track: Track): Track {
  if (track.isUserUpload) return track;
  const reciter = getReciterByIdSync(track.reciterId);
  const surah = track.surahId ? getSurahById(Number(track.surahId)) : undefined;
  return {
    ...track,
    ...(surah ? {title: surah.name} : {}),
    ...(reciter
      ? {
          artist: reciter.name,
          reciterName: reciter.name,
          artwork: getReciterArtwork(reciter),
        }
      : {}),
  };
}
// @ai-end

/**
 * @ai True while the restore still owns the player. Two conditions:
 * - the queue's current track is still the restored track, and
 * - the ExpoAudioService load generation is still `expectedGeneration`.
 *
 * loadTrack() can wait for the player on a cold start
 * (planning/boot-restore-player-order-plan.md). A user pick in that window
 * starts a newer load, and Settings -> Clear cache runs cleanup(). Both move
 * the generation. The generation check is necessary because the user can
 * pick the SAME surah: the URL check alone then stays true, and the restore
 * would seek the user's track. The check uses the generation, not the store
 * playback state, because the provider can set 'buffering' during a normal
 * restore load, and a state check would then skip a real resume.
 */
function restoreStillOwnsPlayer(
  url: string,
  expectedGeneration: number,
): boolean {
  const {queue} = usePlayerStore.getState();
  return (
    queue.tracks[queue.currentIndex]?.url === url &&
    expoAudioService.getLoadGeneration() === expectedGeneration
  );
}

// The in-flight phase 2 load, if any.
let restoreLoad: Promise<void> | null = null;

// @ai-start TECH_DEBT #285
/**
 * The restore's load and seek, while they run. The loaded source reports
 * position 0 until the seek to the saved position lands. ExpoAudioProvider
 * saves the reported position, so it could save that 0 as the session
 * position. When the app then stopped, the next restore (for example a tap
 * on the widget's Play) started the track at 0:00.
 */
let restoreSeek: {url: string; opId: number; generation: number} | null = null;

/**
 * True while the restore loads its track and seeks to the saved position,
 * and still owns the player. Newer work (a play, a cleanup()) ends it at
 * once. ExpoAudioProvider does not save a reported position while it is true.
 */
export function isRestoreSeekPending(): boolean {
  if (!restoreSeek) return false;
  const {url, opId, generation} = restoreSeek;
  return (
    currentPlayOpId() === opId &&
    (restoreStillOwnsPlayer(url, generation) ||
      restoreStillOwnsPlayer(url, generation + 1))
  );
}
// @ai-end

/** Resolves once restoreSession's background load (if any) has settled. */
export function pendingRestoreLoad(): Promise<void> {
  return restoreLoad ?? Promise.resolve();
}

/**
 * Loads the audio source and seeks to position. Runs after store is populated.
 * Skips the load and seek once a newer play claimed a playOpId, so it cannot
 * replace or rewind a source that play started. Exported for tests.
 * @ai Qariah also skips them when the restore no longer owns the player
 * (restoreStillOwnsPlayer above, TECH_DEBT #218).
 */
export function loadAudioInBackground(
  url: string,
  startPosition: number,
): void {
  const opId = currentPlayOpId();
  // @ai The load generation when the restore scheduled its load. A load or a
  // cleanup() after this point belongs to newer work.
  const scheduledGeneration = expoAudioService.getLoadGeneration();
  let settle: () => void = () => undefined;
  const load = new Promise<void>(resolve => {
    settle = resolve;
  });
  restoreLoad = load;
  // @ai The restore owns the position until its seek lands (TECH_DEBT #285).
  const seek =
    startPosition > 0 ? {url, opId, generation: scheduledGeneration} : null;
  restoreSeek = seek;
  // Use setTimeout to defer off the critical startup path
  setTimeout(async () => {
    try {
      // @ai Inside the try, so the finally below settles pendingRestoreLoad()
      // (upstream returned before the try, and left it pending).
      if (hasCarReplacedQueue()) return;
      // Newer work started before the timer fired: do not start a load.
      if (currentPlayOpId() !== opId) return;
      if (!restoreStillOwnsPlayer(url, scheduledGeneration)) return;
      await expoAudioService.loadTrack(url);
      if (currentPlayOpId() !== opId) return;
      // @ai loadTrack() increments the generation once. Any other change means
      // newer work started during the load: do not seek over it.
      if (!restoreStillOwnsPlayer(url, scheduledGeneration + 1)) return;
      if (startPosition > 0 && !hasCarReplacedQueue()) {
        await expoAudioService.seekTo(startPosition);
      }
      if (__DEV__) {
        console.log('[RestoreSession] Phase 2: Audio loaded and seeked');
      }
    } catch (error) {
      // Non-fatal — user can still tap the card to replay
      if (__DEV__) {
        console.debug('[RestoreSession] Background audio load failed:', error);
      }
    } finally {
      if (restoreLoad === load) restoreLoad = null;
      if (restoreSeek === seek) restoreSeek = null; // @ai
      settle();
    }
  }, 100);
}
