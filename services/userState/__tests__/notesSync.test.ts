// @ai
// TECH_DEBT #244 (H3) — delete and edit of a reflection from the posts pull.
//
// A row from the posts pull has a real `qfPostId` but no `qfNoteId` (the QF
// post has no link back to its note). Before H3, a delete returned early on
// the null `qfNoteId`, so the public post stayed on QF and came back on the
// next pull. An edit pushed the row as a new note and post, so QF showed two
// public posts. The Stage-2 review reordered the edit: the new post comes
// first, and the old post is deleted only after it exists. A failed delete
// goes to a pending-delete list that the posts pull retries. The QF calls,
// the local DB and Sentry are mocks; AsyncStorage is the package's jest mock.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {VerseNote} from '@/types/verse-annotations';
import {QfApiError} from '../qfErrors';

const mockCalls: string[] = [];

const mockPatchNoteQfIds = jest.fn(
  (id: string, ids: {qfNoteId?: string | null; qfPostId?: string | null}) => {
    mockCalls.push(`patch ${id} ${JSON.stringify(ids)}`);
    return Promise.resolve();
  },
);

jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    patchNoteQfIds: (
      id: string,
      ids: {qfNoteId?: string | null; qfPostId?: string | null},
    ) => mockPatchNoteQfIds(id, ids),
  },
}));

const mockUnpublishNote = jest.fn((postId: string) => {
  mockCalls.push(`unpublish ${postId}`);
  return Promise.resolve();
});
const mockDeleteNote = jest.fn((noteId: string) => {
  mockCalls.push(`deleteNote ${noteId}`);
  return Promise.resolve();
});
const mockCreateNote = jest.fn((input: {body: string}) => {
  mockCalls.push(`createNote ${input.body}`);
  return Promise.resolve({id: 'new-note', body: input.body, ranges: []});
});
const mockPublishNote = jest.fn((noteId: string) => {
  mockCalls.push(`publish ${noteId}`);
  return Promise.resolve('new-post');
});

jest.mock('../notes', () => ({
  verseKeyToRange: (k: string) => `${k}-${k}`,
  verseKeysToRange: (keys: string[]) => `${keys[0]}-${keys[keys.length - 1]}`,
  unpublishNote: (postId: string) => mockUnpublishNote(postId),
  deleteNote: (noteId: string) => mockDeleteNote(noteId),
  createNote: (input: {body: string}) => mockCreateNote(input),
  publishNote: (noteId: string) => mockPublishNote(noteId),
}));

jest.mock('@/services/auth/qfOAuth', () => ({
  isSignedIn: () => Promise.resolve(true),
}));

const mockCaptureException = jest.fn();

