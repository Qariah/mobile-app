// @ai-generated
// Qariah (Sprint 48): one recitation (one surah of one rewayah of one
// reciter) on the "Newly Added" Listen row. The look follows
// BrowseReciterCard: the reciter photo on top, then the surah name, the
// reciter name and, for a partial recording, the ayah range.
import React, {useCallback, useMemo} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import Color from 'color';
import {GlassView} from 'expo-glass-effect';
import {useTranslation} from 'react-i18next';
import {useTheme} from '@/hooks/useTheme';
import {USE_GLASS, useGlassColorScheme} from '@/hooks/useGlassProps';
import {ReciterImage} from '@/components/ReciterImage';
import {SURAHS} from '@/data/surahData';
import type {NewlyAddedRecitation} from '@/data/reciterCollections';
import {formatAyahRange} from '@/services/dataService';
import {getReciterDisplayName, getSurahDisplayName} from '@/i18n/format';
import {latinLetterSpacing} from '@/utils/rtl';
import type {Theme} from '@/utils/themeUtils';

export const RECITATION_CARD_WIDTH = moderateScale(120);
export const RECITATION_CARD_HEIGHT = moderateScale(164);

interface RecitationCardProps {
  recitation: NewlyAddedRecitation;
  onPress: (recitation: NewlyAddedRecitation) => void;
}

/** The surah name in the app language (Arabic in Arabic mode). */
export function getRecitationSurahName(surahId: number): string {
  const surah = SURAHS[surahId - 1];
  if (!surah) return String(surahId);
  return getSurahDisplayName({
    name: surah.name,
    name_arabic: surah.name_arabic,
  });
}

/** "ayahs 5–20" for a partial recording; undefined for a full surah. */
export function getRecitationRangeText(
  recitation: NewlyAddedRecitation,
): string | undefined {
  if (!recitation.range) return undefined;
  return formatAyahRange({
    surah: recitation.surah,
    is_full: false,
    range: recitation.range,
  });
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    container: {
      width: RECITATION_CARD_WIDTH,
      height: RECITATION_CARD_HEIGHT,
      borderRadius: moderateScale(14),
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.06).toString(),
      backgroundColor: Color(theme.colors.text).alpha(0.04).toString(),
    },
    glassContainer: {
      borderWidth: 0,
      backgroundColor: 'transparent',
    },
    pressed: {
      opacity: 0.7,
    },
    imageContainer: {
      width: '100%',
      flex: 1,
      overflow: 'hidden',
    },
    image: {
      width: '100%',
      height: '100%',
    },
    // A fixed height, so that a card with no range line has the same photo
    // size as a card with one.
    contentContainer: {
      height: moderateScale(56),
      paddingHorizontal: moderateScale(8),
      paddingVertical: moderateScale(6),
      gap: moderateScale(1),
    },
    surahName: {
      fontSize: moderateScale(11),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.text,
      letterSpacing: latinLetterSpacing(-0.2),
      lineHeight: moderateScale(15),
      includeFontPadding: false,
    },
    reciterName: {
      fontSize: moderateScale(9.5),
      fontFamily: 'Manrope-Medium',
      color: Color(theme.colors.text).alpha(0.7).toString(),
      letterSpacing: latinLetterSpacing(-0.2),
      lineHeight: moderateScale(13),
      includeFontPadding: false,
    },
    rangeText: {
      fontSize: moderateScale(9),
      fontFamily: 'Manrope-Regular',
      color: Color(theme.colors.textSecondary).alpha(0.6).toString(),
      lineHeight: moderateScale(12),
      includeFontPadding: false,
    },
  });
}

export const RecitationCard = React.memo(
  ({recitation, onPress}: RecitationCardProps) => {
    const {theme} = useTheme();
    const {t} = useTranslation('qariah');
    const glassColorScheme = useGlassColorScheme();
    const styles = useMemo(() => createStyles(theme), [theme]);

    const surahName = getRecitationSurahName(recitation.surah);
    const reciterName = getReciterDisplayName(recitation.reciter);
    const rangeText = getRecitationRangeText(recitation);
    const accessibilityLabel = rangeText
      ? t('a11y.playRecitationRange', {
          surah: surahName,
          range: rangeText,
          reciter: reciterName,
        })
      : t('a11y.playRecitation', {surah: surahName, reciter: reciterName});

    const handlePress = useCallback(
      () => onPress(recitation),
      [onPress, recitation],
    );

    const content = (
      <>
        <View style={styles.imageContainer}>
          <ReciterImage
            imageUrl={recitation.reciter.image_url || undefined}
            reciterName={recitation.reciter.name}
            style={styles.image}
            profileIconSize={moderateScale(40)}
          />
        </View>
        <View style={styles.contentContainer}>
          <Text style={styles.surahName} numberOfLines={1}>
            {surahName}
          </Text>
          <Text style={styles.reciterName} numberOfLines={1}>
            {reciterName}
          </Text>
          {rangeText ? (
            <Text style={styles.rangeText} numberOfLines={1}>
              {rangeText}
            </Text>
          ) : null}
        </View>
      </>
    );

    if (USE_GLASS) {
      return (
        <Pressable
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          testID="recitation-card">
          <GlassView
            style={StyleSheet.flatten([
              styles.container,
              styles.glassContainer,
            ])}
            glassEffectStyle="regular"
            colorScheme={glassColorScheme}>
            {content}
          </GlassView>
        </Pressable>
      );
    }

    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID="recitation-card"
        style={({pressed}) => [styles.container, pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  },
);

RecitationCard.displayName = 'RecitationCard';
