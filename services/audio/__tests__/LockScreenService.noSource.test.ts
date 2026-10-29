/**
 * @ai TECH_DEBT #277 (owner decision 2026-10-26, option B): hide the main
 * remote controls while the main player holds no source.
 *
 * Remote commands (lock screen, notification, headset) go to expo-audio's
 * native player and never reach playerStore.play(). After a restore load that
 * failed (offline), or a player store that hydrated after the restore wait, a
 * remote Play started a player with no source: no audio. Now the main controls
 * are cleared while the player holds no source for the current track and no
 * load of it runs. A load of the track that succeeds (a Play in the app) shows
 * them again. A load in flight never hides them, and the Mushaf keeps its own
 * lock screen entry while it plays.
 *
 * These tests use the REAL playerStore and the REAL LockScreenService. The
 * audio service is a fake that holds sources and ends loads as the real one
 * does: the source first, then the source listeners.
 */

type SourceListener = (url: string) => void;

const mockSource = {
  held: new Set<string>(),
  loading: null as string | null,
  listeners: new Set<SourceListener>(),
  failNextLoad: false,
};

/** Ends a load of `url` as ExpoAudioService does: the source, then the listeners. */
function mockEndLoad(url: string, ok: boolean): void {
  if (mockSource.loading === url) mockSource.loading = null;
  if (ok) mockSource.held.add(url);
  else mockSource.held.delete(url);
  mockSource.listeners.forEach(listener => listener(url));
}

const mockMainPlayer = {
  setActiveForLockScreen: jest.fn(),
  clearLockScreenControls: jest.fn(),
  updateLockScreenMetadata: jest.fn(),
};

const mockMushafPlayer = {
  updateLockScreenMetadata: jest.fn(),
  clearLockScreenControls: jest.fn(),
};

jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {
    getPlayer: () => mockMainPlayer,
    holdsSource: (url: string) => mockSource.held.has(url),
    runningLoad: (url: string) =>
      mockSource.loading === url ? Promise.resolve() : null,
    addSourceListener: (listener: SourceListener) => {
      mockSource.listeners.add(listener);
      return () => {
        mockSource.listeners.delete(listener);
      };
    },
    // The load ends a moment later, as on a device.
    loadTrack: jest.fn((url: string) => {
      mockSource.loading = url;
      const ok = !mockSource.failNextLoad;
      mockSource.failNextLoad = false;
      return new Promise<void>(resolve =>
        setTimeout(() => {
          mockEndLoad(url, ok);
          resolve();
        }, 5),
      );
    }),
    play: jest.fn(() => Promise.resolve(true)),
    pause: jest.fn(() => Promise.resolve()),
    seekTo: jest.fn(() => Promise.resolve()),
    getDuration: jest.fn(() => 120),
    getIsLoaded: jest.fn(() => true),
    getCurrentTime: jest.fn(() => 0),
    getPosition: jest.fn(() => 0),
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
  audioCoordinator: {mainWillPlay: jest.fn(), getActiveSource: () => 'main'},
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
// The real module starts a module-level interval that keeps Jest from exiting.
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));

import {lockScreenService} from '../LockScreenService';
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

const URL_A = 'https://cdn.example.com/a.mp3';

const setMushaf = (state: object) =>
  (useMushafPlayerStore as unknown as {setState: (s: object) => void}).setState(
    state,
  );

/** The titles that the main player got on the lock screen, in order. */
const activatedTitles = () =>
  mockMainPlayer.setActiveForLockScreen.mock.calls.map(
    ([, metadata]) => (metadata as {title: string}).title,
  );

const mainClears = () =>
  mockMainPlayer.clearLockScreenControls.mock.calls.length;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** The restore wrote the queue, but the player holds no source and loads nothing. */
async function showRestoredQueueWithNoSource(): Promise<void> {
  usePlayerStore
    .getState()
    .updateQueueState({tracks: [makeTrack('a')], currentIndex: 0});
  usePlayerStore.getState().updatePlaybackState({state: 'paused'});
  await sleep(0);
}

