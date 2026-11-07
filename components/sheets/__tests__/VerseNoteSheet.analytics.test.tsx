// @ai Qariah (TECH_DEBT #297, Sprint 47) — the note sheet's events. A new note
// sends verse_note_created; an edit of a note sends nothing (an edit is not a
// create); a delete sends verse_note_deleted. No event holds the note text.
// The harness is the one of VerseNoteSheet.units.test.tsx.

import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';
import {TextInput} from 'react-native';

const mockCapture = jest.fn();
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    captureDiagnosticEvent: (...args: unknown[]) => mockCapture(...args),
  },
}));
jest.mock('@/components/share/SkiaVersePreview', () => ({
  __esModule: true,
  default: () => null,
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
    SheetManager: {hideAll: jest.fn()},
  };
});
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));
jest.mock('@/utils/toastUtils', () => ({showToast: jest.fn()}));
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
      fonts: {regular: 'Regular', medium: 'Medium', bold: 'Bold'},
    },
    isDarkMode: false,
  }),
}));
jest.mock('@/services/userState/notesSync', () => ({
  pushEditOfUnlinkedNoteToQf: jest.fn(async () => undefined),
  pushLocalNoteToQf: jest.fn(async () => undefined),
  setNotePublishState: jest.fn(async () => undefined),
  syncDeleteToQf: jest.fn(async () => undefined),
}));
const mockNotes = new Map<
  string,
  {content: string; rewayahId?: string; verseKeys?: string[]}
>();
jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    getNoteById: jest.fn(async (id: string) => mockNotes.get(id) ?? null),
    addNote: jest.fn(async () => undefined),
    updateNote: jest.fn(async () => undefined),
    deleteNoteById: jest.fn(async () => undefined),
    getNotesCountForVerse: jest.fn(async () => 0),
  },
}));
jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  digitalKhattDataService: {
    isRewayahReady: () => true,
    getRewayahLoadState: () => 'ready',
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
    .verseUnitsServiceStub({peek: () => null}),
}));

import {VerseNoteSheet} from '../VerseNoteSheet';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';

declare const global: {IS_REACT_ACT_ENVIRONMENT?: boolean};
global.IS_REACT_ACT_ENVIRONMENT = true;

type Payload = React.ComponentProps<typeof VerseNoteSheet>['payload'];
let renderer: TestRenderer.ReactTestRenderer | null = null;

const service = verseAnnotationService as jest.Mocked<
  typeof verseAnnotationService
>;
const events = () =>
  mockCapture.mock.calls.map(([event, props]) => ({event, props}));
const PRIVATE_TEXT = 'my private words about this ayah';

async function openSheet(payload: Payload) {
  const props = {
    sheetId: 'verse-note',
    payload,
  } as React.ComponentProps<typeof VerseNoteSheet>;
  await act(async () => {
    renderer = TestRenderer.create(<VerseNoteSheet {...props} />);
  });
  // The saved note loads on the next microtasks.
  await act(async () => {
    await Promise.resolve();
  });
}

function typeText(text: string) {
  const input = renderer!.root.find(n => (n.type as unknown) === TextInput);
  act(() => input.props.onChangeText(text));
}

async function press(label: string) {
  const button = renderer!.root
    .findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        n.findAll(c => c.props.children === label).length > 0,
    )
    .pop();
  if (!button) throw new Error(`no "${label}" button`);
  await act(async () => {
    await button.props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotes.clear();
  useMushafSettingsStore.setState({rewayah: 'hafs'});
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

describe('a new Hafs note', () => {
  it('sends verse_note_created once, and no event holds the text', async () => {
    await openSheet({
      verseKey: '2:255',
      surahNumber: 2,
      ayahNumber: 255,
      rewayah: 'hafs',
    });
    typeText(PRIVATE_TEXT);
    await press('Save Note');

    expect(service.addNote).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([
      {
        event: 'verse_note_created',
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

  it('a note on a range is one event for the first verse', async () => {
    await openSheet({
      verseKey: '3:1',
      surahNumber: 3,
      ayahNumber: 1,
      verseKeys: ['3:1', '3:2'],
      rewayah: 'hafs',
    });
    typeText(PRIVATE_TEXT);
    await press('Save Note');

    expect(events()).toHaveLength(1);
    expect(events()[0].props).toMatchObject({
      verse_key: '3:1',
      surah_id: 3,
      verse_count: 2,
    });
  });

  it('sends nothing when the note is not saved', async () => {
    service.addNote.mockRejectedValueOnce(new Error('disk full'));
    await openSheet({
      verseKey: '2:255',
      surahNumber: 2,
      ayahNumber: 255,
      rewayah: 'hafs',
    });
    typeText(PRIVATE_TEXT);
    await expect(press('Save Note')).rejects.toThrow('disk full');
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('a saved note', () => {
  it('an edit sends no event (it is not a create)', async () => {
    mockNotes.set('n1', {content: 'old words', rewayahId: 'hafs'});
    await openSheet({
      verseKey: '2:255',
      surahNumber: 2,
      ayahNumber: 255,
      noteId: 'n1',
    });
    typeText(PRIVATE_TEXT);
    await press('Update Note');

    expect(service.updateNote).toHaveBeenCalledTimes(1);
    expect(service.addNote).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('a delete sends verse_note_deleted once, for the verses of the note', async () => {
    mockNotes.set('n5', {
      content: PRIVATE_TEXT,
      rewayahId: 'warsh',
      verseKeys: ['1:7:1', '1:7:5'],
    });
    await openSheet({
      verseKey: '1:7:1',
      surahNumber: 1,
      ayahNumber: 7,
      noteId: 'n5',
    });
    await press('Delete Note');

    expect(service.deleteNoteById).toHaveBeenCalledWith('n5');
    expect(events()).toEqual([
      {
        event: 'verse_note_deleted',
        props: {
          verse_key: '1:7',
          surah_id: 1,
          verse_count: 2,
          rewayah_id: 'warsh',
        },
      },
    ]);
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(
      'private words',
    );
  });

  it('a delete that fails sends nothing', async () => {
    mockNotes.set('n1', {content: 'old words', rewayahId: 'hafs'});
    service.deleteNoteById.mockRejectedValueOnce(new Error('disk full'));
    await openSheet({
      verseKey: '2:255',
      surahNumber: 2,
      ayahNumber: 255,
      noteId: 'n1',
    });
    await expect(press('Delete Note')).rejects.toThrow('disk full');
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
