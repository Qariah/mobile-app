// @ai
// Qariah (Sprint 47, TECH_DEBT #285): the Continue Listening widget's Play on
// a stopped app. The app starts, restoreSession loads the saved track and
// seeks to the saved position, then the widget command plays. Android reports
// isLoaded false while the player buffers after that seek. The command must
// play the source that the player holds at the saved position. It must not
// load the track again at the store position, which can still be the 0 that
// the source reported before the seek.

import {handleWidgetCommand} from '../handleWidgetCommand';
import {loadAudioInBackground} from '@/services/player/utils/restoreSession';

const URL = 'https://cdn.example/reciter/051.mp3';
const SAVED_SEC = 14.5;

const mockCalls: string[] = [];
const mockAudio = {
  generation: 0,
  held: null as string | null,
  // ExoPlayer STATE_READY.
  ready: false,
};
const mockStore = {
  queue: {tracks: [{url: URL}], currentIndex: 0},
  // The status before the restore's seek reported position 0.
  playback: {state: 'paused', position: 0},
  play: async () => {
    mockCalls.push('play');
  },
  updateQueue: async (_tracks: unknown, _index: number, startSec: number) => {
    mockCalls.push(`updateQueue@${startSec}`);
  },
};

jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {
    loadTrack: async (url: string) => {
      mockAudio.generation += 1;
      mockAudio.held = url;
      mockAudio.ready = true;
      mockCalls.push('loadTrack');
    },
    seekTo: async (sec: number) => {
      // Android buffers after a seek: isLoaded is false until data comes.
      mockAudio.ready = false;
      mockCalls.push(`seekTo:${sec}`);
    },
    getIsLoaded: () => mockAudio.ready,
    holdsSource: (url: string) => mockAudio.held === url,
    getLoadGeneration: () => mockAudio.generation,
  },
}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {getState: () => mockStore},
  currentPlayOpId: () => 0,
}));
jest.mock('@/utils/track', () => ({}));
jest.mock('@/services/dataService', () => ({}));
jest.mock('@/utils/audioUtils', () => ({}));
jest.mock('@/utils/artworkUtils', () => ({}));
jest.mock('@/store/uploadsStore', () => ({useUploadsStore: {}}));
jest.mock('@/store/reciterStore', () => ({useReciterStore: {}}));
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {},
}));
jest.mock('@/services/timestamps/TimestampService', () => ({
  timestampService: {},
}));
jest.mock('@/services/timestamps/TimingNumberingService', () => ({
  timingNumberingService: {},
}));
jest.mock('@/services/player/utils/resumeRecent', () => ({
  resumeRecent: jest.fn(),
}));

describe('widget Play after a cold restore (TECH_DEBT #285)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCalls.length = 0;
    mockAudio.generation = 0;
    mockAudio.held = null;
    mockAudio.ready = false;
  });
  afterEach(() => jest.useRealTimers());

  it('plays the restored source at the saved position, with no reload', async () => {
    loadAudioInBackground(URL, SAVED_SEC);
    const command = handleWidgetCommand({type: 'setPlayback', playing: true});
    // The restore's load starts after its 100 ms deferral.
    await jest.advanceTimersByTimeAsync(100);
    await command;

    expect(mockCalls).toEqual(['loadTrack', `seekTo:${SAVED_SEC}`, 'play']);
  });

  it('loads at the saved position when the player holds no source', async () => {
    // The restore loaded nothing (for example, a load error).
    mockStore.playback.position = SAVED_SEC;
    await handleWidgetCommand({type: 'setPlayback', playing: true});

    expect(mockCalls).toEqual([`updateQueue@${SAVED_SEC}`]);
    mockStore.playback.position = 0;
  });
});
