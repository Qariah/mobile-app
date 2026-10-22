/**
 * @ai Early-tap regression tests (third review of PR #422, 2026-09-13).
 *
 * ExpoAudioProvider renders the UI before it calls expoAudioService.setPlayer()
 * (about 0.4 s after app ready on a Pixel 3). A tap on the mini-player play
 * button in that window called playerStore.play() -> expoAudioService.play().
 * The service returned at once with no player and no error, and the store
 * still wrote 'playing'. The user saw Pause and heard no audio.
 *
 * These tests use the REAL ExpoAudioService and the REAL playerStore. Only the
 * native player and side-effect services are fakes.
 */

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackLoad: jest.fn(),
  notePlaybackPaused: jest.fn(),
  notePlaybackPlayRequested: jest.fn(),
  notePlaybackAutoPlayLoad: jest.fn(),
}));

jest.mock('@/services/diagnostics/diagnostics', () => ({
  diagBreadcrumb: jest.fn(),
}));

// The real module starts a module-level interval that keeps Jest from exiting.
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('@/services/audio/AudioCoordinator', () => ({
  audioCoordinator: {
    mainWillPlay: jest.fn(),
  },
}));

jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    trackPlaybackSkipped: jest.fn(),
    trackPlaybackSeeked: jest.fn(),
    trackRateChanged: jest.fn(),
  },
}));

import {
  expoAudioService,
  PLAYER_WAIT_MS,
} from '@/services/audio/ExpoAudioService';
import {usePlayerStore} from '../playerStore';
import type {Track} from '@/types/audio';

const RESTORED_URL = 'https://cdn.example.test/restored.mp3';
const OTHER_URL = 'https://cdn.example.test/other.mp3';

/** The slice of expo-audio's AudioPlayer that ExpoAudioService uses. */
class FakeAudioPlayer {
  isLoaded = false;
  playing = false;
  isBuffering = false;
  currentTime = 0;
  duration = 0;
  playbackRate = 1;
  volume = 1;
  muted = false;
  sources: string[] = [];
  private listeners = new Set<(s: {isLoaded: boolean}) => void>();

  replace = jest.fn(async (source: {uri: string}) => {
    this.sources.push(source.uri);
    this.isLoaded = false;
    setTimeout(() => {
      this.isLoaded = true;
      this.duration = 60;
      this.emit(false);
      this.emit(true);
    }, 5);
  });

  play = jest.fn(async () => {
    this.playing = true;
  });

  pause = jest.fn(async () => {
    this.playing = false;
  });

  seekTo = jest.fn(async (sec: number) => {
    this.currentTime = sec;
  });

  setPlaybackRate = jest.fn();

  addListener(event: string, cb: (s: {isLoaded: boolean}) => void) {
    if (event === 'playbackStatusUpdate') this.listeners.add(cb);
    return {
      remove: () => {
        this.listeners.delete(cb);
      },
    };
  }

  private emit(isLoaded: boolean) {
    for (const cb of [...this.listeners]) cb({isLoaded});
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function inject(player: FakeAudioPlayer): void {
  expoAudioService.setPlayer(
    player as unknown as Parameters<typeof expoAudioService.setPlayer>[0],
  );
}

/** The mini-player state after a boot restore: a track, paused. */
function showRestoredTrack(): void {
  const store = usePlayerStore.getState();
  store.updateQueueState({
    tracks: [
      {
        id: 'reciter-1:44',
        url: RESTORED_URL,
        title: 'Surah 44',
        artist: 'Test Reciter',
        reciterId: 'reciter-1',
        reciterName: 'Test Reciter',
        surahId: '44',
      } as unknown as Track,
    ],
    currentIndex: 0,
  });
  store.updatePlaybackState({state: 'paused', position: 30, duration: 60});
}

describe('playerStore.play() before setPlayer (early tap)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    expoAudioService.reset();
    usePlayerStore.getState().reset();
  });

  it('E1: a tap before setPlayer does not show playing during the wait, and plays once the player arrives', async () => {
    showRestoredTrack();

    const tap = usePlayerStore.getState().play();
    await sleep(10);
    // No player yet: the button must not show Pause.
    expect(usePlayerStore.getState().playback.state).not.toBe('playing');

    const player = new FakeAudioPlayer();
    inject(player);
    await tap;

    expect(player.play).toHaveBeenCalledTimes(1);
    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('playing');
    expect(state.loading.trackLoading).toBe(false);
  });

