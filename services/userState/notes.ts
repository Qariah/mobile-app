/**
 * QF user-data API — Notes resource (Sprint 18 / Slice B).
 *
 * SDK-backed (`@quranjs/api/public`) — mirrors the Sprint-17-rewritten
 * `services/userState/bookmarks.ts` shape, including the `withQfCall`
 * 401-retry wrapper from `qfErrors.ts`.
 *
 * Endpoints (auth service):
 *   GET    /auth/v1/notes                       — list all user notes
 *   POST   /auth/v1/notes                       — {body, ranges, attachedEntities?}
 *   GET    /auth/v1/notes/{noteId}              — single note
 *   PATCH  /auth/v1/notes/{noteId}              — update body / ranges
 *   DELETE /auth/v1/notes/{noteId}              — remove note (and any post)
 *   POST   /auth/v1/notes/{noteId}/publish      — returns {success, postId}
 *   GET    /auth/v1/notes/by-verse/{verseKey}   — narrow list to an ayah
 *
 * Unpublish lives on the quranReflect service, NOT the auth service —
 * there is no `/auth/v1/notes/{id}/unpublish`. Verified 2026-05-17 against
 * the `@quranjs/api` operation catalog. Unpublishing a note = deleting the
 * QuranReflect Post that the publish call returned:
 *   DELETE /v1/posts/{postId}                   — on the quranReflect service
 *
 * The QF Note resource shape is `{id, body, ranges, attachedEntities,
 * source, createdAt, updatedAt}` — no anonymous / visibility / displayName
 * field. Verified against the public docs + SDK type defs 2026-05-17;
 * anonymous-publish is not supported by QF.
 *
 * State machine:
 *   pure-local       — qfNoteId null, qfPostId null   (signed-out user)
 *   QF-private       — qfNoteId set,  qfPostId null
 *   Reflection       — qfNoteId set,  qfPostId set    (visible on QuranReflect)
 */

import {getQfSdk} from '@/services/auth/sdkClient';
import {withQfCall} from './qfErrors';

