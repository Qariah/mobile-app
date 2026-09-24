/**
 * Public API for services/userState.
 *
 * App code should import from '@/services/userState' rather than reaching into
 * individual modules. The granular files (db, syncQueue, qfErrors, etc.) are
 * implementation detail.
 *
 * Sprint 4 (original); Sprint 17 S17.2 — qfApiClient retired in favour of
 * @quranjs/api/public; replaced by qfErrors for typed error classification.
 */

export {UserStateProvider, useUserState} from './UserStateContext';

export {
  enqueueFavoritesSync,
  enqueueReadingSessionSync,
  enqueuePreferenceSync,
} from './syncBus';

export {flushSyncQueue, scheduleSyncFlush} from './syncQueue';

export {QARIAH_PREF_KEYS} from './preferences';
export type {QariahPrefKey} from './preferences';

// QF resource types — exported for downstream consumers (settings UI, etc.)
export type {QfCollection} from './collections';
export type {QfBookmark} from './bookmarks';
export type {QfReadingSession} from './readingSessions';
export type {QfPreference} from './preferences';

// Cache row types — exported for hooks that read from the local mirror.
export type {
  CachedPreference,
  CachedReadingSession,
  CachedBookmark,
} from './db';

// Errors — callers may want to discriminate auth-required vs other failures.
// Sprint 17 (S17.2) — moved from qfApiClient.ts → qfErrors.ts; hand-rolled
// HTTP wrapper retired in favour of @quranjs/api/public.
export {QfApiError, QfAuthRequiredError} from './qfErrors';
