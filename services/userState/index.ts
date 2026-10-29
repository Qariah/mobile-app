/**
 * Public API for services/userState.
 *
 * App code should import from '@/services/userState' rather than reaching into
 * individual modules. The granular files (db, syncQueue, qfErrors, etc.) are
 * implementation detail.
 *
 * Sprint 4 (original); Sprint 17 S17.2 — qfApiClient retired in favour of
 * @quranjs/api/public; replaced by qfErrors for typed error classification.
 * Divergence batch C3 (SEM-S1, 2026-10-24) — the exports that no code
 * imported (the cache row types, the QF resource types, the preference keys,
 * `enqueuePreferenceSync`) were removed. The player stores no longer import
 * the push helpers (PLY-S8, `playerStoreSync.ts`).
 */

export {UserStateProvider, useUserState} from './UserStateContext';

export {flushSyncQueue, scheduleSyncFlush} from './syncQueue';

// Errors — callers may want to discriminate auth-required vs other failures.
// Sprint 17 (S17.2) — moved from qfApiClient.ts → qfErrors.ts; hand-rolled
// HTTP wrapper retired in favour of @quranjs/api/public.
export {QfApiError, QfAuthRequiredError} from './qfErrors';
