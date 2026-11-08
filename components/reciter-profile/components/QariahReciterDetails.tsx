// @ai-generated
// Qariah (TECH_DEBT #306, Sprint 15 S15.5, Sprint 52 Task 3): the Qariah parts
// of the reciter header: the recitation count, the narration line, the country
// and translation chips, and the bio with "Read more". The phone header
// (ReciterHeader) and the iPad hero (upstream's TabletReciterHero, through its
// `details` slot) both render them from this one file.
import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {moderateScale, ScaledSheet} from '@/utils/scale';
import {useTheme} from '@/hooks/useTheme';
import type {Theme} from '@/utils/themeUtils';
import type {Reciter} from '@/data/reciterData';
import {
  getCountryDisplayName,
  getReciterBio,
  getTranslationLanguageName,
} from '@/i18n/qariahCatalog';
import {
  qariahNarrationLine,
  qariahRecitationsCount,
} from '@/components/reciter-profile/qariahHeaderMeta';

/** Bio length above which the "Read more" toggle appears (about 3 lines). */
const BIO_TRUNCATE_CHARS = 240;
/** The longest bio line on iPad, so the text stays readable (ipad-standards). */
const TABLET_BIO_MAX_WIDTH = 560;

/**
 * The Qariah additions to upstream's meta row: the recitation count (text, or
 * null when it equals the surah count) and the narration line (null for one
 * narration).
 */
export function useQariahReciterMeta(
  reciter: Reciter,
  surahCount: number,
): {recitations: string | null; narrationLine: string | null} {
  const {t} = useTranslation('qariah');
  const extraRecitations = qariahRecitationsCount(
    reciter.recitationsCount,
    surahCount,
  );
  return {
    recitations:
      extraRecitations !== null
        ? t('reciter.recitations', {count: extraRecitations})
        : null,
    narrationLine: qariahNarrationLine(reciter.rewayat),
  };
}

interface QariahReciterDetailsProps {
  reciter: Reciter;
  /** Unique surahs of the reciter (`countUniqueSurahs`). */
  surahCount: number;
  /**
   * `phone`: the chips and the bio only, as siblings of the name in
   * ReciterHeader (its meta row shows the count and the narration line).
   * `tablet`: also the count and the narration line, in one container under
   * the iPad hero's meta line.
   */
  variant: 'phone' | 'tablet';
}

export function QariahReciterDetails({
  reciter,
  surahCount,
  variant,
}: QariahReciterDetailsProps) {
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah', 'common']);
  const isTablet = variant === 'tablet';
  const styles = useMemo(
    () => (isTablet ? createTabletStyles(theme) : createPhoneStyles(theme)),
    [isTablet, theme],
  );
  const {recitations, narrationLine} = useQariahReciterMeta(
    reciter,
    surahCount,
  );

  const countryValue = reciter.country?.trim() || null;
  const country = countryValue ? getCountryDisplayName(countryValue) : null;
  const translationValue = reciter.translation?.trim() || null;
  const translation = translationValue
    ? getTranslationLanguageName(translationValue)
    : null;
  const bioRaw = getReciterBio(reciter);

  // Bio expand/collapse toggle. Default collapsed; long bios truncate.
  const [bioExpanded, setBioExpanded] = useState(false);
  const handleToggleBio = useCallback(() => setBioExpanded(v => !v), []);
  const bioNeedsTruncation =
    bioRaw !== null && bioRaw.length > BIO_TRUNCATE_CHARS;
  const bioDisplayed = !bioRaw
    ? null
    : !bioNeedsTruncation || bioExpanded
      ? bioRaw
      : bioRaw.slice(0, BIO_TRUNCATE_CHARS).trimEnd() + '…';

  const chips =
    country || translation ? (
      <View style={styles.chipRow}>
        {country ? (
          <View style={styles.chip}>
            <Text style={styles.chipText} numberOfLines={1}>
              {country}
            </Text>
          </View>
        ) : null}
        {translation ? (
          <View style={styles.chipEmphasis}>
            <Text style={styles.chipEmphasisText} numberOfLines={1}>
              {t('qariah:reciter.translationChip', {language: translation})}
            </Text>
          </View>
        ) : null}
      </View>
    ) : null;

  const bio = bioDisplayed ? (
    <Pressable
      onPress={bioNeedsTruncation ? handleToggleBio : undefined}
      style={styles.bioContainer}
      accessibilityRole={bioNeedsTruncation ? 'button' : 'text'}
      accessibilityHint={
        bioNeedsTruncation
          ? bioExpanded
            ? t('qariah:reciter.collapseBio')
            : t('qariah:reciter.expandBio')
          : undefined
      }>
      <Text style={styles.bioText}>
        {bioDisplayed}
        {bioNeedsTruncation ? (
          <Text style={styles.bioToggle}>
            {'  '}
            {bioExpanded
              ? t('common:actions.showLess')
              : t('qariah:reciter.readMore')}
          </Text>
        ) : null}
      </Text>
    </Pressable>
  ) : null;

  if (!isTablet) {
    // Phone: no wrapper, so ReciterHeader lays out exactly as before.
    return (
      <>
        {chips}
        {bio}
      </>
    );
  }

  if (!recitations && !narrationLine && !chips && !bio) return null;
  return (
    // It holds the bio's "Read more" button (VoiceOver, XCUITest).
    <View style={tabletLayout.container} accessible={false}>
      {recitations ? (
        <Text style={styles.meta} numberOfLines={1}>
          {recitations}
        </Text>
      ) : null}
      {narrationLine ? (
        <Text style={styles.narration} numberOfLines={2}>
          {narrationLine}
        </Text>
      ) : null}
      {chips}
      {bio}
    </View>
  );
}

