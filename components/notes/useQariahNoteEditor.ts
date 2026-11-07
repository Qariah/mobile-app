// @ai-generated
/**
 * Qariah: the QF side of the two note editors, upstream's `NoteContent` (the
 * Add screen in the verse actions sheet) and `VerseNoteSheet` (a saved note,
 * or a new note from the player). It holds the Personal Note / Reflection
 * state, the in-flight `saving` guard, the QF calls and the Qariah button
 * labels, so that the inherited editors keep one-line call sites
 * (2026-10-24 divergence batch C4, SHT-S4).
 *
 * The entry point sets the note type: "Add Personal Note" or "Publish
 * Reflection" in the verse actions sheet, or the saved note's own `qfPostId`.
 * There is no toggle in the editor (Sprint 21 round-4).
 */
import {useCallback, useMemo, useState} from 'react';
import {SheetManager} from 'react-native-actions-sheet';
import {useTranslation} from 'react-i18next';
import type {VerseNote} from '@/types/verse-annotations';
import {useAuthStatus} from '@/services/auth/AuthContext';
import {
  trackVerseNoteCreated,
  type AnnotatedVerses,
} from '@/services/analytics/verseAnnotationEvents';
import {
  afterNoteDelete,
  beforeNoteDelete,
  pushNewNoteToQf,
  pushNoteEditToQf,
} from './qfNoteSync';

export interface QariahNoteEditorOptions {
  /** The editor's name in the dev logs. */
  source: 'NoteContent' | 'VerseNoteSheet';
  /**
   * The note type from the entry point: true publishes the note to
   * QuranReflect. Omit it to take the type from the loaded note.
   */
  publish?: boolean;
}

export interface QariahNoteEditor {
  /** True while a save runs: the Save button reads "Saving…" and is off. */
  saving: boolean;
  /** True when a save publishes to QuranReflect: a Reflection, signed in. */
  publishing: boolean;
  /** The Save button's icon. */
  saveIcon: 'users' | 'save';
  /** The Qariah label of the Save button, or undefined for upstream's. */
  saveLabel: (isEdit: boolean) => string | undefined;
  /** Seeds the editor from the saved note it opened. Stable. */
  onNoteLoaded: (note: VerseNote) => void;
  /** After a local create: the analytics event (when given), the QF push. */
  onNoteCreated: (
    note: VerseNote | null | undefined,
    created?: AnnotatedVerses,
  ) => void;
  /** After a local edit of the loaded note: the QF update, in the background. */
  onNoteUpdated: (noteId: string, content: string) => void;
  /** Before the local delete of the loaded note: the QF delete. */
  beforeDelete: () => Promise<void>;
  /** After the local delete of the loaded note: `verse_note_deleted`. */
  afterDelete: (verseKey: string) => void;
  /**
   * Saves a new note under the `saving` state, then pushes it to QF
   * (`NoteContent`).
   */
  saveNew: (save: () => Promise<VerseNote | null>) => Promise<void>;
  /**
   * One save at a time (`VerseNoteSheet`): `save` runs under the `saving`
   * state. It closes the sheets itself when it succeeds; when it throws, all
   * sheets close too.
   */
  guardSave: (text: string, save: () => Promise<void>) => Promise<void>;
}

export function useQariahNoteEditor({
  source,
  publish: entryPublish,
}: QariahNoteEditorOptions): QariahNoteEditor {
  const {t} = useTranslation('qariah');
  const signedIn = useAuthStatus() === 'authenticated';
  const [loadedNote, setLoadedNote] = useState<VerseNote | null>(null);
  const [loadedPublish, setLoadedPublish] = useState(false);
  const [saving, setSaving] = useState(false);
  const publish = entryPublish ?? loadedPublish;
  const publishing = publish && signedIn;

  const onNoteLoaded = useCallback((note: VerseNote) => {
    setLoadedNote(note);
    // A note with a qfPostId is a Reflection now.
    setLoadedPublish(!!note.qfPostId);
  }, []);

  const onNoteCreated = useCallback(
    (note: VerseNote | null | undefined, created?: AnnotatedVerses) => {
      if (created) trackVerseNoteCreated(created); // TECH_DEBT #297
      pushNewNoteToQf(note, {signedIn, publish}, source);
    },
    [signedIn, publish, source],
  );

  const onNoteUpdated = useCallback(
    (noteId: string, content: string) => {
      pushNoteEditToQf(loadedNote, noteId, content, {signedIn, publish});
    },
    [loadedNote, signedIn, publish],
  );

  const beforeDelete = useCallback(async () => {
    if (loadedNote) await beforeNoteDelete(loadedNote);
  }, [loadedNote]);

  const afterDelete = useCallback(
    (verseKey: string) => afterNoteDelete(loadedNote, verseKey),
    [loadedNote],
  );

  const saveNew = useCallback(
    async (save: () => Promise<VerseNote | null>) => {
      setSaving(true);
      let note: VerseNote | null;
      try {
        note = await save();
      } finally {
        setSaving(false);
      }
      onNoteCreated(note);
    },
    [onNoteCreated],
  );

  const guardSave = useCallback(
    async (text: string, save: () => Promise<void>) => {
      if (!text.trim() || saving) return;
      setSaving(true);
      let finished = false;
      try {
        await save();
        finished = true;
      } finally {
        setSaving(false);
        if (!finished) SheetManager.hideAll();
      }
    },
    [saving],
  );

  const saveLabel = useCallback(
    (isEdit: boolean): string | undefined => {
      if (saving) return t('note.saving');
      if (!publishing) return undefined;
      return isEdit
        ? t('note.updateReflection')
        : t('verseActions.publishReflection');
    },
    [saving, publishing, t],
  );

  return useMemo(
    () => ({
      saving,
      publishing,
      saveIcon: publishing ? 'users' : 'save',
      saveLabel,
      onNoteLoaded,
      onNoteCreated,
      onNoteUpdated,
      beforeDelete,
      afterDelete,
      saveNew,
      guardSave,
    }),
    [
      saving,
      publishing,
      saveLabel,
      onNoteLoaded,
      onNoteCreated,
      onNoteUpdated,
      beforeDelete,
      afterDelete,
      saveNew,
      guardSave,
    ],
  );
}
