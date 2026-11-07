// @ai-generated
// Qariah (Sprint 48): playRecitation runs the same sequence as
// `handleRecitationPress` in components/browse/BrowseReciters.tsx.
import {playRecitation} from '../playRecitation';
import type {Reciter, Rewayat} from '@/data/reciterData';

const mockCalls: string[] = [];

jest.mock('@/services/dataService', () => ({
  getSurahById: (id: number) =>
    id === 2 ? {id: 2, name: 'Al-Baqarah'} : undefined,
}));
jest.mock('@/utils/track', () => ({
  createTracksForReciter: async (
    reciter: {id: string},
    surahs: {id: number}[],
    rewayatId?: string,
  ) => {
    mockCalls.push(
      `createTracks ${reciter.id} ${surahs.map(s => s.id).join(',')} ${rewayatId}`,
    );
    return [{id: 'track-2'}];
  },
}));
jest.mock('@/hooks/useSettings', () => ({
  useSettings: {
    getState: () => ({
      setReciterPreference: (reciterId: string, rewayatId: string) =>
        mockCalls.push(`preference ${reciterId} ${rewayatId}`),
    }),
  },
}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {
    getState: () => ({
      updateQueue: async (tracks: {id: string}[], index: number) =>
        mockCalls.push(
          `updateQueue ${tracks.map(t => t.id).join(',')} ${index}`,
        ),
      play: async () => mockCalls.push('play'),
    }),
  },
}));
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: {
    getState: () => ({
      startNewChain: async (
        reciter: {id: string},
        surah: {id: number},
        progress: number,
        duration: number,
        rewayatId?: string,
      ) =>
        mockCalls.push(
          `startNewChain ${reciter.id} ${surah.id} ${progress} ${duration} ${rewayatId}`,
        ),
    }),
  },
}));
jest.mock('@/services/player/sheetRef', () => ({
  expandPlayerSheet: () => mockCalls.push('expandPlayerSheet'),
}));

const rewayah = {id: 'rw2'} as Rewayat;
const reciter = {
  id: 'r1',
  name: 'Aisha',
  rewayat: [{id: 'rw1'} as Rewayat, rewayah],
} as Reciter;

describe('playRecitation', () => {
  beforeEach(() => {
    mockCalls.length = 0;
  });

  it('queues the surah of the rewayah, plays it, starts a chain and opens the player', async () => {
    await playRecitation(reciter, rewayah, 2);
    expect(mockCalls).toEqual([
      'preference r1 rw2',
      'createTracks r1 2 rw2',
      'updateQueue track-2 0',
      'play',
      'startNewChain r1 2 0 0 rw2',
      'expandPlayerSheet',
    ]);
  });

  it('does nothing for an unknown surah', async () => {
    await playRecitation(reciter, rewayah, 999);
    expect(mockCalls).toEqual([]);
  });
});
