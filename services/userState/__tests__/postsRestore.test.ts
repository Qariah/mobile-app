// @ai
// TECH_DEBT #244 (H3 + M4) — the posts pull.
//
// - It waits for the account check (M4), so a different account's data is
//   gone before this account's posts arrive.
// - It first deletes again the old posts whose delete failed (H3), and it
//   never brings a queued post back as a reflection.
// The account check, the QF SDK, the notes DB and the pending-delete helpers
// are mocks.

const mockEnsureAccountVerified = jest.fn();

jest.mock('../accountCleanup', () => ({
  ensureAccountVerified: () => mockEnsureAccountVerified(),
}));

const mockRetryPendingPostDeletes = jest.fn((_hash: string) =>
  Promise.resolve(),
);
let mockPendingIds: string[] = [];

jest.mock('../notesSync', () => ({
  retryPendingPostDeletes: (hash: string) => mockRetryPendingPostDeletes(hash),
  getPendingPostDeleteIds: () => Promise.resolve([...mockPendingIds]),
  hafsVerseOfAnchor: (anchor: string) =>
    anchor.split(':').slice(0, 2).join(':'),
}));

const mockMyPosts = jest.fn();

jest.mock('@/services/auth/sdkClient', () => ({
  getQfSdk: () => ({
    quranReflect: {
      v1: {raw: {postsControllerGetLoggedinUserPosts: mockMyPosts}},
    },
  }),
}));

jest.mock('@/services/auth/qfOAuth', () => ({
  isSignedIn: () => Promise.resolve(true),
  refreshAfterUnauthorized: jest.fn(),
}));

const mockAddNote = jest.fn(async (verseKey: string) => ({
  id: `local-${verseKey}`,
  verseKey,
}));

const mockGetAllNotes = jest.fn(async (): Promise<unknown[]> => []);
const mockPatchNoteQfIds = jest.fn(async (..._args: unknown[]) => undefined);

jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    getAllNotes: () => mockGetAllNotes(),
    addNote: (verseKey: string) => mockAddNote(verseKey),
    patchNoteQfIds: (...args: unknown[]) => mockPatchNoteQfIds(...args),
  },
}));

import {syncQfPostsToLocal} from '../postsRestore';

function post(id: string, verse: number) {
  return {id, body: `body ${id}`, references: [{chapterId: 2, from: verse}]};
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPendingIds = [];
  mockEnsureAccountVerified.mockResolvedValue({
    kind: 'ok',
    accountHash: 'hash-a',
    change: 'same',
  });
  mockMyPosts.mockResolvedValue({
    data: [post('post-42', 255), post('post-7', 1)],
    pages: 1,
  });
});

describe('posts pull', () => {
  it('retries the pending deletes before it reads the posts', async () => {
    await syncQfPostsToLocal();

    expect(mockRetryPendingPostDeletes).toHaveBeenCalledWith('hash-a');
    expect(
      mockRetryPendingPostDeletes.mock.invocationCallOrder[0],
    ).toBeLessThan(mockMyPosts.mock.invocationCallOrder[0]);
  });

  it('does not bring a queued post back as a reflection', async () => {
    mockPendingIds = ['post-42'];

    const result = await syncQfPostsToLocal();

    expect(result).toEqual({
      kind: 'ok',
      matched: 0,
      created: 1,
      alreadyLinked: 0,
    });
    expect(mockAddNote).toHaveBeenCalledTimes(1);
    expect(mockAddNote).toHaveBeenCalledWith('2:1');
  });

  it('links a post to a local note on a split-verse anchor', async () => {
    // A note on part of a split Hafs verse is stored at a word anchor
    // ("S:A:W"); the QF post names the whole verse ("S:A").
    mockGetAllNotes.mockResolvedValue([
      {id: 'note-split', verseKey: '2:255:4', content: 'body post-42'},
    ]);

    const result = await syncQfPostsToLocal();

    expect(mockPatchNoteQfIds).toHaveBeenCalledWith('note-split', {
      qfPostId: 'post-42',
    });
    expect(result).toMatchObject({kind: 'ok', matched: 1, created: 1});
    expect(mockAddNote).not.toHaveBeenCalledWith('2:255');
  });

  it('pulls nothing while the account check fails', async () => {
    mockEnsureAccountVerified.mockResolvedValue({
      kind: 'error',
      stage: 'userinfo',
      detail: 'network',
    });

    const result = await syncQfPostsToLocal();

    expect(result).toMatchObject({kind: 'error'});
    expect(mockMyPosts).not.toHaveBeenCalled();
  });
});
