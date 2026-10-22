// @ai
/**
 * M4 (TECH_DEBT #244) — AsyncStorage keys for the QF account on this device.
 *
 * This module has no dependency except AsyncStorage, so that notesRestore.ts,
 * v1Restore.ts and accountCleanup.ts can all import it without an import
 * cycle.
 *
 * The restore flags are per account: `<base key>:<account hash>`. Before M4
 * they were device-wide, so the next account on the device got no notes
 * restore and no v1 restore. The account hash is a SHA-256 of the account's
 * QF `sub`; `accountCleanup.ts` writes it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Hash of the QF account that owns the QF-linked data on this device. */
export const ACCOUNT_HASH_KEY = '@qariah:qfAccountHash';

/** Set from the start of a sign-in until the account check completes. */
export const ACCOUNT_CHECK_PENDING_KEY = '@qariah:qfAccountCheckPending';

/** Base key of the per-account notes-restore flag (device-wide before M4). */
export const NOTES_RESTORED_AT_BASE_KEY = '@qariah:notesRestoredAt';

/** Base key of the per-account v1-restore flag (device-wide before M4). */
export const V1_RESTORE_DONE_BASE_KEY = '@qariah:v1RestoreDone';

/** The flag key for one account, or the base key when no account is known. */
export function accountFlagKey(
  baseKey: string,
  accountHash: string | null,
): string {
  return accountHash ? `${baseKey}:${accountHash}` : baseKey;
}

/** The stored account hash, or null when no account check has completed. */
export async function getStoredAccountHash(): Promise<string | null> {
  return AsyncStorage.getItem(ACCOUNT_HASH_KEY).catch(() => null);
}

/**
 * The flag key of the stored account. Before the first account check on this
 * build, this is the device-wide base key; the first account that signs in
 * takes over that key's value (see `accountCleanup.ts`).
 */
export async function currentAccountFlagKey(baseKey: string): Promise<string> {
  return accountFlagKey(baseKey, await getStoredAccountHash());
}
