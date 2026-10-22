// @ai
// TECH_DEBT #244 (M4, redesigned after the Stage-2 review) — the account check.
//
// Sign-out deletes nothing. At sign-in, `ensureAccountVerified()` compares the
// new QF account with the stored one: the same account keeps everything; a
// different account removes the previous account's QF-linked notes, the sync
// queue and the QF caches; the first account on this build takes over the old
// device-wide restore flags. The notes DB, the sync DB, `/userinfo`, the hash
// and Sentry are mocks; AsyncStorage is the package's jest mock.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {VerseNote} from '@/types/verse-annotations';

let mockNotes: VerseNote[] = [];

jest.mock('@/services/verse-annotations/VerseAnnotationService', () => ({
  verseAnnotationService: {
    getAllNotes: jest.fn(async () => [...mockNotes]),
    deleteNoteById: jest.fn(async (id: string) => {
      mockNotes = mockNotes.filter(n => n.id !== id);
    }),
    getNotesCountForVerse: jest.fn(
      async (key: string) =>
        mockNotes.filter(
          n => n.verseKey === key || (n.verseKeys ?? []).includes(key),
        ).length,
    ),
  },
}));

const mockClearAccountSyncState = jest.fn(() => Promise.resolve());

jest.mock('../db', () => ({
  initUserStateDb: () => Promise.resolve(),
  clearAccountSyncState: () => mockClearAccountSyncState(),
}));

const mockFetchQfUserInfo = jest.fn();

jest.mock('../qfUserInfo', () => ({
  fetchQfUserInfo: () => mockFetchQfUserInfo(),
}));

// A readable stand-in for SHA-256: h(<input>).
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: {SHA256: 'SHA-256'},
  CryptoEncoding: {HEX: 'hex'},
  digestStringAsync: async (_algorithm: string, input: string) => `h(${input})`,
}));

const mockCaptureException = jest.fn();

jest.mock('@sentry/react-native', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

// notesSync.ts (for `isPendingPostId`) imports these; no test calls QF.
jest.mock('../notes', () => ({}));
jest.mock('@/services/auth/qfOAuth', () => ({isSignedIn: jest.fn()}));

import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';
import {
  _resetAccountCheckStateForTests,
  ensureAccountVerified,
  isAccountLinkedNote,
  markAccountCheckPending,
} from '../accountCleanup';

const HASH_A = 'h(qf-account:sub-a)';
const HASH_B = 'h(qf-account:sub-b)';
const ACCOUNT_KEY = '@qariah:qfAccountHash';
const PENDING_KEY = '@qariah:qfAccountCheckPending';
const NOTES_FLAG = '@qariah:notesRestoredAt';
const V1_FLAG = '@qariah:v1RestoreDone';

function note(id: string, overrides: Partial<VerseNote>): VerseNote {
  return {
    id,
    verseKey: '1:1',
    surahNumber: 1,
    ayahNumber: 1,
    content: id,
    createdAt: 1,
    updatedAt: 1,
    qfNoteId: null,
    qfPostId: null,
    ...overrides,
  };
}

function userInfo(sub: string) {
  return {email: `${sub}@example.invalid`, first_name: '', last_name: '', sub};
}

function signedInAs(sub: string): void {
  mockFetchQfUserInfo.mockResolvedValue(userInfo(sub));
}

/** Lets pending promises run until `done()` is true (or 50 turns pass). */
async function settleUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !done(); i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/** Account A owns the device; account A's data is in local storage. */
async function seedAccountA(): Promise<void> {
  await AsyncStorage.multiSet([
    [ACCOUNT_KEY, HASH_A],
    [`${NOTES_FLAG}:${HASH_A}`, JSON.stringify({at: 1, count: 3})],
    [`${V1_FLAG}:${HASH_A}`, '1'],
  ]);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockFetchQfUserInfo.mockReset();
  _resetAccountCheckStateForTests();
  await AsyncStorage.clear();
  mockNotes = [
    // Account A's QF-linked data: a private QF note, a pulled reflection,
    // and a QF range note.
    note('qf-private', {verseKey: '2:255', qfNoteId: 'note-1'}),
    note('pulled', {verseKey: '3:7', qfPostId: 'post-9'}),
    note('qf-range', {
      verseKey: '4:1',
      verseKeys: ['4:1', '4:2'],
      qfNoteId: 'note-2',
    }),
    // Device data: a local-only note on 2:255, and an unfinished publish.
    note('local', {verseKey: '2:255'}),
    note('pending', {verseKey: '5:5', qfPostId: 'pending:pending'}),
  ];
  useVerseAnnotationsStore.setState({
    notedVerseKeys: new Set(['2:255', '3:7', '4:1', '4:2', '5:5']),
  });
});

