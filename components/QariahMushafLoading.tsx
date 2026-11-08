// @ai Qariah — the reader's loading state: a spinner, then words.
//
// On a slow phone the reader can wait for the Mushaf data for about 12 s:
// the first open in Lite mode on a Samsung A10s, or a full-mode phone that
// restores the reader at launch (planning/lite-mode-design.md, section 7c).
// A spinner alone looks stuck, so one line of text comes when the wait passes
// 3 s. A shorter wait shows only the spinner. Used by app/mushaf.tsx and
// app/quran/[surah].tsx.
import React, {useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text} from 'react-native';
import {useTranslation} from 'react-i18next';
import {moderateScale} from '@/utils/scale';

const TEXT_AFTER_MS = 3000;

export function QariahMushafLoading({color}: {color: string}) {
  const {t} = useTranslation('qariah');
  const [showText, setShowText] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowText(true), TEXT_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      <ActivityIndicator size="large" color={color} />
      {showText && (
        <Text
          style={[styles.text, {color}]}
          accessibilityLiveRegion="polite"
          testID="mushaf-loading-text">
          {t('mushafLoading.text')}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  text: {
    marginTop: moderateScale(16),
    marginHorizontal: moderateScale(32),
    fontSize: moderateScale(15),
    textAlign: 'center',
  },
});
