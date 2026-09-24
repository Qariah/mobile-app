/**
 * QF user-data API — Reading Sessions resource.
 *
 * QF's `reading_session` is the canonical "where the user left off" record.
 * Qariah maps "last-played track" onto a reading session: reciter slug + surah
 * number + ayah number (default 1) + ISO timestamp.
 *
 * Endpoints (relative to {apiBase}/auth/v1, composed by the SDK):
 *   GET  /reading-sessions
 *   POST /reading-sessions       {reciter_id, surah_number, ayah_number, timestamp}
 *
 * Sprint 4 (S4.1) — original hand-rolled client. The pre-S17.2 module
 * additionally exposed a PUT `/reading-sessions/{id}` path that the SDK
 * doesn't surface; QF's actual API doesn't have a per-id update (each POST
 * creates a fresh session, and the list is sorted by timestamp). Existing
 * call sites passed `existingId` to no real effect — collapsed here to a
 * single create path.
 * Sprint 17 (S17.2) — migrated onto `@quranjs/api/public`. SDK auto-camelizes
 * responses, so the snake → camel `fromRaw` shim from the original module
 * is dropped.
 */

import {getQfSdk} from '@/services/auth/sdkClient';
import {withQfCall} from './qfErrors';

export interface QfReadingSession {
  id: string;
  /** Qariah reciter slug, written as the QF `reciter_id` field. */
  reciterId: string;
  surahNumber: number;
  ayahNumber: number;
  /** ISO-8601 timestamp from QF. */
  timestamp: string;
}

export interface ReadingSessionPayload {
  reciterId: string;
  surahNumber: number;
  /** Defaults to 1 when caller doesn't track ayah-level position. */
  ayahNumber?: number;
  /** Defaults to Date.now() in ISO format. */
  timestamp?: string;
}

interface QfReadingSessionsListResponse {
  readingSessions?: QfReadingSession[];
  data?: QfReadingSession[];
}

function unwrapList(res: unknown): QfReadingSession[] {
  if (Array.isArray(res)) return res as QfReadingSession[];
  if (res && typeof res === 'object') {
    const r = res as QfReadingSessionsListResponse;
    return r.readingSessions ?? r.data ?? [];
  }
  return [];
}

function toRawBody(p: ReadingSessionPayload): Record<string, unknown> {
  return {
    reciter_id: p.reciterId,
    surah_number: p.surahNumber,
    ayah_number: p.ayahNumber ?? 1,
    timestamp: p.timestamp ?? new Date().toISOString(),
  };
}

export async function getLatestReadingSession(): Promise<QfReadingSession | null> {
  return withQfCall('/reading-sessions', async () => {
    const res = await getQfSdk().auth.readingSessions.list();
    const list = unwrapList(res);
    if (list.length === 0) return null;
    // QF list endpoint is "most recent first"; defensive max-by-timestamp.
    const sorted = [...list].sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : -1,
    );
    return sorted[0];
  });
}

/**
 * Creates a new reading session. QF treats reading sessions as append-only —
 * each call lands a fresh row, and `getLatestReadingSession` returns the
 * top-by-timestamp. The pre-S17.2 `existingId` PUT path is collapsed away;
 * the SDK doesn't surface it and QF's docs don't promise an update verb.
 */
export async function upsertReadingSession(
  payload: ReadingSessionPayload,
  // existingId kept in the signature for back-compat with syncQueue dispatch,
  // but ignored — see file header note.
  _existingId?: string,
): Promise<QfReadingSession> {
  void _existingId;
  return withQfCall('/reading-sessions', async () => {
    const body = toRawBody(payload);
    const res = await getQfSdk().auth.readingSessions.create(body);
    return res as QfReadingSession;
  });
}