describe('M4 — the same account signs in again', () => {
  it('keeps every note, the queue and the restore flags', async () => {
    await seedAccountA();
    // Sign-out deletes nothing; the sign-in opens the check.
    await markAccountCheckPending();
    signedInAs('sub-a');

    const result = await ensureAccountVerified();

    expect(result).toEqual({kind: 'ok', accountHash: HASH_A, change: 'same'});
    expect(mockNotes).toHaveLength(5);
    expect(mockClearAccountSyncState).not.toHaveBeenCalled();
    expect(
      await AsyncStorage.getItem(`${NOTES_FLAG}:${HASH_A}`),
    ).not.toBeNull();
    expect(await AsyncStorage.getItem(`${V1_FLAG}:${HASH_A}`)).toBe('1');
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('needs no network when the check is not open', async () => {
    await seedAccountA();

    const result = await ensureAccountVerified();

    expect(result).toMatchObject({kind: 'ok', accountHash: HASH_A});
    expect(mockFetchQfUserInfo).not.toHaveBeenCalled();
  });
});

describe('M4 — a different account signs in', () => {
  it('removes the QF-linked notes and keeps the device notes', async () => {
    await seedAccountA();
    await markAccountCheckPending();
    signedInAs('sub-b');

    const result = await ensureAccountVerified();

    expect(result).toEqual({
      kind: 'ok',
      accountHash: HASH_B,
      change: 'switched',
    });
    expect(mockNotes.map(n => n.id).sort()).toEqual(['local', 'pending']);
    const keys = useVerseAnnotationsStore.getState().notedVerseKeys;
    expect([...keys].sort()).toEqual(['2:255', '5:5']);
  });

  it('clears the queue and the caches, and the old notes-restore flag', async () => {
    await seedAccountA();
    await markAccountCheckPending();
    signedInAs('sub-b');

    await ensureAccountVerified();

    expect(mockClearAccountSyncState).toHaveBeenCalledTimes(1);
    // A's notes left the device, so A's next sign-in must restore them.
    expect(await AsyncStorage.getItem(`${NOTES_FLAG}:${HASH_A}`)).toBeNull();
    // A's v1 data went into the player stores, which stay.
    expect(await AsyncStorage.getItem(`${V1_FLAG}:${HASH_A}`)).toBe('1');
    expect(await AsyncStorage.getItem(ACCOUNT_KEY)).toBe(HASH_B);
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('also cleans up after an expired session (no sign-out)', async () => {
    // A's session expired; the tokens went away, but nothing else changed.
    await seedAccountA();
    await markAccountCheckPending();
    signedInAs('sub-b');

    await ensureAccountVerified();

    expect(mockNotes.map(n => n.id).sort()).toEqual(['local', 'pending']);
  });

  it('keeps the check open and retries when the cleanup fails', async () => {
    await seedAccountA();
    await markAccountCheckPending();
    signedInAs('sub-b');
    mockClearAccountSyncState.mockRejectedValueOnce(new Error('SQLITE_FULL'));

    const failed = await ensureAccountVerified();

    expect(failed).toMatchObject({kind: 'error', stage: 'cleanup'});
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(ACCOUNT_KEY)).toBe(HASH_A);
    expect(await AsyncStorage.getItem(PENDING_KEY)).not.toBeNull();

    const retried = await ensureAccountVerified();

    expect(retried).toMatchObject({kind: 'ok', change: 'switched'});
    expect(mockNotes.map(n => n.id).sort()).toEqual(['local', 'pending']);
  });
});

describe('M4 — the first account on this build', () => {
  it('takes over the device-wide flags and keeps all notes', async () => {
    await AsyncStorage.multiSet([
      [NOTES_FLAG, JSON.stringify({at: 1, count: 2})],
      [V1_FLAG, '1'],
    ]);
    signedInAs('sub-a');

    const result = await ensureAccountVerified();

    expect(result).toEqual({kind: 'ok', accountHash: HASH_A, change: 'first'});
    expect(await AsyncStorage.getItem(`${V1_FLAG}:${HASH_A}`)).toBe('1');
    expect(await AsyncStorage.getItem(`${NOTES_FLAG}:${HASH_A}`)).toBe(
      JSON.stringify({at: 1, count: 2}),
    );
    expect(await AsyncStorage.getItem(V1_FLAG)).toBeNull();
    expect(await AsyncStorage.getItem(NOTES_FLAG)).toBeNull();
    expect(mockNotes).toHaveLength(5);
    expect(mockClearAccountSyncState).not.toHaveBeenCalled();
  });
});

describe('M4 — a check that cannot complete', () => {
  it('reports a userinfo failure, deletes nothing and stays open', async () => {
    await seedAccountA();
    await markAccountCheckPending();
    mockFetchQfUserInfo.mockRejectedValue(new Error('network'));

    const result = await ensureAccountVerified();

    expect(result).toMatchObject({kind: 'error', stage: 'userinfo'});
    expect(mockNotes).toHaveLength(5);
    expect(await AsyncStorage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it('reports no-auth when no session exists', async () => {
    mockFetchQfUserInfo.mockResolvedValue(null);

    expect(await ensureAccountVerified()).toEqual({kind: 'no-auth'});
  });

  it('shares one check between parallel callers', async () => {
    await seedAccountA();
    await markAccountCheckPending();
    signedInAs('sub-b');

    const results = await Promise.all([
      ensureAccountVerified(),
      ensureAccountVerified(),
      ensureAccountVerified(),
    ]);

    expect(mockFetchQfUserInfo).toHaveBeenCalledTimes(1);
    expect(mockClearAccountSyncState).toHaveBeenCalledTimes(1);
    expect(results.every(r => r.kind === 'ok')).toBe(true);
  });
});

describe('M4 — the open-check marker (re-review hardenings)', () => {
  it('runs the check when the marker write fails (a full device)', async () => {
    await seedAccountA();
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(() =>
      Promise.reject(new Error('SQLITE_FULL')),
    );
    await markAccountCheckPending();
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
    signedInAs('sub-b');

    const result = await ensureAccountVerified();

    // Without the in-memory flag, the fast path returned account A here.
    expect(mockFetchQfUserInfo).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({accountHash: HASH_B, change: 'switched'});
    expect(mockNotes.map(n => n.id).sort()).toEqual(['local', 'pending']);
  });

  it('a check for A does not remove the marker of B', async () => {
    await seedAccountA();
    await markAccountCheckPending(); // A signs in
    let resolveA!: (info: unknown) => void;
    mockFetchQfUserInfo.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveA = resolve;
        }),
    );
    const checkA = ensureAccountVerified();
    await settleUntil(() => mockFetchQfUserInfo.mock.calls.length === 1);

    // A signs out and B signs in while A's check waits for /userinfo.
    await markAccountCheckPending();
    const markerB = await AsyncStorage.getItem(PENDING_KEY);
    resolveA(userInfo('sub-a'));

    expect(await checkA).toMatchObject({kind: 'error', stage: 'superseded'});
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBe(markerB);
    expect(await AsyncStorage.getItem(ACCOUNT_KEY)).toBe(HASH_A);

    signedInAs('sub-b');
    const checkB = await ensureAccountVerified();

    expect(checkB).toMatchObject({accountHash: HASH_B, change: 'switched'});
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('a sign-in does not join the check of the previous sign-in', async () => {
    await seedAccountA();
    await markAccountCheckPending(); // A signs in
    let resolveA!: (info: unknown) => void;
    mockFetchQfUserInfo.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveA = resolve;
        }),
    );
    const checkA = ensureAccountVerified();
    await settleUntil(() => mockFetchQfUserInfo.mock.calls.length === 1);

    await markAccountCheckPending(); // B signs in
    mockFetchQfUserInfo.mockResolvedValueOnce(userInfo('sub-b'));
    const checkB = await ensureAccountVerified();
    resolveA(userInfo('sub-a'));
    const resultA = await checkA;

    expect(mockFetchQfUserInfo).toHaveBeenCalledTimes(2);
    expect(checkB).toMatchObject({accountHash: HASH_B, change: 'switched'});
    // The late check for A writes nothing.
    expect(resultA).toMatchObject({kind: 'error', stage: 'superseded'});
    expect(await AsyncStorage.getItem(ACCOUNT_KEY)).toBe(HASH_B);
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  // TECH_DEBT #250: a sign-in that starts while the close reads the marker.
  it('a close does not remove the marker of a sign-in during its read', async () => {
    await seedAccountA();
    await markAccountCheckPending(); // B signs in
    signedInAs('sub-b');

    // Hold the close's marker read (the first read of the marker after the
    // check stores account B). The read returns the value from its start.
    const getItem = AsyncStorage.getItem as jest.Mock;
    const realGetItem = getItem.getMockImplementation() as (
      key: string,
    ) => Promise<string | null>;
    const hold: {release: (() => void) | null; used: boolean} = {
      release: null,
      used: false,
    };
    getItem.mockImplementation(async (key: string) => {
      const value = await realGetItem(key);
      if (
        key === PENDING_KEY &&
        !hold.used &&
        (await realGetItem(ACCOUNT_KEY)) === HASH_B
      ) {
        hold.used = true;
        await new Promise<void>(resolve => {
          hold.release = resolve;
        });
      }
      return value;
    });

    try {
      const checkB = ensureAccountVerified();
      await settleUntil(() => hold.release !== null);
      expect(hold.release).not.toBeNull();

      // B signs out and signs in again while the close waits for its read.
      await markAccountCheckPending();
      const markerNew = await AsyncStorage.getItem(PENDING_KEY);
      expect(markerNew).not.toBeNull();
      hold.release?.();

      expect(await checkB).toMatchObject({accountHash: HASH_B});
      // Before the fix, the late close removed the marker of the new sign-in.
      expect(await AsyncStorage.getItem(PENDING_KEY)).toBe(markerNew);
    } finally {
      getItem.mockImplementation(realGetItem);
    }

    // The new sign-in still gets its own check, and that check closes it.
    mockFetchQfUserInfo.mockClear();
    const next = await ensureAccountVerified();
    expect(mockFetchQfUserInfo).toHaveBeenCalledTimes(1);
    expect(next).toMatchObject({kind: 'ok', change: 'same'});
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe('isAccountLinkedNote', () => {
  it('links a QF note or a real post, not a pending placeholder', () => {
    expect(isAccountLinkedNote({qfNoteId: 'n', qfPostId: null})).toBe(true);
    expect(isAccountLinkedNote({qfNoteId: null, qfPostId: 'p'})).toBe(true);
    expect(isAccountLinkedNote({qfNoteId: null, qfPostId: 'pending:x'})).toBe(
      false,
    );
    expect(isAccountLinkedNote({qfNoteId: null, qfPostId: null})).toBe(false);
  });
});
