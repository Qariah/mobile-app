// @ai
// TECH_DEBT #272: each change of what a Mushaf page draws reports a draw
// (SkiaPage `onDraw`, components/mushaf/useCommitReport.ts), so the rotation
// stage drops its portrait snapshot of the page. This test RENDERS SkiaPage
// and makes each change that the 2026-10-18 review named: the verse units
// (the reviewer's probe), the text identity, the font manager, a highlight,
// a bookmark, the selection, the player's verse, a reader setting, the theme,
// and a new prop from the page view. The mount alone reports nothing.
//
// The Skia / service tree is stubbed as in pageTextIdentity.test.tsx.

import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';
import type {DKLine} from '@/services/mushaf/DigitalKhattDataService';
import type {RewayahId} from '@/services/rewayah/RewayahIdentity';
import type {FixtureDb} from '@/services/mushaf/__fixtures__/rewayahOverlayFixture';

type MockDKLine = DKLine;
type MockRewayahId = RewayahId;
type MockFixtureDb = FixtureDb;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@shopify/react-native-skia', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const makeBuilder = () => {
    let text = '';
    const builder = {
      pushStyle: () => builder,
      pop: () => builder,
      addText(chunk: string) {
        text += chunk;
        return builder;
      },
      build: () => ({
        text,
        layout: () => undefined,
        getLongestLine: () => 0,
        getHeight: () => 0,
        getRectsForRange: () => [],
        getGlyphPositionAtCoordinate: () => 0,
        dispose: () => undefined,
      }),
    };
    return builder;
  };
  const Pass = ({children}: {children?: React.ReactNode}) =>
    ReactActual.createElement(ReactActual.Fragment, null, children);
  return {
    Canvas: Pass,
    Group: Pass,
    Paragraph: () => null,
    RoundedRect: () => null,
    Rect: () => null,
    Skia: {
      Color: (color: string) => color,
      ParagraphBuilder: {Make: () => makeBuilder()},
      // The stroke paint of a heavier text weight.
      Paint: () => ({
        setAntiAlias: () => undefined,
        setColor: () => undefined,
        setStyle: () => undefined,
        setStrokeWidth: () => undefined,
        setStrokeCap: () => undefined,
        setStrokeJoin: () => undefined,
      }),
    },
    TextAlign: {Left: 0},
    TextDirection: {RTL: 0},
    TextHeightBehavior: {DisableAll: 3},
    PaintStyle: {Stroke: 1},
    StrokeCap: {Round: 1},
    StrokeJoin: {Round: 1},
  };
});

jest.mock('@/services/mushaf/DigitalKhattDataService', () => {
  const actual = jest.requireActual<
    typeof import('@/services/mushaf/DigitalKhattDataService')
  >('@/services/mushaf/DigitalKhattDataService');
  const {createFakeDKService} = jest.requireActual<
    typeof import('@/services/mushaf/__fixtures__/rewayahOverlayFixture')
  >('@/services/mushaf/__fixtures__/rewayahOverlayFixture');
  const base = createFakeDKService();
  const listeners = new Set<() => void>();
  let version = 0;
  let identity: string | null = null;
  const service = {
    get rewayah() {
      return base.rewayah;
    },
    get initialized() {
      return identity !== null;
    },
    getCacheVersion: () => version,
    subscribeCacheChanges: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLayoutIdentityKey: () => identity,
    getPageLines: (page: number) => base.getPageLines(page),
    getWordText: (wordId: number) => base.getWordText(wordId),
    getWordInfo: (wordId: number) => base.getWordInfo(wordId),
    getLineText: (line: MockDKLine) => base.getLineText(line),
    getVerseWords: (verseKey: string, rewayah?: MockRewayahId) =>
      base.getVerseWords(verseKey, rewayah),
    getVerseText: (verseKey: string, rewayah?: MockRewayahId) =>
      base.getVerseText(verseKey, rewayah),
    getSurahStartPages: () => ({}),
    getPageToSurah: () => ({}),
    swapMain(db: MockFixtureDb) {
      base.load(db);
      identity = `${base.rewayah}@fixture-${db}`;
      version += 1;
    },
    notify() {
      for (const listener of [...listeners]) listener();
    },
  };
  return {...actual, digitalKhattDataService: service};
});

