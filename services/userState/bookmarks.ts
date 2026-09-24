/**
 * QF user-data API — Bookmarks resource.
 *
 * Bookmarks live inside collections. Sprint 4 only scaffolds — v2.x backlog
 * wires the verse-bookmark UI through these calls.
 *
 * Endpoints (relative to {apiBase}/auth/v1, composed by the SDK):
 *   GET    /collections/{collectionId}/bookmarks
 *   POST   /collections/{collectionId}/bookmarks   {verse_key}
 *   DELETE /collections/{collectionId}/bookmarks/{bookmarkId}
 *
 * Sprint 4 (S4.1) — original hand-rolled client.
 * Sprint 17 (S17.2) — migrated onto `@quranjs/api/public`. The SDK's
 * `collections.removeBookmark` takes (collectionId, bookmarkId); the pre-
 * S17.2 helper assumed a bare `/bookmarks/{id}` route which the actual QF
 * surface does not expose. Sync-queue payload now includes both ids.
 */

import {getQfSdk} from '@/services/auth/sdkClient';
import {withQfCall} from './qfErrors';

export interface QfBookmark {
  id: string;
  collectionId: string;
  /** "{surahNumber}:{ayahNumber}", e.g. "2:255". */
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  /** ISO-8601 timestamp; raw passthrough from QF. */
  createdAt?: string;
}

interface QfBookmarksListResponse {
  bookmarks?: QfBookmark[];
  data?: QfBookmark[];
}

function unwrapList(res: unknown): QfBookmark[] {
  if (Array.isArray(res)) return res as QfBookmark[];
  if (res && typeof res === 'object') {
    const r = res as QfBookmarksListResponse;
    return r.bookmarks ?? r.data ?? [];
  }
  return [];
}

export async function getBookmarks(
  collectionId: string,
): Promise<QfBookmark[]> {
  // The SDK has both `auth.collections.get(id, query)` (which can include
  // bookmarks inline depending on query) and `auth.bookmarks.list(query)`.
  // For Qariah's "list bookmarks in a specific collection" need, we ask QF
  // for the collection detail with `bookmarks=true`. If QF's response shape
  // ever shifts, the unwrap heuristic above will still cope.
  return withQfCall(`/collections/${collectionId}/bookmarks`, async () => {
    const res = await getQfSdk().auth.collections.get(collectionId, {
      bookmarks: true,
    });
    // Detail responses embed bookmarks under .bookmarks (after camelize).
    if (res && typeof res === 'object' && 'bookmarks' in res) {
      const b = (res as {bookmarks?: QfBookmark[]}).bookmarks;
      if (Array.isArray(b)) return b;
    }
    return unwrapList(res);
  });
}

export async function addBookmark(
  collectionId: string,
  verseKey: string,
): Promise<QfBookmark> {
  return withQfCall(`/collections/${collectionId}/bookmarks`, async () => {
    // QF still expects snake_case on the wire; SDK passes the body through
    // unchanged (decamelize is only applied to query params, not bodies).
    const res = await getQfSdk().auth.collections.addBookmark(collectionId, {
      verse_key: verseKey,
    });
    return res as QfBookmark;
  });
}

export async function deleteBookmark(
  collectionId: string,
  bookmarkId: string,
): Promise<void> {
  await withQfCall(
    `/collections/${collectionId}/bookmarks/${bookmarkId}`,
    async () => {
      await getQfSdk().auth.collections.removeBookmark(
        collectionId,
        bookmarkId,
      );
    },
  );
}
