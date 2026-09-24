import React, {useMemo} from 'react';
import {Pressable, Text, View, StyleSheet} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {TranslationInfo} from '@/data/translationCollections';
import {useTheme} from '@/hooks/useTheme';
import Color from 'color';
import {GlassView} from 'expo-glass-effect';
import {USE_GLASS, useGlassColorScheme} from '@/hooks/useGlassProps';

interface TranslationCardProps {
  translation: TranslationInfo;
  onPress: () => void;
  width?: number;
  height?: number;
}

function TranslationCard({
  translation,
  onPress,
  width = moderateScale(110),
  height = moderateScale(92),
}: TranslationCardProps) {
  const {theme} = useTheme();
  const glassColorScheme = useGlassColorScheme();
  const styles = useMemo(
    () => createStyles(theme, width, height),
    [theme, width, height],
  );

  const content = (
    <View style={styles.content}>
      <Text style={styles.languageCode} numberOfLines={1}>
        {translation.languageCode.toUpperCase()}
      </Text>
      <View style={styles.textContainer}>
        <Text style={styles.name} numberOfLines={2}>
          {translation.name}
        </Text>
        {translation.itemCount > 0 && (
          <Text style={styles.subtitle}>
            {translation.itemCount} item
            {translation.itemCount !== 1 && 's'}
          </Text>
        )}
      </View>
    </View>
  );

  if (USE_GLASS) {
    return (
      <Pressable onPress={onPress}>
        <GlassView
          style={StyleSheet.flatten([styles.container, styles.glassContainer])}
          glassEffectStyle="regular"
          colorScheme={glassColorScheme}>
          {content}
        </GlassView>
      </Pressable>
    );
  }

  return (
    <Pressable style={styles.container} onPress={onPress}>
      {content}
    </Pressable>
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
    languageCode: {
      fontSize: moderateScale(9),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.textSecondary).alpha(0.45).toString(),
      letterSpacing: 0.8,
    },
    textContainer: {
      gap: moderateScale(2),
    },
    name: {
      fontSize: moderateScale(14),
      fontFamily: theme.fonts.semiBold,
      color: theme.colors.text,
      letterSpacing: -0.3,
      lineHeight: moderateScale(18),
    },
    subtitle: {
      fontSize: moderateScale(10),
      fontFamily: theme.fonts.regular,
      color: Color(theme.colors.textSecondary).alpha(0.5).toString(),
    },
  });
}

export default React.memo(TranslationCard);
