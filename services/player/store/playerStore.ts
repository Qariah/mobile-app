import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {Track} from '@/types/audio';
import {
  UnifiedPlayerState,
  PlaybackState,
  QueueState,
  LoadingState,
  ErrorState,
  PlaybackSettings,
  UIState,
} from '../types/state';
import {createDefaultUnifiedPlayerState} from './validation';
import {diagBreadcrumb} from '@/services/diagnostics/diagnostics';
import {notePlaybackAutoPlayLoad} from '@/services/diagnostics/playbackHealth';
import {expoAudioService} from '@/services/audio/ExpoAudioService';
import {audioCoordinator} from '@/services/audio/AudioCoordinator';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import {guardedJSONStorage} from '@/services/storage/hydrationGuardedStorage';

const STORAGE_KEY = 'player-store';

// Map our playback state to store state
type StorePlaybackState =
  | 'none'
  | 'loading'
  | 'buffering'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'ended'
  | 'error';

/**
 * Interface for the player store
 */
export interface PlayerStoreState extends Omit<UnifiedPlayerState, 'ui'> {
  // UI State
  sheetMode: UIState['sheetMode'];
  isImmersive: boolean;

  // UI Actions
  setSheetMode: (mode: UIState['sheetMode']) => void;
  toggleImmersive: () => void;
  setImmersive: (value: boolean) => void;

  // Playback Actions
  play: () => Promise<void>;
  pause: () => Promise<void>;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  setRate: (rate: number) => Promise<void>;

  // Queue Actions
  updateQueue: (
    tracks: Track[],
    currentIndex?: number,
    startPosition?: number,
  ) => Promise<void>;
  addToQueue: (tracks: Track[]) => Promise<void>;
  removeFromQueue: (indices: number[]) => Promise<void>;
  moveInQueue: (fromIndex: number, toIndex: number) => Promise<void>;

  // Settings Actions
  setRepeatMode: (mode: PlaybackSettings['repeatMode']) => void;
  toggleShuffle: () => void;
  setSleepTimer: (minutes: number) => void;
  toggleSkipSilence: () => void;

  // State Updates
  updatePlaybackState: (playbackState: Partial<PlaybackState>) => void;
  updateQueueState: (queueState: Partial<QueueState>) => void;
  updateLoadingState: (loadingState: Partial<LoadingState>) => void;
  setError: (type: keyof ErrorState, error: Error | null) => void;
  reset: () => void;

  // Cleanup
  cleanup: () => Promise<void>;
}

// Monotonic id for the in-flight play operation. Every loadTrackAtIndex()
// claims a fresh id at entry; cleanup() bumps it via invalidatePlayOps().
// Without this, two overlapping loads both run to completion: a second tap (a
// rapid skip, or re-queueing while the first load is still awaiting the
// network) starts its own load, then the OLDER one's play() lands after the
// newer one's and its caller's trailing set() clobbers the newer track's state
// — audible track A over a queue that says track B. loadTrackAtIndex re-checks
// the id after each await and returns false when superseded, so callers skip
// their trailing state writes and the last legitimate operation wins.
let playOpId = 0;

/** Invalidate any in-flight loadTrackAtIndex (see playOpId above). */
function invalidatePlayOps(): void {
  playOpId++;
}

/**
 * Current play op id. Loads outside the store (restoreSession's background
 * load) snapshot it and bail when it moves, so they never replace a source a
 * newer play started.
 */
export function currentPlayOpId(): number {
  return playOpId;
}

/**
 * @ai Stop the audio before a write that leaves the queue with no current
 * track: cleanup() (Settings -> Clear cache), the removal of the last tracks,
 * or a queue with no track to load (TECH_DEBT #235). With no current track,
 * the app shows no player, and LockScreenService clears the lock-screen and
 * notification controls, so audio that kept playing had no control anywhere.
 *
 * It ends the in-flight loads first, so none of them can start audio after
 * the pause, then pauses the native player. A pause failure must not block
 * the caller's write. Returns the op id that it claimed: a caller compares it
 * after the await to learn if a newer load started during the pause.
 */
async function pauseForEmptyQueue(): Promise<number> {
  invalidatePlayOps();
  const opId = playOpId;
  try {
    await expoAudioService.pause();
  } catch (error) {
    if (__DEV__)
      console.warn('[PlayerStore] Pause before an empty queue failed:', error);
  }
  return opId;
}

// @ai-start
/**
 * The result of loadTrackAtIndex. `false`: superseded. 'played': the service
 * called player.play(). 'loaded': the track loaded and did not play (no
 * autoplay, or play() returned false: no player came in time, or a pause
 * cancelled the player wait).
 */
