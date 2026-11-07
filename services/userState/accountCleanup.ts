// @ai
/**
 * M4 (TECH_DEBT #244) — keep one QF account's data away from the next account
 * on this device.
 *
 * Design (after the Stage-2 review of the first M4 fix):
 *   - Sign-out clears only the tokens. It deletes no note, no queued write and
 *     no restore flag, so the same account that signs in again keeps all of
 *     them. (The first fix deleted the QF-linked notes at sign-out. The notes
 *     restore then could not bring them all back, and the local rewayah, the
 *     creation time and the reflection links were lost.)
 *   - The device stores a hash of the signed-in account's QF `sub`. At
 *     sign-in, `ensureAccountVerified()` compares it with the new account.
 *     It runs BEFORE any restore, pull or queue flush for the new account:
 *       - same account: keep everything;
 *       - different account: remove the previous account's QF-linked notes
 *         and their Mushaf markers, the sync queue, the QF caches, and the
 *         previous account's notes-restore flag (its notes are no longer on
 *         the device, so its next sign-in must restore them);
 *       - no stored account (the first sign-in on this build): the account
 *         takes over the old device-wide restore flags, so existing users are
 *         not asked again.
 *     This also covers "the session expired, then a different account signed
 *     in".
 *   - The restore flags are per account (`accountKeys.ts`).
 *
 * Device data stays in all cases: a note with no QF link, a note with only a
 * `pending:` post id, highlights, bookmarks and the player stores.
 *
 * Limits:
 *   - A note that account A made while signed in, but that never reached QF,
 *     has no QF link, so account B sees it.
 *   - When A signs in again after B, A's notes come back through the notes
 *     restore and the posts pull, but without their local rewayah and
 *     creation time.
 *   - A device that had two accounts before this build has no stored account.
 *     The first account that signs in on this build owns the old data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digestStringAsync,
} from 'expo-crypto';
import type {VerseNote} from '@/types/verse-annotations';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';
import {
  ACCOUNT_CHECK_PENDING_KEY,
  ACCOUNT_HASH_KEY,
  NOTES_RESTORED_AT_BASE_KEY,
  V1_RESTORE_DONE_BASE_KEY,
  accountFlagKey,
} from './accountKeys';
import {clearAccountSyncState, initUserStateDb} from './db';
import {isPendingPostId} from './notesSync';
import {fetchQfUserInfo} from './qfUserInfo';

export type AccountCheckResult =
  | {
      kind: 'ok';
      accountHash: string;
      /** What the check found: the same account, a different one, or none. */
      change: 'same' | 'switched' | 'first';
    }
  | {kind: 'no-auth'}
  | {
      kind: 'error';
      /** `superseded`: a new sign-in started a new check during this one. */
      stage: 'userinfo' | 'cleanup' | 'superseded';
      detail: string;
    };

// ── Check state (process memory) ──────────────────────────────────────────

/** The account check that is running now. Parallel callers share it. */
let checkInFlight: Promise<AccountCheckResult> | null = null;

/**
 * The number of the latest `markAccountCheckPending()` call in this process.
 * A check remembers the number it started under. If a new sign-in changes the
 * number while the check runs, the check is superseded: it writes nothing and
 * leaves the open-check marker of the new sign-in in place.
 */
let checkGeneration = 0;

/**
 * True from `markAccountCheckPending()` until a check of the same generation
 * completes. The fast path reads it together with the stored marker. Reason:
 * the marker write can fail (a full device, QARIAHV2-20). Without this flag,
 * the fast path would then treat the new account as the stored account.
 */
let checkRequired = false;

/** True when the note is linked to the QF account (a QF note or a real post). */
export function isAccountLinkedNote(
  note: Pick<VerseNote, 'qfNoteId' | 'qfPostId'>,
): boolean {
  if (note.qfNoteId) return true;
  return Boolean(note.qfPostId) && !isPendingPostId(note.qfPostId);
}

/** SHA-256 (hex) of the account identity. The raw `sub` is not stored. */
async function hashAccountIdentity(identity: string): Promise<string> {
  return digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    `qf-account:${identity}`,
    {encoding: CryptoEncoding.HEX},
  );
}

/**
 * Marks the account check as open. AuthContext calls this before a sign-in,
 * so that no flush or restore can use the stored account until the check
 * for the new account completes.
 */
export async function markAccountCheckPending(): Promise<void> {
  // Process memory first, so a failed write below cannot skip the check.
  checkGeneration += 1;
  checkRequired = true;
  // A check that started before this sign-in must not answer for it.
  checkInFlight = null;
  // The marker value names this sign-in, so an older check can tell that the
  // marker is not its own (see `closeAccountCheck`).
  const marker = `${Date.now().toString(36)}-${checkGeneration}`;
  await AsyncStorage.setItem(ACCOUNT_CHECK_PENDING_KEY, marker).catch(
    () => undefined,
  );
}

/**
 * Closes the check that started under `generation` with the stored marker
 * `startMarker`. It removes the stored marker only when that marker is still
 * the one the check started with, and it clears `checkRequired` only when no
 * new sign-in happened. So a check for account A cannot close the check of
 * account B.
 *
 * TECH_DEBT #250: a `markAccountCheckPending()` can start while the marker
 * read below waits. The read then returns the old marker, and the new sign-in
 * writes its own marker. So the generation is compared again after the read,
 * in the same synchronous step as the remove call. `markAccountCheckPending()`
 * changes the generation before its first await, so an unchanged generation
 * here means that no new sign-in started. A sign-in that starts after the
 * remove call queues its marker write after the remove, and AsyncStorage
 * runs the calls in order.
 */
