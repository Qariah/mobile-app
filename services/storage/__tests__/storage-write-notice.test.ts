/**
 * Regression guard for GitHub #398 — the WRITE half of Sentry QARIAHV2-20.
 *
 * A rejected `setItem` is swallowed by zustand@4's persist middleware
 * (`errorInSync` is assigned asynchronously and tested synchronously), so a
 * write that never lands looks exactly like one that succeeded. The guarded
 * storage adapter already reported it to Sentry; these tests pin the part that
 * was missing — one, and only one, user-visible notice per session, and only
 * when the cause can be named.
 *
 * Before the fix all three of the behavioural tests failed: no notice was ever
 * shown, so `showToast` was never called at all.
 *
 * @ai Authored with AI assistance.
 */

import {
  createHydrationGuardedStateStorage,
  guardedJSONStorage,
} from '../hydrationGuardedStorage';
import {
  OUT_OF_SPACE_NOTICE_MESSAGE,
  OUT_OF_SPACE_NOTICE_TITLE,
  __resetStorageWriteNoticeForTests,
  classifyStorageWriteError,
  notifyStorageWriteFailure,
} from '../storageWriteNotice';
import {showToast} from '@/utils/toastUtils';
import {AppState} from 'react-native';

// `burnt` ships untransformed ESM and is outside jest-expo's transform
// allowlist, so the real toast helper throws at parse time.
jest.mock('@/utils/toastUtils', () => ({showToast: jest.fn()}));

// The Sentry SDK registers a module-level setInterval at import time, which
// keeps the jest worker alive and forces a hard exit.
jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const Sentry = require('@sentry/react-native');

const mockShowToast = showToast as jest.MockedFunction<typeof showToast>;

/**
 * The iOS shape as it ACTUALLY reaches JS: message only, no `code`, no
 * `domain`.
 *
 * This matters, and an earlier version of this file got it wrong. Native
 * builds the rejection at `RNCAsyncStorage.mm:572` via
 * `RCTMakeError(@"Failed to write manifest file.", error, nil)`, and
 * `RCTUtils.mm:529-538` returns a FLAT dict carrying only `message` (the
 * `extraData` argument is nil here). async-storage's own `convertError` then
 * does `new Error(error.message)` and attaches `key` — and nothing else.
 * Android is the same: `AsyncStorageModule.java:209` →
 * `AsyncStorageErrorUtil.getError(null, e.getMessage())`, message and `key`.
 *
 * So a rejected `setItem` NEVER carries `code` or `domain`, and the two
 * `code`-based branches in `classifyStorageWriteError` are unreachable in
 * production. Fixtures that set `code` return early and never evaluate
 * `OUT_OF_SPACE_TEXT` — which is the single line the shipped behaviour
 * actually depends on. These fixtures therefore carry the message alone.
 *
 * 27 of QARIAHV2-20's first 40 events are this iOS shape.
 */
function iosOutOfSpaceError(): Error {
  return new Error(
    'Failed to write manifest file.Error Domain=NSCocoaErrorDomain Code=640 ' +
      '"The file couldn’t be saved because there isn’t enough space." ' +
      'UserInfo={NSFilePath=/var/mobile/.../manifest.json}',
  );
}

/** The Android shape as it reaches JS: message only. 11 of the 40 events. */
function androidOutOfSpaceError(): Error {
  return new Error('database or disk is full (code 13 SQLITE_FULL[13])');
}

/** Android before API 28, which omits the bracketed extended result code. */
function androidOutOfSpaceErrorLegacy(): Error {
  return new Error('database or disk is full (code 13)');
}

/**
 * iOS without the `UserInfo=` tail — some frames stringify the NSError more
 * tersely. Still must classify on `Code=640`.
 */
function iosOutOfSpaceErrorTerse(): Error {
  return new Error(
    'Failed to write manifest file.Error Domain=NSCocoaErrorDomain Code=640 ' +
      '"The file couldn’t be saved because there isn’t enough space."',
  );
}

/** A write failure we cannot name — the case that must stay silent. */
function unknownWriteError(): Error {
  return new Error('Failed to write manifest file.Unknown error');
}

/** A raw storage whose reads succeed and whose writes always reject. */
function failingStorage(error: Error) {
  return {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {
      throw error;
    }),
    removeItem: jest.fn(async () => undefined),
  };
}

/** A raw storage that works. */
function healthyStorage() {
  const disk: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => disk[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      disk[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete disk[key];
    }),
  };
}

/**
 * `AppState.currentState` is a plain property on the jest-expo mock, and it is
 * `undefined` there by default — which the notice treats as showable.
 */
function setAppState(state: 'active' | 'background'): void {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: state,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetStorageWriteNoticeForTests();
  setAppState('active');
});

