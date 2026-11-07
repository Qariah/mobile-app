// @ai-generated
// Qariah-only cases for ExpoAudioService, moved out of upstream's
// characterization suite (ExpoAudioService.test.ts) so that file stays close
// to upstream (2026-10-24 divergence audit, batch C1):
//   B1-B7  boot order: loads that wait for setPlayer() (TECH_DEBT #218);
//   P1-P5  play() that waits for setPlayer() (PR #422);
//   L1-L4  the first load of a new player and error statuses (QP-07).

// Mock setAudioModeAsync — the only native call ExpoAudioService.initialize()
// makes. The rest of the service flows through the injected FakeAudioPlayer.
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

// The playback-health hooks are report-only and have their own suite
// (services/diagnostics/__tests__/playbackHealth.test.ts).
jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackLoad: jest.fn(),
  notePlaybackPaused: jest.fn(),
  notePlaybackPlayRequested: jest.fn(),
}));

import {
  notePlaybackLoad,
  notePlaybackPlayRequested,
} from '@/services/diagnostics/playbackHealth';
import {ExpoAudioService, PLAYER_WAIT_MS} from '../ExpoAudioService';
import type {ExpoAudioServiceState} from '../ExpoAudioService';

// The subset of expo-audio's playbackStatusUpdate payload that the
// event-driven waitForLoaded() reads.
type FakeStatus = {
  isLoaded: boolean;
  duration: number;
  currentTime: number;
  playing: boolean;
};

/**
 * Test double for expo-audio's AudioPlayer: the same fake as upstream's suite,
 * with the status events and two more drivers (QP-07).
 */
class FakeAudioPlayer {
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

  // Mark the player as loaded: expo-audio's false→true playbackStatusUpdate
  // edge for the new source.
  simulateLoaded(durationSec: number) {
    this.isLoaded = true;
    this.duration = durationSec;
    this.emitStatus(false);
    this.emitStatus(true);
  }

  // QP-07: iOS (expo-audio AudioPlayer.swift) sends no isLoaded:false after
  // replace(). It sends one isLoaded:true when the new item is ready.
  simulateReadyOnly(durationSec: number) {
    this.isLoaded = true;
    this.duration = durationSec;
    this.emitStatus(true);
  }

  // QP-07: the `error` status that expo-audio sends for a failed source.
  simulateErrorStatus() {
    for (const cb of [...this.statusListeners]) {
      cb({error: 'Source error'} as unknown as FakeStatus);
    }
  }
}

/** Reset the singleton, set a fake player, and return both. */
function makeService(): {service: ExpoAudioService; player: FakeAudioPlayer} {
  const service = ExpoAudioService.getInstance();
  service.reset();
  const player = new FakeAudioPlayer();
  service.setPlayer(
    player as unknown as Parameters<typeof service.setPlayer>[0],
  );
  return {service, player};
}

