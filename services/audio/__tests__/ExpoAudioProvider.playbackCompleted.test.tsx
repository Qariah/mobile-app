// @ai
// Qariah (Sprint 47, TECH_DEBT #296): `playback_completed` carries the
// recitation id (`rewayah_id`), in the same format as `playback_started` and
// `meaningful_listen`, so the dashboard can show a finish rate per riwayah.
// The provider sends the event when expo-audio reports `didJustFinish`.

import React from 'react';
import {View} from 'react-native';
import {render, act} from '@testing-library/react-native';

const mockTrack: Record<string, unknown> = {
  id: 't1',
  surahId: '2',
  reciterId: 'reciter-1',
  reciterName: 'Reciter One',
  rewayatId: 'warsh',
};

jest.mock('@/config/featureFlags', () => ({
  isFeatureEnabled: () => false,
}));

const mockPlayer = {playing: false, playbackRate: 1};
const mockService = {
  initialize: jest.fn(() => Promise.resolve()),
  setPlayer: jest.fn(),
  setRate: jest.fn(),
  seekTo: jest.fn(),
  play: jest.fn(),
};
const mockLockScreen = {
  startSync: jest.fn(() => Promise.resolve()),
  stopSync: jest.fn(),
};

jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockPlayer,
  createAudioPlayer: () => mockPlayer,
  useAudioPlayerStatus: () => ({
    isLoaded: false,
    playing: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    didJustFinish: true,
  }),
}));
jest.mock('@/services/widgets/syncWidgets', () => ({
  markPlayerReadyForWidgets: jest.fn(),
}));
jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackProgress: jest.fn(),
}));
jest.mock('@sentry/react-native', () => ({captureMessage: jest.fn()}));
// Lazy getters: the imports run before the `const` mocks above exist.
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
const mockTrackPlaybackCompleted = jest.fn();
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    get trackPlaybackCompleted() {
      return mockTrackPlaybackCompleted;
    },
  },
}));
jest.mock('@/services/player/store/playerStore', () => {
  const state = {
    playback: {state: 'paused', rate: 1},
    queue: {tracks: [] as unknown[], currentIndex: 0},
    settings: {repeatMode: 'none'},
    updatePlaybackState: jest.fn(),
    skipToNext: jest.fn(),
  };
  // Lazy: the track is a `const` declared above this factory's first use.
  Object.defineProperty(state.queue, 'tracks', {
    get: () => [mockTrack],
  });
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const usePlayerStore = selector => selector(state);
  usePlayerStore.getState = () => state;
  return {usePlayerStore};
});
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {getState: () => ({})},
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

async function mountAndFinishTrack(): Promise<void> {
  const view = render(
    <ExpoAudioProvider>
      <View />
    </ExpoAudioProvider>,
  );
  // The didJustFinish effect runs handleTrackEnd (async) after the mount.
  await act(() => Promise.resolve());
  await act(() => Promise.resolve());
  view.unmount();
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
}

describe('playback_completed carries rewayah_id (TECH_DEBT #296)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrack.rewayatId = 'warsh';
  });

  it('sends the finished track rewayah id, once', async () => {
    await mountAndFinishTrack();

    expect(mockTrackPlaybackCompleted).toHaveBeenCalledTimes(1);
    expect(mockTrackPlaybackCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        surah_id: 2,
        reciter_id: 'reciter-1',
        reciter_name: 'Reciter One',
        rewayah_id: 'warsh',
      }),
    );
  });

  it('sends an empty string when the track has no rewayah, as playback_started does', async () => {
    delete mockTrack.rewayatId;
    await mountAndFinishTrack();

    expect(mockTrackPlaybackCompleted).toHaveBeenCalledTimes(1);
    expect(mockTrackPlaybackCompleted.mock.calls[0][0]).toHaveProperty(
      'rewayah_id',
      '',
    );
  });
});
