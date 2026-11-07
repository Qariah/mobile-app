// @ai
// PLY-S8 (divergence batch C3): the QF pushes moved out of the inherited
// player stores into `playerStoreSync.ts`. These tests pin that the pushes
// are the same as when the stores made them: the same calls, and no push for
// the writes that did not push before (persist hydration, reset, auto-advance
// and progress writes).

import type {Reciter} from '@/data/reciterData';
import type {Surah} from '@/data/surahData';

const mockDisk: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) =>
      Object.prototype.hasOwnProperty.call(mockDisk, key)
        ? mockDisk[key]
        : null,
    ),
    setItem: jest.fn(async (key: string, value: string) => {
      mockDisk[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete mockDisk[key];
    }),
  },
}));

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// The recently-played store reads the player queue only for a queue
// auto-advance to a new reciter.
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {
    getState: () => ({queue: {tracks: [], currentIndex: 0}}),
  },
}));

const mockEnqueueFavoritesSync = jest.fn();
const mockEnqueueReadingSessionSync = jest.fn();
jest.mock('../syncBus', () => ({
  enqueueFavoritesSync: (ids: string[]) => mockEnqueueFavoritesSync(ids),
  enqueueReadingSessionSync: (payload: unknown) =>
    mockEnqueueReadingSessionSync(payload),
}));

import {useFavoriteRecitersStore} from '@/services/player/store/favoriteRecitersStore';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {installPlayerStoreSync} from '../playerStoreSync';

function reciter(id: string): Reciter {
  return {id, name: id, rewayat: []} as unknown as Reciter;
}

function surah(id: number): Surah {
  return {id, name: `surah-${id}`} as unknown as Surah;
}

beforeAll(async () => {
  // Let both stores finish their first (empty) hydration.
  await useFavoriteRecitersStore.persist.rehydrate();
  await useRecentlyPlayedStore.persist.rehydrate();
  installPlayerStoreSync();
  // A second call must not wrap the actions twice.
  installPlayerStoreSync();
});

beforeEach(() => {
  useFavoriteRecitersStore.getState().reset();
  useRecentlyPlayedStore.getState().reset();
  mockEnqueueFavoritesSync.mockClear();
  mockEnqueueReadingSessionSync.mockClear();
});

describe('favourites push', () => {
  it('pushes the full list once when a reciter is added', () => {
    useFavoriteRecitersStore.getState().addFavoriteReciter(reciter('a'));
    useFavoriteRecitersStore.getState().addFavoriteReciter(reciter('b'));

    expect(mockEnqueueFavoritesSync.mock.calls).toEqual([
      [['a']],
      [['a', 'b']],
    ]);
  });

  it('does not push when the reciter is already a favourite', () => {
    useFavoriteRecitersStore.getState().addFavoriteReciter(reciter('a'));
    mockEnqueueFavoritesSync.mockClear();

    useFavoriteRecitersStore.getState().addFavoriteReciter(reciter('a'));

    expect(mockEnqueueFavoritesSync).not.toHaveBeenCalled();
  });

  it('pushes on every remove, also for a reciter that is not a favourite', () => {
    useFavoriteRecitersStore.getState().addFavoriteReciter(reciter('a'));
    mockEnqueueFavoritesSync.mockClear();

    useFavoriteRecitersStore.getState().removeFavoriteReciter('x');
    useFavoriteRecitersStore.getState().removeFavoriteReciter('a');

    expect(mockEnqueueFavoritesSync.mock.calls).toEqual([[['a']], [[]]]);
  });

  it('pushes through toggle, which calls add and remove', () => {
    useFavoriteRecitersStore.getState().toggleFavoriteReciter(reciter('a'));
    useFavoriteRecitersStore.getState().toggleFavoriteReciter(reciter('a'));

    expect(mockEnqueueFavoritesSync.mock.calls).toEqual([[['a']], [[]]]);
  });

  it('does not push on reset or on a persist hydration', async () => {
    mockDisk['player-favorite-reciters-storage'] = JSON.stringify({
      state: {
        favoriteReciterIds: ['stored'],
        favoriteReciters: {stored: {id: 'stored', favoritedAt: 1}},
      },
      version: 0,
    });

    await useFavoriteRecitersStore.persist.rehydrate();
    expect(useFavoriteRecitersStore.getState().favoriteReciterIds).toEqual([
      'stored',
    ]);
    useFavoriteRecitersStore.getState().reset();

    expect(mockEnqueueFavoritesSync).not.toHaveBeenCalled();

    // The hydration merge keeps the wrapped actions.
    useFavoriteRecitersStore.getState().addFavoriteReciter(reciter('c'));
    expect(mockEnqueueFavoritesSync.mock.calls).toEqual([[['c']]]);
  });
});

describe('reading-session push', () => {
  it('pushes a reading session for an explicit play (startNewChain)', () => {
    useRecentlyPlayedStore
      .getState()
      .startNewChain(reciter('a'), surah(18), 0.5, 300, 'rw-a');

    expect(mockEnqueueReadingSessionSync.mock.calls).toEqual([
      [{reciterId: 'a', surahNumber: 18, ayahNumber: 1}],
    ]);
    expect(useRecentlyPlayedStore.getState().recentTracks[0]).toMatchObject({
      rewayatId: 'rw-a',
      progress: 0.5,
      duration: 300,
    });
  });

  it('pushes again when the same track starts again', () => {
    const rs = useRecentlyPlayedStore.getState();
    rs.startNewChain(reciter('a'), surah(18), 0, 0, 'rw-a');
    rs.startNewChain(reciter('a'), surah(18), 0, 0, 'rw-a');

    expect(mockEnqueueReadingSessionSync).toHaveBeenCalledTimes(2);
  });

  it('does not push for auto-advance or progress writes', () => {
    const rs = useRecentlyPlayedStore.getState();
    rs.updateActiveChain(reciter('a'), surah(18), 0, 0, 'rw-a');
    rs.updateProgress('a', 18, 10, 300);

    expect(mockEnqueueReadingSessionSync).not.toHaveBeenCalled();
  });
});
