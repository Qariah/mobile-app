/**
 * Sprint 18 / Slice B — orchestration between local notes (SQLite via
 * `VerseAnnotationDatabaseService`) and QF Notes (via `notes.ts` SDK
 * wrapper).
 *
 * `notes.ts` is the thin SDK adapter; `notesSync.ts` is the
 * local-DB-aware glue that decides whether to push to QF based on
 * auth state and patches the local row with returned QF ids.
 *
 * Callers (`components/sheets/verse-actions/NoteContent.tsx`,
 * `components/sheets/VerseNoteSheet.tsx`, plus the upcoming delete-sync
 * call from any "delete note" handler) should reach for these helpers
 * rather than calling `notes.ts` directly — that keeps the local-first
 * vs server-first decision in one place.
 */

import type {VerseNote} from '@/types/verse-annotations';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import * as qfNotes from './notes';
import * as Auth from '@/services/auth/qfOAuth';

function buildRanges(
  note: Pick<VerseNote, 'verseKey' | 'verseKeys'>,
): string[] {
  if (note.verseKeys && note.verseKeys.length > 0) {
    return [qfNotes.verseKeysToRange(note.verseKeys)];
  }
  return [qfNotes.verseKeyToRange(note.verseKey)];
}

/**
 * Push a freshly-created (or unsynced) local note up to QF. Optionally
 * publish in the same pass. Patches the local row with returned ids.
 *
 * Silently no-ops when the user is signed out (notes stay local-only,
 * matching Bayaan upstream behavior).
 *
 * Errors from QF surface to the caller — the local note is already
 * created either way, so a failure here doesn't lose the user's content.
 */
/**
 * Sprint 21 round-5.4 — optimistic-publish placeholder.
 *
 * QF Hydra's `/auth/v1/notes/{id}/publish` endpoint takes ~15-20 seconds
 * to return (measured on prelive 2026-05-21 — createNote ~0.5s,
 * publishNote ~19s). Awaiting the full round-trip blocks the UI for
 * the whole window and the app appears frozen.
 *
 * Solution: when the user requests publish, IMMEDIATELY write a
 * `pending:<localId>` placeholder into `qf_post_id` so the
 * Reflections-collection filter (`!!qfPostId`) treats the note as
 * a Reflection from the moment of save. The sheet closes instantly.
 * In the background we run createNote + publishNote, then patch the
 * real `qfPostId` (or clear the placeholder on failure — note then
 * falls back to Personal Notes).
 *
 * The placeholder uses a `pending:` prefix so any downstream code that
 * uses qfPostId for QF API calls (e.g. `quranReflect.v1.posts.remove`
 * on unpublish) can detect + short-circuit if the publish is still
 * in-flight.
 */
const PENDING_PREFIX = 'pending:';
export function isPendingPostId(qfPostId: string | null | undefined): boolean {
  return typeof qfPostId === 'string' && qfPostId.startsWith(PENDING_PREFIX);
}

export async function pushLocalNoteToQf(
  localNote: VerseNote,
  opts: {publish: boolean},
): Promise<{qfNoteId: string | null; qfPostId: string | null}> {
  const signedIn = await Auth.isSignedIn();
  if (!signedIn) {
    return {qfNoteId: null, qfPostId: null};
  }

  // Optimistically write the pending placeholder BEFORE awaiting any
  // QF call. The Reflections-collection filter picks this up instantly
  // so the user sees their reflection in the right place even while
  // the ~19s publishNote round-trip is still in flight.
  if (opts.publish) {
    try {
      await verseAnnotationService.patchNoteQfIds(localNote.id, {
        qfPostId: `${PENDING_PREFIX}${localNote.id}`,
      });
    } catch (e) {
      if (__DEV__) console.warn('[notesSync] pending placeholder failed', e);
    }
  }

  let qf;
  try {
    qf = await qfNotes.createNote({
      body: localNote.content,
      ranges: buildRanges(localNote),
    });
  } catch (e) {
    // createNote failed — roll back the pending placeholder so the
    // note returns to Personal Notes.
    if (opts.publish) {
      await verseAnnotationService
        .patchNoteQfIds(localNote.id, {qfPostId: null})
        .catch(() => {});
    }
    throw e;
  }

  let qfPostId: string | null = null;
  if (opts.publish) {
    try {
      // Round-5.3 — publishNote requires the note body in its payload
      // (QF prelive returns 422 "body is required" without it).
      qfPostId = await qfNotes.publishNote(qf.id, localNote.content);
    } catch (e) {
      // Publish failed — clear the pending placeholder. The local QF
      // Note still exists (we got qf.id), so persist qfNoteId at least
      // so the next edit can sync without re-creating.
      await verseAnnotationService
        .patchNoteQfIds(localNote.id, {
          qfNoteId: qf.id,
          qfPostId: null,
        })
        .catch(() => {});
      throw e;
    }
  }

  await verseAnnotationService.patchNoteQfIds(localNote.id, {
    qfNoteId: qf.id,
    qfPostId,
  });

  return {qfNoteId: qf.id, qfPostId};
}

/**
 * Toggle publish state on an already-synced note. Returns the new
 * `qfPostId` (string after publish, null after unpublish).
 *
 * Pre-conditions:
 *  - User must be signed in.
 *  - `localNote.qfNoteId` must be set (the note has been pushed to QF).
 *    Throws if not — callers should pushLocalNoteToQf first.
 */
export async function setNotePublishState(
  localNote: VerseNote,
  publish: boolean,
): Promise<string | null> {
  if (!localNote.qfNoteId) {
    throw new Error(
      'setNotePublishState: note has not been synced to QF yet; call pushLocalNoteToQf first.',
    );
  }

  if (publish) {
    if (localNote.qfPostId) {
      // Already published; no-op.
      return localNote.qfPostId;
    }
    const postId = await qfNotes.publishNote(
      localNote.qfNoteId,
      localNote.content,
    );
    await verseAnnotationService.patchNoteQfIds(localNote.id, {
      qfPostId: postId,
    });
    return postId;
  }

  // Unpublish path.
  if (!localNote.qfPostId) {
    // Already private; no-op.
    return null;
  }
  await qfNotes.unpublishNote(localNote.qfPostId);
  await verseAnnotationService.patchNoteQfIds(localNote.id, {qfPostId: null});
  return null;
}

/**
 * Delete-side sync — when the user removes a local note, also delete
 * the QF note (which cascades the Post if any) if it was synced.
 *
 * Silently no-ops for unsynced notes (local-only, signed-out case).
 * Errors from QF are swallowed — the local delete is authoritative;
 * orphaned QF rows are recoverable via the next list-and-reconcile
 * pass (out of scope for Sprint 18).
 */
export async function syncDeleteToQf(localNote: VerseNote): Promise<void> {
  if (!localNote.qfNoteId) return;
  const signedIn = await Auth.isSignedIn();
  if (!signedIn) return;
  try {
    await qfNotes.deleteNote(localNote.qfNoteId);
  } catch {
    // Best-effort. Next reconcile pass (Sprint 19+) catches drift.
  }
}
