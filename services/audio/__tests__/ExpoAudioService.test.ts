/**
 * Characterization tests for ExpoAudioService — Group A from
 * bayaan-platform/planning/Characterization-Test-Plan.md.
 *
 * These tests lock in current state-machine behavior before any
 * AudioCoordinator / ExpoAudioProvider / LockScreenService refactor begins
 * (RFC-006 onward). They use a per-test `FakeAudioPlayer` that mirrors the
 * slice of expo-audio's AudioPlayer surface that ExpoAudioService.ts actually
 * touches. Once Group B reuses the same fake, it gets promoted into
 * @bayaan/test-utils.
 *
 * See docs/rfcs/005-audio-characterization-tests.md.
 */

// Mock setAudioModeAsync — the only native call ExpoAudioService.initialize()
// makes. The rest of the service flows through the injected FakeAudioPlayer.
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

// @ai The playback-health telemetry hooks are report-only and have their own
// suite (services/diagnostics/__tests__/playbackHealth.test.ts). Mock them
// here: the real module reaches react-native-mmkv, which cannot load in Jest.
jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackLoad: jest.fn(),
  notePlaybackPaused: jest.fn(),
  notePlaybackPlayRequested: jest.fn(),
}));

import {setAudioModeAsync} from 'expo-audio';
import {notePlaybackLoad} from '@/services/diagnostics/playbackHealth';
import {ExpoAudioService} from '../ExpoAudioService';
import type {ExpoAudioServiceState} from '../ExpoAudioService';

/**
 * Test double for expo-audio's AudioPlayer. Exposes the slice of the surface
 * ExpoAudioService.ts uses (replace, play, pause, seekTo, setPlaybackRate,
 * volume, muted, currentTime, duration, playing, isLoaded, isBuffering,
 * playbackRate). Adds `simulate*` drivers for deterministic state changes.
 */
// Minimal subset of expo-audio's playbackStatusUpdate payload that
// waitForLoaded() reads (it only keys on `isLoaded`).
type FakeStatus = {
  isLoaded: boolean;
  duration: number;
  currentTime: number;
  playing: boolean;
};

class FakeAudioPlayer {
  // expo-audio AudioPlayer surface (only what ExpoAudioService consumes)
  isLoaded = false;
  playing = false;
  isBuffering = false;
  currentTime = 0;
  duration = 0;
  playbackRate = 1;
  volume = 1;
  muted = false;

  replace = jest.fn(async (_source: {uri: string}) => {
    // Mimic expo-audio: replace() resets isLoaded then loads the new source.
    // Tests drive the loaded state via simulateLoaded().
    this.isLoaded = false;
    this.currentTime = 0;
    this.duration = 0;
  });

  play = jest.fn(async () => {
    this.playing = true;
  });

  pause = jest.fn(async () => {
    this.playing = false;
  });

  seekTo = jest.fn(async (positionSec: number) => {
    this.currentTime = positionSec;
  });

  setPlaybackRate = jest.fn(
    (rate: number, _quality: 'low' | 'medium' | 'high') => {
      this.playbackRate = rate;
    },
  );

  // --- event surface: expo-audio AudioPlayer.addListener ------------------
  // The event-driven waitForLoaded() (Redmi play-freeze fix, kept after the
  // H1 revert in #227) subscribes to 'playbackStatusUpdate' instead of
  // busy-polling isLoaded; the fake mirrors that contract.
  private statusListeners = new Set<(status: FakeStatus) => void>();

  addListener(
    event: string,
    cb: (status: FakeStatus) => void,
  ): {remove: () => void} {
    if (event === 'playbackStatusUpdate') {
      this.statusListeners.add(cb);
    }
    return {remove: () => void this.statusListeners.delete(cb)};
  }

  private emitStatus(isLoaded: boolean) {
    const status: FakeStatus = {
      isLoaded,
      duration: this.duration,
      currentTime: this.currentTime,
      playing: this.playing,
    };
    for (const cb of [...this.statusListeners]) cb(status);
  }

  // Test driver: mark the player as loaded with a duration. Mirrors expo-audio
  // emitting the new source's false→true `playbackStatusUpdate` edge, which is
  // what waitForLoaded()'s seenUnloaded gate keys on.
  simulateLoaded(durationSec: number) {
    this.isLoaded = true;
    this.duration = durationSec;
    this.emitStatus(false);
    this.emitStatus(true);
  }
}

