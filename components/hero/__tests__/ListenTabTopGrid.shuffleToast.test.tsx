// @ai-generated
// TECH_DEBT #220 (GitHub #267): on iOS, a tap on Shuffle played a random
// recitation with no message, because the Shuffle tile called an
// Android-only `ToastAndroid` helper. The tile now uses the cross-platform
// toast (`utils/toastUtils`, burnt) and shows one message that names what
// started. Play stays instant: there is no confirm step.

import React from 'react';
import {Platform} from 'react-native';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

const mockShowToast = jest.fn();
const mockUpdateQueue = jest.fn(async () => undefined);
const mockPlay = jest.fn(async () => undefined);
const mockStartNewChain = jest.fn(async () => undefined);
const mockPick = jest.fn();
const mockCreateTracks = jest.fn();

jest.mock('@/utils/toastUtils', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  showToast: (...args) => mockShowToast(...args),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      isDarkMode: false,
      colors: {
        text: '#111111',
        textSecondary: '#555555',
        backgroundSecondary: '#eeeeee',
        light: '#ffffff',
      },
      fonts: {bold: 'Manrope-Bold'},
    },
  }),
}));

jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => ({
    updateQueue: mockUpdateQueue,
    play: mockPlay,
  }),
}));

jest.mock('@/utils/track', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  createTracksForReciter: (...args) => mockCreateTracks(...args),
}));

jest.mock('@/utils/randomRecitation', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  pickRandomRecitations: (...args) => mockPick(...args),
}));

jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useRecentlyPlayedStore: selector =>
    selector({startNewChain: mockStartNewChain}),
}));

jest.mock('@/i18n/format', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  getReciterDisplayName: reciter => reciter.name,
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  getSurahDisplayName: surah => surah.name,
}));

jest.mock('@/components/hero/SurahGradientMesh', () => ({
  SurahGradientMesh: () => null,
  MESH_PALETTES: [{}],
}));

jest.mock('@/components/hero/heroThemes', () => ({
  SESSION_SEED: 0,
  pickHeroTheme: () => ({bg: ['#000000'], bgLight: ['#ffffff']}),
}));

jest.mock('@/utils/rtl', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  latinLetterSpacing: value => value,
}));

jest.mock('expo-router', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  Link: ({children}) => children,
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {Medium: 'medium'},
}));

jest.mock('@expo/vector-icons', () => ({Feather: () => null}));

jest.mock('react-native-reanimated', () => {
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: {View},
    useSharedValue: (value: number) => ({value}),
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
  };
});

import {ListenTabTopGrid} from '../ListenTabTopGrid';

const RECITER = {id: 'r1', name: 'Reciter One'};
const SURAH = {id: 1, name: 'Al-Fatihah'};

describe('ListenTabTopGrid Shuffle message (TECH_DEBT #220)', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPick.mockReturnValue([
      {reciter: RECITER, surah: SURAH, rewayatId: 'hafs'},
    ]);
    mockCreateTracks.mockResolvedValue([{id: 'track-1'}]);
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it.each(['ios', 'android'] as const)(
    'on %s, shows one toast that names what started, and plays',
    async os => {
      Platform.OS = os;
      const {getByLabelText} = render(<ListenTabTopGrid />);

      fireEvent.press(getByLabelText('Shuffle'));

      await waitFor(() => expect(mockPlay).toHaveBeenCalledTimes(1));
      expect(mockShowToast).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Playing Al-Fatihah by Reciter One',
      );
      expect(mockUpdateQueue).toHaveBeenCalledWith([{id: 'track-1'}], 0);
      expect(mockStartNewChain).toHaveBeenCalledWith(
        RECITER,
        SURAH,
        0,
        0,
        'hafs',
      );
    },
  );

  it('shows an error toast and plays nothing when no recitation is found', async () => {
    mockPick.mockReturnValue([]);
    const {getByLabelText} = render(<ListenTabTopGrid />);

    fireEvent.press(getByLabelText('Shuffle'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));
    expect(mockShowToast).toHaveBeenCalledWith(
      'Failed to find random recitations. Please try again.',
      undefined,
      'error',
    );
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('shows an error toast when the play fails', async () => {
    mockPlay.mockRejectedValueOnce(new Error('no source'));
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const {getByLabelText} = render(<ListenTabTopGrid />);

    fireEvent.press(getByLabelText('Shuffle'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(2));
    expect(mockShowToast).toHaveBeenLastCalledWith(
      'Failed to play random recitation. Please try again.',
      undefined,
      'error',
    );
    errorSpy.mockRestore();
  });
});
