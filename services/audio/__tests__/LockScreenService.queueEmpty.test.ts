/**
 * @ai Regression tests: the lock screen after Settings -> Clear cache
 * (TECH_DEBT #235, follow-up to the cleanup() pause).
 *
 * playerStore.cleanup() pauses the main player and empties the queue, so the
 * app shows no player. The main player's lock-screen and notification
 * controls stayed active, and a remote Play there resumed the old source.
 *
 * The contract these tests hold: when the main queue has no current track,
 * LockScreenService clears the main player's controls once. A track change
 * never clears them, and the Mushaf player is never cleared by this path.
 *
 * These tests use the REAL playerStore and the REAL LockScreenService, so the
 * queue writes have their real shapes. The native players are fakes.
 */

const mockMainPlayer = {
  setActiveForLockScreen: jest.fn(),
  clearLockScreenControls: jest.fn(),
};

const mockMushafPlayer = {
  updateLockScreenMetadata: jest.fn(),
  clearLockScreenControls: jest.fn(),
};

jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {
    getPlayer: () => mockMainPlayer,
    loadTrack: jest.fn(() => Promise.resolve()),
    play: jest.fn(() => Promise.resolve(true)),
    pause: jest.fn(() => Promise.resolve()),
    seekTo: jest.fn(() => Promise.resolve()),
    getDuration: jest.fn(() => 120),
    getIsLoaded: jest.fn(() => true),
    // @ai The source of each load stays loaded (TECH_DEBT #271).
    holdsSource: jest.fn(() => true),
    runningLoad: jest.fn(() => null),
    getCurrentTime: jest.fn(() => 0),
    getIsPlaying: jest.fn(() => false),
    setRate: jest.fn(),
    cleanup: jest.fn(),
  },
}));

jest.mock('@/services/audio/MushafAudioService', () => ({
  mushafAudioService: {getPlayer: () => mockMushafPlayer},
}));

jest.mock('@/store/mushafPlayerStore', () => {
  const {create} = jest.requireActual('zustand');
  return {
    useMushafPlayerStore: create(() => ({
      playbackState: 'idle',
      currentSurah: 0,
      currentVerseKey: null,
      currentVerseLabel: null,
      numberingMode: null,
      reciterName: 'Test Reciter',
    })),
  };
});

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

import {lockScreenService} from '../LockScreenService';
import {expoAudioService} from '@/services/audio/ExpoAudioService';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {useMushafPlayerStore} from '@/store/mushafPlayerStore';
import type {Track} from '@/types/audio';

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

const setMushaf = (state: object) =>
  (useMushafPlayerStore as unknown as {setState: (s: object) => void}).setState(
    state,
  );

/** The titles that the main player got on the lock screen, in order. */
const activatedTitles = () =>
  mockMainPlayer.setActiveForLockScreen.mock.calls.map(
    ([, metadata]) => (metadata as {title: string}).title,
  );

