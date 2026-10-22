// @ai Qariah (TECH_DEBT #297, Sprint 47) — "Remove Personal Note" in the verse
// actions sheet deletes the verse's note and sends verse_note_deleted once per
// deleted note. The harness is a short form of VerseActionsSheet.units.test.tsx.

import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';

const mockCapture = jest.fn();
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    captureDiagnosticEvent: (...args: unknown[]) => mockCapture(...args),
  },
}));
// Qariah: upstream's flag values (the note rows need `verseNotes`).
jest.mock('@/config/featureFlags', () =>
  jest.requireActual('@/test-utils/upstreamFeatureFlags'),
);
jest.mock('@/services/userState/notesSync', () => ({
  syncDeleteToQf: jest.fn(async () => undefined),
  pushLocalNoteToQf: jest.fn(async () => undefined),
  pushEditOfUnlinkedNoteToQf: jest.fn(async () => undefined),
  setNotePublishState: jest.fn(async () => undefined),
}));
jest.mock('../verse-actions/HighlightContent', () => ({
  HighlightContent: () => null,
}));
jest.mock('../verse-actions/NoteContent', () => ({NoteContent: () => null}));
jest.mock('../verse-actions/ShareContent', () => ({ShareContent: () => null}));
jest.mock('../verse-actions/SimilarVersesContent', () => ({
  SimilarVersesContent: () => null,
}));
jest.mock('../verse-actions/TranslationContent', () => ({
  TranslationContent: () => null,
}));
jest.mock('../verse-actions/TafseerContent', () => ({
  TafseerContent: () => null,
}));
jest.mock('../verse-actions/ThemeContent', () => ({ThemeContent: () => null}));
jest.mock('../verse-actions/WBWContent', () => ({WBWContent: () => null}));
jest.mock('../verse-actions/CommunityReflectionsContent', () => ({
  CommunityReflectionsContent: () => null,
}));
jest.mock('react-native-actions-sheet', () => {
  const ReactActual = jest.requireActual('react');
  const {View} = jest.requireActual('react-native');
  const Container = (props: {children?: React.ReactNode}) =>
    ReactActual.createElement(View, null, props.children);
  return {
    __esModule: true,
    default: Container,
    ScrollView: Container,
    SheetManager: {
      show: jest.fn(() => Promise.resolve()),
      hide: jest.fn(() => Promise.resolve()),
      hideAll: jest.fn(),
    },
  };
});
jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
  MaterialCommunityIcons: () => null,
}));
jest.mock('@/components/Icons', () => {
  const Icon = () => null;
  return {
    PlayIcon: Icon,
    RepeatIcon: Icon,
    StackedVolumesIcon: Icon,
    PageQuillIcon: Icon,
    MirrorWavesIcon: Icon,
    HighlightIcon: Icon,
    ChainLinksIcon: Icon,
    GroupedLinesIcon: Icon,
    BreakdownIcon: Icon,
    CopyIcon: Icon,
    ShareIcon: Icon,
  };
});
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      isDarkMode: false,
      colors: {
        text: '#111111',
        textSecondary: '#666666',
        background: '#ffffff',
        card: '#ffffff',
      },
    },
    isDarkMode: false,
  }),
}));
jest.mock('@/utils/haptics', () => ({lightHaptics: jest.fn()}));
jest.mock('@/utils/toastUtils', () => ({showToast: jest.fn()}));
jest.mock('expo-clipboard', () => ({setStringAsync: jest.fn()}));
jest.mock('expo-router', () => ({router: {push: jest.fn()}}));
jest.mock('@/utils/translationLookup', () => ({
  getTranslationTextRaw: (verseKey: string) => `T(${verseKey})`,
}));
jest.mock('@/utils/timestampUtils', () => ({getPlayFromHereTarget: jest.fn()}));

