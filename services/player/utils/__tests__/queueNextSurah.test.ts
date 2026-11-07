// @ai Qariah (GitHub #557): at the end of the queue, queue the next surah by
// the same reciter and rewayah. The store and the catalog are fakes.
import type {Track} from '@/types/audio';

type FakeState = {
  queue: {tracks: Track[]; currentIndex: number};
  addToQueue: jest.Mock;
};

const mockState: FakeState = {
  queue: {tracks: [], currentIndex: 0},
  addToQueue: jest.fn(),
};

jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {getState: () => mockState},
}));

const mockReciters: Record<string, unknown> = {};
jest.mock('@/services/dataService', () => ({
  getReciterByIdSync: (id: string) => mockReciters[id],
  getSurahById: (id: number) =>
    id >= 1 && id <= 114 ? {id, name: `Surah ${id}`} : undefined,
}));

// The surahs with a download: createTrack gives the local file (generateSmartAudioUrl).
const mockDownloaded = new Set<string>();
/** Runs inside createTrack's await: a test can change the queue there. */
const mockDuringCreate = {run: () => undefined as void};
const mockCreateTrack = jest.fn(
  async (
    reciter: {id: string; name: string},
    surah: {id: number; name: string},
    rewayatId: string,
  ) => {
    mockDuringCreate.run();
    return {
      id: `${reciter.id}-${surah.id}`,
      url: mockDownloaded.has(String(surah.id))
        ? `file:///Documents/${reciter.id}-${surah.id}.mp3`
        : `https://cdn.example.com/${reciter.id}/${rewayatId}/${surah.id}.mp3`,
      title: surah.name,
      artist: reciter.name,
      artwork: 'https://cdn.example.com/photo.jpg',
      surahId: String(surah.id),
      reciterId: reciter.id,
      reciterName: reciter.name,
      duration: 0,
      rewayatId,
    };
  },
);
jest.mock('@/utils/track', () => ({
  createTrack: (...args: Parameters<typeof mockCreateTrack>) =>
    mockCreateTrack(...args),
}));

const mockNetwork = {isOnline: true};
jest.mock('@/store/networkStore', () => ({
  useNetworkStore: {getState: () => mockNetwork},
}));

import {queueNextSurah} from '../queueNextSurah';
import {markPlaylistTracks} from '../queueSource';

function rewayah(id: string, surahList: number[]) {
  return {id, reciter_id: 'r1', surah_list: surahList};
}

const ALL_SURAHS = Array.from({length: 114}, (_, i) => i + 1);

function track(surahId: string, extra: Partial<Track> = {}): Track {
  return {
    id: `r1-${surahId}`,
    url: `https://cdn.example.com/r1/hafs/${surahId}.mp3`,
    title: `Surah ${surahId}`,
    artist: 'Reciter One',
    reciterId: 'r1',
    reciterName: 'Reciter One',
    surahId,
    rewayatId: 'hafs',
    ...extra,
  };
}

function setQueue(tracks: Track[], currentIndex = tracks.length - 1): void {
  mockState.queue = {tracks, currentIndex};
}

/** The one track that queueNextSurah appended. */
function appended(): Track {
  expect(mockState.addToQueue).toHaveBeenCalledTimes(1);
  const [tracks] = mockState.addToQueue.mock.calls[0] as [Track[]];
  expect(tracks).toHaveLength(1);
  return tracks[0];
}

