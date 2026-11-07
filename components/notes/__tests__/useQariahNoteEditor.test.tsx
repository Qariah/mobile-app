// @ai-generated
// Qariah (2026-10-24 divergence batch C4): the QF side of the two note
// editors (`NoteContent`, `VerseNoteSheet`), now a hook beside them. The
// editor suites cover the screens; this suite covers the Reflection state,
// the saving guard, the QF calls and the labels.
import {act, renderHook} from '@testing-library/react-native';
import type {VerseNote} from '@/types/verse-annotations';

let mockAuthStatus: 'authenticated' | 'unauthenticated' | 'loading' =
  'authenticated';
jest.mock('@/services/auth/AuthContext', () => ({
  useAuthStatus: () => mockAuthStatus,
}));
jest.mock('@/services/userState/notesSync', () => ({
  pushLocalNoteToQf: jest.fn(async () => ({qfNoteId: null, qfPostId: null})),
  setNotePublishState: jest.fn(async () => null),
  pushEditOfUnlinkedNoteToQf: jest.fn(async () => undefined),
  syncDeleteToQf: jest.fn(async () => undefined),
}));
jest.mock('@/services/userState/notes', () => ({
  updateNote: jest.fn(async () => ({})),
}));
jest.mock('@/services/userState/postsRestore', () => ({
  syncQfPostsToLocal: jest.fn(),
}));
const mockStored = new Map<string, VerseNote>();
jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    getNoteById: jest.fn(async (id: string) => mockStored.get(id) ?? null),
  },
}));
jest.mock('@/services/analytics/verseAnnotationEvents', () => ({
  trackVerseNoteCreated: jest.fn(),
  trackVerseNoteDeleted: jest.fn(),
  versesOfSaved: (n: {verseKey: string; verseKeys?: string[]}) => ({
    keys: n.verseKeys ?? [n.verseKey],
  }),
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {hideAll: jest.fn()},
}));

import {SheetManager} from 'react-native-actions-sheet';
import {
  pushEditOfUnlinkedNoteToQf,
  pushLocalNoteToQf,
  setNotePublishState,
  syncDeleteToQf,
} from '@/services/userState/notesSync';
import * as qfNotes from '@/services/userState/notes';
import {
  trackVerseNoteCreated,
  trackVerseNoteDeleted,
} from '@/services/analytics/verseAnnotationEvents';
import {useQariahNoteEditor} from '../useQariahNoteEditor';

function note(id: string, extra: Partial<VerseNote> = {}): VerseNote {
  return {
    id,
    verseKey: '2:255',
    surahNumber: 2,
    ayahNumber: 255,
    content: 'old text',
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  } as VerseNote;
}

/** Lets the background QF calls run. */
const flush = () => act(() => Promise.resolve());

beforeEach(() => {
  jest.clearAllMocks();
  mockStored.clear();
  mockAuthStatus = 'authenticated';
});

describe('the note type and the labels', () => {
  it('a Personal Note keeps the upstream button', () => {
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'NoteContent', publish: false}),
    );
    expect(result.current.publishing).toBe(false);
    expect(result.current.saveIcon).toBe('save');
    expect(result.current.saveLabel(false)).toBeUndefined();
    expect(result.current.saveLabel(true)).toBeUndefined();
  });

  it('a Reflection, signed in, shows the publish button', () => {
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'NoteContent', publish: true}),
    );
    expect(result.current.publishing).toBe(true);
    expect(result.current.saveIcon).toBe('users');
    expect(result.current.saveLabel(false)).toBe('Publish Reflection');
    expect(result.current.saveLabel(true)).toBe('Update Reflection');
  });

  it('a Reflection, signed out, keeps the upstream button', () => {
    mockAuthStatus = 'unauthenticated';
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'NoteContent', publish: true}),
    );
    expect(result.current.publishing).toBe(false);
    expect(result.current.saveLabel(false)).toBeUndefined();
  });

  it('a saved note takes its type from its qfPostId', () => {
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    expect(result.current.publishing).toBe(false);
    act(() => result.current.onNoteLoaded(note('n1', {qfPostId: 'post-1'})));
    expect(result.current.publishing).toBe(true);
    act(() => result.current.onNoteLoaded(note('n2')));
    expect(result.current.publishing).toBe(false);
  });
});

describe('saveNew (NoteContent)', () => {
  it('reads "Saving…" while the local save runs, then pushes to QF', async () => {
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'NoteContent', publish: true}),
    );
    let finish!: (value: VerseNote) => void;
    let done!: Promise<void>;
    act(() => {
      done = result.current.saveNew(
        () => new Promise<VerseNote>(resolve => (finish = resolve)),
      );
    });
    expect(result.current.saving).toBe(true);
    expect(result.current.saveLabel(false)).toBe('Saving…');
    await act(async () => {
      finish(note('n1'));
      await done;
    });
    expect(result.current.saving).toBe(false);
    expect(pushLocalNoteToQf).toHaveBeenCalledWith(note('n1'), {
      publish: true,
    });
  });

  it('signed out: saves locally only', async () => {
    mockAuthStatus = 'unauthenticated';
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'NoteContent', publish: false}),
    );
    await act(() => result.current.saveNew(async () => note('n1')));
    expect(pushLocalNoteToQf).not.toHaveBeenCalled();
  });

  it('a failed save pushes nothing and ends the saving state', async () => {
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'NoteContent', publish: false}),
    );
    await expect(
      act(() =>
        result.current.saveNew(async () => {
          throw new Error('disk full');
        }),
      ),
    ).rejects.toThrow('disk full');
    expect(result.current.saving).toBe(false);
    expect(pushLocalNoteToQf).not.toHaveBeenCalled();
  });
});

