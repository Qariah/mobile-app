/**
 * Hydration-guarded persistence for zustand `persist` stores.
 *
 * WHY THIS EXISTS (GitHub #329 / Sentry QARIAHV2-20 / TECH_DEBT #191)
 * ------------------------------------------------------------------
 * zustand@4's `persist` middleware wraps every store so that ANY `set()` calls
 * `setItem()` unconditionally, with no hydration check
 * (`node_modules/zustand/middleware.js`):
 *
 *     var configResult = config(function () {
 *       set.apply(void 0, arguments);
 *       void setItem();          // <- fires on EVERY set(), unguarded
 *     }, get, api);
 *
 * When the hydrating read REJECTS, the promise chain skips `set(stateFromStorage,
 * true)` and lands in `.catch`, so the store sits at its DEFAULTS and
 * `persist.hasHydrated()` stays false. The next write of any kind then persists
 * those defaults over the user's real data — permanent, silent loss with no
 * crash and no telemetry.
 *
 * On iOS the read failure is real and observed in production: the app declares
 * `UIBackgroundModes = audio + remote-notification` and sets no
 * `NSFileProtection` class, so it inherits
 * `NSFileProtectionCompleteUntilFirstUserAuthentication`. A background wake
 * BEFORE the first unlock after a reboot finds the container unreadable and
 * AsyncStorage's `manifest.json` read fails with `NSCocoaErrorDomain 257`.
 *
 * THE FIX
 * -------
 * Refuse to persist until a read has actually succeeded. The discriminator
 * already existed (`hasHydrated()`); it was simply never consulted on the write
 * path. Guarding inside the storage adapter is strictly better than reading
 * `persist.hasHydrated()` from the store, because the adapter owns both halves
 * of the signal and has no chicken-and-egg with the store it belongs to.
 *
 * CRITICAL: a fresh install is a SUCCESSFUL read.
 * `AsyncStorage.getItem` RESOLVES with `null` when the key is absent; zustand
 * treats that as "no persisted state", merges nothing, and flips
 * `hasHydrated()` to true. Only a REJECTED read is a failure. The guard
 * therefore keys off resolve-vs-reject, never off the value — so first-run
 * persistence keeps working exactly as before.
 *
 * All 17 persisted stores go through this module. When adding a persisted
 * store, use `guardedJSONStorage` — the completeness check is that every
 * `persist(` call site in the tree names it. Note that a store can reach
 * AsyncStorage through the `@/utils/storage` alias rather than importing it
 * directly (`hooks/useSettings.ts` does), so grepping for AsyncStorage alone
 * under-counts; grep for `persist(`.
 *
 * THE WRITE HALF (GitHub #398)
 * ----------------------------
 * A failed WRITE is the other half of QARIAHV2-20 and is not destructive — the
 * in-memory state stays correct — but it is silent, because zustand discards
 * the rejection (see `services/storage/storageWriteNotice.ts` for the exact
 * mechanism). This adapter catches it, classifies it and hands it to
 * `notifyStorageWriteFailure`, which shows one out-of-storage notice per
 * session across all 17 stores.
 *
 * Deliberately NOT done here (see #329): retrying the read harder, or writing
 * defaults back after a failed read. Recovering a readable container mid-process
 * (`applicationProtectedDataDidBecomeAvailable`) is the follow-up; blocking the
 * destructive write is the fix.
 *
 * THREE READ STATES, NOT TWO (GitHub #457)
 * ----------------------------------------
 * The first cut of this guard had one boolean, so "the read has not come back
 * yet" and "the read failed" were the same state. Every boot races: zustand
 * issues the hydrating read at store creation and any `set()` before it
 * resolves reached a closed gate. That dropped the write AND reported
 * `persist-write-suppressed` — 1097 events across 220 users in 24 h, with
 * `persist-read-failed` at exactly ZERO, so not one of them was the #329
 * condition.
 *
 * The three states are now explicit:
 *
 *   - `pending`  — the read is in flight. The write is DEFERRED (held, last
 *                  one wins) and replayed when the read resolves. No event.
 *   - `ok`       — a read resolved. Writes go straight through.
 *   - `failed`   — a read REJECTED. Writes are refused and any deferred write
 *                  is discarded, because it carries the store's DEFAULTS and
 *                  writing it is precisely the #329 data loss. One event.
 *
 * WHY A DEFERRED WRITE CANNOT SIMPLY BE REPLAYED AS-IS
 * ---------------------------------------------------
 * The deferred value is a whole-store snapshot taken BEFORE hydration merged
 * anything, so it is the defaults plus whatever changed. Writing it verbatim
 * over a populated blob is the same destructive overwrite the guard exists to
 * stop. And zustand does not repair it afterwards: in zustand 4.5 `hydrate()`
 * merges with the store's UNWRAPPED `set`, and only re-persists when a
 * `migrate` actually ran —
 *
 *     stateFromStorage = options.merge(migratedState, get() ?? configResult);
 *     set(stateFromStorage, true);          // unwrapped -> no setItem
 *     if (migrated) { return setItem(); }   // the ONLY post-hydration write
 *
 * so on the ordinary path nothing writes again until the user's next action.
 * (That is also why stock zustand is worse than this guard, not better: its
 * unguarded pre-hydration write lands on disk and is never repaired either.)
 *
 * The replay therefore reproduces what zustand WOULD have written next — the
 * post-merge state — by applying zustand's own default merge, stored-wins:
 * `{...deferredState, ...storedState}`. Keys the user set pre-hydration that
 * storage never had survive; every stored key is preserved untouched. The
 * replay is skipped, and the write stays dropped, whenever that cannot be
 * proven safe: unparseable values, a version mismatch (a `migrate` is pending,
 * and that is the one path zustand re-persists by itself), or a deferred write
 * that adds no key the stored blob lacks (already correct on disk — the common
 * case, and skipping keeps boot I/O at zero).
 *
 * This assumes zustand's DEFAULT shallow merge. No persisted store in this tree
 * passes a custom `merge` (grep `merge:` across the `persist(` call sites). If
 * one ever does, the replay must be revisited or that store must opt out.
 *
 * @ai Authored with AI assistance.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import {createJSONStorage} from 'zustand/middleware';
import type {StateStorage} from 'zustand/middleware';

import {notifyStorageWriteFailure} from './storageWriteNotice';

/**
 * The guard deliberately sits BENEATH the JSON layer, on the raw string
 * storage — do not lift it above `createJSONStorage`.
 *
 * That placement is what separates the two failure modes that look alike:
 *
 *   - storage UNREADABLE (`getItem` rejects) — the bytes may still be there and
 *     perfectly good, so writing would destroy them. Writes are refused.
 *   - value present but UNPARSEABLE (`JSON.parse` throws in the layer above) —
 *     the read itself succeeded, so the guard has already opened the gate. The
 *     stored blob is already garbage and overwriting it is the only way to
 *     recover, which is exactly what zustand does today. That self-healing is
 *     preserved.
 *
 * Move the guard above the JSON layer and the second case starts being treated
 * as the first: one corrupt blob would lock its store read-only on every launch,
 * forever.
 */

