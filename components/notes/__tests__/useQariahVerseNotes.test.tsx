// @ai-generated
// Qariah (2026-10-24 divergence batch C4): the Personal Notes and Reflections
// of the verse actions sheet, now a hook beside the inherited sheet. The
// sheet suites (`VerseActionsSheet.noteDelete.analytics.test.tsx`) cover the
// rows in the sheet; this suite covers each flow of the hook.
import {Alert} from 'react-native';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import type {VerseNote} from '@/types/verse-annotations';
import type {ReadyVerseSelection} from '@/components/share/rewayahVerseSelection';

let mockAuthStatus: 'authenticated' | 'unauthenticated' | 'loading' =
  'unauthenticated';
jest.mock('@/services/auth/AuthContext', () => ({
  useAuthStatus: () => mockAuthStatus,
}));
const mockNotes = new Map<string, VerseNote[]>();
const mockCounts = new Map<string, number>();
const mockCalls: string[] = [];
jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    getNotesForVerse: jest.fn(async (key: string) => mockNotes.get(key) ?? []),
    deleteNoteById: jest.fn(async (id: string) => {
      mockCalls.push(`delete ${id}`);
    }),
    getNotesCountForVerse: jest.fn(
      async (key: string) => mockCounts.get(key) ?? 0,
    ),
  },
}));
jest.mock('@/services/userState/notesSync', () => ({
  syncDeleteToQf: jest.fn(async (n: {id: string}) => {
    mockCalls.push(`qf ${n.id}`);
  }),
}));
jest.mock('@/services/analytics/verseAnnotationEvents', () => ({
  trackVerseNoteDeleted: jest.fn(),
  versesOfSaved: (n: {verseKey: string}) => ({keys: [n.verseKey]}),
}));
const mockRemoveNote = jest.fn();
jest.mock('@/store/verseAnnotationsStore', () => ({
  useVerseAnnotationsStore: {getState: () => ({removeNote: mockRemoveNote})},
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {
    show: jest.fn(),
    hide: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('expo-router', () => ({router: {push: jest.fn()}}));
jest.mock('@/utils/haptics', () => ({lightHaptics: jest.fn()}));

import {SheetManager} from 'react-native-actions-sheet';
import {router} from 'expo-router';
import {trackVerseNoteDeleted} from '@/services/analytics/verseAnnotationEvents';
import {useQariahVerseNotes} from '../useQariahVerseNotes';

function note(id: string, extra: Partial<VerseNote> = {}): VerseNote {
  return {
    id,
    verseKey: '2:255',
    surahNumber: 2,
    ayahNumber: 255,
    content: `text ${id}`,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  } as VerseNote;
}

function selectionAt(anchor: string): ReadyVerseSelection {
  return {anchors: [{key: anchor}]} as unknown as ReadyVerseSelection;
}

const openEditor = jest.fn();

function renderNotes(
  options: Partial<Parameters<typeof useQariahVerseNotes>[0]> = {},
) {
  return renderHook(() =>
    useQariahVerseNotes({
      sheetId: 'verse-actions',
      verseKey: '2:255',
      isRange: false,
      selection: null,
      openEditor,
      ...options,
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotes.clear();
  mockCounts.clear();
  mockCalls.length = 0;
  mockAuthStatus = 'unauthenticated';
});

describe('the lookup at sheet open', () => {
  it('splits the verse notes into a Personal Note and a Reflection', async () => {
    mockNotes.set('2:255', [note('p1'), note('r1', {qfPostId: 'post-1'})]);
    const {result} = renderNotes();
    await waitFor(() => expect(result.current.hasReflection).toBe(true));
    expect(result.current.hasPersonalNote).toBe(true);
    expect(result.current.personalNoteLabel).toBe('Edit Personal Note');
  });

  it('reads the anchor and the Hafs key, once per note', async () => {
    mockNotes.set('2:255:3', [note('a1', {verseKey: '2:255:3'})]);
    mockNotes.set('2:255', [note('a1'), note('h1', {qfPostId: 'p'})]);
    const {result} = renderNotes({selection: selectionAt('2:255:3')});
    await waitFor(() => expect(result.current.hasReflection).toBe(true));
    expect(result.current.hasPersonalNote).toBe(true);
  });

  it('a range reads nothing and offers Add', async () => {
    const {result} = renderNotes({isRange: true});
    await act(() => Promise.resolve());
    expect(
      jest.requireMock('@/services/verse-annotations/VerseAnnotationService')
        .verseAnnotationService.getNotesForVerse,
    ).not.toHaveBeenCalled();
    expect(result.current.personalNoteLabel).toBe('Add Personal Note');
  });
});

describe('Add / Edit Personal Note', () => {
  it('opens the editor as a Personal Note when the verse has none', async () => {
    const {result} = renderNotes();
    await act(() => result.current.onPersonalNote());
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(result.current.editorPublish).toBe(false);
    expect(result.current.screenTitle('note')).toBe('Add Personal Note');
    expect(result.current.screenTitle('share')).toBeUndefined();
  });

  it('opens a saved note in the note sheet, named by its own keys', async () => {
    mockNotes.set('2:255', [
      note('p1', {verseKeys: ['2:255', '2:256'], rewayahId: undefined}),
    ]);
    const {result} = renderNotes();
    await act(() => result.current.onPersonalNote());
    expect(openEditor).not.toHaveBeenCalled();
    expect(SheetManager.hide).toHaveBeenCalledWith('verse-actions');
    expect(SheetManager.show).toHaveBeenCalledWith('verse-note', {
      payload: {
        verseKey: '2:255',
        surahNumber: 2,
        ayahNumber: 255,
        verseKeys: ['2:255', '2:256'],
        noteId: 'p1',
        rewayah: 'hafs',
      },
    });
  });
});

describe('Publish / Edit Reflection', () => {
  it('signed out: closes the sheet and asks for a sign-in', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const {result} = renderNotes();
    await act(() => result.current.onReflection());
    expect(SheetManager.hide).toHaveBeenCalledWith('verse-actions');
    expect(openEditor).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] ?? [];
    expect(buttons.map(b => b.text)).toEqual(['Cancel', 'Sign in']);
    buttons[1].onPress?.();
    expect(router.push).toHaveBeenCalledWith('/(d.settings)/sign-in');
    alert.mockRestore();
  });

  it('while the sign-in state loads: does nothing', async () => {
    mockAuthStatus = 'loading';
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const {result} = renderNotes();
    await act(() => result.current.onReflection());
    expect(alert).not.toHaveBeenCalled();
    expect(openEditor).not.toHaveBeenCalled();
    expect(SheetManager.hide).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('signed in: opens the editor as a Reflection', async () => {
    mockAuthStatus = 'authenticated';
    const {result} = renderNotes();
    await act(() => result.current.onReflection());
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(result.current.editorPublish).toBe(true);
    expect(result.current.screenTitle('note')).toBe('Publish Reflection');
  });

  it('signed in: opens a saved Reflection in the note sheet', async () => {
    mockAuthStatus = 'authenticated';
    mockNotes.set('2:255', [note('p1'), note('r1', {qfPostId: 'post-1'})]);
    const {result} = renderNotes();
    await act(() => result.current.onReflection());
    expect(openEditor).not.toHaveBeenCalled();
    expect(SheetManager.show).toHaveBeenCalledWith(
      'verse-note',
      expect.objectContaining({
        payload: expect.objectContaining({noteId: 'r1'}),
      }),
    );
  });
});

describe('Remove Personal Note / Remove Reflection', () => {
  it('removes only the Reflections: QF first, then the row, then the event', async () => {
    mockNotes.set('2:255', [note('p1'), note('r1', {qfPostId: 'post-1'})]);
    mockCounts.set('2:255', 1);
    const {result} = renderNotes();
    await act(() => result.current.onRemoveReflection());
    expect(mockCalls).toEqual(['qf r1', 'delete r1']);
    expect(trackVerseNoteDeleted).toHaveBeenCalledTimes(1);
    // A Personal Note stays at the key, so the store keeps its mark.
    expect(mockRemoveNote).not.toHaveBeenCalled();
    expect(SheetManager.hide).toHaveBeenCalledWith('verse-actions');
  });

  it('removes the Personal Notes and clears the mark of an empty key', async () => {
    mockNotes.set('2:255', [note('p1')]);
    const {result} = renderNotes();
    await act(() => result.current.onRemovePersonalNote());
    expect(mockCalls).toEqual(['qf p1', 'delete p1']);
    expect(mockRemoveNote).toHaveBeenCalledWith('2:255');
  });

  it('a failed delete sends no event and keeps the sheet open', async () => {
    mockNotes.set('2:255', [note('p1')]);
    jest
      .requireMock('@/services/verse-annotations/VerseAnnotationService')
      .verseAnnotationService.deleteNoteById.mockRejectedValueOnce(
        new Error('disk full'),
      );
    const {result} = renderNotes();
    await expect(
      act(() => result.current.onRemovePersonalNote()),
    ).rejects.toThrow('disk full');
    expect(trackVerseNoteDeleted).not.toHaveBeenCalled();
    expect(SheetManager.hide).not.toHaveBeenCalled();
  });
});
