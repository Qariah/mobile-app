// @ai
// TECH_DEBT #265 — List + Horizontal mode in landscape showed an empty grey page.
//
// The pager in main.tsx lays out its items `metrics.screenWidth` apart
// (`getItemLayout`), and `metrics` follows the rotation. ReadingPageView sized
// itself from SCREEN_WIDTH / SCREEN_HEIGHT, the window at module load (the
// portrait window). In landscape each page stayed portrait-sized while the
// list placed it one landscape width along, so the screen showed the grey
// list background. The page now takes its size from `metrics`.
//
// The children and the stores are stubs: this suite checks the page size and
// the content width only. The Hafs and verse-unit suites cover the rows.

import {readFileSync} from 'fs';
import {join} from 'path';
import React from 'react';
import {StyleSheet} from 'react-native';
import {render} from '@testing-library/react-native';

const mockDividerWidths: number[] = [];

jest.mock('@/components/player/v2/PlayerContent/QuranView/VerseItem', () => ({
  VerseItem: () => null,
}));
jest.mock(
  '@/components/player/v2/PlayerContent/QuranView/BasmalaHeader',
  () => ({__esModule: true, default: () => null}),
);
jest.mock(
  '@/components/player/v2/PlayerContent/QuranView/SurahDivider',
  () => ({
    __esModule: true,
    default: (props: {width: number}) => {
      mockDividerWidths.push(props.width);
      return null;
    },
  }),
);
jest.mock('@/components/mushaf/PageEdgeDecoration', () => ({
  __esModule: true,
  default: () => null,
  EDGE_BORDER_RADIUS: 40,
  EDGE_HORIZONTAL_INSET: 4,
}));
jest.mock('react-native-size-matters', () => ({
  moderateScale: (value: number) => value,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({theme: {isDarkMode: false}, isDarkMode: false}),
}));
jest.mock('@/hooks/useMushafFontMgr', () => ({useMushafFontMgr: () => null}));
jest.mock('@/services/mushaf/MushafPreloadService', () => ({
  mushafPreloadService: {initialized: false},
}));
jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  digitalKhattDataService: {initialized: false},
}));
jest.mock('@/services/mushaf/ThemeDataService', () => ({
  themeDataService: {getThemeForVerse: () => undefined},
}));
jest.mock('@/services/mushaf/MushafVerseMapService', () => ({
  shownVerseUnitsOf: () => [],
}));
jest.mock('@/utils/translationLookup', () => ({
  ...jest.requireActual('@/utils/translationLookup'),
  getTranslationName: () => 'Translation',
}));
// One surah header, so the content width shows in the divider's width.
jest.mock('@/utils/mushafPageVerses', () => ({
  getReadingPageItems: () => [
    {type: 'surah_header', surahNumber: 2, showBismillah: true},
  ],
}));
jest.mock('@/store/mushafSettingsStore', () => {
  const settings = {
    showTranslation: false,
    showTransliteration: false,
    showTajweed: false,
    showWBW: false,
    wbwShowTranslation: false,
    wbwShowTransliteration: false,
    arabicFontSize: 24,
    arabicTextWeight: 'normal',
    showAllahNameHighlight: false,
    allahNameHighlightColor: 'default',
    translationFontSize: 14,
    transliterationFontSize: 14,
    mushafRenderer: 'dk_v1',
    showThemes: false,
    selectedTranslationId: 1,
    rewayah: 'hafs',
  };
  return {
    useMushafSettingsStore: (selector: (s: typeof settings) => unknown) =>
      selector(settings),
    getDkFontFamily: () => 'DK',
  };
});
jest.mock('@/store/mushafPlayerStore', () => ({
  useMushafPlayerStore: (selector: (s: object) => unknown) =>
    selector({currentVerseKey: null, playbackState: 'idle'}),
  usePlaybackVerseKeys: () => [],
}));
jest.mock('@/store/tajweedStore', () => ({
  useTajweedStore: (selector: (s: object) => unknown) =>
    selector({indexedTajweedData: null}),
}));
jest.mock('@/store/verseAnnotationsStore', () => ({
  useVerseAnnotationsStore: (selector: (s: object) => unknown) =>
    selector({loadAnnotationsForSurah: () => undefined}),
}));
jest.mock('@/hooks/useRewayahVerseUnits', () => ({
  useRewayahVerseUnits: () => ({units: null, status: 'ready'}),
}));
jest.mock('@/components/mushaf/skia/playbackBand', () => ({
  usePlaybackBand: () => null,
}));
jest.mock('@/components/mushaf/skia/verseHighlightLayers', () => ({
  playbackBandUnitKeys: () => [],
}));
jest.mock('@/components/mushaf/reading/VerseUnitsPending', () => ({
  VerseUnitsPending: () => null,
}));