describe('classifyStorageWriteError', () => {
  it('names the iOS out-of-space write failure', () => {
    expect(classifyStorageWriteError(iosOutOfSpaceError())).toBe(
      'out-of-space',
    );
  });

  it('names the Android SQLITE_FULL write failure', () => {
    expect(classifyStorageWriteError(androidOutOfSpaceError())).toBe(
      'out-of-space',
    );
  });

  it('names the iOS shape without the UserInfo tail', () => {
    expect(classifyStorageWriteError(iosOutOfSpaceErrorTerse())).toBe(
      'out-of-space',
    );
  });

  it('names the pre-API-28 Android message, which omits the extended code', () => {
    expect(classifyStorageWriteError(androidOutOfSpaceErrorLegacy())).toBe(
      'out-of-space',
    );
  });

  it('names a bare POSIX ENOSPC', () => {
    expect(
      classifyStorageWriteError(new Error('ENOSPC: no space left on device')),
    ).toBe('out-of-space');
  });

  it('does NOT claim out-of-space for an unrelated write error', () => {
    // The distinction is the whole point: "your disk is full" is actionable,
    // "a storage error occurred" is not, so the two must not collapse.
    expect(classifyStorageWriteError(unknownWriteError())).toBe('other');
    expect(classifyStorageWriteError(new Error('Code=257'))).toBe('other');
    // A bare SQLite result code 13 is far too generic to trust on its own.
    expect(classifyStorageWriteError({code: 13, message: 'timeout'})).toBe(
      'other',
    );
    expect(classifyStorageWriteError(undefined)).toBe('other');
    // A KNOWN MISS, pinned so it is a decision rather than a surprise. An
    // Android device too full for SQLite to even OPEN the catalyst DB takes
    // AsyncStorageModule.java's getDBError path, whose message is this bare
    // literal — the worst end of the full-disk spectrum, and it says nothing
    // we can name. Recorded as residue (d) on TECH_DEBT #215; the
    // `writeErrorKind: 'other'` tag is what will size it.
    expect(classifyStorageWriteError(new Error('Database Error'))).toBe(
      'other',
    );
  });
});

describe('out-of-storage write notice', () => {
  it('shows exactly ONE notice when several stores fail in the same process', async () => {
    // A full volume fails every persisted store at the same moment, and each
    // one retries on every `set()`. 17 stores must not produce 17 toasts.
    const error = iosOutOfSpaceError();
    const storeA = createHydrationGuardedStateStorage(
      'storeA',
      failingStorage(error),
    );
    const storeB = createHydrationGuardedStateStorage(
      'storeB',
      failingStorage(error),
    );

    // Hydrate both first — the guard refuses writes before a successful read,
    // and that refusal is a DIFFERENT signal from a failed write.
    await storeA.getItem('a');
    await storeB.getItem('b');

    await storeA.setItem('a', '{}');
    await storeA.setItem('a', '{}');
    await storeB.setItem('b', '{}');

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      OUT_OF_SPACE_NOTICE_TITLE,
      OUT_OF_SPACE_NOTICE_MESSAGE,
      'error',
    );

    // Sentry still hears from BOTH stores — the per-store report and the
    // once-per-session notice are deliberately latched at different levels.
    const writeFailures = Sentry.captureMessage.mock.calls.filter(
      (call: unknown[]) => call[0] === 'persist-write-failed',
    );
    expect(writeFailures).toHaveLength(2);
    expect(writeFailures[0][1].tags.writeErrorKind).toBe('out-of-space');
  });

  it('stays silent for a write error it cannot name, but still reports it', async () => {
    const storage = createHydrationGuardedStateStorage(
      'storeC',
      failingStorage(unknownWriteError()),
    );
    await storage.getItem('c');
    await storage.setItem('c', '{}');

    expect(mockShowToast).not.toHaveBeenCalled();
    const writeFailures = Sentry.captureMessage.mock.calls.filter(
      (call: unknown[]) => call[0] === 'persist-write-failed',
    );
    expect(writeFailures).toHaveLength(1);
    expect(writeFailures[0][1].tags.writeErrorKind).toBe('other');
  });

  it('shows no notice at all on a healthy write', async () => {
    const base = healthyStorage();
    const storage = guardedJSONStorage<{value: number}>('storeD', base);
    // `createJSONStorage` returns undefined only when storage is unavailable.
    expect(storage).toBeDefined();

    await storage?.getItem('d');
    await storage?.setItem('d', {state: {value: 1}, version: 0});

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(base.setItem).toHaveBeenCalledTimes(1);
  });

  it('does not spend the notice on a background write, and shows it later', () => {
    // Qariah persists player position for the whole of a background listen, so
    // a full volume fails writes long before the user can see anything. The
    // notice must survive that and land on the next foreground write.
    setAppState('background');
    expect(notifyStorageWriteFailure(iosOutOfSpaceError())).toBe(
      'out-of-space',
    );
    expect(mockShowToast).not.toHaveBeenCalled();

    setAppState('active');
    notifyStorageWriteFailure(iosOutOfSpaceError());
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it('keeps the latch for the rest of the session, across separate failures', () => {
    expect(notifyStorageWriteFailure(iosOutOfSpaceError())).toBe(
      'out-of-space',
    );
    expect(notifyStorageWriteFailure(androidOutOfSpaceError())).toBe(
      'out-of-space',
    );
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
