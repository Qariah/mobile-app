// @ai-generated
// Qariah (Sprint 51, GitHub #555): with `branding.systemPlaylistSurahPress:
// 'browse-reciters'`, a tap on a surah of a curated playlist opens the reciter
// list of that surah and plays nothing. With 'play' (the upstream behaviour)
// the tap plays the playlist with the suggested reciter.

import React from 'react';
import {render, fireEvent, waitFor} from '@testing-library/react-native';
import branding from '@/config/branding';
import SystemPlaylistDetail from '@/components/system-playlist/SystemPlaylistDetail';
import type {SystemPlaylist} from '@/data/systemPlaylists';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({push: mockPush, back: jest.fn()}),
  useNavigation: () => ({setOptions: jest.fn()}),
}));
jest.mock('expo-router/react-navigation', () => ({useHeaderHeight: () => 0}));
jest.mock('@/hooks/useGlassProps', () => ({USE_GLASS: false}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        text: '#111111',
        textSecondary: '#666666',
        background: '#ffffff',
        border: '#dddddd',
      },
      fonts: {regular: 'R', medium: 'M', semiBold: 'S'},
    },
    isDarkMode: false,
  }),
}));

jest.mock('react-native-size-matters', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  moderateScale: value => value,
}));

const mockReciter = {
  id: 'r-1',
  name: 'Test Reciter',
  date: null,
  image_url: null,
  rewayat: [
    {
      id: 'rw-1',
      reciter_id: 'r-1',
      name: 'Hafs',
      style: 'murattal',
      server: 'https://cdn.example/r-1',
      surah_total: 2,
      surah_list: [36, 67],
      source_type: 'qariah',
      created_at: '2026-01-01',
    },
  ],
};

jest.mock('@/services/dataService', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  getSurahById: async id =>
    jest.requireActual('@/data/surahData').SURAHS[id - 1],
  getReciterById: async () => undefined,
  getAllReciters: async () => [],
}));
jest.mock('@/data/featuredReciters', () => ({
  getFeaturedReciters: () => [mockReciter],
}));

const mockActions = {
  updateQueue: jest.fn(async () => undefined),
  addToQueue: jest.fn(async () => undefined),
  play: jest.fn(async () => undefined),
};
jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => mockActions,
}));
jest.mock('@/utils/track', () => ({
  createTrack: jest.fn(async (reciter, surah) => ({
    id: `${reciter.id}:${surah.id}`,
    surahId: String(surah.id),
  })),
}));
const mockStartNewChain = jest.fn(async () => undefined);
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useRecentlyPlayedStore: selector =>
    selector({startNewChain: mockStartNewChain}),
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn()},
}));
jest.mock('@/utils/systemPlaylistHelpers', () => ({
  getSystemPlaylistEstimatedDuration: () => 600,
}));
jest.mock('@/components/TrackItem', () => ({TrackItem: () => null}));
jest.mock('@/components/collection/CollectionStickyHeader', () => ({
  CollectionStickyHeader: () => null,
}));
jest.mock('@/components/system-playlist/SystemPlaylistHeader', () => ({
  SystemPlaylistHeader: () => null,
}));

const EVENING: SystemPlaylist = {
  id: 'evening-serenity',
  title: 'Evening Serenity',
  description: 'Calm surahs',
  backgroundColor: '#6366F1',
  type: 'surah-only',
  items: [{surahId: 36}, {surahId: 67}],
  heightMultiplier: 1,
  column: 'right',
  order: 1,
};

const original = branding.systemPlaylistSurahPress;

afterEach(() => {
  branding.systemPlaylistSurahPress = original;
  jest.clearAllMocks();
});

describe('SystemPlaylistDetail — a surah tap (#555)', () => {
  it('opens the reciter list of the surah with browse-reciters', async () => {
    branding.systemPlaylistSurahPress = 'browse-reciters';
    const screen = render(<SystemPlaylistDetail playlist={EVENING} />);

    const mulk = await screen.findByText(/^67\. Al-Mulk/);
    expect(screen.queryByText('with Test Reciter')).toBeNull();
    expect(screen.queryByText('Play')).toBeNull();
    // A screen reader hears that each row is a button.
    expect(screen.getAllByRole('button')).toHaveLength(2);

    fireEvent.press(mulk);

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(tabs)/(b.search)/reciter/browse',
      params: {surahId: '67'},
    });
    expect(mockActions.updateQueue).not.toHaveBeenCalled();
    expect(mockActions.play).not.toHaveBeenCalled();
  });

  it('plays the playlist with the suggested reciter with play (upstream)', async () => {
    branding.systemPlaylistSurahPress = 'play';
    const screen = render(<SystemPlaylistDetail playlist={EVENING} />);

    const mulk = await screen.findByText(/^67\. Al-Mulk/);
    expect(screen.getAllByText('with Test Reciter')).toHaveLength(2);
    // Play mode keeps the upstream row: no role.
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    fireEvent.press(mulk);

    await waitFor(() => expect(mockActions.play).toHaveBeenCalled());
    expect(mockActions.updateQueue).toHaveBeenCalledWith(
      [
        {id: 'r-1:67', surahId: '67'},
        {id: 'r-1:36', surahId: '36'},
      ],
      0,
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
