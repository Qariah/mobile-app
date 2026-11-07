// @ai-generated
import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {Feather} from '@expo/vector-icons';
import Color from 'color';
import {useTranslation} from 'react-i18next';
import {useTheme} from '@/hooks/useTheme';

interface QariahPublishHintProps {
  /** True when the save publishes to QuranReflect (a Reflection, signed in). */
  visible: boolean;
  /** The space under the row: each editor keeps its own scale. */
  marginBottom: number;
}

/**
 * Qariah (Sprint 21 round-4): the note editors show this row above the Save
 * button when the save publishes to QuranReflect, so that the reader knows
 * the note goes public under their name. For a saved Reflection it says that
 * the save updates the post. One copy for `NoteContent` and `VerseNoteSheet`
 * (2026-10-24 divergence batch C4, SHT-S4).
 */
export function QariahPublishHint({
  visible,
  marginBottom,
}: QariahPublishHintProps) {
  const {theme} = useTheme();
  const {t} = useTranslation('qariah');
  if (!visible) return null;
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: Color(theme.colors.text).alpha(0.04).toString(),
          borderColor: Color(theme.colors.text).alpha(0.06).toString(),
          marginBottom,
        },
      ]}>
      <Feather
        name="users"
        size={moderateScale(14)}
        color={theme.colors.textSecondary}
      />
      <Text
        style={[
          styles.text,
          {
            fontFamily: theme.fonts.regular,
            color: theme.colors.textSecondary,
          },
        ]}>
        {t('note.publishingHint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: moderateScale(8),
    borderRadius: moderateScale(12),
    borderWidth: 1,
    paddingVertical: moderateScale(10),
    paddingHorizontal: moderateScale(14),
  },
  text: {
    flex: 1,
    fontSize: moderateScale(12),
    lineHeight: moderateScale(17),
  },
});
