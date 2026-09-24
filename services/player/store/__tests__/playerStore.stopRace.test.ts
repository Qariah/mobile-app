/**
 * Regression tests for the #266 mini-player close (✕) vs in-flight load race
 * (Sprint 42 whole-branch review finding).
 *
 * The race: updateQueue() optimistically writes the queue, then awaits
 * loadTrackAtIndex() → expoAudioService.loadTrack() (network-bound). The ✕
 * button is tappable during that window; stop() pauses, clears the lock
 * screen, and empties the queue — but without a guard the still-in-flight
 * load then fires play() (audio AFTER the pause) and updateQueue's trailing
 * set() clobbers 'stopped' with 'ready': audible audio, empty queue, hidden
 * mini-player, no lock-screen controls ("ghost playback").
 *
 * The fix is a monotonic playOpId: loadTrackAtIndex claims an id at entry and
 * re-checks it after each await; stop()/cleanup() bump it; callers skip their
 * trailing state writes when the load reports it was superseded.
 */

jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {
    loadTrack: jest.fn(),
    play: jest.fn(() => Promise.resolve()),
    pause: jest.fn(() => Promise.resolve()),
    seekTo: jest.fn(() => Promise.resolve()),
    getDuration: jest.fn(() => 120),
    getIsLoaded: jest.fn(() => true),
    getCurrentTime: jest.fn(() => 0),
    getIsPlaying: jest.fn(() => false),
    setRate: jest.fn(),
    cleanup: jest.fn(),
  },
}));

jest.mock('@/services/audio/AudioCoordinator', () => ({
  audioCoordinator: {
    mainWillPlay: jest.fn(),
    sourceDidStop: jest.fn(),
  },
}));

// stop() lazy-requires LockScreenService — jest.mock covers require() too.
jest.mock('@/services/audio/LockScreenService', () => ({
  lockScreenService: {
    clearMainPlayer: jest.fn(),
  },
}));

jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    trackPlaybackSkipped: jest.fn(),
    trackPlaybackSeeked: jest.fn(),
    trackRateChanged: jest.fn(),
  },
}));

jest.mock('@/services/diagnostics/diagnostics', () => ({
  diagBreadcrumb: jest.fn(),
}));

jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackAutoPlayLoad: jest.fn(),
}));

import {usePlayerStore} from '../playerStore';
import {expoAudioService} from '@/services/audio/ExpoAudioService';
import {notePlaybackAutoPlayLoad} from '@/services/diagnostics/playbackHealth';
import {lockScreenService} from '@/services/audio/LockScreenService';
import type {Track} from '@/types/audio';

const mockedAudio = expoAudioService as unknown as {
  loadTrack: jest.Mock;
  play: jest.Mock;
  pause: jest.Mock;
  seekTo: jest.Mock;
  getDuration: jest.Mock;
};

function deferred(): {promise: Promise<void>; resolve: () => void} {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return {promise, resolve};
}

function makeTrack(id: string): Track {
  return {
    id,
    url: `https://cdn.example.com/${id}.mp3`,
    title: `Track ${id}`,
    artist: 'Test Reciter',
    reciterId: 'test-reciter',
    reciterName: 'Test Reciter',
    surahId: '1',
  } as unknown as Track;
}

// Flush the microtask queue so awaited continuations run to completion.
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('playerStore stop() vs in-flight load race (#266)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAudio.loadTrack.mockImplementation(() => Promise.resolve());
  });

  it("stop() during updateQueue()'s network load wins: no play(), state stays stopped, queue stays empty", async () => {
    const load = deferred();
    mockedAudio.loadTrack.mockImplementation(() => load.promise);

    const store = usePlayerStore.getState();
    // Kick off the play; it parks awaiting loadTrack (the network).
    const updatePromise = store.updateQueue([makeTrack('a')], 0);
    await flush();
    expect(mockedAudio.loadTrack).toHaveBeenCalledTimes(1);

    // User taps ✕ while the load is in flight.
    await usePlayerStore.getState().stop();
    expect(mockedAudio.pause).toHaveBeenCalled();
    expect(lockScreenService.clearMainPlayer).toHaveBeenCalled();

    // The network load now completes — too late.
    load.resolve();
    await updatePromise;
    await flush();

    // The core of the ghost: play() must NOT fire after stop()'s pause…
    expect(mockedAudio.play).not.toHaveBeenCalled();
    // …and updateQueue's trailing set() must not clobber stop()'s state.
    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('stopped');
    expect(state.queue.tracks).toHaveLength(0);
    expect(state.queue.currentIndex).toBe(-1);
    expect(state.loading.trackLoading).toBe(false);
    expect(state.loading.queueLoading).toBe(false);
  });

  it('normal updateQueue() (no interleaved stop) still loads, plays, and finalizes', async () => {
    const store = usePlayerStore.getState();
    await store.updateQueue([makeTrack('b')], 0);
    await flush();

    expect(mockedAudio.loadTrack).toHaveBeenCalledTimes(1);
    expect(mockedAudio.play).toHaveBeenCalledTimes(1);
    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('ready');
    expect(state.queue.tracks).toHaveLength(1);
    expect(state.queue.currentIndex).toBe(0);
    expect(state.loading.trackLoading).toBe(false);
  });

  // @ai playback-health: a load-then-play marks its URL BEFORE the load, so
  // the telemetry counts the no-audio window from the tap.
  it('marks a load-then-play for playback-health before it loads', async () => {
    const markedBeforeLoad: boolean[] = [];
    mockedAudio.loadTrack.mockImplementation(() => {
      markedBeforeLoad.push(
        (notePlaybackAutoPlayLoad as jest.Mock).mock.calls.length > 0,
      );
      return Promise.resolve();
    });
    await usePlayerStore.getState().updateQueue([makeTrack('c')], 0);
    await flush();
    expect(notePlaybackAutoPlayLoad).toHaveBeenCalledWith(
      'https://cdn.example.com/c.mp3',
    );
    expect(markedBeforeLoad).toEqual([true]);
  });

  it('a newer updateQueue() supersedes an older in-flight one (last tap wins, single play())', async () => {
    const first = deferred();
    const second = deferred();
    mockedAudio.loadTrack
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const store = usePlayerStore.getState();
    const p1 = store.updateQueue([makeTrack('one')], 0);
    await flush();
    const p2 = store.updateQueue([makeTrack('two')], 0);
    await flush();

    // Older load resolves after being superseded — must not play.
    first.resolve();
    await p1;
    await flush();
    expect(mockedAudio.play).not.toHaveBeenCalled();

    second.resolve();
    await p2;
    await flush();
    expect(mockedAudio.play).toHaveBeenCalledTimes(1);

    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('ready');
    expect(state.queue.tracks[0]?.id).toBe('two');
  });
});
