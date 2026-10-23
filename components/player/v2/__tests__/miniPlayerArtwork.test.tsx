// @ai-generated
// TECH_DEBT #262: the mini player showed the person icon for a reciter whose
// photo the full player showed (for example Zaynab Talha). The full player
// gives `ReciterImage` the track artwork (the catalog photo URL); the mini
// players gave only the reciter name, and a catalog reciter has no bundled
// photo. These tests build the track artwork the way every track builder does
// (`getReciterArtwork`) and check what each mini player gives `ReciterImage`.

import React from 'react';
import {render} from '@testing-library/react-native';
import {getReciterArtwork} from '@/utils/artworkUtils';
import type {Reciter} from '@/data/reciterData';

const mockState = {
  playback: {state: 'paused'},
  queue: {
    tracks: [] as Record<string, unknown>[],
    currentIndex: 0,
  },
  loading: {trackLoading: false, stateRestoring: false},
};

jest.mock('@/services/player/store/playerStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  usePlayerStore: selector => selector(mockState),
}));

jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => ({play: jest.fn(), pause: jest.fn()}),
}));

jest.mock('@/services/player/sheetRef', () => ({
  expandPlayerSheet: jest.fn(),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {text: '#111111', textSecondary: '#666666'}},
    isDarkMode: false,
  }),
}));

// The mock keeps the props, so a test can read what the player gave it.
jest.mock('@/components/ReciterImage', () => {
  const {View} = require('react-native');
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const ReciterImage = props => <View testID="reciter-image" {...props} />;
  return {ReciterImage};
});

jest.mock('@/components/LoadingIndicator', () => {
  const {View} = require('react-native');
  return {LoadingIndicator: View};
});

jest.mock('@/components/Icons', () => {
  const {View} = require('react-native');
  return {PlayIcon: View, PauseIcon: View};
});

jest.mock('expo-router', () => ({
  usePathname: () => '/',
}));

jest.mock('expo-glass-effect', () => {
  const {View} = require('react-native');
  return {GlassView: View, isLiquidGlassAvailable: () => false};
});

jest.mock('@/hooks/useGlassProps', () => ({
  USE_GLASS: false,
  useGlassColorScheme: () => 'light',
}));

jest.mock('@/components/FrostedView', () => {
  const {View} = require('react-native');
  return {FrostedView: View};
});

jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: false}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

import {MiniPlayer} from '../MiniPlayer';
import {FloatingPlayer} from '../FloatingPlayer';
import {TabletDockedPlayer} from '@/components/tablet/TabletDockedPlayer';

const PHOTO = 'https://example.test/reciters/zaynab-talha/photo.jpg?v=1';

function reciter(fields: Partial<Reciter>): Reciter {
  return {
    id: 'r1',
    name: 'Zaynab Talha',
    date: null,
    image_url: null,
    rewayat: [],
    ...fields,
  } as Reciter;
}

function setTrack(fromReciter: Reciter) {
  mockState.queue.tracks = [
    {
      id: 'r1-18',
      title: 'Al-Kahf',
      artist: fromReciter.name,
      artwork: getReciterArtwork(fromReciter),
      reciterId: fromReciter.id,
      reciterName: fromReciter.name,
      surahId: '18',
    },
  ];
}

const players = [
  {name: 'FloatingPlayer', element: () => <FloatingPlayer />},
  {name: 'MiniPlayer', element: () => <MiniPlayer />},
  {name: 'TabletDockedPlayer', element: () => <TabletDockedPlayer expanded />},
  {
    name: 'TabletDockedPlayer (compact)',
    element: () => <TabletDockedPlayer expanded={false} />,
  },
];

describe.each(players)('$name photo (TECH_DEBT #262)', ({element}) => {
  it('gives ReciterImage the photo of a reciter that has one', () => {
    setTrack(reciter({image_url: PHOTO}));
    const {getByTestId} = render(element());
    const image = getByTestId('reciter-image');
    expect(image.props.imageUrl).toBe(PHOTO);
    expect(image.props.reciterName).toBe('Zaynab Talha');
  });

  it('gives no URL for a reciter with no photo, so the fallback stays', () => {
    // getReciterArtwork returns a 1x1 transparent PNG here. ReciterImage then
    // shows the bundled photo by name, or the person icon, as before.
    setTrack(reciter({name: 'No Photo Reciter', image_url: null}));
    const {getByTestId} = render(element());
    const image = getByTestId('reciter-image');
    expect(image.props.imageUrl).toBeUndefined();
    expect(image.props.reciterName).toBe('No Photo Reciter');
  });
});
