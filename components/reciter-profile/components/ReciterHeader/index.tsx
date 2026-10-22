import React, {useState, useCallback} from 'react';
import {View, Text, Pressable} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {ScaledSheet} from 'react-native-size-matters';
import {Theme} from '@/utils/themeUtils';
import {useTheme} from '@/hooks/useTheme';
import {ReciterImage} from '@/components/ReciterImage';
import {ReciterHeaderProps} from '@/components/reciter-profile/types';
import {Link} from 'expo-router';
import {USE_GLASS} from '@/hooks/useGlassProps';

/**
 * Bio paragraph length above which the "Read more" toggle appears.
 * 240 chars ~ 3 lines on most screens at the current type scale.
 */
const BIO_TRUNCATE_CHARS = 240;

export const ReciterHeader: React.FC<ReciterHeaderProps> = ({
  reciter,
  showSearch,
  insets,
}) => {
  const {theme} = useTheme();
  const styles = createStyles(theme);

  const topPadding = showSearch
    ? moderateScale(15)
    : USE_GLASS
      ? moderateScale(10)
      : insets.top + moderateScale(50);

  // Sprint 6 — surface post-filter recitations count + narration tag line.
  // Optional fields, hidden when missing.
  const recitationsCount = reciter.recitationsCount ?? null;
  const narrationLabels = reciter.rewayat
    .map(r => r.name)
    .filter((n): n is string => Boolean(n));
  // Show narration tag line only if there's >1 narration to disambiguate.
  const narrationTagLine =
    narrationLabels.length > 1 ? narrationLabels.join(' · ') : null;

  // Sprint 15 (S15.5) — bio + country + translation surfaces.
  const country = reciter.country?.trim() || null;
  const translation = reciter.translation?.trim() || null;
  const bioRaw = reciter.bio_en?.trim() || null;

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

  return (
    <View style={[styles.container, {paddingTop: topPadding}]}>
      {USE_GLASS ? (
        <Link.AppleZoomTarget>
          <View>
            <ReciterImage
              reciterName={reciter.name}
              imageUrl={reciter.image_url || undefined}
              style={styles.reciterImage}
              profileIconSize={moderateScale(48)}
            />
          </View>
        </Link.AppleZoomTarget>
      ) : (
        <View>
          <ReciterImage
            reciterName={reciter.name}
            imageUrl={reciter.image_url || undefined}
            style={styles.reciterImage}
            profileIconSize={moderateScale(48)}
          />
        </View>
      )}
      <Text style={styles.reciterName} numberOfLines={2}>
        {reciter.name}
      </Text>
      {recitationsCount !== null && recitationsCount > 0 ? (
        <Text style={styles.reciterMeta} numberOfLines={1}>
          {recitationsCount === 1
            ? '1 recitation'
            : `${recitationsCount} recitations`}
        </Text>
      ) : null}
      {narrationTagLine ? (
        <Text style={styles.reciterNarrations} numberOfLines={1}>
          {narrationTagLine}
        </Text>
      ) : null}

      {/* Sprint 15 (S15.5) — country + translation chip row. */}
      {(country || translation) && (
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
                {translation} translation
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Sprint 15 (S15.5) — bio (collapsed by default; expand on tap when long). */}
      {bioDisplayed ? (
        <Pressable
          onPress={bioNeedsTruncation ? handleToggleBio : undefined}
          style={styles.bioContainer}
          accessibilityRole={bioNeedsTruncation ? 'button' : 'text'}
          accessibilityHint={
            bioNeedsTruncation
              ? bioExpanded
                ? 'Collapse bio'
                : 'Expand bio'
              : undefined
          }>
          <Text style={styles.bioText}>
            {bioDisplayed}
            {bioNeedsTruncation ? (
              <Text style={styles.bioToggle}>
                {bioExpanded ? '  Show less' : '  Read more'}
              </Text>
            ) : null}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    container: {
      alignItems: 'center',
      paddingHorizontal: moderateScale(20),
      paddingBottom: moderateScale(6),
      backgroundColor: theme.colors.background,
    },
    reciterImage: {
      width: moderateScale(110),
      height: moderateScale(110),
      borderRadius: moderateScale(14),
    },
    reciterName: {
      fontSize: moderateScale(20),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.text,
      textAlign: 'center',
      marginTop: moderateScale(10),
      lineHeight: moderateScale(26),
    },
    reciterMeta: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Medium',
      color: theme.colors.textSecondary ?? theme.colors.text,
      opacity: 0.7,
      textAlign: 'center',
      marginTop: moderateScale(4),
      lineHeight: moderateScale(18),
    },
    reciterNarrations: {
      fontSize: moderateScale(12),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.textSecondary ?? theme.colors.text,
      opacity: 0.55,
      textAlign: 'center',
      marginTop: moderateScale(2),
      lineHeight: moderateScale(16),
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
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
      paddingHorizontal: moderateScale(4),
    },
    bioText: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.text,
      opacity: 0.78,
      textAlign: 'center',
      lineHeight: moderateScale(19),
    },
    bioToggle: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.primary ?? theme.colors.text,
      opacity: 1,
    },
  });
