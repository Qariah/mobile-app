/**
 * Onboarding — Welcome screen.
 *
 * Qariah's mission pitch + Get Started button. Pure presentational.
 *
 * Sprint 11 (2026-05-13): re-enabled sign-in routing. The welcome screen now
 * pushes to `/onboarding/sign-in` (the QF OAuth flow that Sprint 5 had hidden).
 * Successful sign-in routes through `/onboarding/done`. Sprint 11 also wires
 * the v1 → v2 R2 migration restore that runs once on first authenticated
 * mount — see services/userState/v1Restore.ts.
 */

import React from 'react';
import {Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import {moderateScale} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {analyticsService} from '@/services/analytics/AnalyticsService';

export default function OnboardingWelcome() {
  const {theme} = useTheme();
  const router = useRouter();

  // S35.3 — onboarding funnel: the welcome screen is the first-run entry point.
  React.useEffect(() => {
    analyticsService.trackOnboardingStarted({platform: Platform.OS});
    analyticsService.trackOnboardingStepViewed({
      step: 'welcome',
      step_index: 0,
    });
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: theme.colors.background}]}
      edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={[styles.eyebrow, {color: theme.colors.textSecondary}]}>
          Welcome to Qariah
        </Text>
        <Text style={[styles.title, {color: theme.colors.text}]}>
          Hear the Qurʾan in her voice.
        </Text>
        <Text style={[styles.body, {color: theme.colors.textSecondary}]}>
          The first Qurʾan app celebrating contemporary and historical women
          reciters — bringing voices long unheard to a global audience.
        </Text>
      </View>
      <View style={styles.footer}>
        <Pressable
          onPress={() => router.push('/onboarding/sign-in')}
          style={({pressed}) => [
            styles.cta,
            {backgroundColor: theme.colors.primary},
            pressed && styles.ctaPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Get started">
          <Text style={[styles.ctaText, {color: theme.colors.background}]}>
            Get started
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: moderateScale(28),
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: moderateScale(16),
  },
  eyebrow: {
    fontSize: moderateScale(13),
    fontFamily: 'Manrope-SemiBold',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: moderateScale(34),
    fontFamily: 'Manrope-Bold',
    lineHeight: moderateScale(42),
  },
  body: {
    fontSize: moderateScale(16),
    fontFamily: 'Manrope-Regular',
    lineHeight: moderateScale(24),
    marginTop: moderateScale(8),
  },
  footer: {
    paddingBottom: moderateScale(12),
  },
  cta: {
    paddingVertical: moderateScale(16),
    borderRadius: moderateScale(14),
    alignItems: 'center',
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaText: {
    fontSize: moderateScale(16),
    fontFamily: 'Manrope-SemiBold',
  },
});
