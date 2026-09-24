/**
 * Onboarding — QF sign-in screen.
 *
 * Triggers the PKCE flow against QF via services/auth. On success, navigates
 * to /onboarding/done which writes the onboarded flag and replaces the stack
 * with the home tabs. The Skip link bypasses sign-in but still marks onboarded.
 *
 * Auth is optional in v2 (browse + playback work unauthenticated); a signed-in
 * user gets favorites/last-played/preferences synced via QF's user-data API
 * starting in Sprint 3 / 4.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import {moderateScale} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {useAuth} from '@/services/auth';
import {analyticsService} from '@/services/analytics/AnalyticsService';

export default function OnboardingSignIn() {
  const {theme} = useTheme();
  const router = useRouter();
  const {status, lastError, signIn} = useAuth();
  const isWorking = status === 'loading';

  // S35.3 — onboarding funnel: sign-in step viewed.
  React.useEffect(() => {
    analyticsService.trackOnboardingStepViewed({
      step: 'sign_in',
      step_index: 1,
    });
  }, []);

  // If sign-in succeeded (status flipped), advance.
  React.useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/onboarding/done');
    }
  }, [status, router]);

  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: theme.colors.background}]}
      edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={[styles.title, {color: theme.colors.text}]}>
          Sign in to sync your reading
        </Text>
        <Text style={[styles.body, {color: theme.colors.textSecondary}]}>
          Sign in with your Quran Foundation account to keep your favorites,
          last-played, and bookmarks across devices. You can skip this for now —
          you can always sign in later from Settings.
        </Text>
        {lastError ? (
          <View
            style={[
              styles.errorBox,
              {
                backgroundColor: 'rgba(220, 38, 38, 0.10)',
                borderColor: 'rgba(220, 38, 38, 0.30)',
              },
            ]}>
            <Text style={[styles.errorText, {color: theme.colors.error}]}>
              {lastError}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Pressable
          onPress={signIn}
          disabled={isWorking}
          style={({pressed}) => [
            styles.cta,
            {backgroundColor: theme.colors.primary},
            (pressed || isWorking) && styles.ctaPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign in with Quran Foundation">
          {isWorking ? (
            <ActivityIndicator color={theme.colors.background} />
          ) : (
            <Text style={[styles.ctaText, {color: theme.colors.background}]}>
              Sign in with Quran Foundation
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            analyticsService.trackOnboardingSkipped({step: 'sign_in'});
            router.replace('/onboarding/done');
          }}
          style={styles.skipButton}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip sign-in for now">
          <Text style={[styles.skipText, {color: theme.colors.textSecondary}]}>
            Skip for now
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
  title: {
    fontSize: moderateScale(28),
    fontFamily: 'Manrope-Bold',
    lineHeight: moderateScale(36),
  },
  body: {
    fontSize: moderateScale(15),
    fontFamily: 'Manrope-Regular',
    lineHeight: moderateScale(22),
  },
  errorBox: {
    marginTop: moderateScale(8),
    padding: moderateScale(12),
    borderRadius: moderateScale(10),
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: {
    fontSize: moderateScale(13),
    fontFamily: 'Manrope-Medium',
    lineHeight: moderateScale(18),
  },
  footer: {
    paddingBottom: moderateScale(12),
    gap: moderateScale(8),
  },
  cta: {
    paddingVertical: moderateScale(16),
    borderRadius: moderateScale(14),
    alignItems: 'center',
    minHeight: moderateScale(54),
    justifyContent: 'center',
  },
  ctaPressed: {opacity: 0.85},
  ctaText: {
    fontSize: moderateScale(16),
    fontFamily: 'Manrope-SemiBold',
  },
  skipButton: {
    paddingVertical: moderateScale(12),
    alignItems: 'center',
  },
  skipText: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-Medium',
  },
});
