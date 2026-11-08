// @ai-generated
// Sprint 52 Task 6: on a tablet the Continue Reading cards take their width
// from the measured pane, not from the window; on a tablet with history and a
// resumable track the carousel and Continue Listening share one row. A phone
// keeps the window width and the early return.
import React from 'react';
import {FlatList, StyleSheet} from 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';

let mockIsTablet = true;
let mockResumable = true;
let mockRecent = 2;

jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: mockIsTablet}),
}));
jest.mock('expo-router', () => ({useFocusEffect: () => undefined}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));
jest.mock('@/services/mushaf/MushafSessionStore', () => ({
  mushafSessionStore: {
    getLastReadPage: () => 50,
    getRecentPages: () =>
      [
        {page: 50, openedAt: Date.now() - 60_000},
        {page: 2, openedAt: Date.now() - 120_000},
      ].slice(0, mockRecent),
  },
}));
jest.mock('../HeroSection', () => ({
  HeroSection: ({mainHero}: {mainHero: React.ReactNode}) => mainHero,
}));
jest.mock('../SurahsHero', () => {
  const {View: MockView} = require('react-native');
  return {
    SurahHeroSection: ({style}: {style: object}) => (
      <MockView testID="carousel-card" style={style} />
    ),
  };
});
jest.mock('../ContinueListeningHero', () => {
  const {View: MockView} = require('react-native');
  return {
    ContinueListeningHero: () => <MockView testID="continue-listening" />,
    findResumableIndex: () => (mockResumable ? 0 : -1),
  };
});
jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  useRecentlyPlayedStore: (select: (s: unknown) => unknown) =>
    select({recentTracks: []}),
}));
jest.mock('../continueReadingHistorySize', () => ({
  resolveContinueReadingHistorySize: () => 5,
}));

import {RecentReadingCarousel} from '../RecentReadingCarousel';
import {ContinueReadingHero} from '../ContinueReadingHero';

const layout = (r: ReturnType<typeof render>, width: number) => {
  act(() => {
    fireEvent(r.getByTestId('recent-reading-carousel'), 'layout', {
      nativeEvent: {layout: {width}},
    });
  });
};

const widths = (r: ReturnType<typeof render>) =>
  r
    .getAllByTestId('carousel-card')
    .map(c => StyleSheet.flatten(c.props.style).width as number);

describe('Continue Reading on a tablet', () => {
  beforeEach(() => {
    mockIsTablet = true;
    mockResumable = true;
    mockRecent = 2;
  });

  it('derives the card width from the measured width (700)', () => {
    const r = render(<RecentReadingCarousel historySize={5} />);
    layout(r, 700);
    expect(widths(r)).toEqual([546, 546]); // 700 x 0.78
  });

  it('shows the carousel and Continue Listening in one row', () => {
    const r = render(<ContinueReadingHero />);
    layout(r, 500);
    expect(r.getAllByTestId('carousel-card').length).toBe(2);
    expect(r.getByTestId('continue-listening')).toBeTruthy();
  });

  it('keeps the early return on a phone', () => {
    mockIsTablet = false;
    const r = render(<ContinueReadingHero />);
    expect(r.getAllByTestId('carousel-card').length).toBe(2);
    expect(r.queryByTestId('continue-listening')).toBeNull();
  });

  it('draws no list before the first layout on a tablet', () => {
    const r = render(<RecentReadingCarousel historySize={5} />);
    expect(r.queryByTestId('carousel-card')).toBeNull();
    expect(r.UNSAFE_queryByType(FlatList)).toBeNull();
    layout(r, 700);
    expect(r.getAllByTestId('carousel-card').length).toBe(2);
  });

  it('ignores a measured width of 0', () => {
    const r = render(<RecentReadingCarousel historySize={5} />);
    layout(r, 0);
    expect(r.queryByTestId('carousel-card')).toBeNull();
  });

  it('gives a single entry the full cell width (bare)', () => {
    mockRecent = 1;
    const r = render(<RecentReadingCarousel historySize={5} bare />);
    layout(r, 400);
    expect(widths(r)).toEqual([400]);
  });

  it('ignores a measured width on a phone', () => {
    mockIsTablet = false;
    const r = render(<RecentReadingCarousel historySize={5} />);
    const before = widths(r);
    layout(r, 700);
    expect(widths(r)).toEqual(before);
  });
});