jest.mock('@/services/mushaf/JustificationService', () => {
  const cache = new Map<string, unknown[]>();
  const key = (ratio: number, page: number, font: string) => {
    const {
      digitalKhattDataService,
    } = require('@/services/mushaf/DigitalKhattDataService');
    return `${digitalKhattDataService.getLayoutIdentityKey()}|${font}|${ratio}|${page}`;
  };
  return {
    JustService: {
      getCachedPageLayout: (ratio: number, page: number, font: string) =>
        cache.get(key(ratio, page, font)),
      getPageLayout: (
        page: number,
        ratio: number,
        _f: unknown,
        font: string,
      ) => {
        const k = key(ratio, page, font);
        const {
          digitalKhattDataService,
        } = require('@/services/mushaf/DigitalKhattDataService');
        const layout =
          cache.get(k) ??
          digitalKhattDataService.getPageLines(page).map(() => ({
            fontFeatures: new Map(),
            simpleSpacing: 100,
            ayaSpacing: 100,
            fontSizeRatio: 1,
          }));
        cache.set(k, layout);
        return layout;
      },
      clearPageLayoutCache: () => undefined,
    },
  };
});

jest.mock('@/services/mushaf/MushafLayoutCacheService', () => ({
  mushafLayoutCacheService: {
    getPageLayout: () => undefined,
    setPageLayout: () => undefined,
  },
}));
jest.mock('@/services/mushaf/MushafPreloadService', () => ({
  mushafPreloadService: {quranCommonTypeface: null},
}));

// The font manager and the theme, as stores the test can change.
jest.mock('@/hooks/useMushafFontMgr', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  const store = create(() => ({fontMgr: {} as object}));
  return {
    mockFontStore: store,
    useMushafFontMgr: () => store(s => s.fontMgr),
  };
});
jest.mock('@/hooks/useTheme', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  const store = create(() => ({isDarkMode: false}));
  return {
    mockThemeStore: store,
    useTheme: () => {
      const isDarkMode = store(s => s.isDarkMode);
      return {theme: {isDarkMode}, isDarkMode};
    },
  };
});

jest.mock('../SkiaSurahHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('react-native-gesture-handler', () => {
  const gesture = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const method of [
      'minDuration',
      'maxDistance',
      'activateAfterLongPress',
      'minDistance',
      'onStart',
      'onUpdate',
      'onEnd',
    ]) {
      chain[method] = () => chain;
    }
    return chain;
  };
  return {
    Gesture: {
      LongPress: gesture,
      Pan: gesture,
      Tap: gesture,
      Exclusive: () => ({}),
    },
    GestureDetector: ({children}: {children: React.ReactNode}) => children,
  };
});
jest.mock('react-native-worklets', () => ({runOnJS: (fn: unknown) => fn}));
jest.mock('@/utils/toastUtils', () => ({showToast: jest.fn()}));
jest.mock('expo-haptics', () => ({
  impactAsync: () => undefined,
  ImpactFeedbackStyle: {Light: 'light', Medium: 'medium'},
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: () => undefined},
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

// The player: the follow-along band fields (playbackBand.ts).
jest.mock('@/store/mushafPlayerStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  const store = create(() => ({
    playbackState: 'idle',
    currentVerseKey: null as string | null,
    currentVerseKeys: [] as string[],
    currentReciterVerseKey: null,
    numberingMode: null,
    _numbering: null,
  }));
  return {
    useMushafPlayerStore: store,
    usePlaybackVerseKeys: () => [],
  };
});
jest.mock('@/store/verseAnnotationsStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    useVerseAnnotationsStore: create(() => ({
      highlights: {} as Record<string, string>,
      bookmarkedVerseKeys: new Set<string>(),
      bookmarkRows: {},
      highlightRows: {},
      loadAnnotationsForSurah: () => undefined,
    })),
  };
});
jest.mock('@/store/tajweedStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {useTajweedStore: create(() => ({indexedTajweedData: null}))};
});
jest.mock('@/services/mushaf/ThemeDataService', () => ({
  themeDataService: {getThemeForVerse: () => undefined},
}));
jest.mock('@/services/mushaf/RewayahVerseUnitsService', () => ({
  rewayahVerseUnitsService: jest
    .requireActual('@/services/mushaf/__fixtures__/verseUnitsServiceStub')
    .verseUnitsServiceStub({peek: () => null, status: () => 'loading'}),
}));

