/**
 * QF user-data API — Collections resource.
 *
 * Collections are named buckets of bookmarks. The default collection is
 * accessible at the well-known id `__default__`. Sprint 4 wires only the
 * read paths; the create/delete + bookmark CRUD are scaffolded for v2.x
 * named-bookmark-list work.
 *
 * Endpoints (relative to {apiBase}/auth/v1, composed by the SDK):
 *   GET    /collections
 *   GET    /collections/__default__
 *   POST   /collections          {name}
 *   DELETE /collections/{id}
 *
 * Sprint 4 (S4.1) — original hand-rolled client.
 * Sprint 17 (S17.2) — migrated onto `@quranjs/api/public` via the singleton
 * SDK client. Response keys are auto-camelized by the SDK (humps).
 */

import {getQfSdk} from '@/services/auth/sdkClient';
import {withQfCall, QfApiError} from './qfErrors';

export interface QfCollection {
  id: string;
  name: string;
  /** Optional — present on detail responses. */
  bookmarksCount?: number;
  /** ISO-8601 timestamp; raw passthrough from QF. */
  createdAt?: string;
  /** ISO-8601 timestamp; raw passthrough from QF. */
  updatedAt?: string;
}

/** QF returns either `{collections: [...]}`, `{data: [...]}`, or a bare array. */
interface QfCollectionsListResponse {
  collections?: QfCollection[];
  data?: QfCollection[];
}

function unwrapList(res: unknown): QfCollection[] {
  if (Array.isArray(res)) return res as QfCollection[];
  if (res && typeof res === 'object') {
    const r = res as QfCollectionsListResponse;
    return r.collections ?? r.data ?? [];
  }
  return [];
}

export async function getUserCollections(): Promise<QfCollection[]> {
  return withQfCall('/collections', async () => {
    const res = await getQfSdk().auth.collections.list();
    return unwrapList(res);
  });
}

export async function getDefaultCollection(): Promise<QfCollection | null> {
  try {
    return await withQfCall('/collections/__default__', async () => {
      const res = await getQfSdk().auth.collections.get('__default__');
      return res as QfCollection;
    });
  } catch (e) {
    // 404 = no default exists yet; QF auto-creates on first bookmark write.
    if (e instanceof QfApiError && e.status === 404) {
      return null;
    }
    throw e;
  }
}

export async function createCollection(name: string): Promise<QfCollection> {
  return withQfCall('/collections', async () => {
    const res = await getQfSdk().auth.collections.create({name});
    return res as QfCollection;
  });
}

export async function deleteCollection(collectionId: string): Promise<void> {
  await withQfCall(`/collections/${collectionId}`, async () => {
    await getQfSdk().auth.collections.remove(collectionId);
  });
}
