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
  stop: () => Promise<void>;
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

// @ai #266 review fix — monotonic id for the in-flight play operation.
// Every loadTrackAtIndex() claims a fresh id at entry; stop()/cleanup() bump
// it via invalidatePlayOps(). Without this, a stop() fired while updateQueue()
// (or a skip) is awaiting the network re-creates ghost playback: the load's
// play() lands AFTER stop()'s pause (audible audio, empty queue, hidden
// mini-player, cleared lock screen) and the caller's trailing set() clobbers
// the 'stopped' state. loadTrackAtIndex re-checks the id after each await and
// returns false when superseded so callers skip their trailing state writes.
let playOpId = 0;

/** Invalidate any in-flight loadTrackAtIndex (see playOpId above). */
function invalidatePlayOps(): void {
  playOpId++;
}

/**
 * Helper to load and optionally play a track from the queue.
 *
 * Returns `false` when the operation was superseded mid-flight (a stop(),
 * cleanup(), or newer load won the race) — the caller MUST skip its trailing
 * state write in that case so the superseding action's state stands.
 */
async function loadTrackAtIndex(
  tracks: Track[],
  index: number,
  startPosition = 0,
  autoPlay = false,
): Promise<boolean> {
  const track = tracks[index];
  if (!track?.url) {
    if (__DEV__) console.warn('[PlayerStore] No track at index:', index);
    // Not superseded — nothing was loaded, but the caller's op is still the
    // current one, so let it finalize its loading flags as before.
    return true;
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
      startPosition,
      autoPlay,
    });

  // @ai REPORT-ONLY playback-health: this load plays at once, so its attempt
  // counts from the tap. No behaviour change.
  if (autoPlay) notePlaybackAutoPlayLoad(track.url);
  await expoAudioService.loadTrack(track.url);
  diagBreadcrumb('play:load-loadTrack-done', {index});
  if (opId !== playOpId) {
    // stop()/cleanup() or a newer load landed while we awaited the network —
    // do NOT seek or play; the superseding action's state is authoritative.
    diagBreadcrumb('play:load-superseded', {index});
    return false;
  }

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
    await expoAudioService.play();
    diagBreadcrumb('play:load-play-done', {index});
    if (__DEV__ && startPosition > 0)
      console.log('[PlayerStore] POST-PLAY state:', {
        currentTime: expoAudioService.getCurrentTime(),
      });
  }
  return true;
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
        try {
          set(state => ({
            loading: {...state.loading, trackLoading: true},
          }));

          audioCoordinator.mainWillPlay();
          await expoAudioService.play();

          set(state => ({
            playback: {
              ...state.playback,
              state: 'playing' as StorePlaybackState,
            },
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

      // Stop playback and dismiss the mini-player (#266). There is no native
      // "stop" distinct from pause — `expoAudioService.pause()` is what halts
      // audio (same call `pause()` above makes) — so this pauses, deactivates
      // the OS media session, then clears the queue. MiniPlayer/FloatingPlayer
      // gate their visibility on `currentTrack` (`queue.tracks[currentIndex]`),
      // so an emptied queue hides them; the player reappears the next time
      // something is queued and played.
      //
      // Why NOT remove() the native player (unlike mushafPlayerStore.stop()):
      // the main AudioPlayer is a persistent `useAudioPlayer(null)` hook
      // instance injected once via `expoAudioService.setPlayer()` on
      // ExpoAudioProvider mount, and `loadTrack()` reuses it via
      // `player.replace()`. There is no re-init path in `play()`/`updateQueue()`
      // (mushaf, by contrast, `createAudioPlayer()`s a fresh player on every
      // `loadSurah`), so `remove()`ing it would break the NEXT play. Instead we
      // pause it and deactivate its lock-screen controls — that leaves no live
      // media session to resume from ("ghost playback"), and `replace()` on the
      // next play re-arms it.
      //
      // Deliberately narrow: playback settings (repeat/shuffle/sleep timer) and
      // other stores (e.g. recently-played history) are left untouched — this
      // dismisses the current track, it doesn't reset preferences.
      stop: async () => {
        diagBreadcrumb('playback', {action: 'stop'});
        // Invalidate any in-flight loadTrackAtIndex FIRST (synchronously,
        // before the pause await) so a load still waiting on the network
        // can't play() after our pause or let its caller overwrite the
        // 'stopped' state below (#266 close-button vs in-flight-load race).
        invalidatePlayOps();
        try {
          await expoAudioService.pause();
        } catch (error) {
          console.error('[PlayerStore] Stop failed to pause audio:', error);
        }

        // Deactivate the main player's lock-screen / media session so there's
        // no remote Play/Seek control left once the queue is empty. Lazy
        // require to dodge the playerStore<->LockScreenService import cycle
        // (LockScreenService imports usePlayerStore) — mirrors AudioCoordinator's
        // lazy mushaf require.
        try {
          const {
            lockScreenService,
          } = require('@/services/audio/LockScreenService');
          lockScreenService.clearMainPlayer();
        } catch (error) {
          if (__DEV__)
            console.warn('[PlayerStore] Stop lock-screen clear failed:', error);
        }

        audioCoordinator.sourceDidStop('main');

        set(state => ({
          playback: {
            ...state.playback,
            state: 'stopped' as StorePlaybackState,
            position: 0,
            duration: 0,
            buffering: false,
          },
          queue: {
            ...state.queue,
            tracks: [],
            currentIndex: -1,
            total: 0,
            loading: false,
            endReached: false,
          },
          loading: {
            ...state.loading,
            trackLoading: false,
            queueLoading: false,
          },
        }));
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
          if (!stillCurrent) return; // superseded by stop()/a newer load

          set(state => ({
            playback: {
              ...state.playback,
              state: 'playing' as StorePlaybackState,
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
          if (!stillCurrent) return; // superseded by stop()/a newer load

          set(state => ({
            playback: {
              ...state.playback,
              state: 'playing' as StorePlaybackState,
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
            // A stop() (mini-player ✕) or newer play landed while the load
            // awaited the network — keep ITS state; writing 'ready' here
            // would leave audio-less 'ready' (or worse, resurrect a playing
            // state over an emptied queue = ghost playback, #266 review).
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
                    state.playback.state === 'playing',
                  );
                  // Superseded by stop()/a newer load — bail before the
                  // trailing set() below re-writes queue.tracks (that would
                  // resurrect a queue stop() just emptied).
                  if (!stillCurrent) return;
                }
              }
            }
          }

          set(state => ({
            queue: {
              ...state.queue,
              tracks,
              total: tracks.length,
              currentIndex: Math.max(0, newCurrentIndex),
            },
            loading: {...state.loading, queueLoading: false},
          }));
        } catch (error) {
          console.error('[PlayerStore] Remove from queue failed:', error);
          if (error instanceof Error) {
            set(state => ({
              error: {...state.error, queue: error},
              loading: {...state.loading, queueLoading: false},
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
        invalidatePlayOps();
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
