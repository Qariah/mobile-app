// @ai
// The rotation stage moves the snapshot of the old page onto the new page's
// text block (components/mushaf/rotationStageGeometry.ts). This test RENDERS
// the page renderer (QCFPage, with the props main.tsx passes) and checks that
// `pageTextRect` names the place where the renderer draws its first line. A
// test that recomputed the formula could not catch a drift between the two;
// pages 1-2 are centred (`centerShortPages`), which the 2026-10-16 review
// found the first geometry missed.
//
// The Skia / gesture / service tree is stubbed as in
// components/mushaf/qcf/__tests__/QCFPage.layout.test.tsx.

import React from 'react';
import {render} from '@testing-library/react-native';

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
    Paragraph: ({y}: any) =>
      ReactLocal.createElement(View, {testID: 'qcf-paragraph', y}),
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
    getPageLines: (page: number) =>
      Array.from({length: page <= 2 ? 8 : 15}, (_, i) => ({
        line_type: 'ayah',
        line_number: i + 1,
        surah_number: page <= 2 ? page : 3,
      })),
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
  // Pass C (Sprint 47): upstream's V4 tajweed font variants (#350).
  getQCFFontVariant: () => 'v2',
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
jest.mock('../skia/SkiaSurahHeader', () => () => null);

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
  // Upstream #329: QCFPage reads the playing verses through this hook.
  usePlaybackVerseKeys: () => [],
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

import QCFPage from '../qcf/QCFPage';
import {
  getMushafLayout,
  getPageEdgeLayout,
  usesSymmetricPageEdges,
  type MushafLayoutMetrics,
} from '../constants';
import {pageTextRect} from '../rotationStageGeometry';

// iPhone 16 Pro, non-glass chrome (main.tsx passes 60/60 below iOS 26).
const PORTRAIT = getMushafLayout({
  width: 402,
  height: 874,
  insets: {top: 62, bottom: 34, left: 0, right: 0},
  toolbarHeight: 60,
  headerHeight: 60,
  isTablet: false,
});
const LANDSCAPE = getMushafLayout({
  width: 874,
  height: 402,
  insets: {top: 0, bottom: 21, left: 62, right: 62},
  toolbarHeight: 60,
  headerHeight: 60,
  isTablet: false,
});

function flatten(style: unknown): Record<string, number> {
  return Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten))
    : ((style ?? {}) as Record<string, number>);
}

/** Renders the page as DKPageView in main.tsx does, and reads where it draws. */
function drawnFirstLine(page: number, m: MushafLayoutMetrics, book: boolean) {
  const marginLeft =
    book && !usesSymmetricPageEdges(m, book)
      ? getPageEdgeLayout(page).contentMarginLeft
      : undefined;
  const {getByTestId, getAllByTestId} = render(
    <QCFPage
      pageNumber={page}
      textColor="#000000"
      dividerColor="#888888"
      contentMarginLeft={marginLeft}
      screenWidth={m.pageWidth}
      screenHeight={m.screenHeight}
      contentWidth={m.contentWidth}
      contentHeight={m.contentHeight}
      baseLineHeight={m.baseLineHeight}
      paddingHorizontal={m.paddingHorizontal}
      paddingTop={m.paddingTop}
      centerShortPages={!m.scrollContainerHeight}
    />,
  );
  const canvas = flatten(getByTestId('qcf-canvas').props.style);
  const firstY = Math.min(
    ...getAllByTestId('qcf-paragraph').map(p => p.props.y as number),
  );
  return {
    // DKSpreadView puts the page at `pageOffsetX`.
    x: m.pageOffsetX + canvas.marginLeft,
    y: canvas.marginTop + firstY,
    width: canvas.width,
  };
}

type Case = {
  name: string;
  orientation: 'portrait' | 'landscape';
  m: MushafLayoutMetrics;
  page: number;
  book: boolean;
};
const cases: Case[] = [];
for (const page of [1, 2, 50, 51]) {
  for (const book of [true, false]) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      cases.push({
        name: `${orientation}, page ${page}, ${book ? 'book' : 'fullscreen'}`,
        orientation,
        m: orientation === 'portrait' ? PORTRAIT : LANDSCAPE,
        page,
        book,
      });
    }
  }
}

describe('the rotation stage maps onto the line the renderer draws', () => {
  it.each(cases)('$name', ({orientation, m, page, book}) => {
    const rect = pageTextRect({
      orientation,
      metrics: m,
      page,
      paged: true,
      isBookLayout: book,
      scrollY: 0,
    });
    const drawn = drawnFirstLine(page, m, book);
    expect(rect).not.toBeNull();
    expect(rect?.x).toBeCloseTo(drawn.x, 3);
    expect(rect?.y).toBeCloseTo(drawn.y, 3);
    expect(rect?.width).toBeCloseTo(drawn.width, 3);
  });

  it('sees pages 1-2 centred in portrait, where the page is not in a scroller', () => {
    const page1 = drawnFirstLine(1, PORTRAIT, true);
    const page50 = drawnFirstLine(50, PORTRAIT, true);
    // The case the first geometry missed: the text block of page 1 starts
    // well below the top padding.
    expect(page1.y - page50.y).toBeGreaterThan(100);
  });
});
