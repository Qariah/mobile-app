// @ai-generated
// Sprint 52 Task 2: the "Browse by" card on iPad. From a 900 pt pane the
// title block and the three tiles share one row, and each tile has one
// caption line. Below 900 pt, and on every phone, the layout is as before.

import React from 'react';
import {render} from '@testing-library/react-native';

let mockIsTablet = true;
let mockWindowWidth = 1180;

jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: mockIsTablet, width: mockWindowWidth}),
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
      fonts: {bold: 'Manrope-Bold', regular: 'Manrope-Regular'},
    },
  }),
}));

jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => ({updateQueue: jest.fn(), play: jest.fn()}),
}));

jest.mock('@/utils/toastUtils', () => ({showToast: jest.fn()}));
jest.mock('@/utils/track', () => ({createTracksForReciter: jest.fn()}));
jest.mock('@/utils/randomRecitation', () => ({
  pickRandomRecitations: jest.fn(() => []),
}));
jest.mock('@/i18n/format', () => ({
  getReciterDisplayName: () => '',
  getSurahDisplayName: () => '',
}));

jest.mock('@/services/player/store/recentlyPlayedStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useRecentlyPlayedStore: selector => selector({startNewChain: jest.fn()}),
}));

jest.mock('@/components/hero/SurahGradientMesh', () => ({
  SurahGradientMesh: () => null,
  MESH_PALETTES: [{}],
}));

jest.mock('@/components/hero/heroThemes', () => ({
  SESSION_SEED: 0,
  pickHeroTheme: () => ({bg: ['#000000'], bgLight: ['#ffffff']}),
}));

jest.mock('expo-router', () => ({
  // Like expo-router's Slot (SDK 58), reject an array style on the child.
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  Link: ({children}) => {
    if (Array.isArray(children?.props?.style)) {
      throw new Error('array style passed to a child of <Link asChild>');
    }
    return children;
  },
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

import {moderateScale} from '@/utils/scale';
import {ListenTabTopGrid} from '../ListenTabTopGrid';

const flat = (style: unknown) => Object.assign({}, ...[style].flat(3));

describe('ListenTabTopGrid on iPad (Sprint 52 Task 2)', () => {
  beforeEach(() => {
    mockIsTablet = true;
    mockWindowWidth = 1180;
  });

  it('at 1180 pt puts the tiles in one row beside the title, with captions', () => {
    const utils = render(<ListenTabTopGrid />);

    const card = flat(utils.getByTestId('listen-top-card').props.style);
    expect(card.flexDirection).toBe('row');
    expect(
      flat(utils.getByTestId('listen-top-title-block').props.style).width,
    ).toBe('20%');

    const captions = [
      utils.getByText('Random recitation'),
      utils.getByText(/qariahs?$/),
      utils.getByText(/surahs?$/),
    ];
    for (const caption of captions) {
      expect(caption.props.numberOfLines).toBe(1);
    }
  });

  it('uses the window width, with no measure (a 1066 pt window with a sidebar)', () => {
    // The 240 pt sidebar leaves an 826 pt pane: the window class decides (mock).
    mockWindowWidth = 1066;
    const utils = render(<ListenTabTopGrid />);
    const card = flat(utils.getByTestId('listen-top-card').props.style);
    expect(card.flexDirection).toBe('row');
    expect(utils.getByText('Random recitation')).toBeTruthy();
  });

  it('puts the caption in the tile accessibility label', () => {
    const utils = render(<ListenTabTopGrid />);
    expect(utils.getByLabelText('Shuffle, Random recitation')).toBeTruthy();
  });

  it('keeps the stacked layout below 900 pt', () => {
    mockWindowWidth = 700;
    const utils = render(<ListenTabTopGrid />);

    const card = flat(utils.getByTestId('listen-top-card').props.style);
    expect(card.flexDirection).toBeUndefined();
    expect(utils.queryByText('Random recitation')).toBeNull();
    // The phone gap (moderateScale(10)), not a pageSpacing gap (16 to 24).
    expect(
      flat(utils.getByTestId('listen-top-tiles').props.style).gap,
    ).toBeCloseTo(moderateScale(10), 5);
  });

  it('keeps the stacked layout in a Split View half window', () => {
    mockWindowWidth = 683;
    const utils = render(<ListenTabTopGrid />);

    const card = flat(utils.getByTestId('listen-top-card').props.style);
    expect(card.flexDirection).toBeUndefined();
    expect(utils.queryByText('Random recitation')).toBeNull();
  });

  it("at 390 pt on a phone keeps today's layout and adds no caption", () => {
    mockIsTablet = false;
    mockWindowWidth = 390;
    const utils = render(<ListenTabTopGrid />);

    const card = flat(utils.getByTestId('listen-top-card').props.style);
    expect(card.flexDirection).toBeUndefined();
    expect(
      utils.getByTestId('listen-top-title-block').props.style,
    ).toBeUndefined();
    expect(utils.queryByText('Random recitation')).toBeNull();
    expect(utils.getByLabelText('Shuffle')).toBeTruthy();
  });
});
