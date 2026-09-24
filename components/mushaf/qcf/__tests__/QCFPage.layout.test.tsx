// @ai
// Regression guard for GH #364 — the QCF renderer drew every page at the
// module-level PORTRAIT constants in `components/mushaf/constants.ts`,
// because `main.tsx` passed it no layout metrics. In phone landscape that
// rendered the page at roughly half scale in the left half of the screen.
//
// These tests RENDER QCFPage and assert the geometry it actually produces:
// the root page View and the Skia Canvas must follow the metrics passed in,
// not the import-time portrait snapshot. Reverting the seven prop lines in
// `main.tsx` cannot make these pass, because they assert on the props.
//
// The Skia / gesture / service tree is stubbed the same way
// components/__tests__/BottomSheetModal.test.tsx stubs gorhom: thin fakes,
// so the assertions are about layout arithmetic rather than native drawing.

import React from 'react';
import {render} from '@testing-library/react-native';

// --- native + heavy-tree stubs ---------------------------------------------

jest.mock('@shopify/react-native-skia', () => {
  const ReactLocal = require('react');
  const {View} = require('react-native');
  const makeParagraph = () => ({
    layout: jest.fn(),
    getLongestLine: () => 900,
    getRectsForRange: () => [],
    getGlyphPositionAtCoordinate: () => 0,
    dispose: jest.fn(),
  });
  const builder = {
    reset: jest.fn(),
    pushStyle: jest.fn(),
    addText: jest.fn(),
    pop: jest.fn(),
    build: () => makeParagraph(),
  };
  return {
    Canvas: ({children, style}: any) =>
      ReactLocal.createElement(View, {testID: 'qcf-canvas', style}, children),
    Group: ({children}: any) => ReactLocal.createElement(View, null, children),
    Paragraph: () => null,
    RoundedRect: () => null,
    TextAlign: {Center: 'center'},
    TextDirection: {RTL: 'rtl'},
    TextHeightBehavior: {DisableAll: 'disableAll'},
    Skia: {
      Color: (c: string) => c,
      ParagraphBuilder: {Make: () => builder},
      Font: () => ({
        getGlyphIDs: () => [1],
        getGlyphWidths: () => [100],
      }),
    },
  };
});

jest.mock('react-native-gesture-handler', () => {
  const ReactLocal = require('react');
  const chain: any = new Proxy({}, {get: () => () => chain});
  return {
    GestureDetector: ({children}: any) =>
      ReactLocal.createElement(ReactLocal.Fragment, null, children),
    Gesture: {
      Tap: () => chain,
      LongPress: () => chain,
      Pan: () => chain,
      Exclusive: () => chain,
      Simultaneous: () => chain,
    },
  };
});

jest.mock('react-native-worklets', () => ({runOnJS: (fn: any) => fn}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {Medium: 'medium'},
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn(), hide: jest.fn()},
}));

jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  BASMALLAH_TEXT: 'basmallah',
  digitalKhattDataService: {
    getPageLines: () => [{line_type: 'ayah', line_number: 1, surah_number: 2}],
  },
}));
jest.mock('@/services/mushaf/QCFDataService', () => ({
  qcfDataService: {
    getWordsForLine: () => [{code: '', verseKey: '2:1'}],
    getOrderedVerseKeysForPage: () => ['2:1'],
  },
}));
jest.mock('@/services/mushaf/QCFLineService', () => ({
  buildQCFLineRenderModel: () => ({
    renderedText: 'x',
    verseSegments: [],
  }),
  buildQCFLineAllahNameMap: () => null,
  findQCFVerseAtCharIndex: () => null,
}));
jest.mock('@/services/mushaf/QCFFontLoader', () => ({
  qcfFontFamilyForPage: () => 'QCF_P100',
  qcfFontLoader: {
    isReady: () => true,
    ensure: () => Promise.resolve(),
    prefetch: jest.fn(),
  },
}));
jest.mock('@/services/mushaf/QCFLayoutCacheService', () => ({
  qcfLayoutCacheService: {
    // Orientation-independent calibration width — the whole point of the
    // cache change. 900 matches the stubbed getLongestLine().
    getPageLayout: () => ({
      widestRef: 900,
      lineWidthsAtRef: [{lineIndex: 0, width: 900}],
    }),
    setPageLayout: jest.fn(),
  },
}));
jest.mock('@/services/mushaf/MushafPreloadService', () => ({
  mushafPreloadService: {quranCommonTypeface: {}},
}));
jest.mock('@/services/mushaf/AllahNameHighlightService', () => ({
  getTextAllahNameCharMap: () => null,
}));
jest.mock('@/services/mushaf/ThemeDataService', () => ({
  themeDataService: {getThemeForVerse: () => null},
}));
jest.mock('@/hooks/useMushafFontMgr', () => ({useMushafFontMgr: () => ({})}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({theme: {isDarkMode: false, colors: {text: '#000'}}}),
}));
jest.mock('@/utils/skiaTextWeight', () => ({
  createTextStrokePaint: () => null,
  getArabicTextWeightStrokeWidth: () => 0,
}));
jest.mock('@/constants/mushafAllahHighlight', () => ({
  getAllahNameHighlightColorHex: () => '#gold',
}));
jest.mock('../../skia/SkiaSurahHeader', () => () => null);

