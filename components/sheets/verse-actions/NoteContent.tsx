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
import {verseAnnotationService} from '@/services/verse-annotations/VerseAnnotationService';
import {useVerseAnnotationsStore} from '@/store/verseAnnotationsStore';
import {useAuth} from '@/services/auth/AuthContext';
import {pushLocalNoteToQf} from '@/services/userState/notesSync';
import SkiaVersePreview from '@/components/share/SkiaVersePreview';

interface NoteContentProps {
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  verseKeys?: string[];
  rewayah?: import('@/store/mushafSettingsStore').RewayahId;
  /**
   * Initial value for the "Publish to QuranReflect" toggle. Sprint 21
   * round-3 — the long-press menu surfaces two entry points (Add
   * Personal Note vs Add Reflection); they share this component but
   * differ on the toggle's default. The toggle remains user-changeable
   * post-mount so an "Add Personal Note → publish anyway" path stays
   * available.
   */
  defaultPublish?: boolean;
  onDone: () => void;
}

export const NoteContent: React.FC<NoteContentProps> = ({
  verseKey,
  surahNumber,
  ayahNumber,
  verseKeys,
  rewayah,
  defaultPublish = false,
  onDone,
}) => {
  const {theme} = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isRange = verseKeys && verseKeys.length > 1;
  const [noteText, setNoteText] = useState('');
  // Sprint 21 round-4 — publish state is fixed for the lifetime of this
  // editor instance. The long-press entry-point sets it via the
  // `defaultPublish` prop and there's no in-editor toggle anymore.
  const publish = defaultPublish;
  const [saving, setSaving] = useState(false);

  const {status: authStatus} = useAuth();
  const signedIn = authStatus === 'authenticated';

  const handleSave = useCallback(async () => {
    if (!noteText.trim() || saving) return;
    setSaving(true);

    const allKeys = isRange ? verseKeys! : [verseKey];
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

    // Fire-and-forget QF push (signed-in users only). The user's note is
    // already saved locally — QF failures don't block the UI close. Errors
    // are logged for triage but not surfaced to the user.
    // Sprint 21 round-5.4 — QF Hydra's publish endpoint takes ~15-20s
    // to return. Don't block the sheet on the full round-trip; the
    // pushLocalNoteToQf helper writes a `pending:` placeholder qfPostId
    // synchronously so the Reflections collection updates immediately,
    // then completes the real publish in the background.
    if (signedIn) {
      pushLocalNoteToQf(localNote, {publish}).catch(err => {
        if (__DEV__) console.warn('[NoteContent] QF push failed', err);
      });
    }

    setSaving(false);
    onDone();
  }, [
    verseKey,
    verseKeys,
    isRange,
    surahNumber,
    ayahNumber,
    noteText,
    onDone,
    rewayah,
    signedIn,
    publish,
    saving,
  ]);

  const canSave = noteText.trim().length > 0 && !saving;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.previewCard}>
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
        placeholderTextColor={Color(theme.colors.textSecondary)
          .alpha(0.5)
          .toString()}
        multiline
        textAlignVertical="top"
        autoFocus
      />

      {/* Sprint 21 round-4 — drop the in-editor publish toggle. The
          entry-point on the long-press menu (Personal Note vs Publish
          Reflection) defines the type now. For the Reflection path keep
          a static info row so the user knows the save will publish. */}
      {publish && signedIn ? (
        <View style={styles.publishHint}>
          <Feather
            name="users"
            size={moderateScale(14)}
            color={theme.colors.textSecondary}
          />
          <Text style={styles.publishHintText}>
            Publishing to QuranReflect — visible on QF community surfaces under
            your name.
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
          {saving
            ? 'Saving…'
            : publish && signedIn
              ? 'Publish Reflection'
              : 'Save Note'}
        </Text>
      </Pressable>
    </ScrollView>
  );
};

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
