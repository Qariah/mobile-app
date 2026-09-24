/**
 * The one place that turns a failed persistence WRITE into something the user
 * can act on.
 *
 * WHY THIS EXISTS (GitHub #398 / #329 / Sentry QARIAHV2-20 / TECH_DEBT #191)
 * -------------------------------------------------------------------------
 * `QARIAHV2-20` has two halves. `hydrationGuardedStorage.ts` fixed the READ
 * half: a failed read no longer lets defaults overwrite real data. This module
 * is the WRITE half.
 *
 * A failed write is not destructive — the in-memory state stays correct — but
 * it is completely silent. zustand@4.5.7 ships TWO persist implementations and
 * picks between them at `middleware.js:593-600`: `oldImpl` only when one of
 * `getStorage | serialize | deserialize` is passed. All 17 of our stores pass
 * `storage:`, so every one of them takes `newImpl`, whose `setItem`
 * (`middleware.js:493-498`) has no `try`, no `.catch` and no error handling at
 * all — and callers invoke it as `void setItem()`. The rejection is therefore
 * an UNHANDLED promise rejection that nothing surfaces: no throw the caller
 * sees, no log. A write that never lands is indistinguishable from one that
 * succeeded, and all 17 stores lose writes this way on a full device.
 *
 * (`oldImpl:369-384` — the deprecated path we do not take — is the variant
 * that assigns the rejection to `errorInSync` inside an async `.catch` and
 * then tests it synchronously, so it too is always `undefined`. Silent either
 * way; the mechanism differs. Issue #398 quoted `oldImpl`.)
 *
 * `hydrationGuardedStorage` already catches the rejection and reports
 * `persist-write-failed` to Sentry. What was missing is a consequence the user
 * can see. This module supplies exactly one.
 *
 * THE TWO RULES
 * -------------
 * 1. ONCE PER SESSION, not once per store and not once per write. A full
 *    volume fails all 17 stores at the same moment, and each store retries on
 *    every `set()`. The latch is module-level, so the process shows at most
 *    one notice however many stores fail.
 * 2. NEVER while the app is in the background. Qariah plays audio in the
 *    background and persists player position the whole time, so a full volume
 *    would otherwise spend the one notice on a toast nobody can see.
 * 3. ONLY when we can name the cause. "Your device is out of storage" tells
 *    the user what to do. A generic "a storage error occurred" tells them
 *    nothing, cannot be acted on, and would fire for causes we have not
 *    identified yet. Other write errors therefore stay SILENT to the user and
 *    keep going only to Sentry, where `persist-write-failed` carries the
 *    `writeErrorKind` tag. When that signal names a second actionable cause,
 *    add it to `classifyStorageWriteError` here — the classification lives in
 *    one place on purpose.
 *
 * Deliberately NOT done: retrying. A full volume cannot be fixed by retrying,
 * and the app cannot free the user's disk.
 *
 * @ai Authored with AI assistance.
 */

import {AppState} from 'react-native';
import * as Sentry from '@sentry/react-native';

/** What kind of failure a rejected `setItem` was. */
export type StorageWriteErrorKind = 'out-of-space' | 'other';

/**
 * User-facing copy. Exported so the tests assert the exact strings rather than
 * a paraphrase, and so the wording lives next to the rule that emits it.
 *
 * `showToast` merges title and message into one line on Android, so both parts
 * stay short enough to read as a single toast.
 */
export const OUT_OF_SPACE_NOTICE_TITLE = 'Your device is out of storage';
export const OUT_OF_SPACE_NOTICE_MESSAGE =
  "Changes aren't being saved. Free up space.";

/** The fields AsyncStorage's `convertError` can attach to a rejection. */
type MaybeCodedError = {code?: unknown; domain?: unknown; message?: unknown};

function readableText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const {message} = error as MaybeCodedError;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