/**
 * Helper: instantiate the singleton, set a fake player, and return both.
 * `reset()` clears state between tests; the singleton itself can't be
 * re-newed cheaply, so reset+re-setup is the supported pattern (the service
 * exposes `reset()` for exactly this use case — see ExpoAudioService.ts:454).
 */
function makeService(): {service: ExpoAudioService; player: FakeAudioPlayer} {
  const service = ExpoAudioService.getInstance();
  service.reset();
  const player = new FakeAudioPlayer();
  service.setPlayer(
    player as unknown as Parameters<typeof service.setPlayer>[0],
  );
  return {service, player};
}

describe('ExpoAudioService — Group A characterization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------- A1 ---
  it('A1: initialize() is idempotent — second call no-ops', async () => {
    const {service} = makeService();

    await service.initialize();
    expect(service.getIsInitialized()).toBe(true);
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);

    await service.initialize();
    expect(service.getIsInitialized()).toBe(true);
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------- A2 ---
  it('A2: setPlayer() stores the player; calling twice replaces it', () => {
    const service = ExpoAudioService.getInstance();
    service.reset();

    const first = new FakeAudioPlayer();
    service.setPlayer(
      first as unknown as Parameters<typeof service.setPlayer>[0],
    );
    expect(service.getPlayer()).toBe(first);
    expect(service.hasPlayer()).toBe(true);

    const second = new FakeAudioPlayer();
    service.setPlayer(
      second as unknown as Parameters<typeof service.setPlayer>[0],
    );
    expect(service.getPlayer()).toBe(second);
    expect(service.getPlayer()).not.toBe(first);
  });

  // @ai Boot-order race (planning/boot-restore-player-order-plan.md). On a
  // cold start, restoreSession can call loadTrack() before ExpoAudioProvider
  // calls setPlayer(). The load must wait for the player, not throw.
  it('B1: loadTrack() before setPlayer() waits for the player, then loads', async () => {
    const service = ExpoAudioService.getInstance();
    service.reset();
    const url = 'https://cdn.example.test/restore.mp3';

    const load = service.loadTrack(url);
    const settled = jest.fn();
    load.then(settled, settled);
    // Let any immediate rejection reach the handler.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    const player = new FakeAudioPlayer();
    player.replace.mockImplementationOnce(async () => {
      player.isLoaded = false;
      setTimeout(() => player.simulateLoaded(60), 0);
    });
    service.setPlayer(
      player as unknown as Parameters<typeof service.setPlayer>[0],
    );
    await load;

    expect(player.replace).toHaveBeenCalledWith({uri: url});
    expect(service.getCurrentUrl()).toBe(url);
    expect(service.getPlaybackState()).toBe('ready');
    expect(notePlaybackLoad).toHaveBeenCalledWith(url);
  });

  // @ai playback-health: a load that fails must still spend the store's
  // load-then-play mark, so the mark cannot leak to a later load. The error
  // contract stays: no player within the wait -> "Player not set".
  it('B2: loadTrack() rejects with Player not set when no player arrives within the wait', async () => {
    jest.useFakeTimers();
    try {
      const service = ExpoAudioService.getInstance();
      service.reset();
      const url = 'https://cdn.example.test/x.mp3';

      const load = service.loadTrack(url);
      const settled = jest.fn();
      load.then(settled, settled);
      expect(notePlaybackLoad).toHaveBeenCalledWith(url);

      await jest.advanceTimersByTimeAsync(9999);
      expect(settled).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      await expect(load).rejects.toThrow('Player not set');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('B3: setPlayer() ends the wait and leaves no timer running', async () => {
    jest.useFakeTimers();
    try {
      const service = ExpoAudioService.getInstance();
      service.reset();
      const url = 'https://cdn.example.test/y.mp3';

      const load = service.loadTrack(url);
      load.catch(() => undefined);
      await Promise.resolve();

      const player = new FakeAudioPlayer();
      player.replace.mockImplementationOnce(async () => {
        player.isLoaded = false;
        player.simulateLoaded(60);
      });
      service.setPlayer(
        player as unknown as Parameters<typeof service.setPlayer>[0],
      );
      await load;

      expect(player.replace).toHaveBeenCalledWith({uri: url});
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  // @ai Settings -> Clear cache calls playerStore.cleanup() -> service
  // cleanup(). ExpoAudioProvider injects its useAudioPlayer() instance only on
  // mount, so cleanup() must keep it, or every later load waits and fails.
  it('B4: cleanup() keeps the injected player, so the next load runs at once on the same player', async () => {
    const {service, player} = makeService();
    player.replace.mockImplementation(async () => {
      player.isLoaded = false;
      player.simulateLoaded(60);
    });

    await service.loadTrack('https://cdn.example.test/before.mp3');
    service.cleanup();
    expect(service.getPlayer()).toBe(player);

    const load = service.loadTrack('https://cdn.example.test/after.mp3');
    // No player wait: replace() runs in the same tick as the call.
    expect(player.replace).toHaveBeenCalledTimes(2);
    expect(player.replace).toHaveBeenLastCalledWith({
      uri: 'https://cdn.example.test/after.mp3',
    });
    await load;
    expect(service.getCurrentUrl()).toBe('https://cdn.example.test/after.mp3');
  });

  // @ai A load that waited for the player is stale when a newer load started
  // during the wait. It must return without replace(), so the older source
  // never reaches the native player before the newer one.
  it('B5: a newer loadTrack() during the player wait drops the older load before replace()', async () => {
    const service = ExpoAudioService.getInstance();
    service.reset();

    const older = service.loadTrack('https://cdn.example.test/older.mp3');
    const newer = service.loadTrack('https://cdn.example.test/newer.mp3');

    const player = new FakeAudioPlayer();
    player.replace.mockImplementation(async () => {
      player.isLoaded = false;
      player.simulateLoaded(60);
    });
    service.setPlayer(
      player as unknown as Parameters<typeof service.setPlayer>[0],
    );
    await Promise.all([older, newer]);

    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(player.replace).toHaveBeenCalledWith({
      uri: 'https://cdn.example.test/newer.mp3',
    });
    expect(service.getCurrentUrl()).toBe('https://cdn.example.test/newer.mp3');
  });

  // @ai A play() that lands while a load is still in flight (for example a
  // tap on the restored track during the boot restore load) sets 'playing'.
  // The load must not write 'ready' over it when it finishes.
  it('B6: play() during a load keeps the playing state when the load finishes', async () => {
    const {service, player} = makeService();
    let finishLoad: () => void = () => undefined;
    player.replace.mockImplementationOnce(async () => {
      player.isLoaded = false;
      finishLoad = () => player.simulateLoaded(60);
    });

    const load = service.loadTrack('https://cdn.example.test/slow.mp3');
    await Promise.resolve();
    await service.play();
    expect(service.getPlaybackState()).toBe('playing');

    finishLoad();
    await load;
    expect(service.getPlaybackState()).toBe('playing');
    expect(service.getCurrentUrl()).toBe('https://cdn.example.test/slow.mp3');
  });

  // @ai A load that a newer load supersedes during its own load must not write
  // service state. Only the newer load reports 'ready'.
  it('B7: a load superseded during its load writes no state', async () => {
    const {service, player} = makeService();
    const finishers: Array<() => void> = [];
    player.replace.mockImplementation(async () => {
      player.isLoaded = false;
      finishers.push(() => player.simulateLoaded(60));
    });
    const states: ExpoAudioServiceState['playbackState'][] = [];
    service.addStateListener(s => states.push(s.playbackState));

    const older = service.loadTrack('https://cdn.example.test/older.mp3');
    await Promise.resolve();
    const newer = service.loadTrack('https://cdn.example.test/newer.mp3');
    await Promise.resolve();
    finishers.forEach(finish => finish());
    await Promise.all([older, newer]);

    expect(states.filter(s => s === 'ready')).toHaveLength(1);
    expect(service.getCurrentUrl()).toBe('https://cdn.example.test/newer.mp3');
    expect(service.getPlaybackState()).toBe('ready');
  });

  // ---------------------------------------------------------------- A3 ---
  it('A3: loadTrack(url) happy path — state idle → loading → ready', async () => {
    const {service, player} = makeService();
    const states: ExpoAudioServiceState['playbackState'][] = [];
    service.addStateListener(s => states.push(s.playbackState));

    expect(service.getPlaybackState()).toBe('idle');

    // Simulate the player completing the load shortly after replace() is called.
    player.replace.mockImplementationOnce(async () => {
      player.isLoaded = false;
      // Schedule the loaded transition so waitForLoaded() observes the
      // false→true edge. Microtask is enough since the poll uses setTimeout.
      setTimeout(() => player.simulateLoaded(60), 0);
    });

    await service.loadTrack('https://example.test/track.mp3');

    expect(service.getPlaybackState()).toBe('ready');
    expect(service.getCurrentUrl()).toBe('https://example.test/track.mp3');
    expect(player.replace).toHaveBeenCalledWith({
      uri: 'https://example.test/track.mp3',
    });
    // Listeners observed loading then ready (idle is the pre-listener baseline).
    expect(states).toContain('loading');
    expect(states[states.length - 1]).toBe('ready');
  });

  // ---------------------------------------------------------------- A4 ---
  it('A4: loadTrack(url) error — state error, lastError set, listeners notified', async () => {
    const {service, player} = makeService();
    const states: ExpoAudioServiceState['playbackState'][] = [];
    service.addStateListener(s => states.push(s.playbackState));

    const networkErr = new Error('network down');
    player.replace.mockRejectedValueOnce(networkErr);

    await expect(
      service.loadTrack('https://example.test/track.mp3'),
    ).rejects.toThrow('network down');

    expect(service.getPlaybackState()).toBe('error');
    expect(service.getLastError()).toBe(networkErr);
    expect(states[states.length - 1]).toBe('error');
  });

  // ---------------------------------------------------------------- A5 ---
  it('A5: play() from ready → playing; pause() from playing → paused', async () => {
    const {service, player} = makeService();

    // Manually drive into 'ready' state without going through loadTrack
    // (covered by A3) — direct test of play/pause transitions.
    player.simulateLoaded(60);
    player.replace.mockImplementationOnce(async () => {
      player.isLoaded = false;
      setTimeout(() => player.simulateLoaded(60), 0);
    });
    await service.loadTrack('https://example.test/x.mp3');
    expect(service.getPlaybackState()).toBe('ready');

    await service.play();
    expect(service.getPlaybackState()).toBe('playing');
    expect(player.play).toHaveBeenCalledTimes(1);

    await service.pause();
    expect(service.getPlaybackState()).toBe('paused');
    expect(player.pause).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------- A6 ---
  it('A6: seekTo(seconds) calls player.seekTo and does NOT change playback state', async () => {
    const {service, player} = makeService();

    // Get into 'playing'.
    player.replace.mockImplementationOnce(async () => {
      player.isLoaded = false;
      setTimeout(() => player.simulateLoaded(60), 0);
    });
    await service.loadTrack('https://example.test/x.mp3');
    await service.play();
    expect(service.getPlaybackState()).toBe('playing');

    await service.seekTo(15);

    expect(player.seekTo).toHaveBeenCalledWith(15);
    expect(service.getPlaybackState()).toBe('playing'); // unchanged
  });

  // ---------------------------------------------------------------- A7 ---
  it('A7: setRate clamps to [0.5, 2.0] and calls player.setPlaybackRate(rate, "high")', () => {
    const {service, player} = makeService();

    service.setRate(1.25);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.25, 'high');

    // Below clamp range — should clamp up to 0.5.
    service.setRate(0.1);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(0.5, 'high');

    // Above clamp range — should clamp down to 2.0.
    service.setRate(5.0);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(2.0, 'high');
  });

  // ---------------------------------------------------------------- A8 ---
  it('A8: state listeners receive correct state objects on each transition', async () => {
    const {service, player} = makeService();
    const observed: ExpoAudioServiceState[] = [];
    service.addStateListener(s => observed.push({...s}));

    player.replace.mockImplementationOnce(async () => {
      player.isLoaded = false;
      setTimeout(() => player.simulateLoaded(60), 0);
    });
    await service.loadTrack('https://example.test/x.mp3');
    await service.play();

    // At minimum: loading, ready, playing — plus any intermediate notifications.
    const states = observed.map(s => s.playbackState);
    expect(states).toEqual(
      expect.arrayContaining(['loading', 'ready', 'playing']),
    );

    // Every notification carries the full state shape.
    for (const s of observed) {
      expect(s).toHaveProperty('isInitialized');
      expect(s).toHaveProperty('playbackState');
      expect(s).toHaveProperty('error');
    }
  });

  // ---------------------------------------------------------------- A9 ---
  it('A9: listener unsubscribe stops further notifications', async () => {
    const {service, player} = makeService();
    const listener = jest.fn();
    const unsubscribe = service.addStateListener(listener);

    player.replace.mockImplementationOnce(async () => {
      player.isLoaded = false;
      setTimeout(() => player.simulateLoaded(60), 0);
    });
    await service.loadTrack('https://example.test/x.mp3');
    expect(listener).toHaveBeenCalled();
    const callCountBeforeUnsubscribe = listener.mock.calls.length;

    unsubscribe();

    await service.play();
    await service.pause();

    expect(listener).toHaveBeenCalledTimes(callCountBeforeUnsubscribe);
  });
});