type LoadOutcome = false | 'loaded' | 'played';

/**
 * The state that an autoplaying load settles. A load that did not play must
 * not write 'playing' (the same rule as play()). It settles 'ready' over its
 * own 'loading' (or the 'playing' it replaced), and keeps a state that a
 * newer action wrote, for example the 'paused' of a pause() during the wait.
 */
function settledAfterAutoPlay(
  outcome: 'loaded' | 'played',
  current: StorePlaybackState,
): StorePlaybackState {
  if (outcome === 'played') return 'playing';
  return current === 'loading' || current === 'playing' ? 'ready' : current;
}
// @ai-end

/**
 * Helper to load and optionally play a track from the queue.
 *
 * Returns `false` when the operation was superseded mid-flight (a cleanup() or
 * a newer load won the race) — the caller MUST skip its trailing state write in
 * that case so the superseding action's state stands.
 */
async function loadTrackAtIndex(
  tracks: Track[],
  index: number,
  // @ai A function is read after the load ends, so a seek during the load
  // wins over the position from before it (TECH_DEBT #271).
  startAt: number | (() => number) = 0,
  autoPlay = false,
): Promise<LoadOutcome> {
  const track = tracks[index];
  if (!track?.url) {
    if (__DEV__) console.warn('[PlayerStore] No track at index:', index);
    // Not superseded — nothing was loaded, but the caller's op is still the
    // current one, so let it finalize its loading flags as before.
    return 'loaded'; // @ai
  }

  // Claim the op: any older load still awaiting the network is now stale
  // (last legitimate operation wins — matches the optimistic-set ordering).
  const opId = ++playOpId;

  // @ai diag — Redmi play-time JS-thread freeze: bracket the play-path phases so a
  // diagnostic build's breadcrumb timestamps name the blocking step (expo-audio
  // load vs the post-play re-render/PlayerContent mount). No-op unless diagnostics on.
  diagBreadcrumb('play:load-enter', {index, autoPlay});

  if (__DEV__)
    console.log('[PlayerStore] Loading track:', {
      index,
      title: track.title,
      url: track.url.substring(0, 50) + '...',
      startPosition: typeof startAt === 'number' ? startAt : 'after the load', // @ai
      autoPlay,
    });

  // @ai REPORT-ONLY playback-health: this load plays at once, so its attempt
  // counts from the tap. No behaviour change.
  if (autoPlay) notePlaybackAutoPlayLoad(track.url);
  await expoAudioService.loadTrack(track.url);
  diagBreadcrumb('play:load-loadTrack-done', {index});
  if (opId !== playOpId) {
    // cleanup() or a newer load landed while we awaited the network — do NOT
    // seek or play; the superseding action's state is authoritative.
    diagBreadcrumb('play:load-superseded', {index});
    return false;
  }
  // @ai The player reported a load error (TECH_DEBT #271): it holds no
  // source. Do not seek or play; the caller settles 'ready', so Play shows,
  // and the next play() in the app loads the track again.
  if (!expoAudioService.holdsSource(track.url)) return 'loaded';
  const startPosition = typeof startAt === 'function' ? startAt() : startAt; // @ai

  if (startPosition > 0) {
    if (__DEV__)
      console.log('[PlayerStore] PRE-SEEK state:', {
        startPosition,
        isLoaded: expoAudioService.getIsLoaded(),
        duration: expoAudioService.getDuration(),
        currentTime: expoAudioService.getCurrentTime(),
      });
    await expoAudioService.seekTo(startPosition);
    if (__DEV__)
      console.log('[PlayerStore] POST-SEEK state:', {
        currentTime: expoAudioService.getCurrentTime(),
      });
  }

  if (autoPlay) {
    if (opId !== playOpId) {
      // Superseded during the seek await — same contract as above.
      diagBreadcrumb('play:load-superseded', {index});
      return false;
    }
    // @ai play() can wait up to 10 s for setPlayer (PR #425). A cleanup(),
    // a newer load or the removal of the last track during that wait moves
    // the op id: the caller must not write 'playing' over the newer state.
    const played = await expoAudioService.play();
    diagBreadcrumb('play:load-play-done', {index});
    if (opId !== playOpId) {
      diagBreadcrumb('play:load-superseded', {index}); // @ai
      return false; // @ai
    }
    if (__DEV__ && startPosition > 0)
      console.log('[PlayerStore] POST-PLAY state:', {
        currentTime: expoAudioService.getCurrentTime(),
      });
    return played ? 'played' : 'loaded'; // @ai
  }
  return 'loaded'; // @ai
}

