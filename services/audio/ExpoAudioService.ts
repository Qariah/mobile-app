/**
 * ExpoAudioService - Core expo-audio wrapper
 *
 * This is a singleton service that manages audio playback using expo-audio.
 * It handles basic playback: play/pause/seek/rate operations.
 * Queue management is handled by playerStore.
 */

import {
  setAudioModeAsync,
  AudioPlayer,
  AudioSource,
  type AudioStatus,
} from 'expo-audio';
import {
  notePlaybackLoad,
  notePlaybackPaused,
  notePlaybackPlayRequested,
} from '@/services/diagnostics/playbackHealth';

type PlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'error';

interface ExpoAudioServiceState {
  isInitialized: boolean;
  playbackState: PlaybackState;
  error: Error | null;
}

type StateListener = (state: ExpoAudioServiceState) => void;

/** @ai Cold-start loads and taps can arrive before ExpoAudioProvider injects the player: wait this long. */
export const PLAYER_WAIT_MS = 10000;

/** @ai The end of a load wait. */
type LoadWaitResult = 'loaded' | 'error' | 'timeout';

class ExpoAudioService {
  private static instance: ExpoAudioService;
  private player: AudioPlayer | null = null;
  private playerWaiters: Array<() => void> = [];
  // @ai Bumped by each loadTrack() and cleanup(): a load that waited for the player is stale if it changed.
  private loadGeneration = 0;
  // @ai Bumped by each pause(): a play() that waited for the player is stale if it changed.
  private pauseGeneration = 0;
  private isInitialized = false;
  // @ai The source the player holds; cleared on a load error (TECH_DEBT #271).
  private currentUrl: string | null = null;
  // @ai The running load and its settle promise, for runningLoad().
  private loadingUrl: string | null = null;
  private loadingDone: Promise<void> | null = null;
  // @ai Players that already had a source; a status for a new player cannot be stale (QP-07).
  private sourcedPlayers = new WeakSet<AudioPlayer>();
  // @ai Called when a timed-out load reports an error later. cleanup() keeps it.
  private sourceLostHandler: ((url: string) => void) | null = null;
  // @ai TECH_DEBT #277: told when a load of a URL ends (with or without a source) and on a late error.
  // cleanup() keeps them: LockScreenService subscribes once, at startSync().
  private sourceListeners = new Set<(url: string) => void>();
  private stateListeners: Set<StateListener> = new Set();
  private playbackState: PlaybackState = 'idle';
  private lastError: Error | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): ExpoAudioService {
    if (!ExpoAudioService.instance) {
      ExpoAudioService.instance = new ExpoAudioService();
    }
    return ExpoAudioService.instance;
  }

  // ========== INITIALIZATION ==========

  /**
   * Initialize audio mode for background playback.
   * Should be called once during app startup.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      if (__DEV__) console.log('[ExpoAudioService] Already initialized');
      return;
    }

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });

      this.isInitialized = true;
      if (__DEV__) console.log('[ExpoAudioService] Initialized successfully');
    } catch (error) {
      console.error('[ExpoAudioService] Initialization failed:', error);
      this.lastError =
        error instanceof Error ? error : new Error(String(error));
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Check if the service is initialized
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  // ========== PLAYER MANAGEMENT ==========

  /**
   * Set the player instance from the useAudioPlayer hook.
   * This must be called from a React component that uses useAudioPlayer.
   */
  setPlayer(player: AudioPlayer): void {
    this.player = player;
    const waiters = this.playerWaiters;
    this.playerWaiters = [];
    waiters.forEach(resolve => resolve());
    if (__DEV__) console.log('[ExpoAudioService] Player instance set');
  }

  /** Resolves once a player is set, or after timeoutMs at the latest. */
  waitForPlayer(timeoutMs: number): Promise<void> {
    if (this.player) return Promise.resolve();
    return new Promise<void>(resolve => {
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.playerWaiters = this.playerWaiters.filter(w => w !== done);
        resolve();
      }, timeoutMs);
      this.playerWaiters.push(done);
    });
  }

  /**
   * Get the current player instance
   */
  getPlayer(): AudioPlayer | null {
    return this.player;
  }

  /**
   * Check if player is ready
   */
  hasPlayer(): boolean {
    return this.player !== null;
  }

  /** @ai The current load generation; restoreSession compares it to detect a newer load or a cleanup(). */
  getLoadGeneration(): number {
    return this.loadGeneration;
  }

  // ========== TRACK LOADING ==========

  /**
   * Load a track from a URL.
   * Uses the player's replace method to load new audio.
   */
  loadTrack(url: string): Promise<void> {
    const load = this.loadSource(url);
    // @ai For runningLoad(): settles when the load ends, never rejects.
    this.loadingDone = load.then(
      () => undefined,
      () => undefined,
    );
    return load;
  }

  private async loadSource(url: string): Promise<void> {
    // @ai REPORT-ONLY playback-health. Before the player check, so a load that throws still counts.
    notePlaybackLoad(url);

    // @ai Boot order: wait for ExpoAudioProvider to inject the player instead of failing the load.
    const generation = ++this.loadGeneration;
    this.loadingUrl = url; // @ai
    if (!this.player) {
      await this.waitForPlayer(PLAYER_WAIT_MS);
      // @ai A newer loadTrack() or cleanup() owns the player now: this stale load must not replace().
      if (generation !== this.loadGeneration) return;
    }

    if (!this.player) {
      this.loadingUrl = null; // @ai
      this.notifySource(url); // @ai TECH_DEBT #277
      throw new Error(
        '[ExpoAudioService] Player not set. Call setPlayer first.',
      );
    }

    try {
      this.playbackState = 'loading';
      this.notifyListeners();

      if (__DEV__) console.log('[ExpoAudioService] Loading track:', url);

      // Create the audio source
      const source: AudioSource = {uri: url};

      // Arm the readiness wait BEFORE replace(). Never poll player.isLoaded: it blocks the JS thread.
      // @ai QP-07: record before replace() whether this is the player's first source.
      const firstSource = !this.sourcedPlayers.has(this.player);
      this.sourcedPlayers.add(this.player);
      // @ai A late load error forgets the source, so a later play() loads it again (TECH_DEBT #271).
      const ready = this.waitForLoaded(
        5000,
        () => {
          if (generation === this.loadGeneration && this.currentUrl === url) {
            this.currentUrl = null;
            this.sourceLostHandler?.(url);
            this.notifySource(url); // @ai TECH_DEBT #277
          }
        },
        firstSource, // @ai QP-07
      );

      // Replace current audio with new source
      await this.player.replace(source);

      // Wait for the player to be fully loaded (with timeout)
      const result = await ready; // @ai

      // @ai A newer loadTrack() or cleanup() owns the state: this stale load writes nothing.
      if (generation !== this.loadGeneration) return;

      this.loadingUrl = null; // @ai
      // @ai-start A load error: record no source so the next play() reloads (TECH_DEBT #271). Do not throw.
      if (result === 'error') {
        this.currentUrl = null;
        this.playbackState = 'error';
        this.lastError = new Error(`[ExpoAudioService] Load failed: ${url}`);
        this.notifyListeners();
        this.notifySource(url); // @ai TECH_DEBT #277
        return;
      }
      // @ai-end

      this.currentUrl = url;
      // @ai Keep 'playing' if a play() landed during the load. Use the getter: TS narrowing misses that write.
      if (this.getPlaybackState() !== 'playing') this.playbackState = 'ready';
      this.lastError = null;
      this.notifyListeners();
      this.notifySource(url); // @ai TECH_DEBT #277

      if (__DEV__)
        console.log(
          '[ExpoAudioService] Track loaded successfully, duration:',
          this.getDuration(),
        );
    } catch (error) {
      console.error('[ExpoAudioService] Failed to load track:', error);
      // @ai Only the current load reports its failure.
      if (generation === this.loadGeneration) {
        this.loadingUrl = null;
        this.playbackState = 'error';
        this.lastError =
          error instanceof Error ? error : new Error(String(error));
        this.notifyListeners();
        this.notifySource(url); // @ai TECH_DEBT #277
      }
      throw error;
    }
  }

  /**
   * Wait for the player to be loaded with a timeout.
   * @ai Event-driven: call it BEFORE `replace()`. Never read `player.isLoaded`: the sync getter blocks
   * the JS thread. After a timeout it keeps listening and calls `onLateError` on a late error.
   */
  private waitForLoaded(
    timeoutMs = 5000,
    onLateError?: () => void,
    firstSource = false, // @ai QP-07
  ): Promise<LoadWaitResult> {
    const player = this.player;
    if (!player) return Promise.resolve('timeout'); // @ai

    return new Promise<LoadWaitResult>(resolve => {
      let settled = false;
      // @ai-start QP-07: a first source needs no isLoaded:false first (iOS never sends one after replace()).
      let seenUnloaded = firstSource;
      // @ai-end
      // @ai After a timeout the listener stays for a late error.
      let watchLate = false;
      // @ai An error inside the grace window, before isLoaded:false, can belong to the PREVIOUS source.
      let earlyError = false;
      const armedAt = Date.now();
      // Wait for isLoaded:false before isLoaded:true (a stale status can carry the PREVIOUS
      // track's isLoaded:true); after this grace window, accept the next true anyway.
      const acceptStaleAfterMs = 500;

      const removeListener = (): void => {
        watchLate = false;
        try {
          sub.remove();
        } catch {
          // listener already gone; ignore
        }
      };

      const finish = (result: LoadWaitResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result === 'timeout' && onLateError) watchLate = true;
        else removeListener();
        resolve(result);
      };

      const timer = setTimeout(() => {
        if (__DEV__) {
          console.warn('[ExpoAudioService] Timeout waiting for track to load');
        }
        finish(earlyError ? 'error' : 'timeout'); // @ai
      }, timeoutMs);

      const sub = player.addListener(
        'playbackStatusUpdate',
        (status: AudioStatus) => {
          // @ai-start expo-audio sends an untyped `error` key when the source fails to load.
          const failed = !!(status as {error?: unknown} | undefined)?.error;
          if (watchLate) {
            // The load timed out: a later error or isLoaded ends the watch.
            if (failed) {
              removeListener();
              onLateError?.();
            } else if (status?.isLoaded) {
              removeListener();
            }
            return;
          }
          if (failed) {
            if (!seenUnloaded && Date.now() - armedAt < acceptStaleAfterMs) {
              earlyError = true;
              return;
            }
            finish('error');
            return;
          }
          // @ai-end
          if (!status?.isLoaded) {
            seenUnloaded = true;
            earlyError = false; // @ai The new source loads: that error was old.
            return;
          }
          if (seenUnloaded || Date.now() - armedAt >= acceptStaleAfterMs) {
            finish('loaded');
          }
        },
      );
    });
  }

  /**
   * Get the currently loaded track URL
   */
  getCurrentUrl(): string | null {
    return this.currentUrl;
  }

  /** @ai Hears of a source lost after its load timed out (#271). It must not reload the source (#207). */
  setSourceLostHandler(handler: ((url: string) => void) | null): void {
    this.sourceLostHandler = handler;
  }

  /** @ai True when `url` loaded with no error (TECH_DEBT #271); false while it still loads. */
  holdsSource(url: string): boolean {
    return this.currentUrl === url;
  }

  /** @ai While a load of `url` runs, a promise that settles when it ends; otherwise null (TECH_DEBT #271). */
  runningLoad(url: string): Promise<void> | null {
    return this.loadingUrl === url ? this.loadingDone : null;
  }

  /**
   * @ai TECH_DEBT #277: hears when a load of a URL ends, with a source or without one, and when a late
   * error loses the source. The listener reads holdsSource() for the result. Returns the unsubscribe.
   */
  addSourceListener(listener: (url: string) => void): () => void {
    this.sourceListeners.add(listener);
    return () => {
      this.sourceListeners.delete(listener);
    };
  }

  private notifySource(url: string): void {
    this.sourceListeners.forEach(listener => {
      try {
        listener(url);
      } catch (error) {
        // A listener must not break the load.
        if (__DEV__)
          console.warn('[ExpoAudioService] Source listener failed:', error);
      }
    });
  }

  // ========== PLAYBACK CONTROLS ==========

  /**
   * Start playback.
   * @ai False when no player came or the play was cancelled during the wait: check it before 'playing'.
   */
  async play(): Promise<boolean> {
    if (!this.player) {
      // @ai Early tap: the UI renders before setPlayer(), so wait for the player as loadTrack() does.
      const loadGeneration = this.loadGeneration;
      const pauseGeneration = this.pauseGeneration;
      await this.waitForPlayer(PLAYER_WAIT_MS);
      // @ai A pause, cleanup() or newer loadTrack() during the wait cancels this play.
      if (
        loadGeneration !== this.loadGeneration ||
        pauseGeneration !== this.pauseGeneration
      ) {
        return false;
      }
      if (!this.player) {
        if (__DEV__) console.warn('[ExpoAudioService] Cannot play: no player');
        return false;
      }
    }

    // @ai REPORT-ONLY playback-health. The reader returns a field, never a native player property.
    notePlaybackPlayRequested(() => this.playbackState);

    try {
      await this.player.play();
      this.playbackState = 'playing';
      this.notifyListeners();
      if (__DEV__) console.log('[ExpoAudioService] Playing');
      return true;
    } catch (error) {
      console.error('[ExpoAudioService] Play failed:', error);
      this.playbackState = 'error';
      this.lastError =
        error instanceof Error ? error : new Error(String(error));
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Pause playback
   */
  async pause(): Promise<void> {
    // @ai Before the player check: a pause must still cancel a play() that waits for the player.
    this.pauseGeneration++;
    if (!this.player) {
      if (__DEV__) console.warn('[ExpoAudioService] Cannot pause: no player');
      return;
    }

    // @ai REPORT-ONLY playback-health: a pause or stop ends the attempt.
    notePlaybackPaused();

    try {
      await this.player.pause();
      this.playbackState = 'paused';
      this.notifyListeners();
      if (__DEV__) console.log('[ExpoAudioService] Paused');
    } catch (error) {
      console.error('[ExpoAudioService] Pause failed:', error);
      throw error;
    }
  }

  /**
   * Toggle play/pause
   */
  async togglePlayPause(): Promise<void> {
    if (this.player?.playing) {
      await this.pause();
    } else {
      await this.play();
    }
  }

  /**
   * Seek to a position in seconds
   */
  async seekTo(seconds: number): Promise<void> {
    if (!this.player) {
      if (__DEV__) console.warn('[ExpoAudioService] Cannot seek: no player');
      return;
    }

    try {
      // Only clamp to duration if duration is known (> 0)
      // Otherwise just clamp to non-negative value
      const duration = this.getDuration();
      const clampedSeconds =
        duration > 0
          ? Math.max(0, Math.min(seconds, duration))
          : Math.max(0, seconds);
      await this.player.seekTo(clampedSeconds);
      if (__DEV__) console.log('[ExpoAudioService] Seeked to:', clampedSeconds);
    } catch (error) {
      console.error('[ExpoAudioService] Seek failed:', error);
      throw error;
    }
  }

  /**
   * Seek forward by a number of seconds
   */
  async seekForward(seconds = 15): Promise<void> {
    const newPosition = this.getCurrentTime() + seconds;
    await this.seekTo(newPosition);
  }

  /**
   * Seek backward by a number of seconds
   */
  async seekBackward(seconds = 15): Promise<void> {
    const newPosition = this.getCurrentTime() - seconds;
    await this.seekTo(newPosition);
  }

  // ========== PLAYBACK SETTINGS ==========

  /**
   * Set playback rate (0.5 to 2.0)
   * Also enables pitch correction so audio doesn't sound distorted
   */
  setRate(rate: number): void {
    if (!this.player) {
      if (__DEV__)
        console.warn('[ExpoAudioService] Cannot set rate: no player');
      return;
    }

    // Clamp to valid range (expo-audio supports 0.1 to 2.0)
    const clampedRate = Math.max(0.5, Math.min(2.0, rate));
    // Use setPlaybackRate method with 'high' pitch correction quality
    this.player.setPlaybackRate(clampedRate, 'high');
    if (__DEV__) console.log('[ExpoAudioService] Rate set to:', clampedRate);
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    if (!this.player) {
      if (__DEV__)
        console.warn('[ExpoAudioService] Cannot set volume: no player');
      return;
    }

    // Clamp to valid range
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.player.volume = clampedVolume;
    if (__DEV__)
      console.log('[ExpoAudioService] Volume set to:', clampedVolume);
  }

  /**
   * Mute the player
   */
  setMuted(muted: boolean): void {
    if (!this.player) {
      if (__DEV__) console.warn('[ExpoAudioService] Cannot mute: no player');
      return;
    }

    this.player.muted = muted;
    if (__DEV__) console.log('[ExpoAudioService] Muted:', muted);
  }

  // ========== STATUS GETTERS ==========

  /**
   * Get current playback position in seconds
   */
  getCurrentTime(): number {
    return this.player?.currentTime ?? 0;
  }

  /**
   * Alias for getCurrentTime - for compatibility with queue manager
   */
  getPosition(): number {
    return this.getCurrentTime();
  }

  /**
   * Get total duration in seconds
   */
  getDuration(): number {
    return this.player?.duration ?? 0;
  }

  /**
   * Check if currently playing
   */
  getIsPlaying(): boolean {
    return this.player?.playing ?? false;
  }

  /**
   * Check if track is loaded and ready
   */
  getIsLoaded(): boolean {
    return this.player?.isLoaded ?? false;
  }

  /**
   * Check if currently buffering
   */
  getIsBuffering(): boolean {
    return this.player?.isBuffering ?? false;
  }

  /**
   * Get current playback rate
   */
  getPlaybackRate(): number {
    return this.player?.playbackRate ?? 1;
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.player?.volume ?? 1;
  }

  /**
   * Get current playback state
   */
  getPlaybackState(): PlaybackState {
    return this.playbackState;
  }

  /**
   * Get last error if any
   */
  getLastError(): Error | null {
    return this.lastError;
  }

  // ========== STATE LISTENERS ==========

  /**
   * Subscribe to state changes
   */
  addStateListener(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private notifyListeners(): void {
    const state: ExpoAudioServiceState = {
      isInitialized: this.isInitialized,
      playbackState: this.playbackState,
      error: this.lastError,
    };
    this.stateListeners.forEach(listener => listener(state));
  }

  // ========== CLEANUP ==========

  /**
   * Clean up resources
   */
  cleanup(): void {
    // @ai REPORT-ONLY playback-health: a torn-down player ends the attempt.
    notePlaybackPaused();
    // @ai Keep the player: ExpoAudioProvider injects it only once, on mount. End a waiting load's claim.
    this.loadGeneration++;
    this.currentUrl = null;
    this.loadingUrl = null; // @ai
    this.playbackState = 'idle';
    this.lastError = null;
    this.stateListeners.clear();
    if (__DEV__) console.log('[ExpoAudioService] Cleaned up');
  }

  /**
   * Reset the service (useful for testing)
   */
  reset(): void {
    this.cleanup();
    this.isInitialized = false;
    // @ai Test isolation only: drop the player and release any waiting load.
    this.player = null;
    const waiters = this.playerWaiters;
    this.playerWaiters = [];
    waiters.forEach(release => release());
  }
}

// Export singleton instance
export const expoAudioService = ExpoAudioService.getInstance();

// Export class for testing
export {ExpoAudioService};

// Export types
export type {PlaybackState, ExpoAudioServiceState, StateListener};
