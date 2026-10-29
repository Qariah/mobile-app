// @ai
// TECH_DEBT #384: on an iPad the reciter grid of a country page cut off its
// last column, and the page does not scroll sideways, so those reciters could
// not be seen. Each tab is in a 720 pt column beside the sidebar
// (MaxWidthContainer), but BrowseGrid sized the columns from the window width.
// On a tablet the grid now measures its own width; a phone keeps the window.
import React from 'react';
import {Dimensions, StyleSheet} from 'react-native';
import {act, fireEvent, render, screen} from '@testing-library/react-native';
import type {ReactTestInstance} from 'react-test-renderer';
import {moderateScale} from 'react-native-size-matters';
import type {Reciter} from '@/data/reciterData';
import type {Theme} from '@/utils/themeUtils';

let mockIsTablet = true;

jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: mockIsTablet}),
}));

jest.mock('@legendapp/list', () => {
  const {View: MockView} = require('react-native');
  const {Fragment} = require('react');
  return {
    LegendList: ({
      data,
      renderItem,
    }: {
      data: unknown[];
      renderItem: (info: {item: unknown; index: number}) => React.ReactNode;
    }) => (
      <MockView testID="legend-list">
        {data.map((item, index) => (
          <Fragment key={index}>{renderItem({item, index})}</Fragment>
        ))}
      </MockView>
    ),
  };
});

jest.mock('../BrowseReciterCard', () => {
  const {View: MockView} = require('react-native');
  return {
    BrowseReciterCard: ({width}: {width: number}) => (
      <MockView testID="card" style={{width}} />
    ),
  };
});

import BrowseGrid from '../BrowseGrid';

const theme = {colors: {text: '#000000'}} as unknown as Theme;
const reciters = Array.from(
  {length: 8},
  (_, i) => ({id: `r${i}`, name: `Reciter ${i}`}) as unknown as Reciter,
);

function setWindow(width: number, height: number) {
  const size = {width, height, scale: 2, fontScale: 1};
  act(() => {
    Dimensions.set({window: size, screen: size});
  });
}

/** The grid's own container: the host view with `onLayout` above the list. */
function container(): ReactTestInstance {
  let node: ReactTestInstance | null = screen.getByTestId('legend-list');
  while (node) {
    if (
      typeof node.type === 'string' &&
      typeof node.props.onLayout === 'function'
    ) {
      return node;
    }
    node = node.parent;
  }
  throw new Error('No host view with onLayout above the list');
}

function layout(width: number) {
  fireEvent(container(), 'layout', {
    nativeEvent: {layout: {x: 0, y: 0, width, height: 900}},
  });
}

function cardWidths(): number[] {
  return screen
    .queryAllByTestId('card')
    .map(card => StyleSheet.flatten(card.props.style).width as number);
}

/** The column count and card width that BrowseGrid gives a grid `width` wide. */
function expected(width: number) {
  const columns = Math.max(3, Math.floor(width / moderateScale(120)));
  const card =
    (width - moderateScale(16) - moderateScale(10) * (columns - 1)) / columns;
  return {columns, card};
}

function renderGrid() {
  render(
    <BrowseGrid reciters={reciters} onReciterPress={jest.fn()} theme={theme} />,
  );
}

afterEach(() => {
  mockIsTablet = true;
  setWindow(402, 874);
});

describe('BrowseGrid width (TECH_DEBT #384)', () => {
  it('on a tablet, renders no card before the grid is measured', () => {
    setWindow(1032, 1376);
    renderGrid();
    expect(cardWidths()).toEqual([]);
  });

  it('on a tablet, fits the columns into the measured width, not the window', () => {
    setWindow(1032, 1376);
    renderGrid();
    layout(720);

    const {columns, card} = expected(720);
    const widths = cardWidths();
    expect(widths).toHaveLength(reciters.length);
    widths.forEach(w => expect(w).toBeCloseTo(card));
    // One row of cards and its gaps fit inside the grid.
    expect(
      columns * card + moderateScale(10) * (columns - 1) + moderateScale(16),
    ).toBeLessThanOrEqual(720 + 0.001);
    // A row sized from the window was wider than the grid: the last column was cut off.
    const old = expected(1032);
    expect(
      old.columns * old.card +
        moderateScale(10) * (old.columns - 1) +
        moderateScale(16),
    ).toBeGreaterThan(720);
  });

  it('on a tablet, follows a new width (a turn, Split View)', () => {
    setWindow(1376, 1032);
    renderGrid();
    layout(720);
    layout(500);
    cardWidths().forEach(w => expect(w).toBeCloseTo(expected(500).card));
  });

  it('on a phone, keeps the window width and ignores the layout', () => {
    mockIsTablet = false;
    setWindow(402, 874);
    renderGrid();
    const atOnce = cardWidths();
    expect(atOnce).toHaveLength(reciters.length);
    atOnce.forEach(w => expect(w).toBeCloseTo(expected(402).card));

    layout(380);
    cardWidths().forEach(w => expect(w).toBeCloseTo(expected(402).card));
  });
});
