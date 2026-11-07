// @ai
// TECH_DEBT #273: the "Continue Reading" cards kept a landscape width in
// portrait. The carousel read the window width once, when its module loaded.
// Metro inline requires load that module at the first render of the
// carousel, and that render can come on the way back from the Mushaf reader
// while the window is still in landscape. The cards must follow the live
// window width.
import React from 'react';
import {Dimensions, FlatList, StyleSheet, View} from 'react-native';
import {act, render} from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
}));

jest.mock('@/services/mushaf/MushafSessionStore', () => ({
  mushafSessionStore: {
    getRecentPages: () => [
      {page: 50, openedAt: Date.now() - 60_000},
      {page: 2, openedAt: Date.now() - 120_000},
    ],
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

type Size = {width: number; height: number; scale: number; fontScale: number};

function setWindow(width: number, height: number) {
  const size: Size = {width, height, scale: 3, fontScale: 1};
  act(() => {
    Dimensions.set({window: size, screen: size});
  });
}

function cardWidths(root: ReturnType<typeof render>): number[] {
  return root
    .getAllByTestId('carousel-card')
    .map(card => StyleSheet.flatten(card.props.style).width as number);
}

type CarouselType = React.ComponentType<{historySize: number}>;
let Carousel: CarouselType;

describe('RecentReadingCarousel card width', () => {
  beforeAll(() => {
    // The module loads while the window is still in landscape: the first
    // require of it in this test file comes here.
    setWindow(874, 402);
    Carousel = require('../RecentReadingCarousel').RecentReadingCarousel;
  });

  afterEach(() => setWindow(402, 874));

  it('follows the window when the module loaded in landscape (#273)', () => {
    // The app is back in portrait when the carousel renders.
    setWindow(402, 874);
    const root = render(
      <View>
        <Carousel historySize={5} />
      </View>,
    );
    expect(cardWidths(root)).toEqual([314, 314]); // 402 × 0.78
  });

  it('remounts the list when the card width changes', () => {
    // The old scroll offset with the new snap interval would stop the list
    // between two cards.
    setWindow(402, 874);
    const root = render(<Carousel historySize={5} />);
    const first = root.UNSAFE_getByType(FlatList);
    setWindow(820, 1180);
    expect(root.UNSAFE_getByType(FlatList)).not.toBe(first);
    const second = root.UNSAFE_getByType(FlatList);
    setWindow(820, 1000); // the height only: the cards keep their width
    expect(root.UNSAFE_getByType(FlatList)).toBe(second);
  });

  it('changes the width when the window changes', () => {
    setWindow(402, 874);
    const root = render(<Carousel historySize={5} />);
    expect(cardWidths(root)).toEqual([314, 314]);
    setWindow(820, 1180); // iPad 11-inch, portrait
    expect(cardWidths(root)).toEqual([640, 640]);
  });
});