const mockNotes = new Map<string, Array<Record<string, unknown>>>();
jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    getNotesForVerse: jest.fn(async (key: string) => mockNotes.get(key) ?? []),
    deleteNoteById: jest.fn(async () => undefined),
    getNotesCountForVerse: jest.fn(async () => 0),
    getAnnotationsForSurah: jest.fn(async () => ({
      bookmarks: [],
      notes: [],
      highlights: [],
    })),
  },
}));
jest.mock('@/store/mushafPlayerStore', () => ({
  useMushafPlayerStore: {
    getState: () => ({rewayatId: 'r1'}),
    setState: jest.fn(),
  },
}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {
    getState: () => ({
      queue: {tracks: [], currentIndex: 0},
      playback: {state: 'paused'},
      pause: jest.fn(),
      setSheetMode: jest.fn(),
    }),
  },
}));
jest.mock('@/store/timestampStore', () => ({
  useTimestampStore: {
    getState: () => ({supportedRewayatIds: new Set(['r1'])}),
  },
  resolvePlayFromHere: jest.fn(() => ({
    status: 'unavailable',
    title: 'Not now',
    message: 'No timing',
  })),
}));
jest.mock('@/services/mushaf/QulDataService', () => ({
  qulDataService: {
    hasSimilarVerses: jest.fn(async () => false),
    hasSharedPhrases: jest.fn(async () => false),
  },
}));
jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  digitalKhattDataService: {
    rewayah: 'hafs',
    initialized: true,
    isRewayahReady: () => true,
    getRewayahLoadState: () => 'ready',
    getVerseText: (key: string) => `HAFS-${key}`,
    getPageForVerse: () => 3,
    subscribeCacheChanges: () => () => undefined,
    getCacheVersion: () => 0,
    retainRewayah: () => () => undefined,
    ensureRewayahLoaded: jest.fn(async () => undefined),
  },
  getRewayahDataIdentityKey: (r: string) => `${r}@test`,
}));
jest.mock('@/services/mushaf/RewayahVerseUnitsService', () => ({
  rewayahVerseUnitsService: jest
    .requireActual('@/services/mushaf/__fixtures__/verseUnitsServiceStub')
    .verseUnitsServiceStub({peek: () => null, status: () => 'error'}),
}));

import {VerseActionsSheet} from '../VerseActionsSheet';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';

declare const global: {IS_REACT_ACT_ENVIRONMENT?: boolean};
global.IS_REACT_ACT_ENVIRONMENT = true;

const service = verseAnnotationService as jest.Mocked<
  typeof verseAnnotationService
>;
const events = () =>
  mockCapture.mock.calls.map(([event, props]) => ({event, props}));
let renderer: TestRenderer.ReactTestRenderer | null = null;

async function openSheet() {
  const props = {
    sheetId: 'verse-actions',
    payload: {
      verseKey: '2:255',
      surahNumber: 2,
      ayahNumber: 255,
      source: 'mushaf' as const,
    },
  } as React.ComponentProps<typeof VerseActionsSheet>;
  await act(async () => {
    renderer = TestRenderer.create(<VerseActionsSheet {...props} />);
  });
  // The verse's notes load on the next microtasks.
  await act(async () => {
    await Promise.resolve();
  });
}

async function press(label: string) {
  const target = renderer!.root
    .findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        n.findAll(c => c.props.children === label).length > 0,
    )
    .pop();
  if (!target) throw new Error(`nothing to press for ${label}`);
  await act(async () => {
    await target.props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotes.clear();
  useMushafSettingsStore.setState({rewayah: 'hafs', mushafRenderer: 'dk_v2'});
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

describe('Remove Personal Note', () => {
  it('sends verse_note_deleted once for the deleted note, without its text', async () => {
    mockNotes.set('2:255', [
      {
        id: 'n1',
        verseKey: '2:255',
        surahNumber: 2,
        ayahNumber: 255,
        content: 'my private words about this ayah',
        rewayahId: 'hafs',
      },
    ]);
    await openSheet();
    await press('Remove Personal Note');

    expect(service.deleteNoteById).toHaveBeenCalledWith('n1');
    expect(events()).toEqual([
      {
        event: 'verse_note_deleted',
        props: {
          verse_key: '2:255',
          surah_id: 2,
          verse_count: 1,
          rewayah_id: 'hafs',
        },
      },
    ]);
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(
      'private words',
    );
  });

  it('sends nothing when the delete fails', async () => {
    mockNotes.set('2:255', [
      {
        id: 'n1',
        verseKey: '2:255',
        surahNumber: 2,
        ayahNumber: 255,
        content: 'x',
      },
    ]);
    service.deleteNoteById.mockRejectedValueOnce(new Error('disk full'));
    await openSheet();
    await expect(press('Remove Personal Note')).rejects.toThrow('disk full');
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
