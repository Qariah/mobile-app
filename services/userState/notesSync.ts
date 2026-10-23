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

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import type {VerseNote} from '@/types/verse-annotations';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import * as qfNotes from './notes';
import * as Auth from '@/services/auth/qfOAuth';
import {getStoredAccountHash} from './accountKeys'; // @ai
import {isQfErrorRetryable} from './qfErrors'; // @ai

/**
 * The Hafs verse ("S:A") of a stored note anchor. Since upstream's rewayah
 * verse units (Bayaan #329, absorbed Sprint 45 Pass A), a note on part of a
 * split Hafs verse is anchored at a word ("1:7:5" for Warsh 1:7). QF ranges
 * name whole verses, so the note syncs on the Hafs verse that holds it.
 */
export function hafsVerseOfAnchor(anchor: string): string {
  const [surah, ayah] = anchor.split(':');
  return `${surah}:${ayah}`;
}

export function buildRanges(
  note: Pick<VerseNote, 'verseKey' | 'verseKeys'>,
): string[] {
  if (note.verseKeys && note.verseKeys.length > 0) {
    return [qfNotes.verseKeysToRange(note.verseKeys.map(hafsVerseOfAnchor))];
  }
  return [qfNotes.verseKeyToRange(hafsVerseOfAnchor(note.verseKey))];
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
        .catch(() => {
          // Best effort. The next line throws the original error.
        });
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
        .catch(() => {
          // Best effort. The next line throws the original error.
        });
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
 * H3 (TECH_DEBT #244): a reflection from the posts pull has a `qfPostId`
 * but no `qfNoteId` (the QF post has no link back to its note). Before H3
 * this function returned early for it, so the public post stayed on QF and
 * the next posts pull brought the reflection back. Now it deletes that
 * post by its id. // @ai
 *
 * Silently no-ops for unsynced notes (local-only, signed-out case).
 * Errors from QF are swallowed — the local delete is authoritative;
 * orphaned QF rows are recoverable via the next list-and-reconcile
 * pass (out of scope for Sprint 18).
 */
export async function syncDeleteToQf(localNote: VerseNote): Promise<void> {
  const pulledPostId = localNote.qfNoteId ? null : realPostId(localNote); // @ai
  if (!localNote.qfNoteId && !pulledPostId) return; // @ai
  const signedIn = await Auth.isSignedIn();
  if (!signedIn) return;
  try {
    if (localNote.qfNoteId) {
      await qfNotes.deleteNote(localNote.qfNoteId);
    } else if (pulledPostId) {
      // Unpublish = DELETE /v1/posts/{id}. // @ai
      await qfNotes.unpublishNote(pulledPostId); // @ai
    }
  } catch (e) {
    // Best-effort. Next reconcile pass (Sprint 19+) catches drift.
    // @ai-start
    // A pulled post that stays on QF would come back at the next posts pull,
    // so the pull deletes it again first (`retryPendingPostDeletes`).
    if (pulledPostId) {
      if (__DEV__) console.warn('[notesSync] post delete failed', e);
      await queuePostDelete(pulledPostId);
    }
    // @ai-end
  }
}

// @ai-start
/**
 * The QF post id of a note, or null when the note has no post or only the
 * `pending:` placeholder of a publish that has not finished.
 */
function realPostId(note: Pick<VerseNote, 'qfPostId'>): string | null {
  const id = note.qfPostId;
  if (!id || isPendingPostId(id)) return null;
  return id;
}

/**
 * H3 (TECH_DEBT #244) — edit-side sync for a note that has no `qfNoteId`.
 *
 * Two kinds of note get here:
 *   - A note made before sign-in. Push it to QF, as before.
 *   - A reflection from the posts pull. It has a real `qfPostId` but no
 *     `qfNoteId`, because the QF post has no link back to its note. Before
 *     H3, an edit pushed it as a new note and post, so QF showed two public
 *     posts, and an unpublish left the old post public.
 *
 * For a pulled reflection:
 *   - Text and publish state did not change: do nothing.
 *   - Publish turned off: the user asked to take the post down. Delete the
 *     post, then keep the text as a private QF note. If the delete fails,
 *     this function throws and changes nothing.
 *   - Text changed, publish on: create and publish the new post FIRST. The
 *     row stays linked to the old post until the new post exists, so a
 *     failed create or publish (a network drop, an iOS suspend) leaves the
 *     old reflection public and linked (Stage-2 review: the first H3 fix
 *     deleted the old post first and could unpublish it with no message).
 *     Then link the row to the new post and delete the old post. If that
 *     delete fails, the old post id goes to the pending-delete list, the next
 *     posts pull deletes it again, and Sentry gets a warning.
 *
 * The flow uses only the endpoints that the app already uses
 * (`DELETE /v1/posts/{id}` and create-and-publish). The new post does not
 * keep the likes and comments of the old post.
 *
 * @param before The note as it was before the local edit.
 * @param edited The note after the local edit (read again from the DB).
 */
export async function pushEditOfUnlinkedNoteToQf(
  before: VerseNote,
  edited: VerseNote,
  opts: {publish: boolean},
): Promise<void> {
  if (edited.qfNoteId) {
    throw new Error(
      'pushEditOfUnlinkedNoteToQf: the note already has a qfNoteId; update the QF note instead.',
    );
  }
  const existingPostId = realPostId(before);
  if (!existingPostId) {
    await pushLocalNoteToQf(edited, opts);
    return;
  }
  const textChanged =
    (before.content ?? '').trim() !== (edited.content ?? '').trim();
  if (opts.publish && !textChanged) return;

  const signedIn = await Auth.isSignedIn();
  if (!signedIn) return;

  if (!opts.publish) {
    await qfNotes.unpublishNote(existingPostId);
    await verseAnnotationService.patchNoteQfIds(edited.id, {qfPostId: null});
    await pushLocalNoteToQf({...edited, qfPostId: null}, {publish: false});
    return;
  }

  const qf = await qfNotes.createNote({
    body: edited.content,
    ranges: buildRanges(edited),
  });
  let newPostId: string;
  try {
    newPostId = await qfNotes.publishNote(qf.id, edited.content);
  } catch (e) {
    // Remove the new private note, so that a retry does not add a second one.
    await qfNotes.deleteNote(qf.id).catch(() => undefined);
    throw e;
  }
  await verseAnnotationService.patchNoteQfIds(edited.id, {
    qfNoteId: qf.id,
    qfPostId: newPostId,
  });
  try {
    await qfNotes.unpublishNote(existingPostId);
  } catch (e) {
    await queuePostDelete(existingPostId);
    if (__DEV__) console.warn('[notesSync] old post delete failed', e);
    Sentry.captureException(e, {
      level: 'warning',
      tags: {scope: 'notes-sync', step: 'old-post-delete'},
    });
  }
}

/**
 * H3 — QF posts that the app must delete, but whose delete failed. The posts
 * pull retries them first and does not bring them back as reflections.
 * Each entry keeps the account hash, so another account never tries it.
 */
export const PENDING_POST_DELETES_KEY = '@qariah:qfPostDeletesPending';

interface PendingPostDelete {
  postId: string;
  accountHash: string | null;
  queuedAt: number;
}

let pendingDeletesLock: Promise<unknown> = Promise.resolve();

/** Runs read-modify-write steps on the list one at a time. */
function withPendingDeletesLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = pendingDeletesLock.then(fn, fn);
  pendingDeletesLock = run.catch(() => undefined);
  return run;
}

async function readPendingPostDeletes(): Promise<PendingPostDelete[]> {
  const raw = await AsyncStorage.getItem(PENDING_POST_DELETES_KEY).catch(
    () => null,
  );
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (e): e is PendingPostDelete =>
            !!e && typeof e === 'object' && typeof e.postId === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

async function writePendingPostDeletes(
  entries: PendingPostDelete[],
): Promise<void> {
  if (entries.length === 0) {
    await AsyncStorage.removeItem(PENDING_POST_DELETES_KEY);
  } else {
    await AsyncStorage.setItem(
      PENDING_POST_DELETES_KEY,
      JSON.stringify(entries),
    );
  }
}

/** Adds a post id to the pending-delete list. Never throws. */
export function queuePostDelete(postId: string): Promise<void> {
  return withPendingDeletesLock(async () => {
    const entries = await readPendingPostDeletes();
    if (entries.some(e => e.postId === postId)) return;
    entries.push({
      postId,
      accountHash: await getStoredAccountHash(),
      queuedAt: Date.now(),
    });
    await writePendingPostDeletes(entries);
  }).catch(e => {
    if (__DEV__) console.warn('[notesSync] queuePostDelete failed', e);
  });
}

/** The post ids in the pending-delete list (all accounts). */
export async function getPendingPostDeleteIds(): Promise<string[]> {
  return (await readPendingPostDeletes()).map(e => e.postId);
}

/**
 * Tries the pending deletes of one account again. A delete that succeeds, or
 * that fails with a permanent error (for example a 404: the post is already
 * gone), leaves the list. A retryable error (network, 401, 429, 5xx) keeps
 * the entry for the next pull. Never throws.
 */
export function retryPendingPostDeletes(accountHash: string): Promise<void> {
  return withPendingDeletesLock(async () => {
    const entries = await readPendingPostDeletes();
    if (entries.length === 0) return;
    const keep: PendingPostDelete[] = [];
    for (const entry of entries) {
      if (entry.accountHash && entry.accountHash !== accountHash) {
        keep.push(entry);
        continue;
      }
      try {
        await qfNotes.unpublishNote(entry.postId);
      } catch (e) {
        if (isQfErrorRetryable(e)) keep.push(entry);
      }
    }
    await writePendingPostDeletes(keep);
  }).catch(e => {
    if (__DEV__) console.warn('[notesSync] retryPendingPostDeletes failed', e);
  });
}
// @ai-end