// Let awaited continuations run to completion.
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('LockScreenService: the main queue has no current track (#235)', () => {
  beforeEach(async () => {
    usePlayerStore.getState().reset();
    setMushaf({playbackState: 'idle'});
    await lockScreenService.startSync();
    jest.clearAllMocks();
  });

  afterEach(() => {
    lockScreenService.stopSync();
  });

  it('(safety) a track change does not clear the controls', async () => {
    const store = usePlayerStore.getState();
    await store.updateQueue([makeTrack('a'), makeTrack('b')], 0);
    await flush();
    await usePlayerStore.getState().skipToNext();
    await flush();
    // A new queue replaces the old one.
    await usePlayerStore
      .getState()
      .updateQueue([makeTrack('c'), makeTrack('d'), makeTrack('e')], 0);
    await flush();
    await usePlayerStore.getState().addToQueue([makeTrack('f')]);
    await usePlayerStore.getState().moveInQueue(3, 1);
    // Remove another track, then the current one (the next track loads).
    await usePlayerStore.getState().removeFromQueue([2]);
    await usePlayerStore.getState().removeFromQueue([0]);
    await flush();

    expect(mockMainPlayer.clearLockScreenControls).not.toHaveBeenCalled();
    expect(mockMushafPlayer.clearLockScreenControls).not.toHaveBeenCalled();
    expect(activatedTitles()).toEqual([
      'Track a',
      'Track b',
      'Track c',
      'Track f',
    ]);
  });

  it('cleanup() clears the main controls once, and the next play shows them again', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('a')], 0);
    await flush();
    expect(activatedTitles()).toEqual(['Track a']);

    await usePlayerStore.getState().cleanup();
    expect(mockMainPlayer.clearLockScreenControls).toHaveBeenCalledTimes(1);

    // Later writes on the empty queue (the provider's status sync) do not
    // clear again.
    usePlayerStore.getState().updatePlaybackState({state: 'paused'});
    usePlayerStore.getState().updatePlaybackState({position: 12});
    expect(mockMainPlayer.clearLockScreenControls).toHaveBeenCalledTimes(1);
    expect(mockMushafPlayer.clearLockScreenControls).not.toHaveBeenCalled();

    // The same track again: the controls come back.
    await usePlayerStore.getState().updateQueue([makeTrack('a')], 0);
    await flush();
    expect(activatedTitles()).toEqual(['Track a', 'Track a']);
    expect(mockMainPlayer.clearLockScreenControls).toHaveBeenCalledTimes(1);
  });

  // @ai Stage-2 review of #237: the queue view can remove the only track
  // while it plays. The player pauses first, then the queue empties, then
  // the controls clear. A stopped player loses its controls, never a
  // playing one.
  it('remove the only track while it plays: pause() runs before the queue is empty, then the controls clear', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('a')], 0);
    await flush();
    usePlayerStore.getState().updatePlaybackState({state: 'playing'});
    const pause = expoAudioService.pause as jest.Mock;
    pause.mockClear();
    const queueLengthAtPause: number[] = [];
    pause.mockImplementationOnce(() => {
      queueLengthAtPause.push(usePlayerStore.getState().queue.tracks.length);
      return Promise.resolve();
    });

    await usePlayerStore.getState().removeFromQueue([0]);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(queueLengthAtPause).toEqual([1]);
    expect(mockMainPlayer.clearLockScreenControls).toHaveBeenCalledTimes(1);
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(
      mockMainPlayer.clearLockScreenControls.mock.invocationCallOrder[0],
    );
    expect(usePlayerStore.getState().playback.state).not.toBe('playing');
    expect(mockMushafPlayer.clearLockScreenControls).not.toHaveBeenCalled();
  });

  it('(safety) an empty queue at the start clears nothing', () => {
    usePlayerStore.getState().updatePlaybackState({state: 'paused'});
    expect(mockMainPlayer.clearLockScreenControls).not.toHaveBeenCalled();
  });

  it('while the Mushaf plays, cleanup() clears neither player; the main controls clear when the Mushaf goes idle', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('a')], 0);
    await flush();
    setMushaf({playbackState: 'playing'});

    await usePlayerStore.getState().cleanup();
    expect(mockMainPlayer.clearLockScreenControls).not.toHaveBeenCalled();
    expect(mockMushafPlayer.clearLockScreenControls).not.toHaveBeenCalled();

    // The Mushaf stops. Its own controls clear (existing behaviour), and the
    // main player has no track to show, so its controls clear too.
    setMushaf({playbackState: 'idle'});
    expect(mockMushafPlayer.clearLockScreenControls).toHaveBeenCalledTimes(1);
    expect(mockMainPlayer.clearLockScreenControls).toHaveBeenCalledTimes(1);
    expect(activatedTitles()).toEqual(['Track a']);
  });

  it('(safety) the Mushaf goes idle with a main track in the queue: the main controls come back, nothing clears them', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('a')], 0);
    await flush();
    setMushaf({playbackState: 'playing'});
    setMushaf({playbackState: 'idle'});

    expect(mockMainPlayer.clearLockScreenControls).not.toHaveBeenCalled();
    expect(activatedTitles()).toEqual(['Track a', 'Track a']);
  });
});
