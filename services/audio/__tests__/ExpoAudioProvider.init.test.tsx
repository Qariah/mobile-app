// @ai
// Regression test for the review of d16b73bb, L3. ExpoAudioProvider called
// expoAudioService.setPlayer() only after `await initialize()` succeeded. When
// initialize() threw (setAudioModeAsync failed), the player was never set, so
// every play() and loadTrack() waited PLAYER_WAIT_MS and then played nothing.

import React from 'react';
import {View} from 'react-native';
import {render, act} from '@testing-library/react-native';

const mockPlayer = {playing: false, playbackRate: 1};
const mockService = {
  initialize: jest.fn(),
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
  // Upstream Pass B: the provider owns one shared player (createAudioPlayer).
  createAudioPlayer: () => mockPlayer,
  useAudioPlayerStatus: () => ({
    isLoaded: false,
    playing: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    didJustFinish: false,
  }),
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
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {},
}));
jest.mock('@/services/player/store/playerStore', () => {
  const state = {
    playback: {state: 'paused', rate: 1},
    queue: {tracks: [], currentIndex: -1},
    settings: {repeatMode: 'none'},
    updatePlaybackState: jest.fn(),
    skipToNext: jest.fn(),
  };
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

describe('ExpoAudioProvider player injection (review L3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets the player even when initialize() throws', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      mockService.initialize.mockRejectedValueOnce(
        new Error('setAudioModeAsync failed'),
      );
      render(
        <ExpoAudioProvider>
          <View />
        </ExpoAudioProvider>,
      );
      // Flush the mount effect and its awaits.
      await act(() => Promise.resolve());

      expect(mockService.setPlayer).toHaveBeenCalledWith(mockPlayer);
      expect(mockLockScreen.startSync).toHaveBeenCalled();
      // The error is still reported.
      expect(errorSpy).toHaveBeenCalledWith(
        '[ExpoAudioProvider] Failed to initialize:',
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('(safety) sets the player after a successful initialize()', async () => {
    mockService.initialize.mockResolvedValueOnce(undefined);
    render(
      <ExpoAudioProvider>
        <View />
      </ExpoAudioProvider>,
    );
    await act(() => Promise.resolve());

    expect(mockService.initialize).toHaveBeenCalledTimes(1);
    expect(mockService.setPlayer).toHaveBeenCalledWith(mockPlayer);
    expect(mockService.initialize.mock.invocationCallOrder[0]).toBeLessThan(
      mockService.setPlayer.mock.invocationCallOrder[0],
    );
  });
});
