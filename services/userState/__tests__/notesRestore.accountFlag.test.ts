// @ai
// TECH_DEBT #244 (M4) — the notes-restore flag is per account.
//
// Before M4 the flag was device-wide, so a second account on the device never
// got its notes restore. The account check, the QF notes list and the notes DB
// are mocks; AsyncStorage is the package's jest mock.

import AsyncStorage from '@react-native-async-storage/async-storage';

const mockEnsureAccountVerified = jest.fn();

jest.mock('../accountCleanup', () => ({
  ensureAccountVerified: () => mockEnsureAccountVerified(),
}));

const mockListNotes = jest.fn();
let mockListComplete = true;

jest.mock('../notes', () => ({
  listAllNotes: async () => ({
    notes: await mockListNotes(),
    complete: mockListComplete,
  }),
}));

jest.mock('@/services/auth/qfOAuth', () => ({
  isSignedIn: () => Promise.resolve(true),
}));

let mockNextId = 0;

jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    getNoteByQfNoteId: jest.fn(async () => null),
    addNote: jest.fn(async (verseKey: string) => {
      mockNextId += 1;
      return {id: `local-${mockNextId}`, verseKey};
    }),
    patchNoteQfIds: jest.fn(async () => undefined),
  },
}));

import {getLastNotesRestoreCount, restoreQfNotesOnce} from '../notesRestore';

const FLAG = '@qariah:notesRestoredAt';

async function asAccount(hash: string): Promise<void> {
  mockEnsureAccountVerified.mockResolvedValue({
    kind: 'ok',
    accountHash: hash,
    change: 'same',
  });
  // getLastNotesRestoreCount() reads the stored account.
  await AsyncStorage.setItem('@qariah:qfAccountHash', hash);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockNextId = 0;
  mockListComplete = true;
  await AsyncStorage.clear();
  mockListNotes.mockResolvedValue([
    {id: 'qf-1', body: 'one', ranges: ['2:255-2:255']},
    {id: 'qf-2', body: 'two', ranges: ['3:7-3:7']},
  ]);
});

describe('M4 — per-account notes-restore flag', () => {
  it('writes the flag under the account hash', async () => {
    await asAccount('hash-a');

    const result = await restoreQfNotesOnce();

    expect(result).toEqual({kind: 'restored', count: 2});
    expect(await AsyncStorage.getItem(`${FLAG}:hash-a`)).not.toBeNull();
    expect(await AsyncStorage.getItem(FLAG)).toBeNull();
    expect(await getLastNotesRestoreCount()).toBe(2);
  });

  it('runs the restore again for a second account', async () => {
    await asAccount('hash-a');
    await restoreQfNotesOnce();

    await asAccount('hash-b');
    const result = await restoreQfNotesOnce();

    expect(result).toEqual({kind: 'restored', count: 2});
    expect(mockListNotes).toHaveBeenCalledTimes(2);
  });

  it('does not run again for the same account', async () => {
    await asAccount('hash-a');
    await restoreQfNotesOnce();

    const again = await restoreQfNotesOnce();

    expect(again).toEqual({kind: 'already-done', count: 2});
    expect(mockListNotes).toHaveBeenCalledTimes(1);
  });

  it('does not restore while the account check fails', async () => {
    mockEnsureAccountVerified.mockResolvedValue({
      kind: 'error',
      stage: 'userinfo',
      detail: 'network',
    });

    const result = await restoreQfNotesOnce();

    expect(result).toMatchObject({kind: 'error'});
    expect(mockListNotes).not.toHaveBeenCalled();
  });
});

// @ai A listing that QF says is incomplete (hasNextPage with no cursor, or
// the page cap) must not set the done flag, or the rest is never restored.
describe('a truncated QF notes listing', () => {
  it('merges what it read and leaves the flag unset', async () => {
    await asAccount('hash-a');
    mockListComplete = false;

    const result = await restoreQfNotesOnce();

    expect(result).toEqual({kind: 'restored', count: 2, incomplete: true});
    expect(await AsyncStorage.getItem(`${FLAG}:hash-a`)).toBeNull();

    // The next run lists again (and the dedupe skips the merged notes).
    mockListComplete = true;
    await restoreQfNotesOnce();
    expect(mockListNotes).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem(`${FLAG}:hash-a`)).not.toBeNull();
  });

  it('does not record an empty truncated listing as empty', async () => {
    await asAccount('hash-a');
    mockListComplete = false;
    mockListNotes.mockResolvedValue([]);

    const result = await restoreQfNotesOnce();

    expect(result).toEqual({kind: 'restored', count: 0, incomplete: true});
    expect(await AsyncStorage.getItem(`${FLAG}:hash-a`)).toBeNull();
  });
});