describe('LockScreenService: no main source, no main controls (TECH_DEBT #277)', () => {
  beforeEach(async () => {
    mockSource.held.clear();
    mockSource.loading = null;
    mockSource.failNextLoad = false;
    usePlayerStore.getState().reset();
    setMushaf({playbackState: 'idle'});
    await lockScreenService.startSync();
    jest.clearAllMocks();
  });

  afterEach(() => {
    lockScreenService.stopSync();
  });

  it('a queue with no source (late hydration, failed restore): the controls are cleared, never shown', async () => {
    await showRestoredQueueWithNoSource();

    expect(mockMainPlayer.setActiveForLockScreen).not.toHaveBeenCalled();
    expect(mainClears()).toBe(1);
    expect(mockMushafPlayer.clearLockScreenControls).not.toHaveBeenCalled();
  });

  it('a Play in the app loads the track: the good load shows the controls again, before the audio plays', async () => {
    await showRestoredQueueWithNoSource();
    const play = jest.requireMock('@/services/audio/ExpoAudioService')
      .expoAudioService.play as jest.Mock;

    await usePlayerStore.getState().play();

    expect(activatedTitles()).toEqual(['Track a']);
    expect(
      mockMainPlayer.setActiveForLockScreen.mock.invocationCallOrder[0],
    ).toBeLessThan(play.mock.invocationCallOrder[0]);
    expect(usePlayerStore.getState().playback.state).toBe('playing');
  });

  it('a failed load (still offline): the controls stay cleared', async () => {
    await showRestoredQueueWithNoSource();
    mockSource.failNextLoad = true;

    await usePlayerStore.getState().play();

    expect(mockMainPlayer.setActiveForLockScreen).not.toHaveBeenCalled();
    expect(mainClears()).toBe(1);
    expect(usePlayerStore.getState().playback.state).not.toBe('playing');
  });

  it('a new track whose load starts in the same action: shown at once, never cleared (no flicker)', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('b')], 0);
    await sleep(10);

    expect(activatedTitles()).toEqual(['Track b']);
    expect(mainClears()).toBe(0);
  });

  it('a load in flight keeps the controls; when it fails, they clear', async () => {
    mockSource.loading = URL_A; // The restore load runs.
    usePlayerStore
      .getState()
      .updateQueueState({tracks: [makeTrack('a')], currentIndex: 0});
    await sleep(0);
    expect(activatedTitles()).toEqual(['Track a']);
    expect(mainClears()).toBe(0);

    mockEndLoad(URL_A, false);

    expect(mainClears()).toBe(1);
  });

  it('a late error loses the source: the controls clear; the next good load shows them', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('a')], 0);
    await sleep(10);
    expect(activatedTitles()).toEqual(['Track a']);

    mockEndLoad(URL_A, false); // The source errors after its load timed out.
    expect(mainClears()).toBe(1);

    await usePlayerStore.getState().play();
    expect(activatedTitles()).toEqual(['Track a', 'Track a']);
  });

  it('(safety) a good load of a source that the controls already show does not activate again', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('a')], 0);
    await sleep(10);

    mockEndLoad(URL_A, true);

    expect(activatedTitles()).toEqual(['Track a']);
    expect(mainClears()).toBe(0);
  });

  it('car mode does not show cleared controls', async () => {
    await showRestoredQueueWithNoSource();

    lockScreenService.setCarMode(true);
    lockScreenService.setCarMode(false);

    expect(mockMainPlayer.setActiveForLockScreen).not.toHaveBeenCalled();
  });

  it('the Mushaf override is unaffected: no main clear while the Mushaf plays; the main decides again when it goes idle', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('a')], 0);
    await sleep(10);
    setMushaf({
      playbackState: 'playing',
      currentSurah: 2,
      numberingMode: 'disabled',
    });

    // The main source goes while the Mushaf owns the lock screen.
    mockEndLoad(URL_A, false);
    expect(mainClears()).toBe(0);
    expect(mockMushafPlayer.clearLockScreenControls).not.toHaveBeenCalled();
    // The Mushaf entry still gets its title.
    expect(mockMushafPlayer.updateLockScreenMetadata).toHaveBeenCalled();

    // The Mushaf stops: its entry clears (existing behaviour); the main
    // player holds no source, so its controls do not come back.
    setMushaf({playbackState: 'idle'});
    await sleep(0);
    expect(mockMushafPlayer.clearLockScreenControls).toHaveBeenCalledTimes(1);
    expect(activatedTitles()).toEqual(['Track a']);
    expect(mainClears()).toBe(1);

    // A Play in the app: the good load shows the main controls again.
    await usePlayerStore.getState().play();
    expect(activatedTitles()).toEqual(['Track a', 'Track a']);
  });

  it('(safety) the Mushaf goes idle while the main player holds its source: the main controls come back at once', async () => {
    await usePlayerStore.getState().updateQueue([makeTrack('a')], 0);
    await sleep(10);
    setMushaf({playbackState: 'playing'});
    setMushaf({playbackState: 'idle'});

    expect(activatedTitles()).toEqual(['Track a', 'Track a']);
    expect(mainClears()).toBe(0);
  });
});
