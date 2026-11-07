// @ai-generated
/**
 * Qariah (Sprint 21 round-3): the Personal Notes and Reflections of the verse
 * actions sheet. Personal Notes are private; Reflections are published to
 * QuranReflect. Both are the same note rows, split by `qf_post_id`. Upstream
 * has one "Add Note" row and no QF sync; this hook gives the sheet what its
 * note rows render and do, so that `VerseActionsSheet.tsx` keeps one-line
 * call sites (2026-10-24 divergence batch C4, SHT-S3). The rows themselves
 * are `QariahVerseNoteRows`.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert} from 'react-native';
import {SheetManager} from 'react-native-actions-sheet';
import {router} from 'expo-router';
import {useTranslation} from 'react-i18next';
import type {VerseNote} from '@/types/verse-annotations';
import type {ReadyVerseSelection} from '@/components/share/rewayahVerseSelection';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';
import {useAuthStatus} from '@/services/auth/AuthContext';
import {lightHaptics} from '@/utils/haptics';
import {afterNoteDelete, beforeNoteDelete} from './qfNoteSync';

export interface QariahVerseNotesOptions {
  sheetId: string;
  /** The payload's Hafs verse key. */
  verseKey: string;
  isRange: boolean;
  /** The sheet's selection once its verses can be named, else null. */
  selection: ReadyVerseSelection | null;
  /** Opens the sheet's note editor (upstream's `handleNote`). */
  openEditor: () => void;
}

export interface QariahVerseNotes {
  isRange: boolean;
  /** The verse has a Personal Note (looked up once at sheet open). */
  hasPersonalNote: boolean;
  /** The verse has a Reflection (looked up once at sheet open). */
  hasReflection: boolean;
  /** The label of the sheet's note row: "Add" or "Edit Personal Note". */
  personalNoteLabel: string;
  onPersonalNote: () => Promise<void>;
  onRemovePersonalNote: () => Promise<void>;
  onReflection: () => Promise<void>;
  onRemoveReflection: () => Promise<void>;
  /** True when the note editor publishes: the Reflection row opened it. */
  editorPublish: boolean;
  /** The back-row title of the note editor, or undefined for upstream's. */
  screenTitle: (screen: string | null) => string | undefined;
}