  it('E2: no player within the wait -> no crash, the state is not stuck on playing, loading ends', async () => {
    jest.useFakeTimers();
    try {
      showRestoredTrack();

      const tap = usePlayerStore.getState().play();
      await jest.advanceTimersByTimeAsync(PLAYER_WAIT_MS);
      await expect(tap).resolves.toBeUndefined();

      const state = usePlayerStore.getState();
      expect(state.playback.state).toBe('paused');
      expect(state.loading.trackLoading).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  // Safety tests (not regressions): they pass on the unfixed code too, where
  // play() never waits. They prove the wait does not re-open the #266 ghost
  // playback race: a superseding op (a newer load, or cleanup()) cancels the
  // waiting play.
  //
  // @ai E3 was "stop() during the wait". stop() is gone (TECH_DEBT #227), so
  // the superseding op here is a newer store load: the user picks another
  // track while the tap waits. The only play() must be the new load's.
  it('E3 (safety): a newer store load during the wait -> the stale tap starts no audio, the newer load plays and owns the state', async () => {
    showRestoredTrack();

    const tap = usePlayerStore.getState().play();
    await sleep(10);
    const pick = usePlayerStore.getState().updateQueue(
      [
        {
          id: 'reciter-2:1',
          url: OTHER_URL,
          title: 'Surah 1',
          artist: 'Other Reciter',
          reciterId: 'reciter-2',
          reciterName: 'Other Reciter',
          surahId: '1',
        } as unknown as Track,
      ],
      0,
    );
    await sleep(10);

    const player = new FakeAudioPlayer();
    inject(player);
    await tap;
    await pick;
    await sleep(20);

    // One play(), after the new source: the stale tap did not play the empty
    // player before replace().
    expect(player.sources).toEqual([OTHER_URL]);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.replace.mock.invocationCallOrder[0]).toBeLessThan(
      player.play.mock.invocationCallOrder[0],
    );
    const state = usePlayerStore.getState();
    expect(state.queue.tracks[state.queue.currentIndex]?.url).toBe(OTHER_URL);
    // updateQueue()'s own final state, not a 'playing' from the stale tap.
    expect(state.playback.state).toBe('ready');
    expect(state.loading.trackLoading).toBe(false);
  });

  it('E4 (safety): playerStore.cleanup() during the wait -> no play() when the player arrives', async () => {
    showRestoredTrack();

    const tap = usePlayerStore.getState().play();
    await sleep(10);
    await usePlayerStore.getState().cleanup();

    const player = new FakeAudioPlayer();
    inject(player);
    await tap;
    await sleep(20);

    expect(player.play).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playback.state).not.toBe('playing');
  });

  it('E5: a newer load during the wait -> the stale tap does not start the new source and does not show playing', async () => {
    showRestoredTrack();

    const tap = usePlayerStore.getState().play();
    await sleep(10);
    // A load with no play (for example the boot restore load of another
    // source) starts while the tap waits.
    const load = expoAudioService.loadTrack(OTHER_URL);

    const player = new FakeAudioPlayer();
    inject(player);
    await tap;
    await load;

    expect(player.sources).toEqual([OTHER_URL]);
    expect(player.play).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playback.state).not.toBe('playing');
  });

  // @ai Review of d16b73bb, L4: three gaps in the early-tap cases.
  it('E6: the native play() rejects after the wait -> the store records the error, ends loading, and does not show playing', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      showRestoredTrack();

      const tap = usePlayerStore.getState().play();
      await sleep(10);

      const player = new FakeAudioPlayer();
      const nativeError = new Error('native play failed');
      player.play.mockRejectedValueOnce(nativeError);
      inject(player);
      await expect(tap).resolves.toBeUndefined();

      expect(player.play).toHaveBeenCalledTimes(1);
      const state = usePlayerStore.getState();
      expect(state.error.playback).toBe(nativeError);
      expect(state.loading.trackLoading).toBe(false);
      expect(state.playback.state).not.toBe('playing');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('E7: playerStore.pause() during the wait -> no play() when the player arrives, the state is not playing', async () => {
    showRestoredTrack();

    const tap = usePlayerStore.getState().play();
    await sleep(10);
    await usePlayerStore.getState().pause();

    const player = new FakeAudioPlayer();
    inject(player);
    await tap;
    await sleep(20);

    expect(player.play).not.toHaveBeenCalled();
    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('paused');
    expect(state.loading.trackLoading).toBe(false);
  });

  it('E8: two play taps during the wait -> no crash, and both end in playing with loading done', async () => {
    showRestoredTrack();

    const firstTap = usePlayerStore.getState().play();
    const secondTap = usePlayerStore.getState().play();
    await sleep(10);
    expect(usePlayerStore.getState().playback.state).not.toBe('playing');

    const player = new FakeAudioPlayer();
    inject(player);
    await expect(Promise.all([firstTap, secondTap])).resolves.toBeDefined();

    // player.play() is idempotent on a playing player.
    expect(player.play).toHaveBeenCalled();
    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('playing');
    expect(state.loading.trackLoading).toBe(false);
    expect(state.error.playback).toBeFalsy();
  });
});