export const usePlayerStore = create<PlayerStoreState>()(
  persist(
    (set, get) => ({
      ...createDefaultUnifiedPlayerState(),
      // Add UI state
      sheetMode: 'hidden' as const,
      isImmersive: false,

      // UI Actions
      setSheetMode: (mode: UIState['sheetMode']) => {
        const currentMode = get().sheetMode;
        if (currentMode === mode) return; // Don't update if mode hasn't changed

        if (__DEV__)
          console.log('[PlayerStore] Sheet mode:', {
            from: currentMode,
            to: mode,
          });

        set({sheetMode: mode});
      },

      toggleImmersive: () => {
        set(state => ({isImmersive: !state.isImmersive}));
      },

      setImmersive: (value: boolean) => {
        if (get().isImmersive !== value) {
          set({isImmersive: value});
        }
      },

      // Playback Actions
      play: async () => {
        diagBreadcrumb('playback', {action: 'play'});
        // @ai-start TECH_DEBT #271: the player does not hold the shown track.
        // Examples: a restore that loaded nothing, a load that failed, a
        // queue that hydrated after the restore ran, or a load that still
        // runs (the boot restore, or the load of an earlier tap).
        // player.play() would then show Pause with no audio. So first wait
        // for the running load of that track, or load it at the saved
        // position (no autoplay), and play below only when the player holds
        // it. The play below keeps the early-tap rules (#218 part 5). This
        // never re-loads a source that the player holds (TECH_DEBT #207).
        const {queue} = get();
        const shown = queue.tracks[queue.currentIndex];
        if (shown?.url && !expoAudioService.holdsSource(shown.url)) {
          // A 'loading' state that is gone after the wait means a pause (or
          // another action) during the wait: no play.
          const settleNoPlay = () =>
            set(state => ({
              loading: {...state.loading, trackLoading: false},
              playback:
                state.playback.state === 'loading'
                  ? {...state.playback, state: 'paused' as StorePlaybackState}
                  : state.playback,
            }));
          try {
            set(state => ({
              loading: {...state.loading, trackLoading: true},
              playback: {
                ...state.playback,
                state: 'loading' as StorePlaybackState,
              },
            }));
            const running = expoAudioService.runningLoad(shown.url);
            if (running) {
              const waitOpId = playOpId;
              await running;
              // A newer load or a cleanup() owns the state now.
              if (waitOpId !== playOpId) return;
            } else {
              const loaded = await loadTrackAtIndex(
                queue.tracks,
                queue.currentIndex,
                () => get().playback.position, // @ai read after the load
                false,
              );
              if (!loaded) return; // superseded by cleanup()/a newer load
            }
            if (
              get().playback.state !== 'loading' ||
              !expoAudioService.holdsSource(shown.url)
            ) {
              // A pause during the wait, or the load failed: no play.
              settleNoPlay();
              return;
            }
            set(state => ({
              playback: {
                ...state.playback,
                state: 'paused' as StorePlaybackState,
              },
            }));
          } catch (error) {
            console.error('[PlayerStore] Play (load) failed:', error);
            if (error instanceof Error) {
              set(state => ({error: {...state.error, playback: error}}));
            }
            settleNoPlay();
            return;
          }
        }
        // @ai-end
        // @ai The current op id. A cleanup() or a newer load during the play
        // await moves it (see playOpId above).
        const opId = playOpId;
        try {
          set(state => ({
            loading: {...state.loading, trackLoading: true},
          }));

          audioCoordinator.mainWillPlay();
          // @ai false when no player came in time, or the play was cancelled
          // during the player wait (an early tap before setPlayer).
          const played = await expoAudioService.play();

          // @ai Superseded: the newer action owns the state. Do not write
          // 'playing' over its state, and do not touch its loading flags.
          if (opId !== playOpId) return;

          set(state => ({
            // @ai Write 'playing' only when the service called player.play().
            // That call does not prove that audio is audible. Before this
            // check, a tap before setPlayer showed Pause with no audio.
            playback: played
              ? {...state.playback, state: 'playing' as StorePlaybackState}
              : state.playback,
            loading: {...state.loading, trackLoading: false},
          }));
        } catch (error) {
          console.error('[PlayerStore] Play failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, playback: error},
              loading: {...state.loading, trackLoading: false},
            }));
          }
        }
      },

      pause: async () => {
        diagBreadcrumb('playback', {action: 'pause'});
        try {
          set(state => ({
            loading: {...state.loading, trackLoading: true},
          }));

          await expoAudioService.pause();

          set(state => ({
            playback: {
              ...state.playback,
              state: 'paused' as StorePlaybackState,
            },
            loading: {...state.loading, trackLoading: false},
          }));
        } catch (error) {
          console.error('[PlayerStore] Pause failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, playback: error},
              loading: {...state.loading, trackLoading: false},
            }));
          }
        }
      },

      skipToNext: async () => {
        diagBreadcrumb('playback', {action: 'skipToNext'});
        const state = get();
        const {tracks, currentIndex} = state.queue;
        const {repeatMode} = state.settings;

        // Fire analytics before advancing
        const currentTrack = tracks[currentIndex];
        if (currentTrack?.surahId && !currentTrack.isUserUpload) {
          analyticsService.trackPlaybackSkipped({
            surah_id: parseInt(currentTrack.surahId, 10),
            reciter_id: currentTrack.reciterId,
            reciter_name: currentTrack.reciterName,
            position_ms: Math.round(state.playback.position * 1000),
            listened_ms: Math.round(state.playback.position * 1000),
            direction: 'next',
          });
        }

        try {
          let nextIndex = currentIndex + 1;

          // Handle end of queue
          if (nextIndex >= tracks.length) {
            if (repeatMode === 'queue') {
              nextIndex = 0; // Loop back to start
            } else {
              // End of queue, stay on last track
              if (__DEV__) console.log('[PlayerStore] End of queue reached');
              set(state => ({
                playback: {
                  ...state.playback,
                  state: 'ended' as StorePlaybackState,
                },
              }));
              return;
            }
          }

          // Optimistic update: set currentIndex immediately so UI updates instantly
          set(state => ({
            queue: {...state.queue, currentIndex: nextIndex},
            loading: {...state.loading, trackLoading: true},
            playback: {
              ...state.playback,
              state: 'loading' as StorePlaybackState,
              position: 0,
            },
          }));

          // Load and play the next track
          audioCoordinator.mainWillPlay();
          const stillCurrent = await loadTrackAtIndex(
            tracks,
            nextIndex,
            0,
            true,
          );
          if (!stillCurrent) return; // superseded by cleanup()/a newer load

          set(state => ({
            playback: {
              ...state.playback,
              // @ai 'playing' only when play() played (see settledAfterAutoPlay).
              state: settledAfterAutoPlay(stillCurrent, state.playback.state),
              position: 0,
            },
            loading: {...state.loading, trackLoading: false},
          }));
        } catch (error) {
          console.error('[PlayerStore] Skip to next failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, playback: error},
              loading: {...state.loading, trackLoading: false},
            }));
          }
        }
      },

      skipToPrevious: async () => {
        diagBreadcrumb('playback', {action: 'skipToPrevious'});
        const state = get();
        const {tracks, currentIndex} = state.queue;
        const {repeatMode} = state.settings;
        const position = expoAudioService.getPosition();

        // Fire analytics before going back
        const currentTrack = tracks[currentIndex];
        if (currentTrack?.surahId && !currentTrack.isUserUpload) {
          analyticsService.trackPlaybackSkipped({
            surah_id: parseInt(currentTrack.surahId, 10),
            reciter_id: currentTrack.reciterId,
            reciter_name: currentTrack.reciterName,
            position_ms: Math.round(state.playback.position * 1000),
            listened_ms: Math.round(state.playback.position * 1000),
            direction: 'prev',
          });
        }

        try {
          // If more than 3 seconds into the track, restart it (no index change needed)
          if (position > 3) {
            set(state => ({
              loading: {...state.loading, trackLoading: true},
            }));
            await expoAudioService.seekTo(0);
            set(state => ({
              playback: {...state.playback, position: 0},
              loading: {...state.loading, trackLoading: false},
            }));
            return;
          }

          let prevIndex = currentIndex - 1;

          // Handle start of queue
          if (prevIndex < 0) {
            if (repeatMode === 'queue') {
              prevIndex = tracks.length - 1; // Loop to end
            } else {
              // Start of queue, just restart current track
              set(state => ({
                loading: {...state.loading, trackLoading: true},
              }));
              await expoAudioService.seekTo(0);
              set(state => ({
                playback: {...state.playback, position: 0},
                loading: {...state.loading, trackLoading: false},
              }));
              return;
            }
          }

          // Optimistic update: set currentIndex immediately so UI updates instantly
          set(state => ({
            queue: {...state.queue, currentIndex: prevIndex},
            loading: {...state.loading, trackLoading: true},
            playback: {
              ...state.playback,
              state: 'loading' as StorePlaybackState,
              position: 0,
            },
          }));

          // Load and play the previous track
          audioCoordinator.mainWillPlay();
          const stillCurrent = await loadTrackAtIndex(
            tracks,
            prevIndex,
            0,
            true,
          );
          if (!stillCurrent) return; // superseded by cleanup()/a newer load

          set(state => ({
            playback: {
              ...state.playback,
              // @ai 'playing' only when play() played (see settledAfterAutoPlay).
              state: settledAfterAutoPlay(stillCurrent, state.playback.state),
              position: 0,
            },
            loading: {...state.loading, trackLoading: false},
          }));
        } catch (error) {
          console.error('[PlayerStore] Skip to previous failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, playback: error},
              loading: {...state.loading, trackLoading: false},
            }));
          }
        }
      },

      seekTo: async (position: number) => {
        diagBreadcrumb('playback', {
          action: 'seek',
          position: Math.round(position),
        });
        try {
          const currentTrack = get().queue.tracks[get().queue.currentIndex];
          if (currentTrack?.surahId && !currentTrack.isUserUpload) {
            analyticsService.trackPlaybackSeeked({
              surah_id: parseInt(currentTrack.surahId, 10),
              from_ms: Math.round(get().playback.position * 1000),
              to_ms: Math.round(position * 1000),
            });
          }

          await expoAudioService.seekTo(position);
          set(state => ({
            playback: {...state.playback, position},
          }));
        } catch (error) {
          console.error('[PlayerStore] Seek failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, playback: error},
            }));
          }
        }
      },

      setRate: async (rate: number) => {
        try {
          analyticsService.trackRateChanged({
            old_rate: get().playback.rate,
            new_rate: rate,
          });

          expoAudioService.setRate(rate);
          set(state => ({
            playback: {...state.playback, rate},
          }));
        } catch (error) {
          console.error('[PlayerStore] Set rate failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, playback: error},
            }));
          }
        }
      },

      updateQueue: async (
        tracks: Track[],
        currentIndex = 0,
        startPosition = 0,
      ) => {
        try {
          diagBreadcrumb('play:updateQueue-enter', {
            n: tracks.length,
            currentIndex,
          });
          if (__DEV__)
            console.log('[PlayerStore] Updating queue:', {
              tracksCount: tracks.length,
              currentIndex,
              startPosition,
              firstTrack: tracks[0]?.title,
              targetTrack: tracks[currentIndex]?.title,
            });

          // @ai No track to load at currentIndex (for example an empty list):
          // the queue gets no current track, so stop the audio before the
          // queue write (see pauseForEmptyQueue). The callers check for an
          // empty list, so this is a guard.
          if (
            !(
              tracks.length > 0 &&
              currentIndex >= 0 &&
              currentIndex < tracks.length
            )
          ) {
            const opId = await pauseForEmptyQueue();
            if (opId !== playOpId) return; // a newer load owns the state
            set(state => ({
              queue: {
                ...state.queue,
                tracks,
                currentIndex,
                total: tracks.length,
                loading: false,
                endReached: false,
              },
              loading: {
                ...state.loading,
                queueLoading: false,
                trackLoading: false,
                stateRestoring: false,
              },
              playback: {
                ...state.playback,
                state: 'paused' as StorePlaybackState,
                position: startPosition,
                buffering: false,
              },
            }));
            return;
          }

          // Optimistic update: set queue metadata immediately so UI updates instantly
          set(state => ({
            queue: {
              ...state.queue,
              tracks,
              currentIndex,
              total: tracks.length,
              loading: false,
              endReached: false,
            },
            loading: {
              ...state.loading,
              queueLoading: true,
              trackLoading: true,
              stateRestoring: false,
            },
            playback: {
              ...state.playback,
              state: 'loading' as StorePlaybackState,
              position: startPosition,
            },
          }));
          diagBreadcrumb('play:optimistic-set-done', {currentIndex});

          // Load the track at the specified index and auto-play
          if (
            tracks.length > 0 &&
            currentIndex >= 0 &&
            currentIndex < tracks.length
          ) {
            audioCoordinator.mainWillPlay();
            diagBreadcrumb('play:loadTrack-call', {currentIndex});
            const stillCurrent = await loadTrackAtIndex(
              tracks,
              currentIndex,
              startPosition,
              true,
            );
            diagBreadcrumb('play:loadTrack-returned', {currentIndex});
            // A cleanup() or a newer play landed while the load awaited the
            // network — keep ITS state; writing 'ready' here would report the
            // superseded track as the ready one (or resurrect a playing state
            // over a queue that has already moved on).
            if (!stillCurrent) return;
          }

          set(state => ({
            loading: {
              ...state.loading,
              queueLoading: false,
              stateRestoring: false,
              trackLoading: false,
            },
            playback: {
              ...state.playback,
              state: 'ready' as StorePlaybackState,
              position: startPosition,
              duration: expoAudioService.getDuration() || 0,
              buffering: false,
            },
          }));

          if (__DEV__) console.log('[PlayerStore] Queue updated successfully');
        } catch (error) {
          console.error('[PlayerStore] Error updating queue:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, queue: error},
              loading: {
                ...state.loading,
                queueLoading: false,
                stateRestoring: false,
                trackLoading: false,
              },
            }));
          }
        }
      },

      addToQueue: async (tracks: Track[]) => {
        try {
          set(state => ({
            loading: {...state.loading, queueLoading: true},
          }));

          // Just add to our state - expo-audio handles single track playback
          set(state => ({
            queue: {
              ...state.queue,
              tracks: [...state.queue.tracks, ...tracks],
              total: state.queue.tracks.length + tracks.length,
            },
            loading: {...state.loading, queueLoading: false},
          }));

          if (__DEV__)
            console.log(
              '[PlayerStore] Added',
              tracks.length,
              'tracks to queue',
            );
        } catch (error) {
          console.error('[PlayerStore] Add to queue failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, queue: error},
              loading: {...state.loading, queueLoading: false},
            }));
          }
        }
      },

      removeFromQueue: async (indices: number[]) => {
        try {
          set(state => ({
            loading: {...state.loading, queueLoading: true},
          }));

          const sortedIndices = [...indices].sort((a, b) => b - a);
          const state = get();
          const tracks = [...state.queue.tracks];
          let newCurrentIndex = state.queue.currentIndex;
          // @ai Read the autoplay intent before the reload starts (#237).
          // Only the autoplaying loads (updateQueue, skipToNext,
          // skipToPrevious, and play() when it loads first, #271) write
          // 'loading'. So 'loading' means that a load
          // which plays is in flight, and this reload supersedes it. Before,
          // only 'playing' counted, so the replacement track loaded paused.
          const autoPlay =
            state.playback.state === 'playing' ||
            state.playback.state === 'loading';
          // @ai The outcome of the reload, or null when nothing reloaded.
          let reloaded: 'loaded' | 'played' | null = null;

          for (const index of sortedIndices) {
            if (index >= 0 && index < tracks.length) {
              tracks.splice(index, 1);

              // Adjust currentIndex
              if (index < newCurrentIndex) {
                newCurrentIndex--;
              } else if (index === newCurrentIndex) {
                // Current track was removed - load next or previous
                if (newCurrentIndex >= tracks.length) {
                  newCurrentIndex = tracks.length - 1;
                }
                if (tracks.length > 0) {
                  const stillCurrent = await loadTrackAtIndex(
                    tracks,
                    newCurrentIndex,
                    0,
                    autoPlay,
                  );
                  // Superseded by cleanup()/a newer load — bail before the
                  // trailing set() below re-writes queue.tracks (that would
                  // resurrect the queue the superseding action replaced).
                  if (!stillCurrent) return;
                  reloaded = stillCurrent; // @ai
                }
              }
            }
          }

          // @ai The removal left no track: the only track, or the last
          // tracks with the current one. Stop the audio before the
          // empty-queue write (see pauseForEmptyQueue). Before, nothing
          // paused, and the state stayed 'playing' with no player shown.
          const emptied = tracks.length === 0 && state.queue.tracks.length > 0;
          if (emptied) {
            const opId = await pauseForEmptyQueue();
            if (opId !== playOpId) return; // a newer load owns the queue
          }

          // @ai The state that this op settles, or null when it leaves the
          // state to the op that owns it (no reload, nothing emptied). An
          // autoplaying reload writes 'playing' only when play() played.
          let settled: StorePlaybackState | null = null;
          if (emptied) settled = 'paused';
          else if (reloaded)
            settled = autoPlay
              ? settledAfterAutoPlay(reloaded, get().playback.state)
              : 'ready';

          set(state => ({
            queue: {
              ...state.queue,
              tracks,
              total: tracks.length,
              currentIndex: Math.max(0, newCurrentIndex),
            },
            loading: {
              ...state.loading,
              queueLoading: false,
              // @ai The winning op clears all loading state (#237). A skip
              // that this reload superseded returned before its own clear,
              // so without this, trackLoading stayed true (the player
              // controls stayed disabled) and the state stayed 'loading'
              // (ExpoAudioProvider skips its status sync in that state).
              ...(settled ? {trackLoading: false} : {}),
            },
            ...(settled
              ? {playback: {...state.playback, state: settled, position: 0}}
              : {}),
          }));
        } catch (error) {
          console.error('[PlayerStore] Remove from queue failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, queue: error},
              // @ai A failed reload must not leave the controls disabled
              // (#237), the same as the catch in the other load paths.
              loading: {
                ...state.loading,
                queueLoading: false,
                trackLoading: false,
              },
            }));
          }
        }
      },

      moveInQueue: async (fromIndex: number, toIndex: number) => {
        try {
          set(state => ({
            loading: {...state.loading, queueLoading: true},
          }));

          set(state => {
            const tracks = [...state.queue.tracks];
            const [movedTrack] = tracks.splice(fromIndex, 1);
            tracks.splice(toIndex, 0, movedTrack);

            let newCurrentIndex = state.queue.currentIndex;
            if (state.queue.currentIndex === fromIndex) {
              newCurrentIndex = toIndex;
            } else if (
              fromIndex < state.queue.currentIndex &&
              toIndex >= state.queue.currentIndex
            ) {
              newCurrentIndex--;
            } else if (
              fromIndex > state.queue.currentIndex &&
              toIndex <= state.queue.currentIndex
            ) {
              newCurrentIndex++;
            }

            return {
              queue: {
                ...state.queue,
                tracks,
                currentIndex: newCurrentIndex,
              },
              loading: {...state.loading, queueLoading: false},
            };
          });
        } catch (error) {
          console.error('[PlayerStore] Move in queue failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, queue: error},
              loading: {...state.loading, queueLoading: false},
            }));
          }
        }
      },

      setRepeatMode: (mode: PlaybackSettings['repeatMode']) => {
        // Just update store state - expo-audio doesn't have native repeat mode
        // Repeat logic is handled in skipToNext/handleTrackEnd
        set(state => ({
          settings: {...state.settings, repeatMode: mode},
        }));
        if (__DEV__) console.log('[PlayerStore] Repeat mode set to:', mode);
      },

      toggleShuffle: () => {
        const state = get();
        const newShuffleState = !state.settings.shuffle;

        set(prevState => ({
          settings: {...prevState.settings, shuffle: newShuffleState},
        }));

        if (__DEV__)
          console.log('[PlayerStore] Shuffle toggled to:', newShuffleState);

        // TODO: Implement shuffle logic - shuffle the queue tracks
        // For now, shuffle state is stored but not applied
      },

      setSleepTimer: (minutes: number) => {
        if (__DEV__)
          console.log('[PlayerStore] Setting sleep timer:', minutes, 'minutes');

        const state = get();

        // Clear any existing timer
        if (
          typeof state.settings.sleepTimerInterval === 'object' &&
          state.settings.sleepTimerInterval
        ) {
          clearInterval(state.settings.sleepTimerInterval as NodeJS.Timeout);
        }

        if (minutes === 0) {
          set(currentState => ({
            settings: {
              ...currentState.settings,
              sleepTimer: 0,
              sleepTimerEnd: null,
              sleepTimerInterval: null,
            },
          }));
          return;
        }

        // Calculate when the timer should end
        const milliseconds = Math.round(minutes * 60 * 1000);
        const sleepTimerEnd = Date.now() + milliseconds;

        // Create an interval that checks if the timer has expired
        const interval = setInterval(async () => {
          const currentState = get();
          const endTime = currentState.settings.sleepTimerEnd;

          if (!endTime) {
            clearInterval(interval);
            return;
          }

          const now = Date.now();
          if (now >= endTime) {
            if (__DEV__)
              console.log(
                '[PlayerStore] Sleep timer expired, pausing playback',
              );
            clearInterval(interval);

            // Pause playback
            try {
              await get().pause();
            } catch (error) {
              console.error(
                '[PlayerStore] Error pausing on sleep timer:',
                error,
              );
            }

            // Clear timer state
            set(prevState => ({
              settings: {
                ...prevState.settings,
                sleepTimer: 0,
                sleepTimerEnd: null,
                sleepTimerInterval: null,
              },
            }));
          }
        }, 1000);

        set(currentState => ({
          settings: {
            ...currentState.settings,
            sleepTimer: minutes,
            sleepTimerEnd: sleepTimerEnd,
            sleepTimerInterval: interval,
          },
        }));
      },

      toggleSkipSilence: () => {
        // Skip silence not supported in expo-audio
        if (__DEV__)
          console.warn(
            '[PlayerStore] Skip silence is not supported with expo-audio',
          );
        set(prevState => ({
          settings: {
            ...prevState.settings,
            skipSilence: !prevState.settings.skipSilence,
          },
        }));
      },

      updatePlaybackState: (playbackState: Partial<PlaybackState>) => {
        set(state => ({
          playback: {...state.playback, ...playbackState},
        }));
      },

      updateQueueState: (queueState: Partial<QueueState>) => {
        set(state => ({
          queue: {...state.queue, ...queueState},
        }));
      },

      updateLoadingState: (loadingState: Partial<LoadingState>) => {
        set(state => ({
          loading: {...state.loading, ...loadingState},
        }));
      },

      setError: (type: keyof ErrorState, error: Error | null) => {
        set(state => ({
          error: {...state.error, [type]: error},
        }));
      },

      reset: () => {
        const defaultState = createDefaultUnifiedPlayerState();
        set(defaultState);
      },

      // Cleanup method
      cleanup: async () => {
        // In-flight loads must not play()/write state into a cleaned service.
        // @ai Then pause the native player before the reset (TECH_DEBT #235).
        // Settings -> Clear cache calls this while audio can play, and the
        // reset empties the queue (see pauseForEmptyQueue).
        await pauseForEmptyQueue();
        const state = get();
        if (
          typeof state.settings.sleepTimerInterval === 'object' &&
          state.settings.sleepTimerInterval
        ) {
          clearInterval(state.settings.sleepTimerInterval as NodeJS.Timeout);
        }
        expoAudioService.cleanup();
        set(createDefaultUnifiedPlayerState());
      },
    }),
    {
      name: STORAGE_KEY,
      storage: guardedJSONStorage(STORAGE_KEY),
      partialize: state => ({
        settings: {
          ...state.settings,
          // Don't persist the interval object
          sleepTimerInterval: null,
        },
        // Persist queue so uploads survive app restart
        queue: {
          tracks: state.queue.tracks,
          currentIndex: state.queue.currentIndex,
          total: state.queue.total,
          loading: false,
          endReached: false,
        },
        // Persist playback position/duration for resume
        playback: {
          state: 'paused' as const,
          position: state.playback.position,
          duration: state.playback.duration,
          rate: state.playback.rate,
          buffering: false,
        },
      }),
      onRehydrateStorage: () => state => {
        if (!state) return;
        const tracks = state.queue?.tracks ?? [];
        const hasStaleUrls = tracks.some(
          t => t.url.includes('mp3quran.net') || t.url.includes('supabase.co'),
        );
        if (hasStaleUrls) {
          console.log('[PlayerStore] Clearing stale URLs from persisted queue');
          state.queue = {...state.queue, tracks: [], currentIndex: 0, total: 0};
        }
      },
    },
  ),
);

