// @ai
// Qariah (TECH_DEBT #391, lines 2, 3 and 4 of
// planning/posthog-event-cut-proposal.md).
//
// Line 2: the end of a track is not a pause. expo-audio reports
// `playing: false` at the end of each track, and upstream sent it as
// `playback_paused` (56 k of 76 k pauses in October).
// Line 3: `playback_resumed` only after a real pause. Upstream also sent it at
// the start of each track (57 k of 65 k resumes).
// Line 4: an automatic advance calls `skipToNext({auto: true})`, and the next
// `playback_started` says `source: 'autoplay'`.

import React from 'react';
import {View} from 'react-native';
import {render, act} from '@testing-library/react-native';

jest.mock('@/config/featureFlags', () => ({
  isFeatureEnabled: () => false,
}));

type Status = {
  isLoaded: boolean;
  playing: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  didJustFinish: boolean;
};
const mockStatus: {current: Status} = {
  current: {
    isLoaded: true,
    playing: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    didJustFinish: false,
  },
};

const mockPlayer = {playing: false, playbackRate: 1};
const mockService = {
  initialize: jest.fn(() => Promise.resolve()),
  setPlayer: jest.fn(),
  setRate: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
  play: jest.fn(() => Promise.resolve(true)),
};
const mockLockScreen = {
  startSync: jest.fn(() => Promise.resolve()),
  stopSync: jest.fn(),
};

jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockPlayer,
  createAudioPlayer: () => mockPlayer,
  useAudioPlayerStatus: () => mockStatus.current,
}));
jest.mock('@/services/widgets/syncWidgets', () => ({
  markPlayerReadyForWidgets: jest.fn(),
}));
jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackProgress: jest.fn(),
}));
jest.mock('@/services/diagnostics/playbackObserver', () => ({
  usePlaybackObserver: jest.fn(),
}));
jest.mock('@sentry/react-native', () => ({captureMessage: jest.fn()}));
jest.mock('../ExpoAudioService', () => ({
  get expoAudioService() {
    return mockService;
  },
}));
jest.mock('../LockScreenService', () => ({
  get lockScreenService() {
    return mockLockScreen;
  },
}));
jest.mock('../AmbientAudioService', () => ({
  ambientAudioService: {
    hasPlayer: () => false,
    getIsPlaying: () => false,
    play: jest.fn(),
    pause: jest.fn(),
    fadeOut: jest.fn(),
  },
}));
jest.mock('../AudioCoordinator', () => ({
  audioCoordinator: {getActiveSource: () => 'main', mainWillPlay: jest.fn()},
}));
jest.mock('../MushafAudioService', () => ({mushafAudioService: {}}));

const mockAnalytics = {
  trackPlaybackStarted: jest.fn(),
  trackPlaybackPaused: jest.fn(),
  trackPlaybackResumed: jest.fn(),
  trackPlaybackCompleted: jest.fn(),
  setTrackDuration: jest.fn(),
  updatePlaybackProgress: jest.fn(),
};
jest.mock('@/services/analytics/AnalyticsService', () => ({
  get analyticsService() {
    return mockAnalytics;
  },
}));

const mockStore = {
  playback: {state: 'paused', rate: 1},
  queue: {
    tracks: [
      {
        id: 'r:1',
        surahId: '1',
        reciterId: 'r',
        reciterName: 'Reciter',
        rewayatId: 'hafs',
      },
      {
        id: 'r:2',
        surahId: '2',
        reciterId: 'r',
        reciterName: 'Reciter',
        rewayatId: 'hafs',
      },
    ],
    currentIndex: 0,
  },
  settings: {repeatMode: 'none'},
  updatePlaybackState: jest.fn((patch: {state?: string}) => {
    if (patch.state) mockStore.playback.state = patch.state;
  }),
  skipToNext: jest.fn(() => Promise.resolve()),
};
jest.mock('@/services/player/store/playerStore', () => {
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const usePlayerStore = selector => selector(mockStore);
  usePlayerStore.getState = () => mockStore;
  return {usePlayerStore};
});
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {getState: () => ({updateProgress: jest.fn()})},
}));
jest.mock('@/store/ambientStore', () => ({
  useAmbientStore: {getState: () => ({isEnabled: false, currentSound: null})},
}));
jest.mock('@/store/mushafPlayerStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useMushafPlayerStore: selector => selector({playbackState: 'idle'}),
}));
jest.mock('@/services/diagnostics/playbackSentinel', () => ({
  markPlaybackActive: jest.fn(),
  updatePlaybackPosition: jest.fn(),
  clearPlaybackActive: jest.fn(),
  peekActivePlayback: jest.fn(),
}));
jest.mock('@/store/backgroundPlaybackStore', () => ({
  useBackgroundPlaybackStore: {getState: () => ({})},
}));

import {ExpoAudioProvider} from '../ExpoAudioProvider';
import {
  markAutoplayStart,
  takeAutoplayStart,
} from '@/services/analytics/qariahEventGates';

