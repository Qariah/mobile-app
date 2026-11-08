// @ai-generated
/**
 * Qariah: the Personal Notes tab of the iPad ayah panel (Sprint 52 Task 8).
 * The verse's Personal Notes as cards (a tap opens the note to edit it), an
 * "Add Personal Note" button that opens the note editor inside the panel,
 * and the Reflection rows of the verse actions (QariahVerseNoteRows).
 * Upstream has one note row and no QF sync, so this tab stays Qariah's; an
 * upstream port shows upstream's NoteContent here.
 */
import React, {useCallback, useMemo} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import Color from 'color';
import {useTranslation} from 'react-i18next';
import {useTheme} from '@/hooks/useTheme';
import type {VerseNote} from '@/types/verse-annotations';
import type {ReadyVerseSelection} from '@/components/share/rewayahVerseSelection';
import {NoteContent} from '@/components/sheets/verse-actions/NoteContent';
import {useQariahVerseNotes} from '@/components/notes/useQariahVerseNotes';
import {QariahVerseNoteRows} from '@/components/notes/QariahVerseNoteRows';
import {localizeDigits} from '@/i18n/format';
import {currentLanguage} from '@/i18n/language';
import {getIntlLocale} from '@/i18n/languages';
import {
  ayahPanelDraftKey,
  clearAyahPanelDraft,
  setAyahPanelCompose,
  setAyahPanelDraft,
  useAyahPanelStore,
  type AyahPanelPayload,
} from './ayahPanelStore';

interface Props {
  payload: AyahPanelPayload;
  selection: ReadyVerseSelection;
}

function formatNoteDate(time: number): string {
  try {
    return localizeDigits(
      new Date(time).toLocaleDateString(getIntlLocale(currentLanguage), {
        day: 'numeric',
        month: 'short',
      }),
    );
  } catch {
    return '';
  }
}

export function AyahPanelNotesTab({payload, selection}: Props) {
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah', 'common']);
  const compose = useAyahPanelStore(s => s.compose);
  const openEditor = useCallback(() => setAyahPanelCompose(true), []);
  const notes = useQariahVerseNotes({
    verseKey: payload.verseKey,
    isRange: selection.isRange,
    selection,
    openEditor,
  });
  const {refresh} = notes;
  // The draft lives in the store, by ayah: the editor remounts when the
  // window crosses 900 pt (panel <-> card), and a closed panel keeps it.
  // Read, not subscribed: the editor takes it only when it mounts.
  const draft = useAyahPanelStore.getState().drafts[ayahPanelDraftKey(payload)];
  const publish = notes.editorPublish || !!draft?.publish;
  const keepDraft = useCallback(
    (text: string) => setAyahPanelDraft(payload, text, publish),
    [payload, publish],
  );
  const closeEditor = useCallback(() => {
    clearAyahPanelDraft(payload);
    setAyahPanelCompose(false);
    refresh();
  }, [payload, refresh]);
  const cancelEditor = useCallback(() => {
    clearAyahPanelDraft(payload);
    setAyahPanelCompose(false);
  }, [payload]);

  const colors = useMemo(
    () => ({
      card: theme.colors.background,
      border: Color(theme.colors.text).alpha(0.12).toString(),
      secondary: Color(theme.colors.text).alpha(0.7).toString(),
      pressed: Color(theme.colors.text).alpha(0.06).toString(),
    }),
    [theme],
  );
  const rowStyles = useMemo(
    () => ({
      divider: [styles.divider, {backgroundColor: colors.border}],
      option: styles.option,
      optionPressed: {backgroundColor: colors.pressed},
      optionText: [styles.optionText, {color: theme.colors.text}],
    }),
    [colors, theme],
  );

  if (compose) {
    return (
      <View style={styles.flex} accessible={false}>
        <NoteContent
          selection={selection}
          defaultPublish={publish}
          onDone={closeEditor}
          initialText={draft?.text ?? ''}
          onTextChange={keepDraft}
        />
        <Pressable
          onPress={cancelEditor}
          testID="ayah-panel-cancel-note"
          accessibilityRole="button"
          style={({pressed}) => [styles.cancel, pressed && styles.pressed]}>
          <Text style={[styles.cancelText, {color: colors.secondary}]}>
            {t('common:actions.cancel')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      accessible={false}>
      {notes.personalNotes.map((note: VerseNote) => (
        <Pressable
          key={note.id}
          onPress={() => notes.openNote(note)}
          accessibilityRole="button"
          style={({pressed}) => [
            styles.noteCard,
            {backgroundColor: colors.card, borderColor: colors.border},
            pressed && styles.pressed,
          ]}>
          <Text style={[styles.noteText, {color: theme.colors.text}]}>
            {note.content}
          </Text>
          <Text style={[styles.noteDate, {color: colors.secondary}]}>
            {formatNoteDate(note.updatedAt || note.createdAt)}
          </Text>
        </Pressable>
      ))}
      {selection.isRange ? null : (
        <Pressable
          onPress={notes.addPersonalNote}
          accessibilityRole="button"
          testID="ayah-panel-add-note"
          style={({pressed}) => [
            styles.addButton,
            {borderColor: colors.border},
            pressed && {backgroundColor: colors.pressed},
          ]}>
          <Feather name="edit-2" size={16} color={theme.colors.text} />
          <Text style={[styles.addText, {color: theme.colors.text}]}>
            {t('qariah:verseActions.addPersonalNote')}
          </Text>
        </Pressable>
      )}
      <View style={styles.rows} accessible={false}>
        <QariahVerseNoteRows
          notes={notes}
          styles={rowStyles}
          iconColor={theme.colors.text}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  list: {paddingBottom: 24, gap: 12},
  pressed: {opacity: 0.7},
  noteCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    minHeight: 44,
  },
  noteText: {fontSize: 16, fontFamily: 'Manrope-Regular', lineHeight: 22},
  noteDate: {fontSize: 13, fontFamily: 'Manrope-Regular'},
  addButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
  },
  addText: {fontSize: 16, fontFamily: 'Manrope-SemiBold'},
  rows: {marginTop: 4},
  divider: {height: StyleSheet.hairlineWidth},
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  optionText: {fontSize: 15, fontFamily: 'Manrope-Medium'},
  cancel: {
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  cancelText: {fontSize: 15, fontFamily: 'Manrope-SemiBold'},
});