const tabletLayout = StyleSheet.create({
  container: {
    gap: 10,
    marginTop: 4,
  },
});

// The phone styles are ReciterHeader's, unchanged (TECH_DEBT #306). `meta`
// and `narration` stay empty: on a phone ReciterHeader's meta row shows them.
const createPhoneStyles = (theme: Theme) =>
  ScaledSheet.create({
    meta: {},
    narration: {},
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      gap: moderateScale(6),
      marginTop: moderateScale(10),
    },
    chip: {
      paddingHorizontal: moderateScale(10),
      paddingVertical: moderateScale(4),
      borderRadius: moderateScale(12),
      backgroundColor: theme.colors.card ?? 'rgba(0,0,0,0.06)',
    },
    chipText: {
      fontSize: moderateScale(11),
      fontFamily: 'Manrope-Medium',
      color: theme.colors.text,
      opacity: 0.75,
    },
    chipEmphasis: {
      paddingHorizontal: moderateScale(10),
      paddingVertical: moderateScale(4),
      borderRadius: moderateScale(12),
      backgroundColor: theme.colors.primary
        ? `${theme.colors.primary}22`
        : 'rgba(0,128,128,0.12)',
      borderWidth: 1,
      borderColor: theme.colors.primary
        ? `${theme.colors.primary}55`
        : 'rgba(0,128,128,0.3)',
    },
    chipEmphasisText: {
      fontSize: moderateScale(11),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.primary ?? theme.colors.text,
    },
    bioContainer: {
      marginTop: moderateScale(12),
    },
    bioText: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.text,
      opacity: 0.78,
      lineHeight: moderateScale(19),
    },
    bioToggle: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.primary ?? theme.colors.text,
      opacity: 1,
    },
  });

// iPad: real points, matching upstream's TabletReciterHero type scale (its
// meta line is 13 pt semi-bold).
const createTabletStyles = (theme: Theme) =>
  StyleSheet.create({
    meta: {
      fontSize: 13,
      fontFamily: theme.fonts.semiBold,
      color: theme.colors.textSecondary,
    },
    narration: {
      fontSize: 13,
      lineHeight: 18,
      fontFamily: 'Manrope-Regular',
      color: theme.colors.textSecondary ?? theme.colors.text,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      gap: 8,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      backgroundColor: theme.colors.card ?? 'rgba(0,0,0,0.06)',
    },
    chipText: {
      fontSize: 13,
      fontFamily: 'Manrope-Medium',
      color: theme.colors.text,
      opacity: 0.75,
    },
    chipEmphasis: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      backgroundColor: theme.colors.primary
        ? `${theme.colors.primary}22`
        : 'rgba(0,128,128,0.12)',
      borderWidth: 1,
      borderColor: theme.colors.primary
        ? `${theme.colors.primary}55`
        : 'rgba(0,128,128,0.3)',
    },
    chipEmphasisText: {
      fontSize: 13,
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.primary ?? theme.colors.text,
    },
    bioContainer: {
      alignSelf: 'flex-start',
      maxWidth: TABLET_BIO_MAX_WIDTH,
    },
    bioText: {
      fontSize: 15,
      lineHeight: 22,
      fontFamily: 'Manrope-Regular',
      color: theme.colors.text,
      opacity: 0.78,
    },
    bioToggle: {
      fontSize: 15,
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.primary ?? theme.colors.text,
      opacity: 1,
    },
  });
