/**
 * Sprint 18 — first-sign-in QF Notes restore.
 *
 * Pulls the signed-in user's existing QF Notes into the local SQLite
 * cache, so a user who already has notes on QF (via quran.com or
 * another QF-backed app) sees them in Qariah without having to
 * re-create them.
 *
 * Idempotent — gated by AsyncStorage key `@qariah:notesRestoredAt`.
 * Re-running the same user on the same device is a no-op. Different
 * users on the same device: the flag is preserved (we don't want a
 * sign-in-sign-out cycle to re-pull and duplicate). For the
 * cross-user case the per-note `qf_note_id` dedupe protects against
 * duplicate inserts regardless.
 *
 * Pattern parallels Sprint 11's `v1Restore.ts` — pure functions, side
 * effects scoped to the DB + AsyncStorage. UI hook lives in
 * `services/userState/UserStateContext.tsx`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';
import * as Auth from '@/services/auth/qfOAuth';
import * as qfNotes from './notes';
import type {QfNote} from './notes';

export const NOTES_RESTORED_AT_KEY = '@qariah:notesRestoredAt';

export type NotesRestoreResult =
  | {kind: 'restored'; count: number}
  | {kind: 'already-done'; count: number | null}
  | {kind: 'no-auth'}
  | {kind: 'empty'}
  | {kind: 'error'; detail: string};

/**
 * Sprint 27 close (2026-05-29) — flag value shape upgraded from a bare
 * `String(Date.now())` to `JSON.stringify({at, count})` so the V1 restore
 * modal's success toast can include the personal-notes count alongside the
 * reciter / recitation / surah counts.
 *
 * Backwards compat: a bare numeric timestamp string from a pre-upgrade
 * install still parses as already-done with `count = null` (no count info
 * available — those users already saw the silent restore on first sign-in,
 * so the toast wouldn't be shown again anyway).
 */
function readFlag(
  raw: string | null,
): {at: number; count: number | null} | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    // Legacy shape — bare timestamp.
    return {at: Number(raw), count: null};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const at = typeof parsed.at === 'number' ? parsed.at : Date.now();
      const count = typeof parsed.count === 'number' ? parsed.count : null;
      return {at, count};
    }
  } catch {
    // Corrupt JSON — treat as legacy missing-count.
  }
  return {at: Date.now(), count: null};
}

function writeFlag(count: number): Promise<void> {
  return AsyncStorage.setItem(
    NOTES_RESTORED_AT_KEY,
    JSON.stringify({at: Date.now(), count}),
  ).catch(() => {});
}

/**
 * Returns the count of notes ingested by the most recent successful
 * `restoreQfNotesOnce` run (0 if the restore completed with no notes).
 * Returns `null` if the flag is missing OR was written by a pre-upgrade
 * build that didn't persist the count.
 */
export async function getLastNotesRestoreCount(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(NOTES_RESTORED_AT_KEY).catch(
    () => null,
  );
  const parsed = readFlag(raw);
  return parsed ? parsed.count : null;
}

/**
 * Sprint 27 close — module-local singleton promise. Multiple concurrent
 * callers of `restoreQfNotesOnce()` (e.g. UserStateContext's auto-run
 * + V1RestoreModal's user-tap path) all await the same in-flight promise
 * instead of racing the flag-check + flag-set. Without this the modal's
 * call could land between the context's flag-check and flag-set,
 * resulting in either a duplicate REST round-trip OR the modal seeing
 * `already-done` with no count yet (the flag isn't written until the
 * round-trip completes).
 */
let inFlightRestore: Promise<NotesRestoreResult> | null = null;

/**
 * Parse a QF range string (e.g. `"2:255-2:257"`) into ordered verse keys.
 * For single-verse notes (start === end) returns a one-element array.
 * Cross-surah ranges (rare) just yield the start and end as two keys
 * (we don't enumerate verses across surah boundaries — the data model
 * doesn't model that and v1 didn't either).
 */