import ReadingPageView from '../ReadingPageView';
import {
  PAGE_PADDING_HORIZONTAL,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  getMushafLayout,
  type MushafLayoutMetrics,
} from '../../constants';

// iPhone 17 Pro, as in readerListKey.test.ts. `isTablet` is explicit: the
// jest window (750 wide) counts as a tablet.
const PORTRAIT = getMushafLayout({
  width: 402,
  height: 874,
  insets: {top: 62, bottom: 34, left: 0, right: 0},
  isTablet: false,
});
const LANDSCAPE = getMushafLayout({
  width: 874,
  height: 402,
  insets: {top: 0, bottom: 21, left: 62, right: 62},
  isTablet: false,
});

const LANDSCAPE_NO_CUTOUT = getMushafLayout({
  width: 874,
  height: 402,
  insets: {top: 0, bottom: 0, left: 0, right: 0},
  isTablet: false,
});

function renderPage(metrics?: MushafLayoutMetrics, isBookLayout = false) {
  mockDividerWidths.length = 0;
  const screen = render(
    <ReadingPageView
      pageNumber={2}
      textColor="#111111"
      surahLabel="Al-Baqarah"
      juzLabel="Juz 1"
      pageLabel="2"
      labelColor="#666666"
      borderColor="#cccccc"
      cardColor="#ffffff"
      bgColor="#eeeeee"
      isBookLayout={isBookLayout}
      metrics={metrics}
    />,
  );
  const root = screen.toJSON();
  if (!root || Array.isArray(root)) {
    throw new Error('expected one root view');
  }
  return StyleSheet.flatten(root.props.style);
}

describe('ReadingPageView page size (TECH_DEBT #265)', () => {
  it('fills one landscape pager item: 874 x 402', () => {
    // The phone-landscape page is taller than the screen in Mushaf mode; the
    // reading page scrolls inside itself, so it takes the visible height.
    expect(LANDSCAPE.scrollContainerHeight).toBe(402);
    expect(LANDSCAPE.screenHeight).toBeGreaterThan(402);

    const style = renderPage(LANDSCAPE);

    expect(style.width).toBe(874);
    expect(style.height).toBe(402);
  });

  it('fills one portrait pager item: 402 x 874', () => {
    const style = renderPage(PORTRAIT);

    expect(style.width).toBe(402);
    expect(style.height).toBe(874);
  });

  it('sizes the content from the page width (list and book layout)', () => {
    // No cutout (Android, or an iPhone with no notch): the full width.
    renderPage(LANDSCAPE_NO_CUTOUT);
    expect(mockDividerWidths[0]).toBe(874 - (PAGE_PADDING_HORIZONTAL + 8) * 2);

    // Book layout: the card is the page minus the edge inset (4 here), and
    // the content has 12 on each side.
    renderPage(LANDSCAPE_NO_CUTOUT, true);
    expect(mockDividerWidths[0]).toBe(874 - 4 - 12 * 2);
  });

  it('keeps the text out of the landscape cutouts (notch, Dynamic Island)', () => {
    // The page stays one window wide (the pager needs it); the safe span is
    // [pageOffsetX, pageOffsetX + pageWidth] = [62, 812].
    expect(LANDSCAPE.pageOffsetX).toBe(62);
    expect(LANDSCAPE.pageWidth).toBe(874 - 62 - 62);

    const style = renderPage(LANDSCAPE);
    expect(style.width).toBe(874);
    expect(mockDividerWidths[0]).toBe(
      874 - 62 - 62 - (PAGE_PADDING_HORIZONTAL + 8) * 2,
    );

    renderPage(LANDSCAPE, true);
    expect(mockDividerWidths[0]).toBe(874 - 62 - 62 - 4 - 12 * 2);
  });

  it('keeps the module-load size without metrics (the old behaviour)', () => {
    const style = renderPage(undefined);

    expect(style.width).toBe(SCREEN_WIDTH);
    expect(style.height).toBe(SCREEN_HEIGHT);
  });
});

describe('main.tsx gives ReadingPageView the live metrics (TECH_DEBT #265)', () => {
  it('passes metrics={metrics} to the reading page', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'main.tsx'),
      'utf8',
    );
    const start = source.indexOf('<ReadingPageView');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('/>', start);
    expect(end).toBeGreaterThan(start);

    expect(source.slice(start, end)).toMatch(/\bmetrics=\{metrics\}/);
  });
});
