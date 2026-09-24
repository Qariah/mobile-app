/**
 * Offline write queue runner — drains sync_queue rows into the QF user-data API.
 *
 * Invariants:
 *   - One in-flight flush at a time (per-process mutex).
 *   - Per-row retry with exponential backoff: 200ms → 800ms → 3200ms.
 *   - 3 attempts max; row stays in DB with attempts=3 for diagnostics, skipped
 *     by future flushes via `attempts < 3` predicate in dequeueWrites.
 *   - On QfAuthRequiredError: pause draining; row's attempts NOT incremented
 *     (preserves intent until auth restored).
 *   - On non-retryable error (4xx other than 401/408/429): mark attempts = 3
 *     in one shot — no point retrying a 400.
 *
 * Triggered by:
 *   - App foreground transition (UserStateContext)
 *   - Auth status change to 'authenticated' (via syncBus.setAuthSnapshot)
 *   - Connectivity restore (NetInfo) — wired at S4.3 in UserStateContext
 *   - Each enqueueWrite via syncBus.flushScheduler hook
 *
 * Sprint 4 (S4.2).
 */

import {
  dequeueWrites,
  markWriteComplete,
  markWriteFailed,
  type SyncQueueRow,
} from './db';
import {setPreference} from './preferences';
import {upsertReadingSession} from './readingSessions';
import {addBookmark, deleteBookmark} from './bookmarks';
import {createCollection, deleteCollection} from './collections';
import {QfApiError, QfAuthRequiredError, isQfErrorRetryable} from './qfErrors';

const RETRY_DELAYS_MS = [200, 800, 3200];

let inFlight: Promise<FlushResult> | null = null;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
let lastScheduleAt = 0;
const SCHEDULE_DEBOUNCE_MS = 2000;

export interface FlushResult {
  attempted: number;
  succeeded: number;
  retryable: number;
  permanent: number;
  authPaused: boolean;
}

/**
 * Schedules a debounced flush. Multiple callers in the same 2s window collapse
 * to a single network roundtrip — important when a burst of favorites toggles
 * each fires its own enqueue.
 */
export function scheduleSyncFlush(reason: string = 'manual'): void {
  const now = Date.now();
  // If a flush is already in-flight, don't pile on; the next post-flush
  // schedule (from syncBus.flushScheduler) will catch the new writes.
  if (inFlight) return;
  // Debounce: if we just scheduled within the window, the existing timer is
  // already pending — ignore.
  if (scheduledTimer && now - lastScheduleAt < SCHEDULE_DEBOUNCE_MS) return;
  lastScheduleAt = now;
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    flushSyncQueue(reason).catch(e => {
      if (__DEV__)
        console.warn('[userState/syncQueue] scheduled flush threw:', e);
    });
  }, SCHEDULE_DEBOUNCE_MS);
}

/**
 * Drains the queue. Returns a summary; never throws (errors per-row are
 * logged + recorded in sync_queue.last_error).
 */
export async function flushSyncQueue(
  reason: string = 'manual',
): Promise<FlushResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (__DEV__) console.log(`[userState/syncQueue] flush start (${reason})`);
    let result: FlushResult = {
      attempted: 0,
      succeeded: 0,
      retryable: 0,
      permanent: 0,
      authPaused: false,
    };
    try {
      const rows = await dequeueWrites(50);
      for (const row of rows) {
        result.attempted += 1;
        const outcome = await dispatchOne(row);
        if (outcome === 'success') result.succeeded += 1;
        else if (outcome === 'retryable') result.retryable += 1;
        else if (outcome === 'permanent') result.permanent += 1;
        else if (outcome === 'auth-paused') {
          result.authPaused = true;
          break; // stop draining; resume on next setAuthSnapshot('authenticated')
        }
      }
    } finally {
      if (__DEV__)
        console.log(
          `[userState/syncQueue] flush done — attempted=${result.attempted} succeeded=${result.succeeded} retryable=${result.retryable} permanent=${result.permanent} authPaused=${result.authPaused}`,
        );
    }
    return result;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

