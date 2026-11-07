// @ai
// Qariah (PLY-13): a user playlist that the car starts marks its tracks, so the
// end of the playlist stops (queueNextSurah reads the mark). A curated (system)
// playlist and other car requests queue unmarked tracks, as before.
const mockUpdateQueue = jest.fn(async () => undefined);
const mockPlay = jest.fn(async () => undefined);

jest.mock('@/modules/bayaan-car', () => ({BayaanCar: {isAvailable: false}}));
jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {waitForPlayer: () => Promise.resolve()},
}));
jest.mock('@/services/audio/LockScreenService', () => ({
  lockScreenService: {setCarMode: jest.fn()},
}));
jest.mock('@/services/car/carAyah', () => ({startCarAyahTracker: jest.fn()}));
jest.mock('@/services/adhkar/playback/trackControls', () => ({
  skipAdhkarTrack: jest.fn(),
}));
jest.mock('@/i18n/format', () => ({
  getTrackArtistDisplay: (t: {artist: string}) => t.artist,
}));
jest.mock('@/data/reciterData', () => ({RECITERS: [{id: 'r1'}]}));
jest.mock('@/data/systemPlaylists', () => ({getSystemPlaylists: () => []}));
jest.mock('@/utils/track', () => ({
  addUploadToRecentlyPlayed: jest.fn(),
  createTrack: jest.fn(async (_r: unknown, s: {id: number}) => ({
    id: `t${s.id}`,
    url: `https://example.invalid/${s.id}.mp3`,
    title: `Surah ${s.id}`,
    artist: 'Reciter',
    reciterId: 'r1',
    surahId: String(s.id),
  })),
  createUserUploadTrack: jest.fn(),
  shuffleTracks: (t: unknown[]) => t,
}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {
    getState: () => ({updateQueue: mockUpdateQueue, play: mockPlay}),
  },
}));
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {getState: () => ({})},
}));
jest.mock('@/services/player/store/lovedStore', () => ({useLovedStore: {}}));
jest.mock('@/services/player/store/downloadStore', () => ({
  useDownloadStore: {},
}));
jest.mock('@/services/car/CarSnapshotService', () => ({
  getLastResolveContext: () => ({uploads: [], recentTracks: []}),
  writeCarSnapshotNow: jest.fn(),
}));
jest.mock('@/services/car/sessionGate', () => ({
  markCarReplacedQueue: jest.fn(),
  waitForSessionRestored: jest.fn(),
}));
jest.mock('@/services/car/playback/resolveCarRequest', () => ({
  resolveCarRequest: () => ({
    tracks: [{reciterId: 'r1', rewayatId: 'w1', surahId: 112}],
    startIndex: 0,
    startPosition: 0,
    shuffle: false,
    chain: 'none',
  }),
  isUploadSpec: () => false,
}));

import {executeCarRequest} from '../CarPlaybackBridge';
import {isFromPlaylist} from '@/services/player/utils/queueSource';
import type {Track} from '@/types/audio';

function queuedTracks(): Track[] {
  const calls = mockUpdateQueue.mock.calls as unknown as [Track[]][];
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  mockUpdateQueue.mockClear();
  mockPlay.mockClear();
});

describe('executeCarRequest — the playlist mark (PLY-13)', () => {
  it('marks the tracks of a user playlist', async () => {
    await executeCarRequest({
      kind: 'playlist',
      playlistId: 'p1',
      system: false,
    });
    expect(queuedTracks()).toHaveLength(1);
    expect(queuedTracks().every(isFromPlaylist)).toBe(true);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('does not mark a curated (system) playlist', async () => {
    await executeCarRequest({kind: 'playlist', playlistId: 's1', system: true});
    expect(queuedTracks().some(isFromPlaylist)).toBe(false);
  });
});
