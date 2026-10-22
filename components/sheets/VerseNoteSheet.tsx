import React, {useState, useMemo, useCallback, useEffect} from 'react';
import {View, Text, TextInput, Pressable} from 'react-native';
import {
  ScaledSheet,
  moderateScale,
  verticalScale,
} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {Theme} from '@/utils/themeUtils';
import ActionSheet, {
  SheetProps,
  SheetManager,
  ScrollView,
} from 'react-native-actions-sheet';
import Color from 'color';
import {Feather} from '@expo/vector-icons';
import type {VerseNote} from '@/types/verse-annotations';
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';
import {useAuthStatus} from '@/services/auth/AuthContext';
import {
  pushEditOfUnlinkedNoteToQf,
  pushLocalNoteToQf,
  setNotePublishState,
  syncDeleteToQf,
} from '@/services/userState/notesSync';
import * as qfNotes from '@/services/userState/notes';
import SkiaVersePreview from '@/components/share/SkiaVersePreview';
// @ai-start
import {useTranslation} from 'react-i18next';
import type {RewayahId} from '@/store/mushafSettingsStore'; // @ai
// @ai-start
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import {useRewayahVerseUnits} from '@/hooks/useRewayahVerseUnits';
import {
  describeStoredVerses,
  readUnitTexts,
  type ReadyVerseSelection,
  type VerseSelectionRequest,
} from '@/components/share/rewayahVerseSelection';
import {
  useRequireSelection,
  useVerseSelection,
} from '@/components/share/useVerseSelection';
import {addSelectionNote} from './verse-actions/selectionAnnotations';
// @ai-end
// @ai Qariah (TECH_DEBT #297): note analytics, one call per user action.
import {
  trackVerseNoteCreated,
  trackVerseNoteDeleted,
  versesOfSaved,
} from '@/services/analytics/verseAnnotationEvents';