type DispatchOutcome = 'success' | 'retryable' | 'permanent' | 'auth-paused';

async function dispatchOne(row: SyncQueueRow): Promise<DispatchOutcome> {
  // Apply per-attempt backoff before retrying. Attempts=0 means first try → no
  // delay. Attempts=1 means we've failed once → wait 200ms. Etc.
  const delayIdx = row.attempts;
  if (delayIdx > 0 && delayIdx <= RETRY_DELAYS_MS.length) {
    await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[delayIdx - 1]));
  }

  try {
    await dispatchByResource(row);
    await markWriteComplete(row.id);
    return 'success';
  } catch (e) {
    if (e instanceof QfAuthRequiredError) {
      // Don't increment attempts — preserve the write for when auth resumes.
      return 'auth-paused';
    }
    const msg = e instanceof Error ? e.message : 'unknown error';
    if (e instanceof QfApiError && !isQfErrorRetryable(e)) {
      // Permanent failure — bump attempts to 3 in one shot so future flushes
      // skip the row but keep it for diagnostics.
      await markWriteFailed(row.id, msg);
      await markWriteFailed(row.id, msg);
      await markWriteFailed(row.id, msg);
      return 'permanent';
    }
    await markWriteFailed(row.id, msg);
    return 'retryable';
  }
}

interface PreferencePayload {
  key: string;
  value: string;
}
interface ReadingSessionPayload {
  reciterId: string;
  surahNumber: number;
  ayahNumber?: number;
  timestamp?: string;
}
interface BookmarkCreatePayload {
  collectionId: string;
  verseKey: string;
}
interface BookmarkDeletePayload {
  collectionId: string;
  bookmarkId: string;
}
interface CollectionCreatePayload {
  name: string;
}
interface CollectionDeletePayload {
  collectionId: string;
}

async function dispatchByResource(row: SyncQueueRow): Promise<void> {
  const payload = JSON.parse(row.payload);
  switch (row.resource) {
    case 'preference': {
      const p = payload as PreferencePayload;
      await setPreference(p.key, p.value);
      return;
    }
    case 'reading_session': {
      const p = payload as ReadingSessionPayload;
      await upsertReadingSession({
        reciterId: p.reciterId,
        surahNumber: p.surahNumber,
        ayahNumber: p.ayahNumber,
        timestamp: p.timestamp,
      });
      return;
    }
    case 'bookmark': {
      if (row.operation === 'create') {
        const p = payload as BookmarkCreatePayload;
        await addBookmark(p.collectionId, p.verseKey);
        return;
      }
      if (row.operation === 'delete') {
        const p = payload as BookmarkDeletePayload;
        // Sprint 17 (S17.2): QF's bookmark-delete route is
        // /collections/{collectionId}/bookmarks/{bookmarkId} (the SDK only
        // exposes this nested form, matching QF's actual surface). Old
        // queued rows lacking `collectionId` are unreachable — bookmark UI
        // hadn't shipped yet at the time of the migration, so no real-user
        // queues contain such rows.
        if (!p.collectionId || !p.bookmarkId) {
          throw new Error(
            `bookmark delete payload missing collectionId or bookmarkId`,
          );
        }
        await deleteBookmark(p.collectionId, p.bookmarkId);
        return;
      }
      throw new Error(`unsupported bookmark operation: ${row.operation}`);
    }
    case 'collection': {
      if (row.operation === 'create') {
        const p = payload as CollectionCreatePayload;
        await createCollection(p.name);
        return;
      }
      if (row.operation === 'delete') {
        const p = payload as CollectionDeletePayload;
        await deleteCollection(p.collectionId);
        return;
      }
      throw new Error(`unsupported collection operation: ${row.operation}`);
    }
    default:
      throw new Error(`unsupported sync resource: ${String(row.resource)}`);
  }
}
