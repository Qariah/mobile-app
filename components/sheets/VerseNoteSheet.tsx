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
import {useAuth} from '@/services/auth/AuthContext';
import {
  pushLocalNoteToQf,
  setNotePublishState,
  syncDeleteToQf,
} from '@/services/userState/notesSync';
import * as qfNotes from '@/services/userState/notes';
import SkiaVersePreview from '@/components/share/SkiaVersePreview';

export const VerseNoteSheet = (props: SheetProps<'verse-note'>) => {
  const {theme} = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const verseKey = props.payload?.verseKey ?? '';
  const surahNumber = props.payload?.surahNumber ?? 0;
  const ayahNumber = props.payload?.ayahNumber ?? 0;
  const verseKeys = props.payload?.verseKeys;
  const isRange = verseKeys && verseKeys.length > 1;
  const noteId = props.payload?.noteId;
  const rewayah = props.payload?.rewayah;

  const [noteText, setNoteText] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [loadedNote, setLoadedNote] = useState<VerseNote | null>(null);
  const [publish, setPublish] = useState(false);
  const [saving, setSaving] = useState(false);

  const {status: authStatus} = useAuth();
  const signedIn = authStatus === 'authenticated';

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

  useEffect(() => {
    if (!verseKey) return;

    if (noteId) {
      verseAnnotationService.getNoteById(noteId).then(note => {
        if (note) {
          setLoadedNote(note);
          setNoteText(note.content);
          setIsEditMode(true);
          // Seed the publish toggle from the persisted state — a note
          // with a qfPostId is currently a Reflection.
          setPublish(!!note.qfPostId);
        }
      });
    }
  }, [verseKey, noteId]);

  const handleSave = useCallback(async () => {
    if (!noteText.trim() || saving) return;
    setSaving(true);

    // Sprint 21 round-5.4 — fire-and-forget QF round-trips so the sheet
    // closes immediately. QF's publish + update endpoints can take
    // 15-20 seconds; awaiting them froze the UI. The local SQLite
    // writes are still awaited (they're synchronous-ish + needed for
    // store hydration), only the QF network calls go to the background.
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
        } else if (signedIn && !loadedNote?.qfNoteId) {
          // Note pre-dates QF sync; push it up on first edit.
          (async () => {
            try {
              const refreshed =
                await verseAnnotationService.getNoteById(noteId);
              if (refreshed) {
                await pushLocalNoteToQf(refreshed, {publish});
              }
            } catch (err) {
              if (__DEV__)
                console.warn('[VerseNoteSheet] late QF push failed', err);
            }
          })();
        }
      } else {
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
          store.addNote(vk);
        }

        if (signedIn) {
          pushLocalNoteToQf(localNote, {publish}).catch(err => {
            if (__DEV__) console.warn('[VerseNoteSheet] QF push failed', err);
          });
        }
      }
    } finally {
      setSaving(false);
      SheetManager.hideAll();
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
    signedIn,
    loadedNote,
    publish,
    saving,
  ]);

  const handleDelete = useCallback(async () => {
    if (!noteId) return;
    // Best-effort QF delete first — local delete is authoritative either way.
    if (loadedNote) {
      await syncDeleteToQf(loadedNote);
    }
    await verseAnnotationService.deleteNoteById(noteId);
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
        <Text style={styles.title}>
          {isEditMode ? 'Edit Note' : 'Note'} for {verseRefText}
        </Text>

        <View style={styles.ayahContainer}>
          <SkiaVersePreview
            verseKey={verseKey}
            verseKeys={verseKeys}
            numberOfLines={isRange ? 3 : 2}
            rewayah={rewayah}
          />
        </View>

        <TextInput
          style={styles.textInput}
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Write your note here..."
          placeholderTextColor={theme.colors.textSecondary}
          multiline
          textAlignVertical="top"
          autoFocus
        />

        {/* Sprint 21 round-4 — toggle removed; the entry-point on the
            long-press menu defines the type. For an existing
            Reflection we still show a static hint so the user knows
            the save will republish + update QuranReflect. */}
        {publish && signedIn ? (
          <View style={styles.publishHint}>
            <Feather
              name="users"
              size={moderateScale(14)}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.publishHintText}>
              Publishing to QuranReflect — visible on QF community surfaces
              under your name.
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
            {saving
              ? 'Saving…'
              : isEditMode
                ? publish && signedIn
                  ? 'Update Reflection'
                  : 'Update Note'
                : publish && signedIn
                  ? 'Publish Reflection'
                  : 'Save Note'}
          </Text>
        </Pressable>

        {isEditMode && noteId ? (
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <Feather
              name="minus-circle"
              size={moderateScale(18)}
              color="#ff4444"
            />
            <Text style={styles.deleteButtonText}>Delete Note</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ActionSheet>
  );
};

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