/** Shape of the raw string-in/string-out storage zustand's JSON layer sits on. */
type RawStorage = Pick<StateStorage, 'getItem' | 'setItem' | 'removeItem'>;

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Where the hydrating read has got to. See "THREE READ STATES" above. */
type ReadState = 'pending' | 'ok' | 'failed';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * The value to replay for a write that was deferred while the read was in
 * flight, or `null` to keep dropping it.
 *
 * Returns what zustand's own default merge would produce — stored keys win over
 * the pre-hydration snapshot — so the replay can never cost the user a stored
 * value. Anything it cannot prove returns `null`.
 *
 * Both arguments are raw strings because the guard sits BENEATH the JSON layer
 * (see the placement note above); parsing here is local and failure-tolerant,
 * and does not move the guard.
 */
export function mergeDeferredWrite(
  deferredValue: string,
  storedValue: string | null,
): string | null {
  // Nothing on disk (fresh install, or a cleared store): zustand merges nothing,
  // so the deferred snapshot IS the post-hydration state. Replay it verbatim.
  if (storedValue == null) return deferredValue;

  let deferred: unknown;
  let stored: unknown;
  try {
    deferred = JSON.parse(deferredValue);
    stored = JSON.parse(storedValue);
  } catch {
    // An unparseable stored blob is zustand's self-healing case, and it heals on
    // the next ordinary write with the gate already open. Don't race it here.
    return null;
  }

  if (!isPlainRecord(deferred) || !isPlainRecord(stored)) return null;
  const deferredState = deferred.state;
  const storedState = stored.state;
  if (!isPlainRecord(deferredState) || !isPlainRecord(storedState)) return null;

  // A version mismatch means `migrate` is about to run. That is the one path
  // where zustand re-persists the merged state itself, so leave it alone —
  // replaying a pre-migration snapshot over a migrating store is not safe.
  if (deferred.version !== stored.version) return null;

  // The deferred write adds no key storage lacks, so the merge would equal what
  // is already on disk. Skip the write entirely rather than spend boot I/O.
  const addsSomething = Object.keys(deferredState).some(
    key => !hasOwn(storedState, key),
  );
  if (!addsSomething) return null;

  return JSON.stringify({
    ...deferred,
    state: {...deferredState, ...storedState},
  });
}

