/**
 * Sprint 11 — Sign-out confirmation modal.
 *
 * Asks the user to confirm before clearing their tokens. Local state
 * (favorites, recently-played, downloads) is NOT cleared by sign-out per
 * the soft sign-out policy — only the OAuth tokens.
 *
 * Sprint 11 (S11.4).
 */

import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import BottomSheetModal from '@/components/BottomSheetModal';
import {useTheme} from '@/hooks/useTheme';
import {useBottomInset} from '@/hooks/useBottomInset';

interface SignOutConfirmModalProps {
  isVisible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SignOutConfirmModal({
  isVisible,
  onConfirm,
  onCancel,
}: SignOutConfirmModalProps) {
  const {theme} = useTheme();
  // Sprint 17 user test: the prior `['38%']` snap point left the
  // Sign-out + Cancel buttons rendering behind the mini-player + tab bar
  // overlay whenever a track was loaded. Push the sheet up enough that
  // the action row sits comfortably above the bottom-inset region.
  const bottomInset = useBottomInset();
  return (
    <BottomSheetModal
      isVisible={isVisible}
      onClose={onCancel}
      snapPoints={['55%']}>
      <View style={[styles.container, {paddingBottom: bottomInset}]}>
        <Text style={[styles.title, {color: theme.colors.text}]}>
          Sign out of Qariah?
        </Text>
        <Text style={[styles.body, {color: theme.colors.textSecondary}]}>
          Your favorites, listening history, and downloads will stay on this
          device. You can sign back in any time from Settings.
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={onConfirm}
            style={[styles.button, styles.destructiveButton]}
            accessibilityRole="button"
            accessibilityLabel="Sign out">
            <Text style={styles.destructiveButtonText}>Sign out</Text>
          </Pressable>
          <Pressable
            onPress={onCancel}
            style={styles.cancelButton}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Cancel sign-out">
            <Text
              style={[styles.cancelText, {color: theme.colors.textSecondary}]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: moderateScale(4),
  },
  title: {
    fontSize: moderateScale(20),
    fontFamily: 'Manrope-SemiBold',
    marginBottom: moderateScale(12),
  },
  body: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-Regular',
    lineHeight: moderateScale(20),
    // Guaranteed minimum gap before the destructive action. The `actions`
    // block uses `marginTop: 'auto'` to pin itself above the bottom inset;
    // when a track is playing the inset is large and at the 55% snap point
    // that auto-margin collapses to ~0, leaving the body nearly touching the
    // red Sign-out button. This floor keeps comfortable breathing room
    // regardless of how much free space the auto-margin has to work with.
    marginBottom: moderateScale(28),
  },
  actions: {
    marginTop: 'auto',
    paddingBottom: moderateScale(12),
    gap: moderateScale(8),
  },
  button: {
    paddingVertical: moderateScale(14),
    paddingHorizontal: moderateScale(20),
    borderRadius: moderateScale(12),
    alignItems: 'center',
  },
  destructiveButton: {
    backgroundColor: 'rgba(220, 38, 38, 0.95)',
  },
  destructiveButtonText: {
    fontSize: moderateScale(16),
    fontFamily: 'Manrope-SemiBold',
    color: 'white',
  },
  cancelButton: {
    paddingVertical: moderateScale(10),
    alignItems: 'center',
  },
  cancelText: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-Regular',
  },
});
