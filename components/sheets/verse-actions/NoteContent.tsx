import React, {useState, useMemo, useCallback} from 'react';
import {View, TextInput, Pressable, Text} from 'react-native';
import {ScrollView} from 'react-native-actions-sheet';
import {
  ScaledSheet,
  moderateScale,
  verticalScale,
} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {Theme} from '@/utils/themeUtils';
import {Feather} from '@expo/vector-icons';
import Color from 'color';
import SkiaVersePreview from '@/components/share/SkiaVersePreview';
// @ai-start
import {useTranslation} from 'react-i18next';
import {
  selectionPreviewProps,
  type ReadyVerseSelection,
} from '@/components/share/rewayahVerseSelection';
import {addSelectionNote} from './selectionAnnotations';
// @ai-end
import {useAuthStatus} from '@/services/auth/AuthContext';
import {pushLocalNoteToQf} from '@/services/userState/notesSync';

interface NoteContentProps {
  // @ai-start
  /**
   * The selected verses in their rewayah's own numbering (decision 3; see
   * components/share/rewayahVerseSelection.ts). The note is stored by Hafs
   * anchors (verse-units contract section 3): verse_key = the first verse's
   * anchor, verse_keys = every verse's anchor for a range, with the
   * selection's rewayah. Hafs: the Hafs keys, exactly as before.
   */
  selection: ReadyVerseSelection;
  // @ai-end
  /**
   * Qariah (Sprint 21 round-3): the long-press menu has two entry points
   * (Add Personal Note, Publish Reflection) that share this component. True
   * publishes the saved note to QuranReflect.
   */
  defaultPublish?: boolean;
  onDone: () => void;
}

// @ai-start
export const NoteContent: React.FC<NoteContentProps> = ({
  selection, // @ai
  defaultPublish = false,
  onDone,
}) => {
  const {theme} = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const {t} = useTranslation(['sheets', 'qariah']);
  // @ai-start
  const {rewayah} = selection;
  const isRange = selection.anchors.length > 1;
  // @ai-end
  const [noteText, setNoteText] = useState('');
  // Qariah (Sprint 21 round-4): the entry point fixes the publish state for
  // this editor; there is no in-editor toggle.
  const publish = defaultPublish;
  const [saving, setSaving] = useState(false);

  const authStatus = useAuthStatus();
  const signedIn = authStatus === 'authenticated';

  const handleSave = useCallback(async () => {
    if (!noteText.trim() || saving) return;

    // @ai-start
    if (selection.anchors.length === 0) return;
    setSaving(true);
    let localNote;
    try {
      localNote = await addSelectionNote(selection, noteText.trim());
    } finally {
      setSaving(false);
    }
    // @ai-end

    // Qariah: fire-and-forget QF push (signed-in users only). The note is
    // already saved locally, so a QF failure does not block the close.
    // pushLocalNoteToQf writes a `pending:` qfPostId placeholder at once,
    // so the Reflections collection updates before QF's slow (15-20 s)
    // publish returns (Sprint 21 round-5.4).
    if (signedIn && localNote) {
      pushLocalNoteToQf(localNote, {publish}).catch(err => {
        if (__DEV__) console.warn('[NoteContent] QF push failed', err);
      });
    }
    onDone();
  }, [selection, noteText, onDone, signedIn, publish, saving]); // @ai

  const canSave = noteText.trim().length > 0 && !saving;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.previewCard}>
        {/* @ai: the selected verses, each with its own marker */}
        <SkiaVersePreview
          {...selectionPreviewProps(selection)}
          numberOfLines={isRange ? 3 : 2}
          rewayah={rewayah}
        />
      </View>

      <TextInput
        style={styles.textInput}
        value={noteText}
        onChangeText={setNoteText}
        placeholder={t('note.placeholder')}
        placeholderTextColor={Color(theme.colors.textSecondary)
          .alpha(0.5)
          .toString()}
        multiline
        textAlignVertical="top"
        autoFocus
      />

      {/* Qariah (Sprint 21 round-4) — the long-press entry point (Personal
          Note vs Publish Reflection) defines the type. The Reflection path
          shows a static row so the reader knows the save will publish. */}
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
        style={({pressed}) => [
          styles.saveButton,
          !canSave && styles.saveButtonDisabled,
          pressed && canSave && {opacity: 0.85},
        ]}
        onPress={handleSave}
        disabled={!canSave}>
        <Feather
          name={publish && signedIn ? 'users' : 'save'}
          size={moderateScale(16)}
          color={theme.colors.text}
        />
        <Text style={styles.saveButtonText}>
          {/* @ai Qariah (QF sync). */}
          {saving
            ? t('qariah:note.saving')
            : publish && signedIn
              ? t('qariah:verseActions.publishReflection')
              : t('note.save')}
        </Text>
      </Pressable>
    </ScrollView>
  );
};
// @ai-end

const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    previewCard: {
      backgroundColor: Color(theme.colors.text).alpha(0.03).toString(),
      borderRadius: moderateScale(12),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.05).toString(),
      padding: moderateScale(14),
      marginBottom: moderateScale(14),
    },
    textInput: {
      backgroundColor: Color(theme.colors.text).alpha(0.04).toString(),
      borderRadius: moderateScale(12),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.06).toString(),
      padding: moderateScale(14),
      minHeight: verticalScale(120),
      fontSize: moderateScale(15),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.text,
      marginBottom: moderateScale(12),
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
      marginBottom: moderateScale(14),
    },
    publishHintText: {
      flex: 1,
      fontSize: moderateScale(12),
      lineHeight: moderateScale(17),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.textSecondary,
    },
    saveButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: Color(theme.colors.text).alpha(0.08).toString(),
      borderRadius: moderateScale(12),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.1).toString(),
      paddingVertical: verticalScale(13),
      gap: moderateScale(8),
    },
    saveButtonDisabled: {
      opacity: 0.35,
    },
    saveButtonText: {
      fontSize: moderateScale(15),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.text,
    },
  });