export function useQariahVerseNotes({
  sheetId,
  verseKey,
  isRange,
  selection,
  openEditor,
}: QariahVerseNotesOptions): QariahVerseNotes {
  const {t} = useTranslation(['qariah', 'common']);

  // A single verse's notes are stored at its anchor (upstream verse units:
  // "S:A", or "S:A:W" for part of a split Hafs verse) or, for a row saved
  // before verse units, at the payload's Hafs key. Hafs: both are the verse
  // key.
  const noteKeys = useMemo(() => {
    if (isRange || !verseKey) return [];
    const anchor = selection?.anchors[0]?.key;
    return [...new Set(anchor ? [anchor, verseKey] : [verseKey])];
  }, [isRange, verseKey, selection]);
  const getVerseNotes = useCallback(async (): Promise<VerseNote[]> => {
    const lists = await Promise.all(
      noteKeys.map(key => verseAnnotationService.getNotesForVerse(key)),
    );
    const byId = new Map<string, VerseNote>();
    for (const list of lists) for (const note of list) byId.set(note.id, note);
    return [...byId.values()];
  }, [noteKeys]);

  // One-shot fetch at sheet open; the sheet dismisses on save and the next
  // open re-fetches.
  const [personalNoteId, setPersonalNoteId] = useState<string | null>(null);
  const [reflectionNoteId, setReflectionNoteId] = useState<string | null>(null);
  useEffect(() => {
    if (noteKeys.length === 0) {
      setPersonalNoteId(null);
      setReflectionNoteId(null);
      return;
    }
    let cancelled = false;
    getVerseNotes()
      .then(list => {
        if (cancelled) return;
        const reflection = list.find(n => n.qfPostId) ?? null;
        const personal = list.find(n => !n.qfPostId) ?? null;
        setReflectionNoteId(reflection?.id ?? null);
        setPersonalNoteId(personal?.id ?? null);
      })
      .catch(() => {
        // A failed read leaves the Add rows; the handlers read again on tap.
      });
    return () => {
      cancelled = true;
    };
  }, [noteKeys, getVerseNotes]);
  const hasPersonalNote = !!personalNoteId;
  const hasReflection = !!reflectionNoteId;

  const authStatus = useAuthStatus();
  const signedIn = authStatus === 'authenticated';
  // `authStatus` is `'loading'` during the cold-start token refresh; only
  // the explicit `'unauthenticated'` state triggers the sign-in Alert, so a
  // `'loading'` tap is a no-op (Sprint 26 PR #42 code review).
  const authUnsettled = authStatus === 'loading';

  // The note editor publishes when the Reflection row opened it.
  const [editorPublish, setEditorPublish] = useState(false);

  // Open a saved note in the note sheet, named by its own stored anchors and
  // rewayah (as the Notes collection opens it).
  const openSavedNote = useCallback(
    async (note: VerseNote) => {
      await SheetManager.hide(sheetId);
      SheetManager.show('verse-note', {
        payload: {
          verseKey: note.verseKey,
          surahNumber: note.surahNumber,
          ayahNumber: note.ayahNumber,
          verseKeys: note.verseKeys,
          noteId: note.id,
          rewayah: note.rewayahId ?? 'hafs',
        },
      });
    },
    [sheetId],
  );

  /**
   * Re-fetch the notes inside the handler (not the effect's state) so a tap
   * before the lookup resolves never falls through to the Add path and
   * creates a duplicate local row + QF post (sprint-20 round-2 bug A).
   */
  const onPersonalNote = useCallback(async () => {
    const personal = (await getVerseNotes()).find(n => !n.qfPostId);
    if (personal?.id) {
      await openSavedNote(personal);
      return;
    }
    setEditorPublish(false);
    openEditor();
  }, [getVerseNotes, openSavedNote, openEditor]);

  const onReflection = useCallback(async () => {
    // Reflections publish to QuranReflect under the reader's name, so they
    // need a Quran Foundation sign-in before the editor opens (Sprint 26).
    if (authUnsettled) {
      // Auth still loading — the reader is likely signed in. Bail silently.
      return;
    }
    if (!signedIn) {
      await SheetManager.hide(sheetId);
      Alert.alert(
        t('qariah:verseActions.signInToPublishTitle'),
        t('qariah:verseActions.signInToPublishBody'),
        [
          {text: t('common:actions.cancel'), style: 'cancel'},
          {
            text: t('qariah:verseActions.signInButton'),
            onPress: () => router.push('/(d.settings)/sign-in'),
          },
        ],
      );
      return;
    }
    const reflection = (await getVerseNotes()).find(n => n.qfPostId);
    if (reflection?.id) {
      await openSavedNote(reflection);
      return;
    }
    setEditorPublish(true);
    openEditor();
  }, [
    authUnsettled,
    signedIn,
    getVerseNotes,
    openSavedNote,
    sheetId,
    openEditor,
    t,
  ]);

  /**
   * Delete this verse's Personal Notes (or Reflections), keeping the other
   * kind. The QF delete goes first so a fresh-install restore does not pull
   * the note back (sprint-20 round-2 bug B). The store's note mark goes only
   * when no row remains at a key.
   */
  const removeVerseNotes = useCallback(
    async (published: boolean) => {
      if (noteKeys.length === 0) return;
      lightHaptics();
      const notes = await getVerseNotes();
      for (const n of notes.filter(note => !!note.qfPostId === published)) {
        // The QF note, and its QuranReflect post.
        await beforeNoteDelete(n);
        await verseAnnotationService.deleteNoteById(n.id);
        afterNoteDelete(n); // TECH_DEBT #297
      }
      const store = useVerseAnnotationsStore.getState();
      for (const key of noteKeys) {
        if ((await verseAnnotationService.getNotesCountForVerse(key)) === 0) {
          store.removeNote(key);
        }
      }
      await SheetManager.hide(sheetId);
    },
    [noteKeys, getVerseNotes, sheetId],
  );
  const onRemovePersonalNote = useCallback(
    () => removeVerseNotes(false),
    [removeVerseNotes],
  );
  const onRemoveReflection = useCallback(
    () => removeVerseNotes(true),
    [removeVerseNotes],
  );

  const personalNoteLabel =
    hasPersonalNote && !isRange
      ? t('qariah:verseActions.editPersonalNote')
      : t('qariah:verseActions.addPersonalNote');

  const screenTitle = useCallback(
    (screen: string | null) => {
      if (screen !== 'note') return undefined;
      return editorPublish
        ? t('qariah:verseActions.publishReflection')
        : t('qariah:verseActions.addPersonalNote');
    },
    [editorPublish, t],
  );

  return {
    isRange,
    hasPersonalNote,
    hasReflection,
    personalNoteLabel,
    onPersonalNote,
    onRemovePersonalNote,
    onReflection,
    onRemoveReflection,
    editorPublish,
    screenTitle,
  };
}