// @ai-start
export const VerseNoteSheet = (props: SheetProps<'verse-note'>) => {
  const {theme} = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const {t} = useTranslation(['sheets', 'qariah']);

  const verseKey = props.payload?.verseKey ?? '';
  const surahNumber = props.payload?.surahNumber ?? 0;
  const ayahNumber = props.payload?.ayahNumber ?? 0;
  const verseKeys = props.payload?.verseKeys;
  const unitKeys = props.payload?.unitKeys; // @ai
  const isRange = verseKeys && verseKeys.length > 1;
  const noteId = props.payload?.noteId;
  const rewayah = props.payload?.rewayah;

  const [noteText, setNoteText] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [loadedNote, setLoadedNote] = useState<VerseNote | null>(null);
  const [publish, setPublish] = useState(false);
  const [saving, setSaving] = useState(false);

  const authStatus = useAuthStatus();
  const signedIn = authStatus === 'authenticated';
  // @ai-start
  // An existing note opened from the Notes list carries no rewayah in the
  // payload; preview it in the rewayah it was saved in (legacy notes without
  // one follow the active rewayah). Hold the preview until the note loads so
  // it never flashes another rewayah's text first.
  const [savedNoteRewayah, setSavedNoteRewayah] = useState<
    RewayahId | undefined
  >(undefined);
  // The saved note's own anchors (notes.verse_keys of a note on several
  // verses; the Notes list sends only verse_key).
  const [savedNoteKeys, setSavedNoteKeys] = useState<string[] | undefined>(
    undefined,
  );
  const [noteLoaded, setNoteLoaded] = useState(!noteId);
  const previewRewayah = rewayah ?? savedNoteRewayah;
  // @ai-end

  // Compute range-aware reference text
  const verseRefText = useMemo(() => {
    if (!isRange) return `${surahNumber}:${ayahNumber}`;
    const firstKey = verseKeys[0];
    const lastKey = verseKeys[verseKeys.length - 1];
    const [firstSurah, firstAyah] = firstKey.split(':');
    const [lastSurah, lastAyah] = lastKey.split(':');
    if (firstSurah === lastSurah) {
      return `${firstSurah}:${firstAyah}-${lastAyah}`;
    }
    return `${firstSurah}:${firstAyah} - ${lastSurah}:${lastAyah}`;
  }, [isRange, verseKeys, surahNumber, ayahNumber]);

  // @ai-start
  // Decision 3: the note's verses are named in the numbering of the rewayah
  // it belongs to: the payload's, else (a saved note opened from the Notes
  // list) the note's own once it has loaded; a legacy note without one
  // counts as Hafs (verse-units contract section 3). Null while a saved
  // note's rewayah is not known yet. Hafs keeps the label and preview above,
  // exactly as before.
  const mushafRewayah = useMushafSettingsStore(s => s.rewayah);
  const noteRewayah: RewayahId | null = noteId
    ? (rewayah ?? (noteLoaded ? (savedNoteRewayah ?? 'hafs') : null))
    : (rewayah ?? mushafRewayah);
  const isHafsNote = noteRewayah === 'hafs';

  // A new note: the payload's verses (verse-units contract 4.1), as the
  // verse actions sheet names them.
  const selectionRequest = useMemo<VerseSelectionRequest>(
    () => ({
      rewayah: noteRewayah ?? 'hafs',
      verseKey,
      surahNumber,
      ayahNumber,
      verseKeys,
      unitKeys,
    }),
    [noteRewayah, verseKey, surahNumber, ayahNumber, verseKeys, unitKeys],
  );
  const newNoteSelection = useVerseSelection(selectionRequest);
  const requireSelection = useRequireSelection(
    newNoteSelection,
    selectionRequest,
  );

  // A saved note: its stored anchors ("S:A" or "S:A:W", Hafs locations),
  // named in its rewayah's own verses once it has loaded (its verse_keys
  // name every verse of a note on several verses).
  const savedUnits = useRewayahVerseUnits(
    noteId && noteRewayah && !isHafsNote ? noteRewayah : null,
  );
  const verses = useMemo((): {
    label: string;
    selection: ReadyVerseSelection | null;
  } | null => {
    if (noteRewayah === null) return null;
    if (isHafsNote) return {label: verseRefText, selection: null};
    if (!noteId) {
      return newNoteSelection.status === 'ready'
        ? {label: newNoteSelection.label, selection: newNoteSelection}
        : null;
    }
    if (!noteLoaded) return null;
    const anchorKeys =
      savedNoteKeys && savedNoteKeys.length > 0
        ? savedNoteKeys
        : isRange
          ? verseKeys
          : [verseKey];
    const described = describeStoredVerses(
      savedUnits.units,
      savedUnits.status,
      anchorKeys,
    );
    if (described.status === 'loading') return null;
    if (described.status === 'unnumbered') {
      return {label: described.label, selection: null};
    }
    return {label: described.selection.label, selection: described.selection};
  }, [
    noteRewayah,
    isHafsNote,
    verseRefText,
    noteId,
    newNoteSelection,
    noteLoaded,
    savedNoteKeys,
    isRange,
    verseKeys,
    verseKey,
    savedUnits,
  ]);
  // Another rewayah's verses are drawn from their own text (each with its
  // own marker); '' draws nothing (not nameable, or still loading).
  const previewText = isHafsNote
    ? undefined
    : verses?.selection
      ? (readUnitTexts(verses.selection) ?? []).join(' ')
      : '';
  // @ai-end

  useEffect(() => {
    if (!verseKey) return;

    if (noteId) {
      // @ai-start
      verseAnnotationService
        .getNoteById(noteId)
        .then(note => {
          if (note) {
            setLoadedNote(note);
            setNoteText(note.content);
            setIsEditMode(true);
            setSavedNoteRewayah(note.rewayahId ?? undefined);
            setSavedNoteKeys(note.verseKeys);
            // Seed the publish state from the persisted note — a note
            // with a qfPostId is currently a Reflection.
            setPublish(!!note.qfPostId);
          }
        })
        .finally(() => setNoteLoaded(true));
      // @ai-end
    }
  }, [verseKey, noteId]);

  const handleSave = useCallback(async () => {
    if (!noteText.trim() || saving) return;
    setSaving(true);

    // Qariah (Sprint 21 round-5.4): the QF round-trips run in the background
    // so the sheet closes at once — QF's publish and update endpoints can
    // take 15-20 seconds. Only the local SQLite writes are awaited.
    const pushNewNote = (localNote: VerseNote | null) => {
      if (!signedIn || !localNote) return;
      pushLocalNoteToQf(localNote, {publish}).catch(err => {
        if (__DEV__) console.warn('[VerseNoteSheet] QF push failed', err);
      });
    };
    let close = true;
    try {
      if (isEditMode && noteId) {
        const trimmed = noteText.trim();
        await verseAnnotationService.updateNote(noteId, trimmed);

        if (signedIn && loadedNote?.qfNoteId) {
          (async () => {
            try {
              if (loadedNote.content !== trimmed) {
                await qfNotes.updateNote(loadedNote.qfNoteId!, {body: trimmed});
              }
              await setNotePublishState(
                {...loadedNote, content: trimmed},
                publish,
              );
            } catch (err) {
              if (__DEV__)
                console.warn(
                  '[VerseNoteSheet] QF body update or publish toggle failed',
                  err,
                );
            }
          })();
        } else if (signedIn && loadedNote && !loadedNote.qfNoteId) {
          // A note made before sign-in, or a reflection from the posts
          // pull (H3, TECH_DEBT #244). The helper edits the existing
          // public post instead of making a second one. // @ai
          (async () => {
            try {
              const refreshed =
                await verseAnnotationService.getNoteById(noteId);
              if (refreshed) {
                await pushEditOfUnlinkedNoteToQf(loadedNote, refreshed, {
                  publish,
                }); // @ai
              }
            } catch (err) {
              if (__DEV__)
                console.warn('[VerseNoteSheet] late QF push failed', err);
            }
          })();
        }
      } else if (isHafsNote || !noteRewayah) {
        const allKeys = isRange ? verseKeys : [verseKey];
        const localNote = await verseAnnotationService.addNote(
          verseKey,
          surahNumber,
          ayahNumber,
          noteText.trim(),
          isRange ? verseKeys : undefined,
          rewayah,
        );
        const store = useVerseAnnotationsStore.getState();
        for (const vk of allKeys) {
          store.addNote(vk, rewayah); // @ai: the rewayah the row is saved in
        }
        trackVerseNoteCreated({keys: allKeys, rewayahId: noteRewayah}); // @ai
        pushNewNote(localNote);
      } else {
        // @ai-start
        // Another rewayah: stored by its verses' Hafs anchors (verse-units
        // contract section 3), verse_keys = every anchor of a range.
        const ready = await requireSelection('saved');
        if (!ready || ready.anchors.length === 0) {
          close = false;
          return;
        }
        pushNewNote(await addSelectionNote(ready, noteText.trim()));
        // @ai-end
      }
    } finally {
      setSaving(false);
      if (close) SheetManager.hideAll();
    }
  }, [
    verseKey,
    verseKeys,
    isRange,
    surahNumber,
    ayahNumber,
    noteText,
    isEditMode,
    noteId,
    rewayah,
    isHafsNote, // @ai
    noteRewayah, // @ai
    requireSelection, // @ai
    signedIn,
    loadedNote,
    publish,
    saving,
  ]);

  const handleDelete = useCallback(async () => {
    if (!noteId) return;
    // Qariah: best-effort QF delete first — the local delete is
    // authoritative either way.
    if (loadedNote) {
      await syncDeleteToQf(loadedNote);
    }
    await verseAnnotationService.deleteNoteById(noteId);
    // @ai Qariah (TECH_DEBT #297): the note's own verses, else the payload's.
    trackVerseNoteDeleted(
      loadedNote ? versesOfSaved(loadedNote) : {keys: [verseKey]},
    );
    const remaining =
      await verseAnnotationService.getNotesCountForVerse(verseKey);
    if (remaining === 0) {
      useVerseAnnotationsStore.getState().removeNote(verseKey);
    }
    SheetManager.hideAll();
  }, [verseKey, noteId, loadedNote]);

  const canSave = noteText.trim().length > 0 && !saving;

  return (
    <ActionSheet
      id={props.sheetId}
      containerStyle={styles.sheetContainer}
      indicatorStyle={styles.indicator}
      gestureEnabled={true}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* @ai: the verses in the note's own rewayah numbering, once known */}
        <Text style={styles.title}>
          {isEditMode
            ? verses?.label
              ? t('note.editTitle', {ref: verses.label})
              : t('note.editTitleWithoutRef')
            : verses?.label
              ? t('note.title', {ref: verses.label})
              : t('note.titleWithoutRef')}
        </Text>

        <View style={styles.ayahContainer}>
          {/* @ai-start */}
          {noteLoaded ? (
            <SkiaVersePreview
              verseKey={verseKey}
              verseKeys={verseKeys}
              numberOfLines={isRange || verses?.selection?.isRange ? 3 : 2} // @ai
              rewayah={previewRewayah}
              text={previewText} // @ai
            />
          ) : null}
          {/* @ai-end */}
        </View>

        <TextInput
          style={styles.textInput}
          value={noteText}
          onChangeText={setNoteText}
          placeholder={t('note.placeholder')}
          placeholderTextColor={theme.colors.textSecondary}
          multiline
          textAlignVertical="top"
          autoFocus
        />

        {/* Qariah (Sprint 21 round-4) — the long-press entry point defines
            the note type. For an existing Reflection a static hint says
            the save will republish + update QuranReflect. */}
        {publish && signedIn ? (
          <View style={styles.publishHint}>
            <Feather
              name="users"
              size={moderateScale(14)}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.publishHintText}>
              {t('qariah:note.publishingHint')}
            </Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!canSave}>
          <Feather
            name={publish && signedIn ? 'users' : 'save'}
            size={moderateScale(18)}
            color={canSave ? theme.colors.text : theme.colors.textSecondary}
          />
          <Text
            style={[
              styles.saveButtonText,
              !canSave && styles.saveButtonTextDisabled,
            ]}>
            {/* @ai Qariah (QF sync): Reflection labels and the saving state. */}
            {saving
              ? t('qariah:note.saving')
              : isEditMode
                ? publish && signedIn
                  ? t('qariah:note.updateReflection')
                  : t('note.update')
                : publish && signedIn
                  ? t('qariah:verseActions.publishReflection')
                  : t('note.save')}
          </Text>
        </Pressable>

        {isEditMode && noteId ? (
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <Feather
              name="minus-circle"
              size={moderateScale(18)}
              color="#ff4444"
            />
            <Text style={styles.deleteButtonText}>{t('note.delete')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ActionSheet>
  );
};
// @ai-end

const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    sheetContainer: {
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: moderateScale(20),
      borderTopRightRadius: moderateScale(20),
      paddingTop: moderateScale(8),
    },
    indicator: {
      backgroundColor: Color(theme.colors.text).alpha(0.3).toString(),
      width: moderateScale(40),
      height: 2.5,
    },
    container: {
      padding: moderateScale(16),
    },
    scrollContent: {
      paddingBottom: moderateScale(40),
    },
    title: {
      fontSize: moderateScale(20),
      fontFamily: theme.fonts.bold,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: verticalScale(12),
    },
    ayahContainer: {
      backgroundColor: Color(theme.colors.text).alpha(0.04).toString(),
      borderRadius: moderateScale(12),
      padding: moderateScale(16),
      marginBottom: verticalScale(16),
    },
    publishHint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: moderateScale(8),
      backgroundColor: Color(theme.colors.text).alpha(0.04).toString(),
      borderRadius: moderateScale(12),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.06).toString(),
      paddingVertical: moderateScale(10),
      paddingHorizontal: moderateScale(14),
      marginBottom: verticalScale(14),
    },
    publishHintText: {
      flex: 1,
      fontSize: moderateScale(12),
      lineHeight: moderateScale(17),
      fontFamily: theme.fonts.regular,
      color: theme.colors.textSecondary,
    },
    textInput: {
      backgroundColor: theme.colors.card,
      borderRadius: moderateScale(12),
      padding: moderateScale(14),
      minHeight: verticalScale(120),
      fontSize: moderateScale(15),
      fontFamily: theme.fonts.regular,
      color: theme.colors.text,
      marginBottom: verticalScale(16),
    },
    saveButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: Color(theme.colors.text).alpha(0.1).toString(),
      borderRadius: moderateScale(12),
      paddingVertical: verticalScale(12),
      gap: moderateScale(8),
    },
    saveButtonDisabled: {
      backgroundColor: Color(theme.colors.textSecondary).alpha(0.2).toString(),
    },
    saveButtonText: {
      fontSize: moderateScale(16),
      fontFamily: theme.fonts.semiBold,
      color: theme.colors.text,
    },
    saveButtonTextDisabled: {
      color: theme.colors.textSecondary,
    },
    deleteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255, 68, 68, 0.1)',
      borderRadius: moderateScale(12),
      paddingVertical: verticalScale(14),
      gap: moderateScale(8),
      marginTop: verticalScale(10),
    },
    deleteButtonText: {
      fontSize: moderateScale(16),
      fontFamily: theme.fonts.semiBold,
      color: '#ff4444',
    },
  });