function readField(error: unknown, field: 'code' | 'domain'): string {
  if (!error || typeof error !== 'object') return '';
  const value = (error as MaybeCodedError)[field];
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Text tells for a full volume, across both platforms and both layers.
 *
 * - `NSFileWriteOutOfSpaceError` / `Code=640` — iOS Cocoa write-out-of-space.
 * - `SQLITE_FULL` / `database or disk is full` — Android AsyncStorage's SQLite
 *   backend.
 * - `ENOSPC` / `no space left on device` — the POSIX layer underneath both.
 */
const OUT_OF_SPACE_TEXT =
  /(NSFileWriteOutOfSpaceError|SQLITE_FULL|SQLiteFullException|Code=640\b|no space left on device|disk (?:is )?full|out of space|ENOSPC)/i;

/**
 * Name the cause of a rejected write, or admit we cannot.
 *
 * Kept pure and exported so the tell-matching is testable on its own — the
 * strings come from two different native layers and will grow.
 */
export function classifyStorageWriteError(
  error: unknown,
): StorageWriteErrorKind {
  const code = readField(error, 'code');
  const text = readableText(error);

  // iOS `NSFileWriteOutOfSpaceError`. The domain is not always attached to the
  // JS error, so the code alone counts — 640 has no other meaning here.
  if (code === '640') return 'out-of-space';
  // Android SQLite result code 13 is SQLITE_FULL, but a bare 13 is far too
  // generic to trust on its own, so it must come with a SQLite tell.
  if (code === '13' && /sql/i.test(text)) return 'out-of-space';
  if (OUT_OF_SPACE_TEXT.test(text)) return 'out-of-space';
  return 'other';
}

/**
 * Module-level on purpose: this is the once-per-session latch. Every guarded
 * store shares this module, so 17 stores failing together produce one notice.
 */
let noticeShown = false;

/** Test seam. The latch is process-lifetime state with no production reset. */
export function __resetStorageWriteNoticeForTests(): void {
  noticeShown = false;
}

/**
 * Classify a rejected `setItem` and, at most once per session, tell the user
 * their device is out of storage.
 *
 * Returns the classification so the caller can tag its own report with it.
 * Never throws: a notice that cannot render must not take persistence with it.
 */
export function notifyStorageWriteFailure(
  error: unknown,
): StorageWriteErrorKind {
  const kind = classifyStorageWriteError(error);

  // Rule 2 — no notice for a cause we cannot name.
  if (kind !== 'out-of-space') return kind;
  // Rule 1 — at most one per session.
  if (noticeShown) return kind;
  // Rule 3 — do not spend the one notice while the app is in the background.
  // Qariah's core use is background audio, and `playerStore` persists position
  // the whole time it plays, so a full volume would otherwise burn the single
  // notice on a toast nobody can see. Returning WITHOUT latching leaves it for
  // the next foreground write. Any state other than `background` still shows,
  // so an unknown state fails towards telling the user.
  if (AppState.currentState === 'background') return kind;
  // Latch BEFORE showing. "At most once" is the requirement, so a toast that
  // fails to render must not make the next failed write try again.
  noticeShown = true;

  Sentry.addBreadcrumb({
    category: 'persist',
    message: 'showed the out-of-storage write notice',
    level: 'warning',
  });

  try {
    // Required lazily, not imported. Two reasons, both load-bearing:
    //   - persisted writes run in contexts with no UI at all (a background
    //     audio wake), and a storage module must not drag a native toast
    //     module into that graph just by being imported;
    //   - `burnt` ships untransformed ESM and is outside jest-expo's transform
    //     allowlist, so a top-level import here would break every test that
    //     loads a persisted store.
    const {showToast} =
      require('@/utils/toastUtils') as typeof import('@/utils/toastUtils');
    showToast(OUT_OF_SPACE_NOTICE_TITLE, OUT_OF_SPACE_NOTICE_MESSAGE, 'error');
  } catch {
    // Swallowed deliberately — see above.
  }

  return kind;
}