describe('ExpoAudioService — Qariah boot order and load readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  // @ai Early tap (third review of PR #422, 2026-09-13). ExpoAudioProvider
  // renders the UI before it calls setPlayer(). A play() in that window
  // returned at once with no error, so playerStore wrote 'playing' and the
  // user saw Pause with no audio. play() must wait for the player, as
  // loadTrack() does.
  it('P1: play() before setPlayer() waits for the player, then plays', async () => {
    const service = ExpoAudioService.getInstance();
    service.reset();

    const play = service.play();
    const settled = jest.fn();
    play.then(settled, settled);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    // No playback-health attempt for a play that has no player yet.
    expect(notePlaybackPlayRequested).not.toHaveBeenCalled();

    const player = new FakeAudioPlayer();
    service.setPlayer(
      player as unknown as Parameters<typeof service.setPlayer>[0],
    );
    await expect(play).resolves.toBe(true);

    expect(player.play).toHaveBeenCalledTimes(1);
    expect(service.getPlaybackState()).toBe('playing');
    expect(notePlaybackPlayRequested).toHaveBeenCalledTimes(1);
  });

  it('P2: play() with no player within the wait resolves false after the wait, does not throw, and starts no attempt', async () => {
    jest.useFakeTimers();
    try {
      const service = ExpoAudioService.getInstance();
      service.reset();

      const play = service.play();
      const settled = jest.fn();
      play.then(settled, settled);

      await jest.advanceTimersByTimeAsync(PLAYER_WAIT_MS - 1);
      expect(settled).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      await expect(play).resolves.toBe(false);
      expect(service.getPlaybackState()).not.toBe('playing');
      expect(notePlaybackPlayRequested).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  // Safety tests (not regressions): they pass on the unfixed code too, where
  // play() never waits. They prove the wait cannot start audio that a pause,
  // a cleanup or a newer load cancelled.
  it('P3 (safety): pause() during the player wait -> no play() when the player arrives', async () => {
    const service = ExpoAudioService.getInstance();
    service.reset();

    const play = service.play();
    await Promise.resolve();
    // playerStore.pause() and playerStore.cleanup() call pause().
    await service.pause();

    const player = new FakeAudioPlayer();
    service.setPlayer(
      player as unknown as Parameters<typeof service.setPlayer>[0],
    );
    await play;

    expect(player.play).not.toHaveBeenCalled();
    expect(service.getPlaybackState()).not.toBe('playing');
    expect(notePlaybackPlayRequested).not.toHaveBeenCalled();
  });

  it('P4 (safety): cleanup() during the player wait -> no play() when the player arrives', async () => {
    const service = ExpoAudioService.getInstance();
    service.reset();

    const play = service.play();
    await Promise.resolve();
    service.cleanup();

    const player = new FakeAudioPlayer();
    service.setPlayer(
      player as unknown as Parameters<typeof service.setPlayer>[0],
    );
    await play;

    expect(player.play).not.toHaveBeenCalled();
    expect(service.getPlaybackState()).not.toBe('playing');
  });

  it('P5 (safety): a newer loadTrack() during the player wait -> the stale play() does not start the new source', async () => {
    const service = ExpoAudioService.getInstance();
    service.reset();

    const play = service.play();
    await Promise.resolve();
    const load = service.loadTrack('https://cdn.example.test/newer.mp3');

    const player = new FakeAudioPlayer();
    player.replace.mockImplementation(async () => {
      player.isLoaded = false;
      player.simulateLoaded(60);
    });
    service.setPlayer(
      player as unknown as Parameters<typeof service.setPlayer>[0],
    );
    await Promise.all([play, load]);

    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(player.replace).toHaveBeenCalledWith({
      uri: 'https://cdn.example.test/newer.mp3',
    });
    expect(player.play).not.toHaveBeenCalled();
    expect(service.getPlaybackState()).toBe('ready');
  });

  // @ai-start QP-07 (Sprint 50, the test iPhone). On iOS, expo-audio sends
  // no isLoaded:false after replace(). It sends one isLoaded:true when the
  // item is ready, and no other status while the player has never played (the
  // periodic status starts at the first play). On a cold start, the restore
  // load is the first source of a new player. waitForLoaded() ignored an
  // isLoaded:true in its first 500 ms as a possible status of an earlier
  // source, so a source that was ready in less than 500 ms waited for the 5 s
  // timeout, and a tap on Play during the restore played about 5 s late.
  it('L1: the first load of a new player ends at its first isLoaded:true, with no isLoaded:false before it', async () => {
    jest.useFakeTimers();
    try {
      const {service, player} = makeService();
      const url = 'https://cdn.example.test/first.mp3';
      player.replace.mockImplementationOnce(async () => {
        player.isLoaded = false;
        setTimeout(() => player.simulateReadyOnly(60), 50);
      });

      const load = service.loadTrack(url);
      const settled = jest.fn();
      load.then(settled, settled);
      await jest.advanceTimersByTimeAsync(60);

      expect(settled).toHaveBeenCalled();
      expect(service.holdsSource(url)).toBe(true);
      expect(service.getPlaybackState()).toBe('ready');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('L2: a later load of the same player still ignores an early isLoaded:true with no isLoaded:false (it can be a status of the earlier source)', async () => {
    jest.useFakeTimers();
    try {
      const {service, player} = makeService();
      player.replace.mockImplementationOnce(async () => {
        player.isLoaded = false;
        setTimeout(() => player.simulateLoaded(60), 0);
      });
      const first = service.loadTrack('https://cdn.example.test/a.mp3');
      await jest.advanceTimersByTimeAsync(1);
      await first;

      const url = 'https://cdn.example.test/b.mp3';
      player.replace.mockImplementationOnce(async () => {
        setTimeout(() => player.simulateReadyOnly(90), 50);
      });
      const load = service.loadTrack(url);
      const settled = jest.fn();
      load.then(settled, settled);

      await jest.advanceTimersByTimeAsync(60);
      expect(settled).not.toHaveBeenCalled();
      expect(service.holdsSource(url)).toBe(false);

      // The 5 s load timeout ends the wait (a timed-out load counts as held).
      await jest.advanceTimersByTimeAsync(5000);
      expect(settled).toHaveBeenCalled();
      expect(service.holdsSource(url)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('L3: the first load of a new player ends at once on an error status, with no isLoaded:false before it', async () => {
    jest.useFakeTimers();
    try {
      const {service, player} = makeService();
      const url = 'https://cdn.example.test/missing.mp3';
      player.replace.mockImplementationOnce(async () => {
        setTimeout(() => player.simulateErrorStatus(), 50);
      });

      const load = service.loadTrack(url);
      const settled = jest.fn();
      load.then(settled, settled);
      await jest.advanceTimersByTimeAsync(60);

      expect(settled).toHaveBeenCalled();
      expect(service.holdsSource(url)).toBe(false);
      expect(service.getPlaybackState()).toBe('error');
    } finally {
      jest.useRealTimers();
    }
  });

  it('L4: a later load of the same player keeps an early error status with no isLoaded:false pending, and ends as an error at the 5 s timeout', async () => {
    jest.useFakeTimers();
    try {
      const {service, player} = makeService();
      player.replace.mockImplementationOnce(async () => {
        player.isLoaded = false;
        setTimeout(() => player.simulateLoaded(60), 0);
      });
      const first = service.loadTrack('https://cdn.example.test/a.mp3');
      await jest.advanceTimersByTimeAsync(1);
      await first;

      const url = 'https://cdn.example.test/b.mp3';
      player.replace.mockImplementationOnce(async () => {
        setTimeout(() => player.simulateErrorStatus(), 50);
      });
      const load = service.loadTrack(url);
      const settled = jest.fn();
      load.then(settled, settled);

      // The error can belong to the earlier source: the wait goes on.
      await jest.advanceTimersByTimeAsync(60);
      expect(settled).not.toHaveBeenCalled();

      // No isLoaded:false came, so at the timeout the load counts as failed.
      await jest.advanceTimersByTimeAsync(5000);
      expect(settled).toHaveBeenCalled();
      expect(service.holdsSource(url)).toBe(false);
      expect(service.getPlaybackState()).toBe('error');
      expect(service.getLastError()?.message).toContain(url);
    } finally {
      jest.useRealTimers();
    }
  });
  // @ai-end
});

// @ai TECH_DEBT #277: LockScreenService hides the main controls while the
// player holds no source; it hears the end of each load through these.
describe('ExpoAudioService — source listeners (TECH_DEBT #277)', () => {
  it('S1: a good load tells the listener after the source is held; the listener survives cleanup()', async () => {
    jest.useFakeTimers();
    try {
      const {service, player} = makeService();
      const url = 'https://cdn.example.test/a.mp3';
      const heldAtCall: boolean[] = [];
      const unsubscribe = service.addSourceListener(u => {
        if (u === url) heldAtCall.push(service.holdsSource(url));
      });
      player.replace.mockImplementation(async () => {
        setTimeout(() => player.simulateLoaded(60), 0);
      });

      const first = service.loadTrack(url);
      await jest.advanceTimersByTimeAsync(1);
      await first;
      expect(heldAtCall).toEqual([true]);

      service.cleanup();
      const second = service.loadTrack(url);
      await jest.advanceTimersByTimeAsync(1);
      await second;
      expect(heldAtCall).toEqual([true, true]);
      unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });

  it('S2: a load that ends on an error status tells the listener, with no source', async () => {
    jest.useFakeTimers();
    try {
      const {service, player} = makeService();
      const url = 'https://cdn.example.test/missing.mp3';
      const heldAtCall: boolean[] = [];
      const unsubscribe = service.addSourceListener(u =>
        heldAtCall.push(service.holdsSource(u)),
      );
      player.replace.mockImplementationOnce(async () => {
        setTimeout(() => player.simulateErrorStatus(), 50);
      });

      const load = service.loadTrack(url);
      load.catch(() => undefined);
      await jest.advanceTimersByTimeAsync(60);

      expect(heldAtCall).toEqual([false]);
      expect(service.runningLoad(url)).toBeNull();
      unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });

  it('S3: a listener that throws does not break the load; an unsubscribed listener hears nothing', async () => {
    jest.useFakeTimers();
    try {
      const {service, player} = makeService();
      const url = 'https://cdn.example.test/a.mp3';
      const heard = jest.fn();
      const unsubscribe = service.addSourceListener(heard);
      unsubscribe();
      const unsubscribeThrowing = service.addSourceListener(() => {
        throw new Error('listener bug');
      });
      player.replace.mockImplementationOnce(async () => {
        setTimeout(() => player.simulateLoaded(60), 0);
      });

      const load = service.loadTrack(url);
      await jest.advanceTimersByTimeAsync(1);
      await expect(load).resolves.toBeUndefined();

      expect(service.holdsSource(url)).toBe(true);
      expect(heard).not.toHaveBeenCalled();
      unsubscribeThrowing();
    } finally {
      jest.useRealTimers();
    }
  });
});
