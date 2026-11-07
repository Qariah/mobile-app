/**
 * Onboarding — Done.
 *
 * Writes the `@qariah:onboarded` AsyncStorage flag and replaces the navigation
 * stack with the home tabs. Splash-style spinner while writing, then navigate.
 *
 * The same screen handles both the sign-in success path and the skip path —
 * the only difference is whether `useAuth().status === 'authenticated'`.
 */

import React from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {useRouter} from 'expo-router';
import {useTheme} from '@/hooks/useTheme';
import {markOnboarded} from '@/services/onboarding/onboardingState';
import {useAuth} from '@/services/auth';
import {qariahAnalytics} from '@/services/analytics/qariahEvents';

export default function OnboardingDone() {
  const {theme} = useTheme();
  const router = useRouter();
  const {status} = useAuth();

  React.useEffect(() => {
    let cancelled = false;
    qariahAnalytics.trackOnboardingCompleted({
      signed_in: status === 'authenticated',
    });
    markOnboarded()
      .catch(() => {
        // Persistence failed — still let the user into the app; we'll retry
        // the flag write on next launch via the same redirect logic.
      })
      .finally(() => {
        if (cancelled) return;
        router.replace('/(tabs)/(a.home)');
      });
    return () => {
      cancelled = true;
    };
  }, [router, status]);

  return (
    <View
      style={[styles.container, {backgroundColor: theme.colors.background}]}>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