import SkiaPage from '../SkiaPage';
import {digitalKhattDataService} from '@/services/mushaf/DigitalKhattDataService';
import {quranTextService} from '@/services/mushaf/QuranTextService';
import {rewayahVerseUnitsService} from '@/services/mushaf/RewayahVerseUnitsService';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import {useMushafPlayerStore} from '@/store/mushafPlayerStore';
import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';
import {useMushafVerseSelectionStore} from '@/store/mushafVerseSelectionStore';

declare const global: {IS_REACT_ACT_ENVIRONMENT?: boolean};
global.IS_REACT_ACT_ENVIRONMENT = true;

const {mockFontStore} = jest.requireMock('@/hooks/useMushafFontMgr') as {
  mockFontStore: {setState: (s: {fontMgr: object}) => void};
};
const {mockThemeStore} = jest.requireMock('@/hooks/useTheme') as {
  mockThemeStore: {setState: (s: {isDarkMode: boolean}) => void};
};

interface TestDKService {
  readonly rewayah: RewayahId;
  swapMain(db: FixtureDb): void;
  notify(): void;
}
const dk = digitalKhattDataService as unknown as TestDKService;
const verseUnits = rewayahVerseUnitsService as unknown as {notify(): void};

const PAGE = 4;
const onDraw = jest.fn();
let renderer: TestRenderer.ReactTestRenderer | null = null;

const page = (textColor = '#111111') => (
  <SkiaPage
    pageNumber={PAGE}
    textColor={textColor}
    dividerColor="#666666"
    onDraw={onDraw}
  />
);

beforeEach(() => {
  act(() => {
    useMushafSettingsStore.setState({
      mushafRenderer: 'dk_v2',
      uthmaniFont: 'v2',
      arabicTextWeight: 'normal',
      showTajweed: false,
      showThemes: false,
      showAllahNameHighlight: false,
      showRewayahDiffs: false,
      rewayah: 'hafs',
    });
    dk.swapMain('hafs');
    quranTextService.clearCaches();
    dk.notify();
  });
  act(() => {
    renderer = TestRenderer.create(page());
  });
  onDraw.mockClear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

it('reports nothing for the mount', () => {
  act(() => {
    renderer?.unmount();
    renderer = TestRenderer.create(page());
  });
  expect(onDraw).not.toHaveBeenCalled();
});

it.each<[string, () => void]>([
  // The reviewer's probe: the end of a verse-units build (SkiaPage
  // verseUnitsVersion: bookmark tint, highlights, selection, playback band).
  ['the verse units', () => verseUnits.notify()],
  [
    'the text identity (a rewayah switch)',
    () => {
      dk.swapMain('warsh' as FixtureDb);
      dk.notify();
    },
  ],
  ['the font manager', () => mockFontStore.setState({fontMgr: {}})],
  [
    'a highlight',
    () => useVerseAnnotationsStore.setState({highlights: {'3:1': 'yellow'}}),
  ],
  [
    'a bookmark',
    () =>
      useVerseAnnotationsStore.setState({
        bookmarkedVerseKeys: new Set(['3:1']),
      }),
  ],
  [
    'the selection',
    () => useMushafVerseSelectionStore.getState().selectVerse('2:30', PAGE),
  ],
  [
    "the player's verse",
    () =>
      useMushafPlayerStore.setState({
        playbackState: 'playing',
        currentVerseKey: '2:30',
      }),
  ],
  [
    'a reader setting',
    () => useMushafSettingsStore.setState({arabicTextWeight: 'bold'}),
  ],
  ['the theme', () => mockThemeStore.setState({isDarkMode: true})],
  ['a new prop from the page view', () => renderer?.update(page('#222222'))],
])('reports a draw for %s', (_name, change) => {
  act(change);
  expect(onDraw).toHaveBeenCalled();
});
