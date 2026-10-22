import React, {useMemo} from 'react';
import {Pressable, Text, View, StyleSheet} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {RewayatInfo} from '@/data/rewayatCollections';
import {getRewayatArabic} from '@/data/rewayatArabic';
import {useTheme} from '@/hooks/useTheme';
import Color from 'color';
import {Link} from 'expo-router';
import {GlassView} from 'expo-glass-effect';
import {USE_GLASS, useGlassColorScheme} from '@/hooks/useGlassProps';
import {
  SurahGradientMesh,
  paletteForKey,
} from '@/components/hero/SurahGradientMesh';

interface RewayatCardProps {
  rewayat: RewayatInfo;
  onPress: () => void;
  width?: number;
  height?: number;
}

function RewayatCard({
  rewayat,
  onPress,
  width = moderateScale(110),
  height = moderateScale(92),
}: RewayatCardProps) {
  const {theme} = useTheme();
  const glassColorScheme = useGlassColorScheme();
  const styles = useMemo(
    () => createStyles(theme, width, height),
    [theme, width, height],
  );

  // Sprint 21 round-4 — per-tile mesh palette matching the Mushaf
  // surah-tile treatment. Seed on the rewaya's display name so each
  // rewaya gets a stable, distinct color across reloads.
  const meshPalette = useMemo(
    () => paletteForKey(rewayat.displayName),
    [rewayat.displayName],
  );

  const linkHref = {
    pathname: '/(tabs)/(a.home)/reciter/browse' as const,
    params: {
      teacher: rewayat.teacher,
      student: rewayat.student,
      rewayatName: rewayat.displayName,
    },
  };

  // Sprint 14 — large Arabic calligraphic glyph (ScheherazadeNew) replaces
  // the previous grey-square card treatment. Falls back to displayName
  // (Latin transliteration) when no Arabic mapping exists.
  const arabicGlyph =
    getRewayatArabic(rewayat.student) ?? getRewayatArabic(rewayat.displayName);

  const content = (
    <View style={styles.content}>
      <SurahGradientMesh
        palette={meshPalette}
        isDark={theme.isDarkMode}
        viewBoxWidth={width}
        viewBoxHeight={height}
      />
      <Text style={styles.teacherLabel} numberOfLines={1}>
        {rewayat.teacher}
      </Text>
      <View style={styles.glyphContainer}>
        {arabicGlyph ? (
          <Text
            style={styles.arabicGlyph}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}>
            {arabicGlyph}
          </Text>
        ) : (
          <Text style={styles.displayName} numberOfLines={2}>
            {rewayat.displayName}
          </Text>
        )}
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.subtitleName} numberOfLines={1}>
          {rewayat.displayName}
        </Text>
        <Text style={styles.subtitle}>
          {rewayat.reciterCount} reciter{rewayat.reciterCount !== 1 && 's'}
        </Text>
      </View>
    </View>
  );

  if (USE_GLASS) {
    return (
      <Link href={linkHref} asChild>
        <Pressable>
          <Link.AppleZoom>
            <GlassView
              style={StyleSheet.flatten([
                styles.container,
                styles.glassContainer,
              ])}
              glassEffectStyle="regular"
              colorScheme={glassColorScheme}>
              {content}
            </GlassView>
          </Link.AppleZoom>
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href={linkHref} asChild>
      <Pressable style={styles.container}>{content}</Pressable>
    </Link>
  );
}

function createStyles(
  theme: {
    colors: {
      text: string;
      textSecondary: string;
      card: string;
      border: string;
      background: string;
    };
    fonts: {semiBold: string; regular: string; medium: string};
    isDarkMode: boolean;
  },
  width: number,
  height: number,
) {
  return StyleSheet.create({
    container: {
      width,
      height,
      borderRadius: moderateScale(14),
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.08).toString(),
      backgroundColor: Color(theme.colors.text).alpha(0.06).toString(),
    },
    glassContainer: {
      borderWidth: 0,
      backgroundColor: 'transparent',
    },
    content: {
      flex: 1,
      padding: moderateScale(10),
      justifyContent: 'space-between',
    },
    teacherLabel: {
      fontSize: moderateScale(9),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.textSecondary).alpha(0.45).toString(),
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    glyphContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: moderateScale(2),
    },
    arabicGlyph: {
      fontSize: moderateScale(24),
      fontFamily: 'ScheherazadeNew-Bold',
      color: theme.colors.text,
      textAlign: 'center',
      // Arabic shaping reads right-to-left; align center so single-word
      // glyphs sit visually centered in the card.
      writingDirection: 'rtl',
      // Sprint 14 round 3 fix — give the glyph horizontal breathing room
      // and let it auto-shrink (adjustsFontSizeToFit on the Text element)
      // so longer transliterations like السوسي / الدوري don't clip.
      paddingHorizontal: moderateScale(4),
      width: '100%',
    },
    textContainer: {
      gap: moderateScale(2),
    },
    displayName: {
      fontSize: moderateScale(14),
      fontFamily: theme.fonts.semiBold,
      color: theme.colors.text,
      letterSpacing: -0.3,
      lineHeight: moderateScale(18),
    },
    subtitleName: {
      fontSize: moderateScale(11),
      fontFamily: theme.fonts.semiBold,
      color: theme.colors.text,
      letterSpacing: -0.2,
    },
    subtitle: {
      fontSize: moderateScale(10),
      fontFamily: theme.fonts.regular,
      color: Color(theme.colors.textSecondary).alpha(0.5).toString(),
    },
    pressed: {
      backgroundColor: Color(theme.colors.text).alpha(0.06).toString(),
    },
  });
}

export default React.memo(RewayatCard);
