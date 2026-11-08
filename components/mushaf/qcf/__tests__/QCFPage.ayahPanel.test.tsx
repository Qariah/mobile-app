// @ai-generated
// Sprint 52 Task 8: a QCF (Mushaf 1440) long-press opens the verse actions
// while the ayah panel is closed, and moves the open panel to the pressed
// ayah, with no sheet. The page is the stubbed page of QCFPage.layout.test;
// the long-press runs through the gesture callbacks that QCFPage builds.

import React, {act} from 'react';
import {render} from '@testing-library/react-native';

const mockShow = jest.fn();
const mockHit = {verseKey: '2:2'};
/** The callbacks of the last built gestures, by gesture and event. */
const mockGestures: Record<string, (event?: unknown) => void> = {};

// --- native + heavy-tree stubs (as QCFPage.layout.test.tsx) ----------------

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
  const make = (kind: string) => {
    const chain: any = new Proxy(
      {},
      {
        get: (_target, prop: string) => (arg: unknown) => {
          if (typeof arg === 'function')
            mockGestures[`${kind}.${prop}`] = arg as any;
          return chain;
        },
      },
    );
    return chain;
  };
  return {
    GestureDetector: ({children}: any) =>
      ReactLocal.createElement(ReactLocal.Fragment, null, children),
    Gesture: {
      Tap: () => make('tap'),
      LongPress: () => make('longPress'),
      Pan: () => make('pan'),
      Exclusive: () => make('exclusive'),
      Simultaneous: () => make('simultaneous'),
    },
  };
});

jest.mock('react-native-worklets', () => ({runOnJS: (fn: any) => fn}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {Medium: 'medium'},
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: (...args: unknown[]) => mockShow(...args)},
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
  // Every point of the page hits the verse of this test.
  findQCFVerseAtCharIndex: () => ({verseKey: mockHit.verseKey}),
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
    // A cache miss: the page measures itself with the stubbed
    // getLongestLine() (900) and sizes the font from the live content width.
    getPageLayout: () => undefined,
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
// One font manager object: the selection store re-renders the page here.
const mockFontMgr = {};
jest.mock('@/hooks/useMushafFontMgr', () => ({
  useMushafFontMgr: () => mockFontMgr,
}));
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
  // Upstream #329: QCFPage reads the playing verses through this hook.
  usePlaybackVerseKeys: () => [],
  usePlaybackBasmalaSurah: () => null, // Pass D: upstream's basmala intro
}));
import {Platform} from 'react-native';
import QCFPage from '../QCFPage';
import {getMushafLayout} from '../../constants';
import {useMushafVerseSelectionStore} from '@/store/mushafVerseSelectionStore';
import {
  closeAyahPanel,
  openAyahPanel,
  registerAyahPanelHost,
  useAyahPanelStore,
  type AyahPanelPayload,
} from '@/components/mushaf/ayah-panel/ayahPanelStore';

const METRICS = getMushafLayout({width: 834, height: 1194, isTablet: true});

function renderPage() {
  return render(
    <QCFPage
      metrics={METRICS}
      pageNumber={2}
      textColor="#000000"
      dividerColor="#888888"
    />,
  );
}

/**
 * A long-press on the page: the drag gesture (iOS: a Pan after a long press,
 * Android: a LongPress) starts on the first point of the page that hits a
 * verse line, and ends there.
 */
function longPress() {
  const kind = Platform.OS === 'android' ? 'longPress' : 'pan';
  const x = METRICS.paddingHorizontal + METRICS.contentWidth / 2;
  act(() => {
    for (
      let y = METRICS.paddingTop;
      y < METRICS.paddingTop + METRICS.contentHeight;
      y += 2
    ) {
      mockGestures[`${kind}.onStart`]({x, y});
      const selected = useMushafVerseSelectionStore.getState().selectedVerseKey;
      if (selected === mockHit.verseKey) break;
    }
    // The press reached a verse line of the page.
    expect(useMushafVerseSelectionStore.getState().selectedVerseKey).toBe(
      mockHit.verseKey,
    );
    mockGestures[`${kind}.onEnd`]();
  });
}

function payload(key: string): AyahPanelPayload {
  const [surah, ayah] = key.split(':').map(Number);
  return {
    verseKey: key,
    surahNumber: surah,
    ayahNumber: ayah,
    source: 'mushaf',
  } as AyahPanelPayload;
}

let unregister: (() => void) | null = null;

beforeEach(() => {
  mockShow.mockClear();
  unregister = registerAyahPanelHost();
});

afterEach(() => {
  unregister?.();
  unregister = null;
  closeAyahPanel();
  useMushafVerseSelectionStore.getState().clearSelection();
});

describe('QCFPage long-press and the ayah panel (Sprint 52 Task 8)', () => {
  it('opens the verse actions while the panel is closed', () => {
    mockHit.verseKey = '2:2';
    renderPage();
    longPress();
    expect(useMushafVerseSelectionStore.getState().selectedVerseKey).toBe(
      '2:2',
    );
    expect(mockShow).toHaveBeenCalledWith('verse-actions', {
      payload: {
        verseKey: '2:2',
        surahNumber: 2,
        ayahNumber: 2,
        verseKeys: undefined,
        source: 'mushaf',
      },
    });
  });

  it('moves the open panel to the pressed ayah, with no sheet', () => {
    useMushafVerseSelectionStore.getState().selectVerse('2:1', 2);
    act(() => openAyahPanel(payload('2:1'), 'reflections'));
    mockHit.verseKey = '2:3';
    renderPage();
    longPress();
    expect(mockShow).not.toHaveBeenCalled();
    const state = useAyahPanelStore.getState();
    expect(state.payload?.verseKey).toBe('2:3');
    expect(state.tab).toBe('reflections');
    expect(useMushafVerseSelectionStore.getState().selectedVerseKeys).toEqual([
      '2:3',
    ]);
  });

  it('keeps the panel and an unsaved note on their ayah', () => {
    useMushafVerseSelectionStore.getState().selectVerse('2:1', 2);
    act(() => openAyahPanel(payload('2:1'), 'notes', {compose: true}));
    mockHit.verseKey = '2:3';
    renderPage();
    longPress();
    expect(mockShow).not.toHaveBeenCalled();
    const state = useAyahPanelStore.getState();
    expect(state.payload?.verseKey).toBe('2:1');
    expect(state.compose).toBe(true);
    // The highlight goes back to the panel's ayah.
    expect(useMushafVerseSelectionStore.getState().selectedVerseKeys).toEqual([
      '2:1',
    ]);
  });
});