async function closeAccountCheck(
  generation: number,
  startMarker: string | null,
): Promise<void> {
  const current = await AsyncStorage.getItem(ACCOUNT_CHECK_PENDING_KEY);
  if (generation !== checkGeneration) return;
  if (current === startMarker) {
    await AsyncStorage.removeItem(ACCOUNT_CHECK_PENDING_KEY);
  }
  if (generation === checkGeneration) checkRequired = false;
}

async function removeAccountLinkedNotes(): Promise<number> {
  const notes = await verseAnnotationService.getAllNotes();
  const touchedKeys = new Set<string>();
  let removed = 0;
  for (const note of notes) {
    if (!isAccountLinkedNote(note)) continue;
    await verseAnnotationService.deleteNoteById(note.id);
    removed += 1;
    touchedKeys.add(note.verseKey);
    for (const key of note.verseKeys ?? []) touchedKeys.add(key);
  }
  // A verse loses its note marker only when no note is left on it.
  const store = useVerseAnnotationsStore.getState();
  for (const key of touchedKeys) {
    const remaining = await verseAnnotationService.getNotesCountForVerse(key);
    if (remaining === 0) store.removeNote(key);
  }
  return removed;
}

/** Removes the previous account's QF-linked data. Throws on a failure. */
async function removePreviousAccountData(previousHash: string): Promise<void> {
  await initUserStateDb();
  await clearAccountSyncState();
  await removeAccountLinkedNotes();
  // The previous account's notes are gone from the device, so its next
  // sign-in must restore them. Its v1-restore flag stays: the v1 data went
  // into the player stores, which stay.
  await AsyncStorage.removeItem(
    accountFlagKey(NOTES_RESTORED_AT_BASE_KEY, previousHash),
  );
}

/** The first account on this build takes over the device-wide flags. */
async function adoptLegacyFlags(accountHash: string): Promise<void> {
  for (const baseKey of [
    NOTES_RESTORED_AT_BASE_KEY,
    V1_RESTORE_DONE_BASE_KEY,
  ]) {
    const legacy = await AsyncStorage.getItem(baseKey);
    if (legacy === null) continue;
    const target = accountFlagKey(baseKey, accountHash);
    if ((await AsyncStorage.getItem(target)) === null) {
      await AsyncStorage.setItem(target, legacy);
    }
    await AsyncStorage.removeItem(baseKey);
  }
}

const SUPERSEDED: AccountCheckResult = {
  kind: 'error',
  stage: 'superseded',
  detail: 'a new sign-in started a new account check',
};

async function runAccountCheck(
  generation: number,
): Promise<AccountCheckResult> {
  const superseded = () => generation !== checkGeneration;
  const startMarker = await AsyncStorage.getItem(
    ACCOUNT_CHECK_PENDING_KEY,
  ).catch(() => null);
  let info;
  try {
    info = await fetchQfUserInfo();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (__DEV__) console.warn('[accountCleanup] userinfo failed:', detail);
    return {kind: 'error', stage: 'userinfo', detail};
  }
  if (superseded()) return SUPERSEDED;
  if (!info) return {kind: 'no-auth'};

  // `sub` is the stable QF account id. The email is a fallback only for a
  // response with no `sub`.
  const identity = info.sub || `email:${info.email.trim().toLowerCase()}`;
  try {
    const accountHash = await hashAccountIdentity(identity);
    const stored = await AsyncStorage.getItem(ACCOUNT_HASH_KEY);
    let change: 'same' | 'switched' | 'first';
    if (!stored) {
      await adoptLegacyFlags(accountHash);
      change = 'first';
    } else if (stored !== accountHash) {
      await removePreviousAccountData(stored);
      change = 'switched';
    } else {
      change = 'same';
    }
    // A new sign-in during the cleanup owns the result now; its own check
    // stores its account.
    if (superseded()) return SUPERSEDED;
    await AsyncStorage.setItem(ACCOUNT_HASH_KEY, accountHash);
    await closeAccountCheck(generation, startMarker);
    return {kind: 'ok', accountHash, change};
  } catch (e) {
    // The check stays open, so the next caller tries the cleanup again.
    const detail = e instanceof Error ? e.message : String(e);
    if (__DEV__) console.warn('[accountCleanup] account check failed:', e);
    Sentry.captureException(e, {tags: {scope: 'account-check'}});
    return {kind: 'error', stage: 'cleanup', detail};
  }
}

/** Test-only: reset the process-memory check state. Not for app code. */
export function _resetAccountCheckStateForTests(): void {
  checkInFlight = null;
  checkGeneration = 0;
  checkRequired = false;
}

/**
 * Makes sure that the local QF-linked data belongs to the signed-in account.
 *
 * Fast path (no network): an account is stored and no check is open. A check
 * is open after `markAccountCheckPending()` (a sign-in; in the stored marker
 * and in process memory), before the first check on this build, and after a
 * failed or superseded check. Then this function asks QF for the account
 * (`/userinfo`) and runs the comparison above. Parallel callers share one
 * check.
 *
 * Callers must not restore, pull or flush unless the result is `ok`.
 */
export async function ensureAccountVerified(): Promise<AccountCheckResult> {
  if (checkInFlight) return checkInFlight;
  const [stored, pending] = await Promise.all([
    AsyncStorage.getItem(ACCOUNT_HASH_KEY).catch(() => null),
    AsyncStorage.getItem(ACCOUNT_CHECK_PENDING_KEY).catch(() => null),
  ]);
  if (stored && !pending && !checkRequired) {
    return {kind: 'ok', accountHash: stored, change: 'same'};
  }
  if (checkInFlight) return checkInFlight;
  const flight = runAccountCheck(checkGeneration).finally(() => {
    if (checkInFlight === flight) checkInFlight = null;
  });
  checkInFlight = flight;
  return flight;
}