function parseQfRange(range: string): string[] {
  const [start, end] = range.split('-');
  if (!start || !end) return [start ?? range];
  const [sSurah, sAyah] = start.split(':').map(Number);
  const [eSurah, eAyah] = end.split(':').map(Number);
  if (!Number.isFinite(sSurah) || !Number.isFinite(sAyah)) return [range];
  if (sSurah !== eSurah || !Number.isFinite(eAyah)) {
    // Cross-surah or malformed → keep both endpoints, don't enumerate.
    return start === end ? [start] : [start, end];
  }
  const keys: string[] = [];
  for (let v = sAyah; v <= eAyah; v++) {
    keys.push(`${sSurah}:${v}`);
  }
  return keys;
}

async function ingestOne(qf: QfNote): Promise<'inserted' | 'skipped'> {
  // Dedupe against any local row already synced to this QF id.
  const existing = await verseAnnotationService.getNoteByQfNoteId(qf.id);
  if (existing) return 'skipped';

  // QF guarantees at least one range per note. Use the first range as the
  // canonical anchor — Sprint 18 stores only one (verseKey, verseKeys?)
  // tuple per local row, so multi-range QF notes (rare) collapse to their
  // first range. If this becomes a real-world miss case we widen later.
  const firstRange = qf.ranges[0];
  if (!firstRange) return 'skipped';
  const keys = parseQfRange(firstRange);
  const verseKey = keys[0];
  const [surahStr, ayahStr] = verseKey.split(':');
  const surahNumber = Number(surahStr);
  const ayahNumber = Number(ayahStr);
  if (!Number.isFinite(surahNumber) || !Number.isFinite(ayahNumber)) {
    return 'skipped';
  }
  const isRange = keys.length > 1;

  const localNote = await verseAnnotationService.addNote(
    verseKey,
    surahNumber,
    ayahNumber,
    qf.body,
    isRange ? keys : undefined,
    undefined, // rewayah — QF doesn't track this; use app default
  );

  await verseAnnotationService.patchNoteQfIds(localNote.id, {
    qfNoteId: qf.id,
    qfPostId: null,
  });

  // Hydrate the in-memory verseAnnotationsStore so the Mushaf overlay
  // shows the new notes immediately.
  const store = useVerseAnnotationsStore.getState();
  for (const k of keys) store.addNote(k);

  return 'inserted';
}

/**
 * Idempotent first-sign-in restore. Safe to call after every auth
 * transition into 'authenticated' — the flag short-circuits subsequent
 * runs. Concurrent callers share a single in-flight promise (see
 * `inFlightRestore`).
 */
export async function restoreQfNotesOnce(): Promise<NotesRestoreResult> {
  if (inFlightRestore) return inFlightRestore;
  inFlightRestore = (async () => {
    if (!(await Auth.isSignedIn())) {
      return {kind: 'no-auth'} as const;
    }

    const doneRaw = await AsyncStorage.getItem(NOTES_RESTORED_AT_KEY);
    const done = readFlag(doneRaw);
    if (done) return {kind: 'already-done', count: done.count} as const;

    try {
      const list = await qfNotes.listNotes();
      if (list.length === 0) {
        await writeFlag(0);
        return {kind: 'empty'} as const;
      }

      let inserted = 0;
      for (const qf of list) {
        try {
          const outcome = await ingestOne(qf);
          if (outcome === 'inserted') inserted += 1;
        } catch (err) {
          // Continue on per-note error — don't let one bad row block restore.
          if (__DEV__) {
            console.warn('[notesRestore] ingest failed for note', qf.id, err);
          }
        }
      }

      await writeFlag(inserted);
      return {kind: 'restored', count: inserted} as const;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {kind: 'error', detail} as const;
    }
  })();
  try {
    return await inFlightRestore;
  } finally {
    inFlightRestore = null;
  }
}

/** Test-only: clear the done flag so the next call re-runs the restore. */
export async function clearNotesRestoredFlag(): Promise<void> {
  await AsyncStorage.removeItem(NOTES_RESTORED_AT_KEY);
}
