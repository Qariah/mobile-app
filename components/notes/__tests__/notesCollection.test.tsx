// @ai-generated
// Qariah (2026-10-24 divergence batch C4): the Personal Notes / Reflections
// split of the Collection tab and the Notes screen, now hooks beside the
// inherited screens. `hooks/__tests__/notesScreenRender.qariah.test.tsx`
// renders the screen; this suite covers the hooks.
import {act, renderHook} from '@testing-library/react-native';
import type {VerseNote} from '@/types/verse-annotations';

let mockParams: {type?: string} = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/services/userState/postsRestore', () => ({
  syncQfPostsToLocal: jest.fn(),
}));
jest.mock('@/services/userState/notesSync', () => ({}));
jest.mock('@/services/userState/notes', () => ({}));
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));

import {syncQfPostsToLocal} from '@/services/userState/postsRestore';
import {useQariahNotesView} from '../useQariahNotesView';
import {useQariahNoteEntries} from '../useQariahNoteEntries';
import {backfillReflections} from '../qfNoteSync';

const sync = syncQfPostsToLocal as jest.Mock;
const personal = {id: 'p', qfPostId: null} as unknown as VerseNote;
const reflection = {id: 'r', qfPostId: 'post-1'} as unknown as VerseNote;
const pending = {id: 'q', qfPostId: 'pending:q'} as unknown as VerseNote;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

describe('useQariahNotesView', () => {
  it('no type: the Personal Notes view', () => {
    const {result} = renderHook(() => useQariahNotesView());
    const {notesView, filterNotes, backfillOnFocus} = result.current;
    expect(notesView.isReflectionView).toBe(false);
    expect(notesView.title).toBe('Personal Notes');
    expect(notesView.icon).toBe('file-text');
    expect(notesView.emptyTitle).toBe('No personal notes yet');
    expect(filterNotes([personal, reflection, pending])).toEqual([personal]);
    expect(backfillOnFocus(jest.fn())).toBeUndefined();
    expect(sync).not.toHaveBeenCalled();
  });

  it('type=reflection: the Reflections view, with the backfill', () => {
    mockParams = {type: 'reflection'};
    sync.mockReturnValue(new Promise(() => undefined));
    const {result} = renderHook(() => useQariahNotesView());
    const {notesView, filterNotes, backfillOnFocus} = result.current;
    expect(notesView.title).toBe('Reflections');
    expect(notesView.icon).toBe('users');
    expect(notesView.countLabel(2)).toBe('2 reflections');
    expect(notesView.emptyTitle).toBe('No reflections yet');
    expect(filterNotes([personal, reflection, pending])).toEqual([
      reflection,
      pending,
    ]);
    expect(typeof backfillOnFocus(jest.fn())).toBe('function');
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('an unknown type falls back to Personal Notes', () => {
    mockParams = {type: 'other'};
    const {result} = renderHook(() => useQariahNotesView());
    expect(result.current.notesView.isReflectionView).toBe(false);
  });
});

describe('backfillReflections', () => {
  it('reloads when the backfill matched or created rows', async () => {
    sync.mockResolvedValue({kind: 'ok', matched: 1, created: 0});
    const reload = jest.fn();
    backfillReflections(reload);
    await act(() => Promise.resolve());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when nothing changed, or after a blur', async () => {
    sync.mockResolvedValue({kind: 'ok', matched: 0, created: 0});
    const reload = jest.fn();
    backfillReflections(reload);
    await act(() => Promise.resolve());
    sync.mockResolvedValue({kind: 'ok', matched: 3, created: 1});
    const cleanup = backfillReflections(reload);
    cleanup();
    await act(() => Promise.resolve());
    expect(reload).not.toHaveBeenCalled();
  });

  it('a failed backfill does not throw', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    sync.mockRejectedValue(new Error('offline'));
    const reload = jest.fn();
    backfillReflections(reload);
    await act(() => Promise.resolve());
    expect(reload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('useQariahNoteEntries', () => {
  it('counts Personal Notes and Reflections apart, in two cards', () => {
    const {result} = renderHook(() => useQariahNoteEntries());
    act(() => result.current.countNotes([personal, reflection, pending]));
    const [personalCard, reflectionCard] = result.current.noteEntries;
    expect(personalCard).toMatchObject({
      id: 'personal-notes',
      label: 'Personal Notes',
      count: 1,
      route: '/collection/notes?type=personal',
    });
    expect(reflectionCard).toMatchObject({
      id: 'reflections',
      label: 'Reflections',
      count: 2,
      route: '/collection/notes?type=reflection',
    });
  });
});
