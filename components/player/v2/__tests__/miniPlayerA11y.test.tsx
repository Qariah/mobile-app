// @ai
// Regression tests for #401 — the mini-player controls must each be their OWN
// accessibility element.
//
// The bug: both bars wrap their content in a `Pressable` (tap = open the full
// player). A Pressable is `accessible` by default, and on iOS an accessible
// container ABSORBS its children into one composed label
// ("Ad-Dukhan, Qariah Reciter, Close player"). VoiceOver could not reach the
// close control, and Maestro's `Close player` selector matched the BAR — so
// the tap EXPANDED the player instead of closing it, and the flow's dismissal
// assertion then passed for the wrong reason (the sheet covered the bar).
//
// These tests assert the contract that prevents that composition:
//   1. the bar itself is NOT an accessibility element (`accessible={false}`),
//   2. each control is addressable on its own (testID + label + button role),
//   3. pressing the close control stops playback and does NOT open the sheet.
// jsdom cannot reproduce the iOS a11y tree, so this locks the props that the
// platform derives it from; a device run still owns the final proof.

import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

const mockActions = {
  play: jest.fn(),
  pause: jest.fn(),
  stop: jest.fn(),
};
const mockExpandPlayerSheet = jest.fn();

const mockState = {
  playback: {state: 'playing'},
  queue: {
    tracks: [
      {
        id: 't1',
        title: 'Ad-Dukhan',
        artist: 'Qariah Reciter',
        reciterName: 'Qariah Reciter',
      },
    ],
    currentIndex: 0,
  },
  loading: {trackLoading: false, stateRestoring: false},
};

jest.mock('@/services/player/store/playerStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  usePlayerStore: selector => selector(mockState),
}));

jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => mockActions,
}));

jest.mock('@/services/player/sheetRef', () => ({
  expandPlayerSheet: () => mockExpandPlayerSheet(),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {text: '#111111', textSecondary: '#666666'}},
    isDarkMode: false,
  }),
}));

jest.mock('@/components/ReciterImage', () => {
  const {View} = require('react-native');
  return {ReciterImage: View};
});

jest.mock('@/components/LoadingIndicator', () => {
  const {View} = require('react-native');
  return {LoadingIndicator: View};
});

jest.mock('@/components/Icons', () => {
  const {View} = require('react-native');
  return {PlayIcon: View, PauseIcon: View};
});

jest.mock('@expo/vector-icons', () => {
  const {View} = require('react-native');
  return {Feather: View};
});

// FloatingPlayer-only dependencies.
jest.mock('expo-router', () => ({
  usePathname: () => '/',
}));

jest.mock('expo-glass-effect', () => {
  const {View} = require('react-native');
  return {GlassView: View, isLiquidGlassAvailable: () => false};
});

// Mocked directly: the real module pulls in themeStore -> @react-navigation's
// DefaultTheme, which is not resolvable in this environment.
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

// The iOS BottomAccessory bar and the Android/iOS-<26 pill are two components
// with one contract, so both run the same assertions.
const bars = [
  {name: 'MiniPlayer', Component: MiniPlayer},
  {name: 'FloatingPlayer', Component: FloatingPlayer},
];

describe.each(bars)('$name accessibility (#401)', ({Component}) => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not make the bar itself an accessibility element', () => {
    // The row is a plain View. A Pressable here would be `accessible` by
    // default, and on iOS an accessible container ABSORBS its children into
    // one composed label -- which is the #401 defect. Assert the row declares
    // nothing that would group it, rather than asserting a literal `false`:
    // a View that never opts in is the stronger shape, and `accessible` is
    // simply undefined on it.
    const {getByTestId} = render(<Component />);
    const bar = getByTestId('mini-player-bar').props;
    expect(bar.accessible).not.toBe(true);
    expect(bar.accessibilityRole).toBeUndefined();
    expect(bar.accessibilityLabel).toBeUndefined();
    expect(bar.onPress).toBeUndefined();
  });

  it('exposes the close control as its own labelled button', () => {
    const {getByTestId} = render(<Component />);
    const close = getByTestId('mini-player-close');
    expect(close.props.accessibilityLabel).toBe('Close player');
    expect(close.props.accessibilityRole).toBe('button');
    expect(close.props.accessible).not.toBe(false);
  });

  it('stops playback on close instead of expanding the player', () => {
    const {getByTestId} = render(<Component />);
    fireEvent.press(getByTestId('mini-player-close'));
    expect(mockActions.stop).toHaveBeenCalledTimes(1);
    expect(mockExpandPlayerSheet).not.toHaveBeenCalled();
  });

  it('exposes the play/pause control as its own labelled button', () => {
    const {getByTestId} = render(<Component />);
    const playPause = getByTestId('mini-player-play-pause');
    expect(playPause.props.accessibilityLabel).toBe('Pause');
    expect(playPause.props.accessibilityRole).toBe('button');
  });

  it('shows the artist on the second line and in the expand label', () => {
    // The second line always reads the artist. The expand label announces
    // the same text, so a screen-reader user hears what the eye reads.
    const {getByTestId, getByText} = render(<Component />);
    expect(getByText('Qariah Reciter')).toBeTruthy();
    expect(getByTestId('mini-player-expand').props.accessibilityLabel).toBe(
      'Ad-Dukhan, Qariah Reciter',
    );
  });

  it('keeps an expand target that opens the full player', () => {
    const {getByTestId} = render(<Component />);
    const expand = getByTestId('mini-player-expand');
    expect(expand.props.accessibilityLabel).toBe('Ad-Dukhan, Qariah Reciter');
    fireEvent.press(expand);
    expect(mockExpandPlayerSheet).toHaveBeenCalledTimes(1);
    expect(mockActions.stop).not.toHaveBeenCalled();
  });
});