jest.mock('@sentry/react-native', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import {
  getPendingPostDeleteIds,
  pushEditOfUnlinkedNoteToQf,
  retryPendingPostDeletes,
  syncDeleteToQf,
} from '../notesSync';

function note(overrides: Partial<VerseNote>): VerseNote {
  return {
    id: 'local-1',
    verseKey: '2:255',
    surahNumber: 2,
    ayahNumber: 255,
    content: 'Original reflection',
    createdAt: 1,
    updatedAt: 1,
    qfNoteId: null,
    qfPostId: null,
    ...overrides,
  };
}

const pulledReflection = note({qfPostId: 'post-42'});

beforeEach(async () => {
  mockCalls.length = 0;
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem('@qariah:qfAccountHash', 'hash-a');
});

/** A network error as withQfCall reports it (retryable). */
function networkError(): QfApiError {
  return new QfApiError('QF /v1/posts failed: network', 0, '/v1/posts');
}

describe('H3 — delete of a pulled reflection', () => {
  it('deletes the public post by the id from the pull', async () => {
    await syncDeleteToQf(pulledReflection);

    expect(mockCalls).toEqual(['unpublish post-42']);
  });

  it('still deletes a synced note through its QF note id', async () => {
    await syncDeleteToQf(note({qfNoteId: 'note-7', qfPostId: 'post-7'}));

    expect(mockCalls).toEqual(['deleteNote note-7']);
  });

  it('sends nothing for a pending placeholder or a local-only note', async () => {
    await syncDeleteToQf(note({qfPostId: 'pending:local-1'}));
    await syncDeleteToQf(note({}));

    expect(mockCalls).toEqual([]);
  });
});

describe('H3 — delete of a pulled reflection that fails', () => {
  it('queues the post for a later delete', async () => {
    mockUnpublishNote.mockRejectedValueOnce(networkError());

    await syncDeleteToQf(pulledReflection);

    expect(await getPendingPostDeleteIds()).toEqual(['post-42']);
  });
});

describe('H3 — edit of a pulled reflection', () => {
  it('makes the new post first, then deletes the old post', async () => {
    const edited = {...pulledReflection, content: 'Edited reflection'};

    await pushEditOfUnlinkedNoteToQf(pulledReflection, edited, {
      publish: true,
    });

    expect(mockCalls).toEqual([
      'createNote Edited reflection',
      'publish new-note',
      'patch local-1 {"qfNoteId":"new-note","qfPostId":"new-post"}',
      'unpublish post-42',
    ]);
    expect(await getPendingPostDeleteIds()).toEqual([]);
  });

  it('leaves the old post public and linked when the create fails', async () => {
    mockCreateNote.mockRejectedValueOnce(networkError());
    const edited = {...pulledReflection, content: 'Edited reflection'};

    await expect(
      pushEditOfUnlinkedNoteToQf(pulledReflection, edited, {publish: true}),
    ).rejects.toThrow('network');

    expect(mockUnpublishNote).not.toHaveBeenCalled();
    expect(mockPatchNoteQfIds).not.toHaveBeenCalled();
  });

  it('removes the new note and keeps the old post when the publish fails', async () => {
    mockPublishNote.mockRejectedValueOnce(networkError());
    const edited = {...pulledReflection, content: 'Edited reflection'};

    await expect(
      pushEditOfUnlinkedNoteToQf(pulledReflection, edited, {publish: true}),
    ).rejects.toThrow('network');

    expect(mockDeleteNote).toHaveBeenCalledWith('new-note');
    expect(mockUnpublishNote).not.toHaveBeenCalled();
    expect(mockPatchNoteQfIds).not.toHaveBeenCalled();
  });

  it('keeps the new post and queues the old one when its delete fails', async () => {
    mockUnpublishNote.mockRejectedValueOnce(networkError());
    const edited = {...pulledReflection, content: 'Edited reflection'};

    await pushEditOfUnlinkedNoteToQf(pulledReflection, edited, {
      publish: true,
    });

    expect(mockPatchNoteQfIds).toHaveBeenLastCalledWith('local-1', {
      qfNoteId: 'new-note',
      qfPostId: 'new-post',
    });
    expect(await getPendingPostDeleteIds()).toEqual(['post-42']);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the text and the publish state did not change', async () => {
    const edited = {...pulledReflection, content: '  Original reflection '};

    await pushEditOfUnlinkedNoteToQf(pulledReflection, edited, {
      publish: true,
    });

    expect(mockCalls).toEqual([]);
  });

  it('unpublishes: deletes the post and keeps a private QF note', async () => {
    await pushEditOfUnlinkedNoteToQf(pulledReflection, pulledReflection, {
      publish: false,
    });

    expect(mockCalls[0]).toBe('unpublish post-42');
    expect(mockCreateNote).toHaveBeenCalledTimes(1);
    expect(mockPublishNote).not.toHaveBeenCalled();
    expect(mockPatchNoteQfIds).toHaveBeenLastCalledWith('local-1', {
      qfNoteId: 'new-note',
      qfPostId: null,
    });
  });

  it('changes nothing when the unpublish delete fails', async () => {
    mockUnpublishNote.mockRejectedValueOnce(networkError());

    await expect(
      pushEditOfUnlinkedNoteToQf(pulledReflection, pulledReflection, {
        publish: false,
      }),
    ).rejects.toThrow('network');

    expect(mockCreateNote).not.toHaveBeenCalled();
    expect(mockPatchNoteQfIds).not.toHaveBeenCalled();
  });

  it('still pushes a note made before sign-in, as before', async () => {
    const local = note({content: 'Made offline'});

    await pushEditOfUnlinkedNoteToQf(local, local, {publish: false});

    expect(mockUnpublishNote).not.toHaveBeenCalled();
    expect(mockCalls).toContain('createNote Made offline');
  });
});

describe('H3 — retry of the pending post deletes', () => {
  async function queue(postId: string, accountHash: string | null) {
    const raw = await AsyncStorage.getItem('@qariah:qfPostDeletesPending');
    const entries = raw ? JSON.parse(raw) : [];
    entries.push({postId, accountHash, queuedAt: 1});
    await AsyncStorage.setItem(
      '@qariah:qfPostDeletesPending',
      JSON.stringify(entries),
    );
  }

  it('deletes the queued posts of the account and empties the list', async () => {
    await queue('post-1', 'hash-a');

    await retryPendingPostDeletes('hash-a');

    expect(mockCalls).toEqual(['unpublish post-1']);
    expect(await getPendingPostDeleteIds()).toEqual([]);
  });

  it('keeps a post after a retryable error, drops it after a 404', async () => {
    await queue('post-1', 'hash-a');
    await queue('post-2', 'hash-a');
    mockUnpublishNote
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(
        new QfApiError('QF /v1/posts failed: 404', 404, '/v1/posts'),
      );

    await retryPendingPostDeletes('hash-a');

    expect(await getPendingPostDeleteIds()).toEqual(['post-1']);
  });

  it('never tries a post of another account', async () => {
    await queue('post-b', 'hash-b');

    await retryPendingPostDeletes('hash-a');

    expect(mockUnpublishNote).not.toHaveBeenCalled();
    expect(await getPendingPostDeleteIds()).toEqual(['post-b']);
  });
});