describe('guardSave (VerseNoteSheet)', () => {
  it('ignores an empty note', async () => {
    const save = jest.fn(async () => undefined);
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    await act(() => result.current.guardSave('   ', save));
    expect(save).not.toHaveBeenCalled();
  });

  it('runs one save at a time', async () => {
    let finish!: () => void;
    const save = jest.fn(
      () => new Promise<void>(resolve => (finish = resolve)),
    );
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    let first!: Promise<void>;
    act(() => {
      first = result.current.guardSave('text', save);
    });
    await act(() => result.current.guardSave('text', save));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await first;
    });
    expect(result.current.saving).toBe(false);
    // A save that succeeds closes the sheets itself.
    expect(SheetManager.hideAll).not.toHaveBeenCalled();
  });

  it('closes all sheets when the save throws', async () => {
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    await expect(
      act(() =>
        result.current.guardSave('text', async () => {
          throw new Error('disk full');
        }),
      ),
    ).rejects.toThrow('disk full');
    expect(SheetManager.hideAll).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(false);
  });
});

describe('the QF calls around the local writes', () => {
  it('a new note sends verse_note_created when told, and pushes', () => {
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    const verses = {keys: ['2:255'], rewayahId: 'hafs'};
    act(() => result.current.onNoteCreated(note('n1'), verses));
    expect(trackVerseNoteCreated).toHaveBeenCalledWith(verses);
    expect(pushLocalNoteToQf).toHaveBeenCalledWith(note('n1'), {
      publish: false,
    });
    act(() => result.current.onNoteCreated(undefined));
    expect(trackVerseNoteCreated).toHaveBeenCalledTimes(1);
    expect(pushLocalNoteToQf).toHaveBeenCalledTimes(1);
  });

  it('an edit of a synced note updates the QF body, then the publish state', async () => {
    const loaded = note('n1', {qfNoteId: 'qf-1', qfPostId: 'post-1'});
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    act(() => result.current.onNoteLoaded(loaded));
    act(() => result.current.onNoteUpdated('n1', 'new text'));
    await flush();
    expect(qfNotes.updateNote).toHaveBeenCalledWith('qf-1', {
      body: 'new text',
    });
    expect(setNotePublishState).toHaveBeenCalledWith(
      {...loaded, content: 'new text'},
      true,
    );
  });

  it('an edit with the same text only sets the publish state', async () => {
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    act(() => result.current.onNoteLoaded(note('n1', {qfNoteId: 'qf-1'})));
    act(() => result.current.onNoteUpdated('n1', 'old text'));
    await flush();
    expect(qfNotes.updateNote).not.toHaveBeenCalled();
    expect(setNotePublishState).toHaveBeenCalledTimes(1);
  });

  it('an edit of an unlinked note pushes it with the stored row', async () => {
    const loaded = note('n1', {qfPostId: 'post-9'});
    const edited = note('n1', {qfPostId: 'post-9', content: 'new text'});
    mockStored.set('n1', edited);
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    act(() => result.current.onNoteLoaded(loaded));
    act(() => result.current.onNoteUpdated('n1', 'new text'));
    await flush();
    expect(pushEditOfUnlinkedNoteToQf).toHaveBeenCalledWith(loaded, edited, {
      publish: true,
    });
  });

  it('signed out, an edit stays local', async () => {
    mockAuthStatus = 'unauthenticated';
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    act(() => result.current.onNoteLoaded(note('n1', {qfNoteId: 'qf-1'})));
    act(() => result.current.onNoteUpdated('n1', 'new text'));
    await flush();
    expect(qfNotes.updateNote).not.toHaveBeenCalled();
    expect(setNotePublishState).not.toHaveBeenCalled();
  });

  it('a delete goes to QF first, then sends verse_note_deleted', async () => {
    const loaded = note('n1', {verseKeys: ['2:255', '2:256']});
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    act(() => result.current.onNoteLoaded(loaded));
    await act(() => result.current.beforeDelete());
    expect(syncDeleteToQf).toHaveBeenCalledWith(loaded);
    act(() => result.current.afterDelete('2:255'));
    expect(trackVerseNoteDeleted).toHaveBeenCalledWith({
      keys: ['2:255', '2:256'],
    });
  });

  it('a delete before the note loaded reports the payload verse', async () => {
    const {result} = renderHook(() =>
      useQariahNoteEditor({source: 'VerseNoteSheet'}),
    );
    await act(() => result.current.beforeDelete());
    expect(syncDeleteToQf).not.toHaveBeenCalled();
    act(() => result.current.afterDelete('3:7'));
    expect(trackVerseNoteDeleted).toHaveBeenCalledWith({keys: ['3:7']});
  });
});
