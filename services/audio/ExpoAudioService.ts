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

/**
 * @ai How long loadTrack() waits for setPlayer() before it gives up. On a cold
 * start, restoreSession can reach loadTrack() before ExpoAudioProvider mounts
 * and injects the player (planning/boot-restore-player-order-plan.md). The
 * mount takes well under a second on a Pixel 3. The limit only stops a hang
 * when the provider never mounts.
 */
export const PLAYER_WAIT_MS = 10000;

class ExpoAudioService {
  private static instance: ExpoAudioService;
  private player: AudioPlayer | null = null;
  // @ai Loads that wait for setPlayer(). Each entry clears its own timer.
  private playerWaiters: Set<() => void> = new Set();
  // @ai Increments on each loadTrack() and each cleanup(). A load that waited
  // for the player compares it after the wait, to learn if it is stale.
  private loadGeneration = 0;
  private isInitialized = false;
  private currentUrl: string | null = null;
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
    if (__DEV__) console.log('[ExpoAudioService] Player instance set');
    // @ai Release every load that arrived before the player (boot order).
    const waiters = [...this.playerWaiters];
    this.playerWaiters.clear();
    waiters.forEach(release => release());
  }

  /**
   * @ai Resolve when a player exists, or after `timeoutMs`. Never rejects.
   * The caller re-checks `this.player`. A resolved wait leaves no timer.
   */
  private waitForPlayer(timeoutMs: number): Promise<void> {
    if (this.player) return Promise.resolve();
    return new Promise<void>(resolve => {
      const release = (): void => {
        clearTimeout(timer);
        this.playerWaiters.delete(release);
        resolve();
      };
      const timer = setTimeout(release, timeoutMs);
      this.playerWaiters.add(release);
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

  /**
   * @ai The current load generation. restoreSession reads it when it schedules
   * its load, and compares it later to learn if another load or a cleanup()
   * started after that point.
   */
  getLoadGeneration(): number {
    return this.loadGeneration;
  }

  // ========== TRACK LOADING ==========

  /**
   * Load a track from a URL.
   * Uses the player's replace method to load new audio.
   */
  async loadTrack(url: string): Promise<void> {
    // @ai REPORT-ONLY playback-health: a new source ends the previous attempt.
    // Before the player check, so a load that throws still spends the store's
    // load-then-play mark.
    notePlaybackLoad(url);

    // @ai Boot order: wait for ExpoAudioProvider to inject the player instead
    // of failing a load that arrived first. A caller that supersedes the load
    // meanwhile (playerStore playOpId) re-checks after this await as before.
    const generation = ++this.loadGeneration;
    if (!this.player) {
      await this.waitForPlayer(PLAYER_WAIT_MS);
      // @ai A newer loadTrack() or a cleanup() started during the wait. The
      // newer work owns the player, so this stale load must not replace() its
      // source. The callers stop their next step on their own: playerStore
      // through playOpId, restoreSession through restoreStillOwnsPlayer().
      if (generation !== this.loadGeneration) return;
    }

    if (!this.player) {
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

      // Arm the event-driven readiness wait BEFORE replace() so the
      // load->ready transition can't be missed. CRITICAL: never poll
      // this.player.isLoaded — that synchronous getter round-trips through
      // expo-audio's runOnMain -> runBlocking(mainQueue) on the JS thread, and
      // on a slow device with a busy main thread the old poll loop (~110 reads)
      // turned into a multi-second JS-thread hard-lock at play, while audio kept
      // playing on its own native thread (Redmi Note 9 freeze, 2026-06-19).
      const ready = this.waitForLoaded(5000);

      // Replace current audio with new source
      await this.player.replace(source);

      // Wait for the player to report the new source is loaded (event-driven)
      await ready;

      // @ai A newer loadTrack() or a cleanup() started during this load. The
      // newer work owns the service state, so this stale load writes nothing.
      if (generation !== this.loadGeneration) return;

      this.currentUrl = url;
      // @ai A play() that landed during the load already set 'playing' (for
      // example a tap on the restored track during the boot restore load).
      // Do not report the playing source as only 'ready'. Read through the
      // getter: play() can change the field during the awaits above, which
      // TypeScript's narrowing from the 'loading' write does not model.
      if (this.getPlaybackState() !== 'playing') this.playbackState = 'ready';
      this.lastError = null;
      this.notifyListeners();

      if (__DEV__)
        console.log(
          '[ExpoAudioService] Track loaded successfully, duration:',
          this.getDuration(),
        );
    } catch (error) {
      console.error('[ExpoAudioService] Failed to load track:', error);
      // @ai Only the current load reports its failure in the service state.
      if (generation === this.loadGeneration) {
        this.playbackState = 'error';
        this.lastError =
          error instanceof Error ? error : new Error(String(error));
        this.notifyListeners();
      }
      throw error;
    }
  }

  /**
   * Resolve once the player reports the new source is loaded, driven by the
   * native-pushed `playbackStatusUpdate` event. Falls back to a timeout so a
   * failed/slow load can't hang the caller.
   *
   * MUST be called BEFORE `replace()` so the load->ready transition isn't
   * missed. Deliberately does NOT read `this.player.isLoaded`: that synchronous
   * getter round-trips through expo-audio's `runOnMain` -> `runBlocking(
   * mainQueue)` on the JS thread, so the previous busy-poll implementation
   * blocked the JS thread ~110 times against a saturated main thread on slow
   * devices and hard-locked the UI at play (Redmi Note 9, root-caused
   * 2026-06-19). The event is delivered native->JS and never blocks.
   */
  private waitForLoaded(timeoutMs = 5000): Promise<void> {
    const player = this.player;
    if (!player) return Promise.resolve();

    return new Promise<void>(resolve => {
      let settled = false;
      let seenUnloaded = false;
      let sub: {remove: () => void} | undefined;
      const armedAt = Date.now();
      // Prefer to observe an isLoaded:false (the new source has begun loading)
      // before accepting isLoaded:true — otherwise a stale periodic status
      // update carrying the PREVIOUS track's isLoaded:true (expo-audio's ~500ms
      // timer) could resolve us before replace() takes effect, and play() would
      // run on a half-swapped source. This is the old Phase-1 "wait for false
      // first" intent, now event-driven. If no false arrives within the grace
      // window (fast/cached/same-source load that skips BUFFERING), accept the
      // next true anyway rather than stalling until the timeout.
      const acceptStaleAfterMs = 500;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          sub?.remove();
        } catch {
          // listener already gone; ignore
        }
        resolve();
      };

      const timer = setTimeout(() => {
        if (__DEV__) {
          console.warn('[ExpoAudioService] Timeout waiting for track to load');
        }
        finish();
      }, timeoutMs);

      sub = player.addListener(
        'playbackStatusUpdate',
        (status: AudioStatus) => {
          if (!status?.isLoaded) {
            seenUnloaded = true;
            return;
          }
          // isLoaded === true: accept once the new source has confirmed loading
          // (seenUnloaded), or once the stale-status grace window has elapsed.
          if (seenUnloaded || Date.now() - armedAt >= acceptStaleAfterMs) {
            finish();
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

  // ========== PLAYBACK CONTROLS ==========

  /**
   * Start playback
   */
  async play(): Promise<void> {
    if (!this.player) {
      if (__DEV__) console.warn('[ExpoAudioService] Cannot play: no player');
      return;
    }

    // @ai REPORT-ONLY playback-health: the first play after a load is an
    // attempt. The reader returns a field, never a native player property.
    notePlaybackPlayRequested(() => this.playbackState);

    try {
      await this.player.play();
      this.playbackState = 'playing';
      this.notifyListeners();
      if (__DEV__) console.log('[ExpoAudioService] Playing');
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
    // @ai Keep the injected player. It is the persistent useAudioPlayer()
    // instance that ExpoAudioProvider owns. The provider injects it only once,
    // on mount, so a null here made every later load fail until a restart
    // (Settings -> Clear cache calls playerStore.cleanup()). A load that waits
    // for the player is now stale, so end its claim.
    this.loadGeneration++;
    this.currentUrl = null;
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
    // @ai Test isolation only: drop the player (cleanup() keeps it) and end
    // any waiting load now. That load then returns as stale.
    this.player = null;
    [...this.playerWaiters].forEach(release => release());
  }
}

// Export singleton instance
export const expoAudioService = ExpoAudioService.getInstance();

// Export class for testing
export {ExpoAudioService};

// Export types
export type {PlaybackState, ExpoAudioServiceState, StateListener};
