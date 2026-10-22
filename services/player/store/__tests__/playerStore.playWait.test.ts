/**
 * @ai Regression tests: an autoplaying load must not write 'playing' after a
 * play() that did not play, or over the state of a newer action.
 *
 * Since PR #425, expoAudioService.play() can wait up to 10 s for setPlayer and
 * returns a boolean. A pause(), a cleanup() or a newer load cancels the wait,
 * and play() returns false. loadTrackAtIndex ignored both the result and the
 * op id after that await, so skipToNext() wrote 'playing' over the 'paused' of
 * a removal of the last track (or of a pause) during the wait.
 */

jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {
    loadTrack: jest.fn(),
    play: jest.fn(() => Promise.resolve(true)),
    pause: jest.fn(() => Promise.resolve()),
    seekTo: jest.fn(() => Promise.resolve()),
    getDuration: jest.fn(() => 120),
    getIsLoaded: jest.fn(() => true),
    // @ai The source of each load stays loaded (TECH_DEBT #271).
    holdsSource: jest.fn(() => true),
    runningLoad: jest.fn(() => null),
    getCurrentTime: jest.fn(() => 0),
    getPosition: jest.fn(() => 0),
    getIsPlaying: jest.fn(() => false),
    setRate: jest.fn(),
    cleanup: jest.fn(),
  },
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

jest.mock('@/services/diagnostics/diagnostics', () => ({
  diagBreadcrumb: jest.fn(),
}));

jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackAutoPlayLoad: jest.fn(),
}));

import {usePlayerStore} from '../playerStore';
import {expoAudioService} from '@/services/audio/ExpoAudioService';
import type {Track} from '@/types/audio';

const mockedAudio = expoAudioService as unknown as {
  loadTrack: jest.Mock;
  play: jest.Mock;
  pause: jest.Mock;
};

/** A play() that waits for the player until the test settles it. */
function waitingPlay(): {settle: (played: boolean) => void} {
  let settle!: (played: boolean) => void;
  const promise = new Promise<boolean>(r => (settle = r));
  mockedAudio.play.mockImplementationOnce(() => promise);
  return {settle};
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

// Let awaited continuations run to completion.
const flush = () => new Promise<void>(r => setTimeout(r, 0));

/** A loaded queue on track 0, in 'playing'. */
async function startQueue(ids: string[]): Promise<void> {
  await usePlayerStore.getState().updateQueue(ids.map(makeTrack), 0);
  await flush();
  usePlayerStore.getState().updatePlaybackState({state: 'playing'});
  jest.clearAllMocks();
}

describe('an autoplaying load after a play() wait (PR #425)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePlayerStore.getState().reset();
    mockedAudio.loadTrack.mockImplementation(() => Promise.resolve());
  });

  it('removing the only track during the wait: the skip does not write playing', async () => {
    await startQueue(['a']);
    usePlayerStore.getState().setRepeatMode('queue');
    const play = waitingPlay();

    // Repeat-queue loops the skip back onto track 0; play() waits.
    const skip = usePlayerStore.getState().skipToNext();
    await flush();
    expect(mockedAudio.play).toHaveBeenCalledTimes(1);

    // The user removes the only track: the queue empties and pauses.
    await usePlayerStore.getState().removeFromQueue([0]);
    expect(usePlayerStore.getState().playback.state).toBe('paused');

    // The pause cancelled the wait.
    play.settle(false);
    await skip;
    await flush();

    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('paused');
    expect(state.queue.tracks).toHaveLength(0);
  });

  it('a pause during the wait: the skip does not write playing', async () => {
    await startQueue(['a', 'b']);
    const play = waitingPlay();

    const skip = usePlayerStore.getState().skipToNext();
    await flush();
    await usePlayerStore.getState().pause();
    expect(usePlayerStore.getState().playback.state).toBe('paused');

    play.settle(false);
    await skip;
    await flush();

    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('paused');
    expect(state.queue.currentIndex).toBe(1);
    expect(state.loading.trackLoading).toBe(false);
  });

  it('no player came in time: the skip settles ready, not playing', async () => {
    await startQueue(['a', 'b']);
    mockedAudio.play.mockImplementationOnce(() => Promise.resolve(false));

    await usePlayerStore.getState().skipToNext();
    await flush();

    const state = usePlayerStore.getState();
    expect(state.playback.state).toBe('ready');
    expect(state.loading.trackLoading).toBe(false);
  });

  it('a skip whose play() played still writes playing', async () => {
    await startQueue(['a', 'b']);

    await usePlayerStore.getState().skipToNext();
    await flush();

    expect(usePlayerStore.getState().playback.state).toBe('playing');
  });
});
