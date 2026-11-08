// @ai Qariah (Lite mode, step 1) — the Lite surfaces: the player card, the
// still "now playing" bars, and the route trigger of the Mushaf data load.
import React from 'react';
import {
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react-native';

const mockLite = {on: true};
jest.mock('@/services/lite/liteMode', () => ({
  isLiteMode: () => mockLite.on,
}));

const mockStart = jest.fn();
jest.mock('@/services/lite/startMushafDataLoad', () => ({
  startMushafDataLoad: () => mockStart(),
}));

// The animated indicator (not used in Lite mode) creates its component at
// module level; a stand-in is enough.
jest.mock('react-native-reanimated', () => {
  const {View: MockView} = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: {createAnimatedComponent: () => MockView},
  };
});
jest.mock('expo-linear-gradient', () => {
  const {View: MockView} = jest.requireActual('react-native');
  return {LinearGradient: MockView};
});

const mockSegments = {value: [] as string[]};
jest.mock('expo-router', () => ({
  useSegments: () => mockSegments.value,
}));

import {LitePlayerTextCard} from '../LitePlayerTextCard';
import {NowPlayingIndicator} from '@/components/NowPlayingIndicator';
import {
  needsMushafData,
  useLiteOnDemandData,
} from '@/hooks/useLiteOnDemandData';

beforeEach(() => {
  mockLite.on = true;
  mockStart.mockClear();
  mockSegments.value = [];
});

describe('LitePlayerTextCard', () => {
  it('shows the surah and the reciter, and asks for the text on a press', () => {
    const onShowText = jest.fn();
    render(
      <LitePlayerTextCard
        surah={1}
        reciter="Reciter Name"
        textColor="#000"
        accentColor="#000"
        contentPaddingTop={0}
        contentPaddingBottom={0}
        onShowText={onShowText}
      />,
    );
    expect(screen.getByText('Al-Fatihah')).toBeTruthy();
    expect(screen.getByText('Reciter Name')).toBeTruthy();
    fireEvent.press(screen.getByTestId('lite-show-text'));
    expect(onShowText).toHaveBeenCalledTimes(1);
  });
});

describe('NowPlayingIndicator in Lite mode', () => {
  it('draws still bars: tall while playing, short while paused', () => {
    const heights = (isPlaying: boolean): number[] => {
      const tree = render(
        <NowPlayingIndicator isPlaying={isPlaying} />,
      ).toJSON();
      const bars = (
        tree as unknown as {children: {props: {style: {height: number}}}[]}
      ).children;
      return bars.map(bar => bar.props.style.height);
    };
    const playing = heights(true);
    const paused = heights(false);
    expect(playing).toHaveLength(3);
    expect(playing[1]).toBeGreaterThan(playing[0]);
    expect(new Set(paused).size).toBe(1);
    expect(paused[0]).toBeLessThan(playing[0]);
  });
});

describe('the Mushaf data on demand', () => {
  it('names the screens that read the Mushaf data', () => {
    expect(needsMushafData(['(tabs)', '(b.surahs)'])).toBe(true);
    expect(needsMushafData(['mushaf'])).toBe(true);
    expect(needsMushafData(['quran', '[surah]'])).toBe(true);
    expect(
      needsMushafData(['(tabs)', '(c.collection)', 'collection', 'bookmarks']),
    ).toBe(true);
    expect(needsMushafData(['(tabs)', '(a.home)'])).toBe(false);
    expect(needsMushafData(['player'])).toBe(false);
  });

  it('starts the load when such a screen opens, in Lite mode only', () => {
    mockSegments.value = ['(tabs)', '(a.home)'];
    const {rerender} = renderHook(() => useLiteOnDemandData());
    expect(mockStart).not.toHaveBeenCalled();
    mockSegments.value = ['(tabs)', '(b.surahs)'];
    rerender({});
    expect(mockStart).toHaveBeenCalledTimes(1);

    mockStart.mockClear();
    mockLite.on = false;
    renderHook(() => useLiteOnDemandData());
    expect(mockStart).not.toHaveBeenCalled();
  });
});