describe('queueNextSurah (#557)', () => {
  beforeEach(() => {
    mockState.addToQueue = jest.fn(() => Promise.resolve());
    mockCreateTrack.mockClear();
    mockDuringCreate.run = () => undefined;
    mockDownloaded.clear();
    mockNetwork.isOnline = true;
    for (const key of Object.keys(mockReciters)) delete mockReciters[key];
    mockReciters.r1 = {
      id: 'r1',
      name: 'Reciter One',
      rewayat: [rewayah('hafs', [1, 2, 78, 79, 114]), rewayah('warsh', [1, 3])],
    };
    mockReciters.r2 = {
      id: 'r2',
      name: 'Reciter Two',
      rewayat: [rewayah('r2-hafs', ALL_SURAHS)],
    };
  });

  it('a one-surah user playlist stops (PLY-13): its track carries the playlist mark', async () => {
    setQueue(markPlaylistTracks([track('78')]));

    await expect(queueNextSurah()).resolves.toBe(false);

    expect(mockCreateTrack).not.toHaveBeenCalled();
    expect(mockState.addToQueue).not.toHaveBeenCalled();
  });

  it('a playlist queue stops also when the user added a surah to it (PLY-13)', async () => {
    setQueue([...markPlaylistTracks([track('1')]), track('2')]);

    await expect(queueNextSurah()).resolves.toBe(false);

    expect(mockState.addToQueue).not.toHaveBeenCalled();
  });

  it('a one-surah play continues: it appends the next surah, built by createTrack', async () => {
    setQueue([track('78')]);

    await expect(queueNextSurah()).resolves.toBe(true);

    expect(mockCreateTrack).toHaveBeenCalledWith(
      expect.objectContaining({id: 'r1'}),
      {id: 79, name: 'Surah 79'},
      'hafs',
    );
    expect(appended()).toEqual({
      id: 'r1-79',
      url: 'https://cdn.example.com/r1/hafs/79.mp3',
      title: 'Surah 79',
      artist: 'Reciter One',
      artwork: 'https://cdn.example.com/photo.jpg',
      surahId: '79',
      reciterId: 'r1',
      reciterName: 'Reciter One',
      duration: 0,
      rewayatId: 'hafs',
    });
  });

  it('skips the surahs that the reciter does not have', async () => {
    setQueue([track('2')]);
    await queueNextSurah();
    expect(appended().surahId).toBe('78');
  });

  it('keeps the rewayah of the track', async () => {
    setQueue([track('1', {rewayatId: 'warsh'})]);
    await queueNextSurah();
    const next = appended();
    expect(next.surahId).toBe('3');
    expect(next.rewayatId).toBe('warsh');
  });

  it('stops after the reciter last surah', async () => {
    setQueue([track('114')]);
    await expect(queueNextSurah()).resolves.toBe(false);
    expect(mockState.addToQueue).not.toHaveBeenCalled();
  });

  it('adds nothing while a real queue item is still to play', async () => {
    setQueue([track('1'), track('36')], 0);
    await expect(queueNextSurah()).resolves.toBe(false);
    expect(mockState.addToQueue).not.toHaveBeenCalled();
  });

  it('a reciter-profile queue (78 to 114, then 1 to 77) stops after its last item: it holds every surah', async () => {
    setQueue([track('78'), track('79'), track('114'), track('1'), track('2')]);
    await expect(queueNextSurah()).resolves.toBe(false);
  });

  it('a run that wrapped continues where the rewayah has a surah that the queue does not hold', async () => {
    setQueue([track('79'), track('114'), track('1')]);
    await queueNextSurah();
    expect(appended().surahId).toBe('2');
  });

  it('a queue that the continuation built (78, 79) continues', async () => {
    setQueue([track('78'), track('79')]);
    await queueNextSurah();
    expect(appended().surahId).toBe('114');
  });

  // PR #700 review: the owner asked for a single surah play, not for every queue.
  it('a two-reciter playlist stops at its end', async () => {
    setQueue([
      track('36', {reciterId: 'r2', rewayatId: 'r2-hafs'}),
      track('78'),
    ]);
    await expect(queueNextSurah()).resolves.toBe(false);
    expect(mockState.addToQueue).not.toHaveBeenCalled();
  });

  it('a curated-playlist Play All (one reciter, 36, 55, 56, 67) stops at its end', async () => {
    const r2 = {reciterId: 'r2', rewayatId: 'r2-hafs'};
    setQueue([
      track('36', r2),
      track('55', r2),
      track('56', r2),
      track('67', r2),
    ]);
    await expect(queueNextSurah()).resolves.toBe(false);
    expect(mockState.addToQueue).not.toHaveBeenCalled();
  });

  it('a profile list sorted in descending order stops at its end', async () => {
    setQueue([track('114'), track('79'), track('78')]);
    await expect(queueNextSurah()).resolves.toBe(false);
  });

  it('a queue of two rewayat of the same reciter stops at its end', async () => {
    setQueue([track('1', {rewayatId: 'warsh'}), track('78')]);
    await expect(queueNextSurah()).resolves.toBe(false);
  });

  it('a queue with an upload stops at its end', async () => {
    setQueue([track('1', {isUserUpload: true}), track('2')]);
    await expect(queueNextSurah()).resolves.toBe(false);
  });

  it('(safety) the queue changed during createTrack: nothing is appended', async () => {
    setQueue([track('78')]);
    mockDuringCreate.run = () => setQueue([track('1')]);
    await expect(queueNextSurah()).resolves.toBe(false);
    expect(mockState.addToQueue).not.toHaveBeenCalled();
  });

  it('does not continue an upload', async () => {
    setQueue([track('1', {isUserUpload: true})]);
    await expect(queueNextSurah()).resolves.toBe(false);
  });

  it('does not continue when the catalog does not know the reciter', async () => {
    setQueue([track('1', {reciterId: 'gone'})]);
    await expect(queueNextSurah()).resolves.toBe(false);
  });

  it('does not guess a rewayah for a track with no rewayah id', async () => {
    setQueue([track('1', {rewayatId: undefined})]);
    await expect(queueNextSurah()).resolves.toBe(false);
  });

  it('uses the single rewayah of a reciter when the track has no rewayah id', async () => {
    mockReciters.r1 = {
      id: 'r1',
      name: 'Reciter One',
      rewayat: [rewayah('hafs', [1, 2])],
    };
    setQueue([track('1', {rewayatId: undefined})]);
    await queueNextSurah();
    expect(appended().rewayatId).toBe('hafs');
  });

  // Review M2: offline, a stream would settle the player on a surah that cannot play.
  it('offline: does not queue a next surah that would stream', async () => {
    mockNetwork.isOnline = false;
    setQueue([track('78')]);

    await expect(queueNextSurah()).resolves.toBe(false);
    expect(mockState.addToQueue).not.toHaveBeenCalled();
  });

  it('offline: a downloaded next surah still plays', async () => {
    mockNetwork.isOnline = false;
    mockDownloaded.add('79');
    setQueue([track('78')]);

    await expect(queueNextSurah()).resolves.toBe(true);
    expect(appended().url).toBe('file:///Documents/r1-79.mp3');
  });

  it('does nothing with an empty queue', async () => {
    setQueue([], -1);
    await expect(queueNextSurah()).resolves.toBe(false);
  });
});
