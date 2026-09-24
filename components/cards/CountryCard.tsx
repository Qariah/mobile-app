import React, {useMemo} from 'react';
import {Pressable, Text, View, StyleSheet} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {CountryInfo} from '@/data/countryCollections';
import {getCountryISO} from '@/data/countryISO';
import CountryShape from '@/components/country/CountryShape';
import {useTheme} from '@/hooks/useTheme';
import Color from 'color';
import {Link} from 'expo-router';
import {GlassView} from 'expo-glass-effect';
import {USE_GLASS, useGlassColorScheme} from '@/hooks/useGlassProps';
import {
  SurahGradientMesh,
  paletteForKey,
} from '@/components/hero/SurahGradientMesh';

interface CountryCardProps {
  country: CountryInfo;
  onPress: () => void;
  width?: number;
  height?: number;
}

function CountryCard({
  country,
  onPress,
  width = moderateScale(110),
  height = moderateScale(92),
}: CountryCardProps) {
  const {theme} = useTheme();
  const glassColorScheme = useGlassColorScheme();
  const styles = useMemo(
    () => createStyles(theme, width, height),
    [theme, width, height],
  );

  // @ai Sprint 8 — destination route is a placeholder until the country
  // browse screen lands. The Reciter Browse screen already accepts filter
  // params, so we route there with `country={slug}` and let the screen
  // handle the filter. If the screen doesn't accept country yet, the link
  // still navigates without a filter — degrade gracefully.
  const linkHref = {
    pathname: '/(tabs)/(a.home)/reciter/browse' as const,
    params: {
      country: country.id,
      countryName: country.name,
    },
  };

  // Sprint 14 user feedback — replace the cheesy globe emoji fallback
  // with a stylized 2-letter ISO 3166 monogram badge.
  // Sprint 17 S17.9 — `CountryShape` upgrades the badge to a proper SVG
  // silhouette when one is bundled for the ISO code; the monogram is now
  // the fallback.
  // Sprint 21 S21.U3 — closed the catalog-coverage gap: Palestine (PS,
  // mandate-era boundary, sourced from Wikipedia Commons) and East
  // Turkistan (synthetic 'XJ' code → Xinjiang region of China, also
  // Wikipedia Commons) now render silhouettes. Every catalog country has
  // a silhouette; the monogram-fallback path stays only for future
  // catalog additions that haven't been mapped yet.
  const isoCode = getCountryISO(country.id);
  const fallbackText = isoCode ?? country.name.slice(0, 2).toUpperCase();

  // Sprint 21 round-4 — per-tile mesh palette. Seed on ISO when present
  // (stable across catalog regenerations) or the country slug as fallback.
  const meshPalette = useMemo(
    () => paletteForKey(isoCode ?? country.id),
    [isoCode, country.id],
  );

  const content = (
    <View style={styles.content}>
      <SurahGradientMesh
        palette={meshPalette}
        isDark={theme.isDarkMode}
        viewBoxWidth={width}
        viewBoxHeight={height}
      />
      <View style={styles.badge}>
        <CountryShape
          code={isoCode}
          size={moderateScale(20)}
          color={theme.colors.text}
          fallbackText={fallbackText}
        />
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.name} numberOfLines={2}>
          {country.name}
        </Text>
        <Text style={styles.subtitle}>
          {country.reciterCount} reciter{country.reciterCount !== 1 && 's'}
        </Text>
      </View>
    </View>
  );

  if (USE_GLASS) {
    return (
      <Link href={linkHref} asChild>
        <Pressable onPress={onPress}>
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
      <Pressable style={styles.container} onPress={onPress}>
        {content}
      </Pressable>
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
    badge: {
      width: moderateScale(34),
      height: moderateScale(24),
      borderRadius: moderateScale(4),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: Color(theme.colors.text).alpha(0.1).toString(),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.18).toString(),
    },
    textContainer: {
      gap: moderateScale(2),
    },
    name: {
      fontSize: moderateScale(13),
      fontFamily: theme.fonts.semiBold,
      color: theme.colors.text,
      letterSpacing: -0.3,
      lineHeight: moderateScale(16),
    },
    subtitle: {
      fontSize: moderateScale(10),
      fontFamily: theme.fonts.regular,
      color: Color(theme.colors.textSecondary).alpha(0.5).toString(),
    },
  });
}

export default React.memo(CountryCard);