// A new element each time: React skips a re-render of the same element.
const tree = () => (
  <ExpoAudioProvider>
    <View />
  </ExpoAudioProvider>
);

/** Mounts the provider; `step()` applies a status and re-renders. */
async function mount() {
  const view = render(tree());
  await act(() => Promise.resolve());
  return {
    step: async (patch: Partial<Status>) => {
      mockStatus.current = {...mockStatus.current, ...patch};
      view.rerender(tree());
      await act(() => Promise.resolve());
      await act(() => Promise.resolve());
    },
    unmount: async () => {
      view.unmount();
      await act(() => new Promise(resolve => setTimeout(resolve, 0)));
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  takeAutoplayStart(''); // clear a mark from an earlier test
  mockStore.playback.state = 'paused';
  mockStore.queue.currentIndex = 0;
  mockStatus.current = {
    isLoaded: true,
    playing: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    didJustFinish: false,
  };
});

describe('playback_paused and playback_resumed (TECH_DEBT #391 lines 2-3)', () => {
  it('a pause by the user mid-track sends playback_paused, and the resume sends playback_resumed', async () => {
    const p = await mount();
    await p.step({playing: true, duration: 300, currentTime: 1});
    await p.step({playing: false, currentTime: 120});
    await p.step({playing: true, currentTime: 120});

    expect(mockAnalytics.trackPlaybackPaused).toHaveBeenCalledTimes(1);
    expect(mockAnalytics.trackPlaybackPaused).toHaveBeenCalledWith(
      expect.objectContaining({surah_id: 1, position_ms: 120_000}),
    );
    expect(mockAnalytics.trackPlaybackResumed).toHaveBeenCalledTimes(1);
    expect(mockAnalytics.trackPlaybackResumed).toHaveBeenCalledWith(
      expect.objectContaining({surah_id: 1, position_ms: 120_000}),
    );
    await p.unmount();
  });

  it('the start of a track sends playback_started and no playback_resumed', async () => {
    const p = await mount();
    await p.step({playing: true, duration: 300, currentTime: 0});

    expect(mockAnalytics.trackPlaybackStarted).toHaveBeenCalledTimes(1);
    expect(mockAnalytics.trackPlaybackResumed).not.toHaveBeenCalled();
    await p.unmount();
  });

  it('the end of a track sends no playback_paused, and its listened time goes to playback_completed', async () => {
    const p = await mount();
    await p.step({playing: true, duration: 300, currentTime: 0});
    // iOS: the periodic time observer first reports the stop at the end...
    await p.step({playing: false, currentTime: 299.6});
    // ...then the end notification sets didJustFinish.
    await p.step({currentTime: 300, didJustFinish: true});

    expect(mockAnalytics.trackPlaybackPaused).not.toHaveBeenCalled();
    expect(mockAnalytics.trackPlaybackCompleted).toHaveBeenCalledTimes(1);
    await p.unmount();
  });

  it('the start of the next track after a track end sends no playback_resumed', async () => {
    const p = await mount();
    await p.step({playing: true, duration: 300, currentTime: 0});
    await p.step({playing: false, currentTime: 300, didJustFinish: true});
    mockStore.queue.currentIndex = 1;
    await p.step({
      playing: true,
      currentTime: 0,
      duration: 200,
      didJustFinish: false,
    });

    expect(mockAnalytics.trackPlaybackPaused).not.toHaveBeenCalled();
    expect(mockAnalytics.trackPlaybackResumed).not.toHaveBeenCalled();
    expect(mockAnalytics.trackPlaybackStarted).toHaveBeenCalledTimes(2);
    await p.unmount();
  });
});

describe('the automatic advance (TECH_DEBT #391 line 4)', () => {
  it('a track end advances with skipToNext({auto: true})', async () => {
    const p = await mount();
    await p.step({playing: true, duration: 300, currentTime: 0});
    await p.step({playing: false, currentTime: 300, didJustFinish: true});

    expect(mockStore.skipToNext).toHaveBeenCalledTimes(1);
    expect(mockStore.skipToNext).toHaveBeenCalledWith({auto: true});
    await p.unmount();
  });

  it("playback_started says 'autoplay' for the track that the advance marked", async () => {
    markAutoplayStart('r:2');
    mockStore.queue.currentIndex = 1;
    const p = await mount();
    await p.step({playing: true, duration: 200, currentTime: 0});

    expect(mockAnalytics.trackPlaybackStarted).toHaveBeenCalledWith(
      expect.objectContaining({surah_id: 2, source: 'autoplay'}),
    );
    await p.unmount();
  });

  it("playback_started says 'queue' for a track that the user started", async () => {
    const p = await mount();
    await p.step({playing: true, duration: 300, currentTime: 0});

    expect(mockAnalytics.trackPlaybackStarted).toHaveBeenCalledWith(
      expect.objectContaining({surah_id: 1, source: 'queue'}),
    );
    await p.unmount();
  });
});
