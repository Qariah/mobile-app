// @ai-generated
import React from 'react';
import {
  View,
  Text,
  Pressable,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {Feather} from '@expo/vector-icons';
import {useTranslation} from 'react-i18next';
import type {QariahVerseNotes} from './useQariahVerseNotes';

/** The row styles of the verse actions sheet's STUDY card. */
export interface QariahVerseNoteRowStyles {
  divider: StyleProp<ViewStyle>;
  option: StyleProp<ViewStyle>;
  optionPressed: StyleProp<ViewStyle>;
  optionText: StyleProp<TextStyle>;
}

interface QariahVerseNoteRowsProps {
  notes: QariahVerseNotes;
  styles: QariahVerseNoteRowStyles;
  iconColor: string;
}

/**
 * Qariah (Sprint 21 round-3): the rows under the sheet's note row. Personal
 * Notes are private (not synced to QuranReflect); Reflections are published
 * to QF / QuranReflect. Both are the same note rows, split by `qf_post_id`.
 * The rows, in order:
 *
 * - "Remove Personal Note", when the verse has one (single verse only).
 * - "Publish Reflection" or "Edit Reflection" (single verse only: the QR API
 *   takes one verse key).
 * - "Remove Reflection", when the verse has one.
 */
export function QariahVerseNoteRows({
  notes,
  styles,
  iconColor,
}: QariahVerseNoteRowsProps) {
  const {t} = useTranslation('qariah');

  const row = (
    label: string,
    icon: 'minus-circle' | 'users',
    onPress: () => void,
  ) => (
    <>
      <View style={styles.divider} />
      <Pressable
        style={({pressed}) => [styles.option, pressed && styles.optionPressed]}
        onPress={onPress}>
        <Feather name={icon} size={moderateScale(18)} color={iconColor} />
        <Text style={styles.optionText}>{label}</Text>
      </Pressable>
    </>
  );

  if (notes.isRange) return null;
  return (
    <>
      {notes.hasPersonalNote
        ? row(
            t('verseActions.removePersonalNote'),
            'minus-circle',
            notes.onRemovePersonalNote,
          )
        : null}
      {row(
        notes.hasReflection
          ? t('verseActions.editReflection')
          : t('verseActions.publishReflection'),
        'users',
        notes.onReflection,
      )}
      {notes.hasReflection
        ? row(
            t('verseActions.removeReflection'),
            'minus-circle',
            notes.onRemoveReflection,
          )
        : null}
    </>
  );
}