export interface QfNote {
  id: string;
  body: string;
  /** QF wire form: `["S:V-S:V"]`. Single-ayah notes pass `["S:V-S:V"]` with start === end. */
  ranges: string[];
  attachedEntities?: Array<{
    entityId?: string;
    entityType?: string;
    entityMetadata?: Record<string, unknown>;
  }>;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface QfNotesListResponse {
  notes?: QfNote[];
  data?: QfNote[];
}

function unwrapList(res: unknown): QfNote[] {
  if (Array.isArray(res)) return res as QfNote[];
  if (res && typeof res === 'object') {
    const r = res as QfNotesListResponse;
    return r.notes ?? r.data ?? [];
  }
  return [];
}

interface QfNoteSingleResponse {
  note?: QfNote;
  data?: QfNote;
}

// Sprint 21 round-5 — QF's single-object endpoints (`POST /notes`,
// `PATCH /notes/:id`, `GET /notes/:id`) sometimes wrap the payload in
// `{note: ...}` or `{data: ...}` depending on the API version. The bare
// cast pattern from earlier sprints `return res as QfNote` was returning
// `{note: {...}}` as if it were a flat QfNote, so callers reading
// `qf.id` got `undefined` → downstream calls like `publishNote(qf.id)`
// threw "Missing path parameter: noteId" → the catch swallowed the
// throw → `patchNoteQfIds` never fired → local `qf_post_id` stayed
// null → published reflections showed up in the Personal Notes
// collection instead of Reflections. Defensive unwrap is now the
// shared shape for every single-object endpoint.
function unwrapNote(res: unknown): QfNote {
  if (res && typeof res === 'object') {
    const r = res as QfNoteSingleResponse;
    if (r.note) return r.note;
    if (r.data) return r.data;
  }
  return res as QfNote;
}

/** Build a single-ayah QF range string from a verse key (e.g. `"2:255" → "2:255-2:255"`). */
export function verseKeyToRange(verseKey: string): string {
  return `${verseKey}-${verseKey}`;
}

/** Build a multi-verse QF range string from a verseKeys array. Falls back to single. */
export function verseKeysToRange(verseKeys: string[]): string {
  if (verseKeys.length === 0) {
    throw new Error('verseKeysToRange: at least one verse key required');
  }
  if (verseKeys.length === 1) return verseKeyToRange(verseKeys[0]);
  return `${verseKeys[0]}-${verseKeys[verseKeys.length - 1]}`;
}

export async function listNotes(): Promise<QfNote[]> {
  return withQfCall('/notes', async () => {
    const res = await getQfSdk().auth.v1.notes.list();
    return unwrapList(res);
  });
}

export async function listNotesByVerseKey(verseKey: string): Promise<QfNote[]> {
  return withQfCall(`/notes/by-verse/${verseKey}`, async () => {
    const res = await getQfSdk().auth.v1.notes.listByVerseKey(verseKey);
    return unwrapList(res);
  });
}

export async function getNote(noteId: string): Promise<QfNote | null> {
  return withQfCall(`/notes/${noteId}`, async () => {
    const res = await getQfSdk().auth.v1.notes.get(noteId);
    if (!res) return null;
    return unwrapNote(res);
  });
}

export async function createNote(input: {
  body: string;
  ranges: string[];
  attachedEntities?: QfNote['attachedEntities'];
  source?: string;
}): Promise<QfNote> {
  return withQfCall('/notes', async () => {
    // QF accepts snake_case OR camelCase on POST bodies; the SDK passes the
    // payload through verbatim. Using camelCase matches the SDK's response
    // shape, so round-trips don't surprise callers.
    const res = await getQfSdk().auth.v1.notes.create({
      body: input.body,
      ranges: input.ranges,
      ...(input.attachedEntities
        ? {attachedEntities: input.attachedEntities}
        : {}),
      ...(input.source ? {source: input.source} : {}),
    });
    return unwrapNote(res);
  });
}

export async function updateNote(
  noteId: string,
  patch: {body?: string; ranges?: string[]},
): Promise<QfNote> {
  return withQfCall(`/notes/${noteId}`, async () => {
    const res = await getQfSdk().auth.v1.notes.update(noteId, patch);
    return unwrapNote(res);
  });
}

export async function deleteNote(noteId: string): Promise<void> {
  await withQfCall(`/notes/${noteId}`, async () => {
    await getQfSdk().auth.v1.notes.remove(noteId);
  });
}

interface PublishNoteResponse {
  success?: boolean;
  postId?: string | number;
  data?: {success?: boolean; postId?: string | number};
}

export async function publishNote(
  noteId: string,
  noteBody: string,
): Promise<string> {
  return withQfCall(`/notes/${noteId}/publish`, async () => {
    // Sprint 21 round-5.3 — the publish action requires the note's body
    // text in the request payload (the QR Post is built from this).
    // Empirically determined via raw-fetch probe 2026-05-21 06:33: QF
    // prelive returned 422 ValidationError with `"body" is required` when
    // we sent `{anonymous: false}` only. Adding `body` resolves it.
    // The body lives in the Note resource itself (which we just created
    // 1 round-trip earlier), but QF requires it in the publish payload
    // separately — likely because the publish action can override the
    // Note body for the publicly-visible Post (edit-on-publish UX).
    const res = (await getQfSdk().auth.v1.notes.publish(noteId, {
      body: noteBody,
    } as never)) as PublishNoteResponse;
    const postId = res?.postId ?? res?.data?.postId;
    if (postId === undefined || postId === null) {
      throw new Error(
        'publishNote: QF response missing postId — cannot record local qfPostId',
      );
    }
    return String(postId);
  });
}

/**
 * Unpublish a note by deleting its QuranReflect Post.
 *
 * Calls the quranReflect service (NOT auth). There is no
 * `/auth/v1/notes/{id}/unpublish` endpoint — the only way to retract a
 * published note is to delete the Post it generated. The Note row itself
 * stays on the user's account; only the public Post goes away.
 *
 * SDK shape: `quranReflect.v1.posts` is string-indexed
 * (`[x: string]: (request?: OperationRequest) => Promise<unknown>`) because
 * the SDK auto-generates these from the OpenAPI spec. The HTTP method
 * `delete` is aliased to `remove` (see SDK's `HTTP_METHOD_TO_MUTATION_NAME`).
 */
export async function unpublishNote(postId: string): Promise<void> {
  await withQfCall(`/v1/posts/${postId}`, async () => {
    await getQfSdk().quranReflect.v1.posts.remove({
      path: {id: postId},
    });
  });
}
