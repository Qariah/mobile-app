// @ai
// Qariah (Sprint 47 Pass C, Task 4): upstream's ExpoAudioProvider starts the
// adhkar playback engine, the adhkar Live Activity sync, adhkar session saving
// and the saved-session restore at every provider init. Qariah ships with the
// `adhkar` flag off, so none of them may start: with no engine there is no
// adhkar session to take the lock screen entry or the car's next / previous.

import React from 'react';
import {View} from 'react-native';
import {render, act} from '@testing-library/react-native';

const mockFlags: Record<string, boolean> = {adhkar: false};
jest.mock('@/config/featureFlags', () => ({
  isFeatureEnabled: (flag: string) => mockFlags[flag] ?? false,
}));

const mockStopEngine = jest.fn();
const mockStartEngine = jest.fn(() => mockStopEngine);
const mockStartActivity = jest.fn(() => () => undefined);
const mockStartSaving = jest.fn(() => () => undefined);
const mockRestore = jest.fn(() => Promise.resolve());
jest.mock('@/services/adhkar/playback/adhkarPlaybackEngine', () => ({
  startAdhkarPlaybackEngine: () => mockStartEngine(),
}));
jest.mock('@/services/widgets/live-activity/syncAdhkarActivity', () => ({
  startAdhkarActivitySync: () => mockStartActivity(),
}));
jest.mock('@/services/adhkar/playback/sessionPersistence', () => ({
  startSessionSaving: () => mockStartSaving(),
  restoreSavedSession: () => mockRestore(),
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

// Mounts a provider, lets its init run, then unmounts it and lets the
// deferred cleanup run, so the next test starts with the sync stopped.
async function mountAndUnmount(): Promise<void> {
  const view = render(
    <ExpoAudioProvider>
      <View />
    </ExpoAudioProvider>,
  );
  await act(() => Promise.resolve());
  await act(() => Promise.resolve());
  view.unmount();
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
}

describe('ExpoAudioProvider adhkar boot gate (Sprint 47 Pass C)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not start the adhkar engine, activity, saving or restore when adhkar is off', async () => {
    mockFlags.adhkar = false;
    await mountAndUnmount();

    // The Quran player's lock screen sync still starts.
    expect(mockLockScreen.startSync).toHaveBeenCalledTimes(1);
    expect(mockStartEngine).not.toHaveBeenCalled();
    expect(mockStartActivity).not.toHaveBeenCalled();
    expect(mockStartSaving).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
    // The cleanup still stops the lock screen sync.
    expect(mockLockScreen.stopSync).toHaveBeenCalledTimes(1);
  });

  it('(safety) starts and stops them as upstream does when adhkar is on', async () => {
    mockFlags.adhkar = true;
    await mountAndUnmount();

    expect(mockStartEngine).toHaveBeenCalledTimes(1);
    expect(mockStartActivity).toHaveBeenCalledTimes(1);
    expect(mockStartSaving).toHaveBeenCalledTimes(1);
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(mockStopEngine).toHaveBeenCalledTimes(1);
  });
});