const mockSettingsState = {
  arabicTextWeight: 'normal',
  showThemes: false,
  showAllahNameHighlight: false,
  allahNameHighlightColor: 'gold',
};
jest.mock('@/store/mushafSettingsStore', () => ({
  useMushafSettingsStore: (sel: any) => sel(mockSettingsState),
}));
jest.mock('@/store/mushafPlayerStore', () => ({
  useMushafPlayerStore: (sel: any) =>
    sel({currentVerseKey: null, playbackState: 'idle'}),
}));
const mockSelectionState = {
  selectedVerseKeys: [],
  selectedPageNumber: null,
  selectVerse: jest.fn(),
  selectVerseRange: jest.fn(),
};
jest.mock('@/store/mushafVerseSelectionStore', () => {
  const hook: any = (sel: any) => sel(mockSelectionState);
  hook.getState = () => mockSelectionState;
  return {useMushafVerseSelectionStore: hook};
});

import QCFPage from '../QCFPage';
import {
  SCREEN_WIDTH as DEFAULT_SCREEN_WIDTH,
  SCREEN_HEIGHT as DEFAULT_SCREEN_HEIGHT,
  CONTENT_WIDTH as DEFAULT_CONTENT_WIDTH,
  CONTENT_HEIGHT as DEFAULT_CONTENT_HEIGHT,
  PAGE_PADDING_TOP as DEFAULT_PAGE_PADDING_TOP,
  getMushafLayout,
} from '../../constants';

// Pixel 3 landscape — the orientation the defect showed up in.
const LANDSCAPE = getMushafLayout({
  width: 785.5,
  height: 392.7,
  isTablet: false,
});

function renderPage(props: Record<string, unknown> = {}) {
  return render(
    <QCFPage
      pageNumber={100}
      textColor="#000000"
      dividerColor="#888888"
      {...props}
    />,
  );
}

function flatten(style: unknown): Record<string, number> {
  return Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten))
    : ((style ?? {}) as Record<string, number>);
}

describe('QCFPage geometry follows the metrics it is given (GH #364)', () => {
  it('sizes the page View from the landscape props, not the portrait constants', () => {
    const {toJSON} = renderPage({
      screenWidth: LANDSCAPE.pageWidth,
      screenHeight: LANDSCAPE.screenHeight,
      contentWidth: LANDSCAPE.contentWidth,
      contentHeight: LANDSCAPE.contentHeight,
      baseLineHeight: LANDSCAPE.baseLineHeight,
      paddingHorizontal: LANDSCAPE.paddingHorizontal,
      paddingTop: LANDSCAPE.paddingTop,
    });

    const root = toJSON() as any;
    const style = flatten(root.props.style);
    expect(style.width).toBeCloseTo(LANDSCAPE.pageWidth, 5);
    expect(style.height).toBeCloseTo(LANDSCAPE.screenHeight, 5);
    // The defect: these were the portrait snapshot.
    expect(style.width).not.toBeCloseTo(DEFAULT_SCREEN_WIDTH, 5);
    expect(style.height).not.toBeCloseTo(DEFAULT_SCREEN_HEIGHT, 5);
  });

  it('sizes the Skia Canvas from the landscape props', () => {
    const {getByTestId} = renderPage({
      screenWidth: LANDSCAPE.pageWidth,
      screenHeight: LANDSCAPE.screenHeight,
      contentWidth: LANDSCAPE.contentWidth,
      contentHeight: LANDSCAPE.contentHeight,
      baseLineHeight: LANDSCAPE.baseLineHeight,
      paddingHorizontal: LANDSCAPE.paddingHorizontal,
      paddingTop: LANDSCAPE.paddingTop,
    });

    const style = flatten(getByTestId('qcf-canvas').props.style);
    expect(style.width).toBeCloseTo(LANDSCAPE.contentWidth, 5);
    expect(style.height).toBeCloseTo(LANDSCAPE.contentHeight, 5);
    expect(style.marginTop).toBeCloseTo(LANDSCAPE.paddingTop, 5);
    expect(style.marginLeft).toBeCloseTo(LANDSCAPE.paddingHorizontal, 5);

    expect(style.width).not.toBeCloseTo(DEFAULT_CONTENT_WIDTH, 5);
    expect(style.height).not.toBeCloseTo(DEFAULT_CONTENT_HEIGHT, 5);
    expect(style.marginTop).not.toBeCloseTo(DEFAULT_PAGE_PADDING_TOP, 5);
  });

  it('still renders at the portrait constants when no metrics are passed', () => {
    // Guards the fallback contract: any caller that passes nothing keeps the
    // pre-#364 behaviour byte-for-byte.
    const {toJSON, getByTestId} = renderPage();
    const root = toJSON() as any;
    expect(flatten(root.props.style).width).toBeCloseTo(
      DEFAULT_SCREEN_WIDTH,
      5,
    );
    const canvas = flatten(getByTestId('qcf-canvas').props.style);
    expect(canvas.width).toBeCloseTo(DEFAULT_CONTENT_WIDTH, 5);
    expect(canvas.height).toBeCloseTo(DEFAULT_CONTENT_HEIGHT, 5);
    expect(canvas.marginTop).toBeCloseTo(DEFAULT_PAGE_PADDING_TOP, 5);
  });
});
