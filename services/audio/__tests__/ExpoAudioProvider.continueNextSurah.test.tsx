// @ai
// Qariah (GitHub #557): when a surah ends and the queue has no next item, the
// provider asks `queueNextSurah()` for the next surah by the same reciter and
// skips to it. A real queue item plays first, repeat modes keep their
// behaviour, and with `branding.continueToNextSurah` off the player stops as
// upstream's does.

import React from 'react';
import {View} from 'react-native';
import {render, act} from '@testing-library/react-native';

// The real branding, with `continueToNextSurah` read from mockBranding.
const mockBranding = {continueToNextSurah: true};
jest.mock('@/config/branding', () => {
  const actual = jest.requireActual('@/config/branding');
  const real = actual.default ?? actual;
  const branding = new Proxy(real, {
    get: (target, key) =>
      key === 'continueToNextSurah'
        ? mockBranding.continueToNextSurah
        : target[key],
  });
  return {__esModule: true, default: branding};
});

const mockQueueNextSurah = jest.fn();
jest.mock('@/services/player/utils/queueNextSurah', () => ({
  queueNextSurah: () => mockQueueNextSurah(),
}));

jest.mock('@/config/featureFlags', () => ({
  isFeatureEnabled: () => false,
}));

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
jest.mock('@/services/notifications/playbackEvents', () => ({
  notePlaybackCompleted: jest.fn(),
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
  analyticsService: {trackPlaybackCompleted: jest.fn()},
}));

const mockStore = {
  playback: {state: 'playing', rate: 1},
  queue: {tracks: [] as unknown[], currentIndex: 0},
  settings: {repeatMode: 'none'},
  updatePlaybackState: jest.fn(),
  skipToNext: jest.fn(() => Promise.resolve()),
};
jest.mock('@/services/player/store/playerStore', () => {
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const usePlayerStore = selector => selector(mockStore);
  usePlayerStore.getState = () => mockStore;
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

import {ExpoAudioProvider} from '../ExpoAudioProvider';

function track(surahId: string) {
  return {
    id: `r1:${surahId}`,
    url: `https://cdn.example.com/${surahId}.mp3`,
    surahId,
    reciterId: 'r1',
    reciterName: 'Reciter One',
    rewayatId: 'hafs',
  };
}

async function mountAndFinishTrack(): Promise<void> {
  const view = render(
    <ExpoAudioProvider>
      <View />
    </ExpoAudioProvider>,
  );
  // The didJustFinish effect runs handleTrackEnd (async) after the mount.
  for (let i = 0; i < 4; i++) await act(() => Promise.resolve());
  view.unmount();
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
}

describe('the end of the queue plays the next surah by the same reciter (#557)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBranding.continueToNextSurah = true;
    mockStore.settings.repeatMode = 'none';
    mockStore.queue = {tracks: [track('78')], currentIndex: 0};
    mockQueueNextSurah.mockResolvedValue(true);
  });

  it('queues the next surah and skips to it', async () => {
    await mountAndFinishTrack();

    expect(mockQueueNextSurah).toHaveBeenCalledTimes(1);
    expect(mockStore.skipToNext).toHaveBeenCalledTimes(1);
    expect(mockQueueNextSurah.mock.invocationCallOrder[0]).toBeLessThan(
      mockStore.skipToNext.mock.invocationCallOrder[0],
    );
    expect(mockStore.updatePlaybackState).not.toHaveBeenCalledWith({
      state: 'ended',
    });
  });

  it('ends playback after the reciter last surah', async () => {
    mockQueueNextSurah.mockResolvedValue(false);

    await mountAndFinishTrack();

    expect(mockStore.skipToNext).not.toHaveBeenCalled();
    expect(mockStore.updatePlaybackState).toHaveBeenCalledWith({
      state: 'ended',
    });
  });

  it('plays a real queue item first, without asking for a next surah', async () => {
    mockStore.queue = {tracks: [track('78'), track('36')], currentIndex: 0};

    await mountAndFinishTrack();

    expect(mockStore.skipToNext).toHaveBeenCalledTimes(1);
    expect(mockQueueNextSurah).not.toHaveBeenCalled();
  });

  it('keeps repeat-queue: it loops the queue', async () => {
    mockStore.settings.repeatMode = 'queue';

    await mountAndFinishTrack();

    expect(mockStore.skipToNext).toHaveBeenCalledTimes(1);
    expect(mockQueueNextSurah).not.toHaveBeenCalled();
  });

  it('keeps repeat-track: it restarts the same surah', async () => {
    mockStore.settings.repeatMode = 'track';

    await mountAndFinishTrack();

    expect(mockService.seekTo).toHaveBeenCalledWith(0);
    expect(mockService.play).toHaveBeenCalledTimes(1);
    expect(mockQueueNextSurah).not.toHaveBeenCalled();
    expect(mockStore.skipToNext).not.toHaveBeenCalled();
  });

  it('stops at the end of the queue when the branding option is off', async () => {
    mockBranding.continueToNextSurah = false;

    await mountAndFinishTrack();

    expect(mockQueueNextSurah).not.toHaveBeenCalled();
    expect(mockStore.skipToNext).not.toHaveBeenCalled();
    expect(mockStore.updatePlaybackState).toHaveBeenCalledWith({
      state: 'ended',
    });
  });
});
