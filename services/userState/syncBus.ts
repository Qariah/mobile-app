/**
 * Module-level glue between the player stores (which mutate synchronously) and
 * the user-state SQLite queue (which is async). Player code calls the
 * `enqueue*Sync()` helpers fire-and-forget; this module:
 *
 *   1. Checks an in-memory auth snapshot — no async auth check on the hot path.
 *      AuthContext pushes the snapshot via setAuthSnapshot() on status changes.
 *   2. If unauthenticated → no-op (upstream-equivalent behavior).
 *   3. If userState DB isn't ready yet → buffers in memory and drains on init.
 *   4. Otherwise enqueues directly into sync_queue + schedules a flush.
 *
 * Why a snapshot vs querying useAuth(): player stores live outside React and
 * mutate from non-React paths (e.g. expo-audio callbacks). A pulled snapshot
 * keeps the side-effect synchronous and dependency-free for callers.
 *
 * Why a buffer vs requiring init-before-use: the favorites store can be
 * mutated during app boot — before initUserStateDb() has finished. The buffer
 * is small, in-memory, never persisted; if init fails, the writes are lost
 * (acceptable given the alternative is a startup deadlock).
 *
 * Sprint 4 (S4.2 / S4.3).
 */

import {
  enqueueWrite,
  coalescePreferenceWrite,
  upsertCachedPreference,
  upsertCachedReadingSession,
  type EnqueueInput,
} from './db';

type AuthSnapshot = 'authenticated' | 'unauthenticated' | 'loading';

let authSnapshot: AuthSnapshot = 'loading';
let dbReady = false;

const pendingBuffer: EnqueueInput[] = [];
/** Bound on the buffer to protect against pathological mutation loops. */
const PENDING_BUFFER_LIMIT = 200;

let flushScheduler: ((reason: string) => void) | null = null;

export function setAuthSnapshot(status: AuthSnapshot): void {
  authSnapshot = status;
  if (status === 'authenticated' && dbReady) {
    flushScheduler?.('auth-changed');
  }
}

export function getAuthSnapshot(): AuthSnapshot {
  return authSnapshot;
}

/**
 * Called by initUserStateDb's owner (UserStateContext) once the DB is open.
 * Drains any buffered writes that happened while DB was initializing.
 */
export async function notifyDbReady(): Promise<void> {
  dbReady = true;
  if (pendingBuffer.length === 0) return;
  const drain = pendingBuffer.splice(0, pendingBuffer.length);
  for (const op of drain) {
    try {
      await enqueueWrite(op);
    } catch (e) {
      // If even the drain fails, log but don't throw — UI is already past boot.
      if (__DEV__) console.warn('[userState/syncBus] drain enqueue failed:', e);
    }
  }
  flushScheduler?.('db-ready-drain');
}

export function registerFlushScheduler(
  scheduler: (reason: string) => void,
): void {
  flushScheduler = scheduler;
}

// ──────────────────────── Public side-effect helpers ────────────────────────

/**
 * Call after a successful local favorite-reciters mutation. Enqueues a
 * preference write for `qariah:favoriteReciterIds` containing the full list.
 *
 * Coalesces: rapid toggles within the same flush window collapse to one POST.
 */
export function enqueueFavoritesSync(reciterIds: string[]): void {
  if (authSnapshot !== 'authenticated') return;
  const key = 'qariah:favoriteReciterIds';
  const value = JSON.stringify(reciterIds);
  const op: EnqueueInput = {
    resource: 'preference',
    operation: 'update',
    payload: {key, value},
  };
  // Update local cache mirror eagerly so on-mount reads after sign-out/in see
  // the right value. This is a fire-and-forget — the DB call is fast.
  if (dbReady) {
    upsertCachedPreference(key, value).catch(() => {});
    coalescePreferenceWrite(key)
      .then(() => enqueueWrite(op))
      .then(() => flushScheduler?.('favorites-changed'))
      .catch(e => {
        if (__DEV__)
          console.warn('[userState/syncBus] favorites enqueue failed:', e);
      });
  } else {
    bufferOrDrop(op);
  }
}

/**
 * Call after a meaningful playback event (track change, app backgrounding).
 * Enqueues a reading_session create.
 */
export function enqueueReadingSessionSync(payload: {
  reciterId: string;
  surahNumber: number;
  ayahNumber?: number;
  timestamp?: string;
}): void {
  if (authSnapshot !== 'authenticated') return;
  const op: EnqueueInput = {
    resource: 'reading_session',
    operation: 'create',
    payload,
  };
  if (dbReady) {
    // Mirror locally so first-load reads see it before the network roundtrip.
    upsertCachedReadingSession({
      id: 'pending', // overwritten by syncQueue with QF id on success
      reciterId: payload.reciterId,
      surahNumber: payload.surahNumber,
      ayahNumber: payload.ayahNumber ?? 1,
      updatedAt: Date.now(),
    }).catch(() => {});
    enqueueWrite(op)
      .then(() => flushScheduler?.('reading-session-changed'))
      .catch(e => {
        if (__DEV__)
          console.warn(
            '[userState/syncBus] reading_session enqueue failed:',
            e,
          );
      });
  } else {
    bufferOrDrop(op);
  }
}

/**
 * Call after a Qariah-namespaced preference mutation (defaultReciter, theme,
 * defaultRewayah). The favorites helper above is a specialized form of this.
 */
export function enqueuePreferenceSync(key: string, value: unknown): void {
  if (authSnapshot !== 'authenticated') return;
  const stringValue =
    typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const op: EnqueueInput = {
    resource: 'preference',
    operation: 'update',
    payload: {key, value: stringValue},
  };
  if (dbReady) {
    upsertCachedPreference(key, stringValue).catch(() => {});
    coalescePreferenceWrite(key)
      .then(() => enqueueWrite(op))
      .then(() => flushScheduler?.('preference-changed'))
      .catch(e => {
        if (__DEV__)
          console.warn('[userState/syncBus] preference enqueue failed:', e);
      });
  } else {
    bufferOrDrop(op);
  }
}

function bufferOrDrop(op: EnqueueInput): void {
  if (pendingBuffer.length >= PENDING_BUFFER_LIMIT) {
    if (__DEV__)
      console.warn(
        '[userState/syncBus] pending buffer full — dropping oldest write',
      );
    pendingBuffer.shift();
  }
  pendingBuffer.push(op);
}

/**
 * Test-only — exposes buffer length for verification.
 * @internal
 */
export function _getPendingBufferDepth(): number {
  return pendingBuffer.length;
}
