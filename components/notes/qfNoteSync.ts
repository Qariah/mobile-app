// @ai-generated
/**
 * Qariah: the Quran Foundation (QF) side of the verse notes. It holds the QF
 * note sync, the QuranReflect publish, the posts backfill and the note
 * analytics. The verse sheets and the Notes collection call these functions
 * around upstream's local writes, one line for each step (2026-10-24
 * divergence batch C4, SHT-S3 to SHT-S5).
 *
 * Upstream has no QF note sync, and it drops public notes (`saveToQR: true`)
 * on purpose, so this module stays Qariah-only. When upstream's QF stack
 * reaches `develop`, these functions can sit around its
 * `verseAnnotationService.runInScope` writes.
 *
 * Every QF call is best effort: the local SQLite write is the truth, and a QF
 * failure never blocks a sheet.
 */
import type {VerseNote} from '@/types/verse-annotations';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {
  pushEditOfUnlinkedNoteToQf,
  pushLocalNoteToQf,
  setNotePublishState,
  syncDeleteToQf,
} from '@/services/userState/notesSync';
import * as qfNotes from '@/services/userState/notes';
import {syncQfPostsToLocal} from '@/services/userState/postsRestore';
import {
  trackVerseNoteDeleted,
  versesOfSaved,
} from '@/services/analytics/verseAnnotationEvents';

/** The QF state of a note editor when it saves. */
export interface QfSaveState {
  signedIn: boolean;
  /** True: the note is a Reflection (published to QuranReflect). */
  publish: boolean;
}

/**
 * A new note was saved locally. Signed in, push it to QF, and publish it when
 * it is a Reflection. Fire and forget: the note is saved locally, so a QF
 * failure does not block the close. `pushLocalNoteToQf` writes a `pending:`
 * qfPostId placeholder at once, so the Reflections collection updates before
 * QF's slow (15-20 s) publish returns (Sprint 21 round-5.4).
 */
export function pushNewNoteToQf(
  note: VerseNote | null | undefined,
  {signedIn, publish}: QfSaveState,
  logTag: string,
): void {
  if (!signedIn || !note) return;
  pushLocalNoteToQf(note, {publish}).catch(err => {
    if (__DEV__) console.warn(`[${logTag}] QF push failed`, err);
  });
}

/**
 * A saved note was edited locally. Signed in, update QF in the background, so
 * the sheet closes at once: QF's publish and update endpoints can take 15-20
 * seconds (Sprint 21 round-5.4).
 *
 * - A note with a QF note: update the QF body when the text changed, then set
 *   the publish state.
 * - A note without one: a note made before sign-in, or a reflection from the
 *   posts pull (H3, TECH_DEBT #244). The helper edits the existing public
 *   post instead of making a second one.
 *
 * @param before The note as it was loaded, before the local edit.
 */
export function pushNoteEditToQf(
  before: VerseNote | null,
  noteId: string,
  content: string,
  {signedIn, publish}: QfSaveState,
): void {
  if (!signedIn || !before) return;
  const qfNoteId = before.qfNoteId;
  if (qfNoteId) {
    (async () => {
      try {
        if (before.content !== content) {
          await qfNotes.updateNote(qfNoteId, {body: content});
        }
        await setNotePublishState({...before, content}, publish);
      } catch (err) {
        if (__DEV__)
          console.warn(
            '[VerseNoteSheet] QF body update or publish toggle failed',
            err,
          );
      }
    })();
    return;
  }
  (async () => {
    try {
      const refreshed = await verseAnnotationService.getNoteById(noteId);
      if (refreshed) {
        await pushEditOfUnlinkedNoteToQf(before, refreshed, {publish});
      }
    } catch (err) {
      if (__DEV__) console.warn('[VerseNoteSheet] late QF push failed', err);
    }
  })();
}

/**
 * Before a local note delete: delete the QF note and its QuranReflect post
 * (best effort; `syncDeleteToQf` never throws for a QF error). The QF delete
 * goes first, so that a restore on a fresh install does not pull the note
 * back (sprint-20 round-2 bug B).
 */
export async function beforeNoteDelete(note: VerseNote): Promise<void> {
  await syncDeleteToQf(note);
}

/**
 * After a local note delete: `verse_note_deleted` for the note's own verses,
 * else for `fallbackVerseKey` (TECH_DEBT #297). The event holds no note text.
 */
export function afterNoteDelete(
  note: VerseNote | null,
  fallbackVerseKey = '',
): void {
  trackVerseNoteDeleted(
    note ? versesOfSaved(note) : {keys: [fallbackVerseKey]},
  );
}

/**
 * Sprint 21 round-5.2: the Reflections view backfills from
 * `quranReflect.v1.posts.myPosts` on each focus, so that it shows every
 * reflection the user has published (also from QuranReflect web or another
 * QF surface). The backfill is idempotent (posts already linked by
 * `qf_post_id` are no-ops). When it matched or created rows, `reload` shows
 * them without a manual refresh.
 *
 * @returns The focus cleanup: after a blur, a late result does not reload.
 */
export function backfillReflections(reload: () => void): () => void {
  let cancelled = false;
  syncQfPostsToLocal()
    .then(result => {
      if (cancelled) return;
      if (result.kind === 'ok' && (result.matched > 0 || result.created > 0)) {
        reload();
      }
    })
    .catch(err => {
      if (__DEV__) console.warn('[notes] posts backfill failed', err);
    });
  return () => {
    cancelled = true;
  };
}
