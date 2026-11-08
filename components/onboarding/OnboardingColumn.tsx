// @ai Qariah: the content column of the onboarding screens (Sprint 52, Task 7).
// On a phone it fills the screen, as before. On a tablet it is a centred
// column of at most `SHEET_MAX_WIDTH` (560 pt), the width of the iPad sheet
// cards, so the text and the buttons do not stretch over a 1180 pt window.
import React from 'react';
import {StyleSheet, View} from 'react-native';
import {useResponsive} from '@/hooks/useResponsive';
import {SHEET_MAX_WIDTH} from '@/components/sheets/AdaptiveActionSheet';

export function OnboardingColumn({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {isTablet} = useResponsive();
  return (
    <View
      testID="onboarding-column"
      style={[styles.column, isTablet && styles.tablet]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    justifyContent: 'space-between',
  },
  tablet: {
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    alignSelf: 'center',
  },
});
