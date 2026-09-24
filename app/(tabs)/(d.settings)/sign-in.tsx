/**
 * Settings — QF sign-in screen.
 *
 * Same logic as `app/onboarding/sign-in.tsx` but rendered as a Settings push
 * route. The differences are cosmetic: "Skip for now" becomes "Cancel" and
 * pops back to Settings instead of advancing to onboarding/done. Sign-in
 * success pops back automatically.
 *
 * Sprint 11 (S11.4).
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useRouter} from 'expo-router';
import {moderateScale} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {useAuth} from '@/services/auth';
import {useBottomInset} from '@/hooks/useBottomInset';

export default function SettingsSignIn() {
  const {theme} = useTheme();
  const router = useRouter();
  const {status, lastError, signIn} = useAuth();
  const isWorking = status === 'loading';
  // Sprint 12 fix — the floating mini-player + tab bar overlap the CTA otherwise.
  // useBottomInset returns 0 extra when no track is queued, so this is harmless
  // for users who haven't started playback yet.
  const bottomInset = useBottomInset();

  // If sign-in succeeded, pop back to Settings.
  React.useEffect(() => {
    if (status === 'authenticated') {
      router.back();
    }
  }, [status, router]);

  return (
    // Plain View (not SafeAreaView): `useBottomInset()` already adds the
    // safe-area bottom inset; wrapping in SafeAreaView edges={['bottom']}
    // would double-deduct on home-indicator iPhones (~34pt of dead space
    // below the Cancel button). Top safe-area is owned by the Settings
    // stack header.
    <View
      style={[styles.container, {backgroundColor: theme.colors.background}]}>
      <View style={styles.content}>
        <Text style={[styles.title, {color: theme.colors.text}]}>
          Sign in to Qariah
        </Text>
        <Text style={[styles.body, {color: theme.colors.textSecondary}]}>
          Sign in with your Quran Foundation account to restore your favorites
          from the original Qariah app. We&apos;ll only ask for this once.
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
      <View
        style={[
          styles.footer,
          {paddingBottom: bottomInset + moderateScale(12)},
        ]}>
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
          onPress={() => router.back()}
          style={styles.cancelButton}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Cancel sign-in">
          <Text
            style={[styles.cancelText, {color: theme.colors.textSecondary}]}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
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
  cancelButton: {
    paddingVertical: moderateScale(12),
    alignItems: 'center',
  },
  cancelText: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-Medium',
  },
});
