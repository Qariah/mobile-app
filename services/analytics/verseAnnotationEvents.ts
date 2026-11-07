// @ai Qariah (TECH_DEBT #297, Sprint 47) — the seam between the verse
// annotation sheets and the analytics events.
//
// The sheets that change a note, a highlight or a bookmark are inherited from
// Bayaan. Each one adds ONE import and ONE call to a function in this file, so
// the upstream diff stays small and the event logic lives here:
//
//  - which verse the event names (`verse_key`, `surah_id`, `verse_count`),
//  - which rewayah the user read it in,
//  - that nothing the user typed can reach an event. The functions take verse
//    keys, a colour and a boolean. They have no parameter for note text or a
//    note id, so a caller cannot send either by mistake.
//
// The events go through `qariahAnalytics`, then `captureDiagnosticEvent()`, then
// the single `capture()` chokepoint of AnalyticsService: the consent gate and
// the dev/simulator drop apply as for every other event.
//
// Call these only AFTER the write succeeded, and only for an action the user
// made. A restore from Quran Foundation or a sign-out cleanup writes notes and
// highlights too; those must not call these functions.

import type {HighlightColor} from '@/types/verse-annotations';
import {qariahAnalytics, type VerseAnnotationProps} from './qariahEvents';

/** The verses one user action covered, and the rewayah they were read in. */
export interface AnnotatedVerses {
  /** Hafs storage anchors, reading order: "S:A", or "S:A:W" for a split verse.
   *  The first one is reported as `verse_key`. */
  keys: readonly string[];
  /** The rewayah the user read the verses in; omitted or null when unknown. */
  rewayahId?: string | null;
}

/** A verse selection of the verse sheets (a `ReadyVerseSelection` fits). */
export interface SelectionLike {
  anchors: readonly {key: string}[];
  rewayah?: string | null;
}

/** A saved note or bookmark (a `VerseNote` or `VerseBookmark` fits). */
export interface SavedVerseLike {
  verseKey: string;
  verseKeys?: readonly string[];
  rewayahId?: string | null;
}

/** The verses of a selection, from its storage anchors. */
export function versesOfSelection(selection: SelectionLike): AnnotatedVerses {
  return {
    keys: selection.anchors.map(anchor => anchor.key),
    rewayahId: selection.rewayah,
  };
}

/** The verses of a saved note (all of a range note's keys) or bookmark. */
export function versesOfSaved(saved: SavedVerseLike): AnnotatedVerses {
  return {
    keys:
      saved.verseKeys && saved.verseKeys.length > 0
        ? saved.verseKeys
        : [saved.verseKey],
    rewayahId: saved.rewayahId,
  };
}

/** "S:A", or "S:A:W" for a word-anchored (split) verse. */
const VERSE_KEY = /^(\d{1,3}):(\d{1,3})(?::\d{1,3})?$/;

/**
 * The properties every event carries, or null when the first key is not a verse
 * key of a real surah (1 to 114). The event is then not sent: a wrong key is
 * worse than no event.
 */
export function verseAnnotationProps(
  verses: AnnotatedVerses,
): VerseAnnotationProps | null {
  const match = VERSE_KEY.exec(verses.keys[0] ?? '');
  if (!match) return null;
  const surah = Number(match[1]);
  const ayah = Number(match[2]);
  if (surah < 1 || surah > 114 || ayah < 1) return null;
  return {
    verse_key: `${surah}:${ayah}`,
    surah_id: surah,
    verse_count: verses.keys.length,
    rewayah_id: verses.rewayahId ?? null,
  };
}

/**
 * Send an event; never let analytics break the action that called it. The
 * write has already happened, so a failure here has nothing to undo.
 */
function send(
  verses: AnnotatedVerses,
  track: (props: VerseAnnotationProps) => void,
): void {
  try {
    const props = verseAnnotationProps(verses);
    if (props) track(props);
  } catch (error) {
    if (__DEV__) console.warn('[verseAnnotationEvents] not sent', error);
  }
}

/** A note was CREATED. An edit of a note does not call this. */
export function trackVerseNoteCreated(verses: AnnotatedVerses): void {
  send(verses, props => qariahAnalytics.trackVerseNoteCreated(props));
}

/** The user deleted a note. */
export function trackVerseNoteDeleted(verses: AnnotatedVerses): void {
  send(verses, props => qariahAnalytics.trackVerseNoteDeleted(props));
}

/**
 * The user changed a highlight: a colour sets it (a change of colour sends the
 * event again), `null` removes it.
 */
export function trackVerseHighlightChanged(
  verses: AnnotatedVerses,
  color: HighlightColor | null,
): void {
  if (color === null) {
    send(verses, props => qariahAnalytics.trackVerseHighlightRemoved(props));
    return;
  }
  send(verses, props =>
    qariahAnalytics.trackVerseHighlightSet({...props, color}),
  );
}

/** The user added (`added: true`) or removed a bookmark. */
export function trackVerseBookmarkToggled(
  verses: AnnotatedVerses,
  added: boolean,
): void {
  send(verses, props =>
    qariahAnalytics.trackVerseBookmarkToggled({...props, added}),
  );
}