// Export singleton instance for use in service worker
export const playerStore = usePlayerStore;

// @ai TECH_DEBT #271: a load that timed out counts as held, so Play can start
// it; when the player then reports an error, it holds no source. If the store
// shows that track as playing, show Play again, so the next Play in the app
// loads it. No reload here (TECH_DEBT #207). Test mocks of the service may
// not have the method.
expoAudioService.setSourceLostHandler?.(url => {
  const {queue, playback} = usePlayerStore.getState();
  if (queue.tracks[queue.currentIndex]?.url !== url) return;
  if (playback.state !== 'playing' && playback.state !== 'buffering') return;
  usePlayerStore.setState(state => ({
    playback: {...state.playback, state: 'paused', buffering: false},
  }));
});

export const updateQueue = async (tracks: Track[], targetIndex: number) => {
  const store = usePlayerStore.getState();
  try {
    store.updateLoadingState({
      queueLoading: true,
      stateRestoring: false,
      trackLoading: false,
    });

    // Update store state
    store.updateQueueState({
      tracks,
      currentIndex: targetIndex,
    });

    // Load the target track
    if (tracks.length > 0 && targetIndex >= 0 && targetIndex < tracks.length) {
      const stillCurrent = await loadTrackAtIndex(
        tracks,
        targetIndex,
        0,
        false,
      );
      if (!stillCurrent) return; // superseded — its owner manages the flags
    }

    store.updateLoadingState({
      queueLoading: false,
      stateRestoring: false,
      trackLoading: false,
    });
  } catch (error) {
    console.error('[PlayerStore] Error updating queue:', error);
    store.updateLoadingState({
      queueLoading: false,
      stateRestoring: false,
      trackLoading: false,
    });
    throw error;
  }
};
