// @ai Qariah (Lite mode, step 1) — the full player without the verse text.
//
// On a Samsung A10s the player's verse text (QuranView, drawn with Skia) took
// about 4 s to show and kept the JS thread busy for 5 s
// (planning/lite-mode-design.md). In Lite mode the player shows this card
// instead, and the text only when the listener asks for it.
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {moderateScale} from '@/utils/scale';
import {useTranslation} from 'react-i18next';
import {SURAHS} from '@/data/surahData';
import {getSurahDisplayName} from '@/i18n/format';

interface LitePlayerTextCardProps {
  surah: number;
  reciter?: string;
  textColor: string;
  accentColor: string;
  contentPaddingTop: number;
  contentPaddingBottom: number;
  onShowText: () => void;
}

export function LitePlayerTextCard({
  surah,
  reciter,
  textColor,
  accentColor,
  contentPaddingTop,
  contentPaddingBottom,
  onShowText,
}: LitePlayerTextCardProps): React.ReactElement {
  const {t} = useTranslation('qariah');
  const info = SURAHS[surah - 1];
  return (
    <View
      style={[
        styles.container,
        {paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom},
      ]}>
      {info ? (
        <>
          <Text style={[styles.arabic, {color: textColor}]}>
            {info.name_arabic}
          </Text>
          <Text style={[styles.name, {color: textColor}]}>
            {getSurahDisplayName(info)}
          </Text>
        </>
      ) : null}
      {reciter ? (
        <Text style={[styles.reciter, {color: textColor}]}>{reciter}</Text>
      ) : null}
      <Text style={[styles.note, {color: textColor}]}>
        {t('lite.textHidden')}
      </Text>
      <Pressable
        accessibilityRole="button"
        testID="lite-show-text"
        onPress={onShowText}
        style={[styles.button, {borderColor: accentColor}]}>
        <Text style={[styles.buttonText, {color: accentColor}]}>
          {t('lite.showText')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: moderateScale(24),
  },
  arabic: {
    fontSize: moderateScale(32),
    marginBottom: moderateScale(4),
  },
  name: {
    fontSize: moderateScale(20),
    fontFamily: 'Manrope-Bold',
  },
  reciter: {
    fontSize: moderateScale(15),
    fontFamily: 'Manrope-Medium',
    marginTop: moderateScale(6),
    opacity: 0.8,
  },
  note: {
    fontSize: moderateScale(13),
    fontFamily: 'Manrope-Regular',
    marginTop: moderateScale(20),
    textAlign: 'center',
    opacity: 0.6,
  },
  button: {
    marginTop: moderateScale(14),
    paddingHorizontal: moderateScale(18),
    paddingVertical: moderateScale(8),
    borderRadius: moderateScale(18),
    borderWidth: 1,
  },
  buttonText: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-SemiBold',
  },
});