/**
 * Wraps a raw string storage so a write is deferred while the hydrating read is
 * in flight, and refused once that read has failed.
 *
 * Exported for direct use / testing. Most callers want `guardedJSONStorage`.
 */
export function createHydrationGuardedStateStorage(
  storeName: string,
  base: RawStorage = AsyncStorage,
): StateStorage {
  // 'pending' until a read settles. A resolved `null` (fresh install) is 'ok'.
  let readState: ReadState = 'pending';
  // The one write held while the read is in flight. Each write is a full-state
  // snapshot and state accumulates, so the LAST one subsumes the others.
  let deferredWrite: {name: string; value: string} | undefined;
  // One report per store per process — this can fire on every keystroke-ish
  // write, and the condition is a single fact, not N facts.
  let reportedSuppression = false;
  let reportedDeferral = false;
  let reportedReadFailure = false;
  let reportedWriteFailure = false;
  let suppressedWrites = 0;
  let deferredWrites = 0;

  /** The real write, plus the #398 failure handling. Never rejects. */
  const writeThrough = async (name: string, value: string): Promise<void> => {
    try {
      await base.setItem(name, value);
    } catch (error) {
      // zustand calls setItem as `void setItem()`, so a rejection here is an
      // UNHANDLED rejection today. Catching converts it into a signal and
      // keeps it off the global handler. Writes stay enabled — a transient
      // write failure (e.g. NSFileWriteOutOfSpaceError 640) is not a reason
      // to stop trying, and it cannot destroy already-stored data.
      //
      // The user-facing half (GitHub #398) lives on the SHARED surface, not
      // here: `notifyStorageWriteFailure` owns both the classification and a
      // once-per-SESSION latch, so a full volume failing all 17 stores at the
      // same moment still produces exactly one notice. The per-store latch
      // below stays per-store, because Sentry wants to know which stores
      // lost writes.
      const kind = notifyStorageWriteFailure(error);
      if (!reportedWriteFailure) {
        reportedWriteFailure = true;
        Sentry.captureMessage('persist-write-failed', {
          level: 'warning',
          tags: {scope: 'persist', store: storeName, writeErrorKind: kind},
          extra: {key: name, error: describeError(error)},
          fingerprint: ['persist-write-failed'],
        });
      }
    }
  };

  /**
   * Replay whatever was held while the read was in flight.
   *
   * Called synchronously from the resolve path so the replay is queued on the
   * native storage BEFORE any later write, which keeps the last write the
   * winner. Deliberately not awaited: hydration must not wait on a write.
   */
  const flushDeferredWrite = (storedValue: string | null): void => {
    const pending = deferredWrite;
    deferredWrite = undefined;
    if (!pending) return;

    const replayValue = mergeDeferredWrite(pending.value, storedValue);
    if (replayValue === null) return;
    // `writeThrough` handles its own failures and never rejects.
    writeThrough(pending.name, replayValue);
  };

  return {
    getItem: async (name: string) => {
      try {
        const value = await base.getItem(name);
        // Resolving is the success signal, whatever the value.
        readState = 'ok';
        flushDeferredWrite(value ?? null);
        return value ?? null;
      } catch (error) {
        readState = 'failed';
        // Never replay after a failed read: the held snapshot is the store's
        // DEFAULTS, and writing it is exactly the #329 loss.
        deferredWrite = undefined;
        if (!reportedReadFailure) {
          reportedReadFailure = true;
          Sentry.captureMessage('persist-read-failed', {
            level: 'warning',
            tags: {scope: 'persist', store: storeName},
            extra: {key: name, error: describeError(error)},
            // Group by message so this is its own triageable issue rather than
            // collapsing into whatever call-site Sentry infers.
            fingerprint: ['persist-read-failed'],
          });
        }
        // Re-throw so zustand's hydrate() takes its failure branch and
        // `persist.hasHydrated()` stays false. Swallowing here would make the
        // store claim it hydrated from empty storage — the exact lie that makes
        // the loss silent.
        throw error;
      }
    },

    setItem: async (name: string, value: string) => {
      if (readState === 'pending') {
        // The hydrating read has not come back yet. Hold the write; the resolve
        // path replays it. No Sentry event — an in-flight read is not a failure,
        // and this fires on every boot for two stores (GitHub #457).
        deferredWrite = {name, value};
        deferredWrites += 1;
        if (!reportedDeferral) {
          reportedDeferral = true;
          Sentry.addBreadcrumb({
            category: 'persist',
            message: `write deferred until the hydrating read resolves (${storeName})`,
            level: 'info',
          });
        }
        if (__DEV__) {
          console.warn(
            `[persist] "${storeName}": deferring a write until the hydrating ` +
              `read resolves (deferred ${deferredWrites}). See GitHub #457.`,
          );
        }
        return;
      }

      if (readState === 'failed') {
        suppressedWrites += 1;
        if (!reportedSuppression) {
          reportedSuppression = true;
          Sentry.addBreadcrumb({
            category: 'persist',
            message: `write suppressed before a successful read (${storeName})`,
            level: 'warning',
          });
          Sentry.captureMessage('persist-write-suppressed', {
            level: 'warning',
            tags: {scope: 'persist', store: storeName},
            extra: {key: name},
            fingerprint: ['persist-write-suppressed'],
          });
        }
        if (__DEV__) {
          console.warn(
            `[persist] "${storeName}": refusing to write before a successful read ` +
              `(the hydrating read FAILED; suppressed ${suppressedWrites}). ` +
              `Writing now would overwrite the user's stored data with defaults. ` +
              `See GitHub #329.`,
          );
        }
        return;
      }

      await writeThrough(name, value);
    },

    // Not guarded: removeItem only runs from an explicit `persist.clearStorage()`
    // — a deliberate act, not a side effect of a failed read. It does drop any
    // deferred write, so a clear cannot be undone by a replay landing after it.
    removeItem: (name: string) => {
      deferredWrite = undefined;
      return base.removeItem(name);
    },
  };
}

/**
 * Drop-in replacement for `createJSONStorage(() => AsyncStorage)` that refuses
 * to persist while a read is in flight or after one has failed.
 *
 * Identical JSON semantics to `createJSONStorage` (same parse/stringify, same
 * `null` handling) — the only behavioural difference is the write guard.
 */
export function guardedJSONStorage<S>(
  storeName: string,
  base: RawStorage = AsyncStorage,
) {
  const guarded = createHydrationGuardedStateStorage(storeName, base);
  return createJSONStorage<S>(() => guarded);
}
