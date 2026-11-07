// @ai
// Qariah (Sprint 47, TECH_DEBT #285): on a cold start the restore loads the
// saved track, and the source reports position 0 until the seek to the saved
// position lands. The provider saved that 0 as the session position (the
// store and the recent progress). When the app then stopped, the next restore
// (a tap on the widget's Play) started the track at 0:00. While the restore's
// seek is pending, the provider must not save the reported position.

import React from 'react';
import {AppState, AppStateStatus, View} from 'react-native';
import {render, act} from '@testing-library/react-native';

let mockSeekPending = false;
const mockUpdatePlaybackState = jest.fn();
const mockUpdateProgress = jest.fn();

jest.mock('@/services/player/utils/restoreSession', () => ({
  isRestoreSeekPending: () => mockSeekPending,
}));
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

// The restored source has loaded and is paused at 0: the seek has not landed.
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockPlayer,
  createAudioPlayer: () => mockPlayer,
  useAudioPlayerStatus: () => ({
    isLoaded: true,
    playing: false,
    isBuffering: false,
    currentTime: 0,
    duration: 494,
    didJustFinish: false,
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
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {},
}));
jest.mock('@/services/player/store/playerStore', () => {
  const state = {
    playback: {state: 'paused', rate: 1, position: 14.5},
    queue: {
      tracks: [{id: 't1', surahId: '51', reciterId: 'r1', reciterName: 'R'}],
      currentIndex: 0,
    },
    settings: {repeatMode: 'none'},
    skipToNext: jest.fn(),
  };
  // Lazy: the mock function is a `const` declared above this factory.
  Object.defineProperty(state, 'updatePlaybackState', {
    get: () => mockUpdatePlaybackState,
  });
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const usePlayerStore = selector => selector(state);
  usePlayerStore.getState = () => state;
  return {usePlayerStore};
});
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {
    getState: () => ({updateProgress: mockUpdateProgress}),
  },
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

const appStateListeners: ((state: AppStateStatus) => void)[] = [];

async function mountThenBackground(): Promise<void> {
  const view = render(
    <ExpoAudioProvider>
      <View />
    </ExpoAudioProvider>,
  );
  await act(() => Promise.resolve());
  // The user leaves the app before the seek lands.
  act(() => appStateListeners.forEach(listener => listener('background')));
  view.unmount();
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
}

describe('the restore keeps the saved position (TECH_DEBT #285)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appStateListeners.length = 0;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      appStateListeners.push(cb as (state: AppStateStatus) => void);
      return {remove: jest.fn()} as unknown as ReturnType<
        typeof AppState.addEventListener
      >;
    });
  });

  it('does not save the reported 0 while the restore seek is pending', async () => {
    mockSeekPending = true;
    await mountThenBackground();

    for (const [update] of mockUpdatePlaybackState.mock.calls) {
      expect(update).not.toHaveProperty('position');
    }
    expect(mockUpdatePlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({duration: 494}),
    );
    expect(mockUpdateProgress).not.toHaveBeenCalled();
  });

  it('saves the reported position when no restore seek is pending', async () => {
    mockSeekPending = false;
    await mountThenBackground();

    expect(mockUpdatePlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({position: 0}),
    );
    expect(mockUpdateProgress).toHaveBeenCalledWith('r1', 51, 0, 494);
  });
});
