// @ai
// Qariah (Sprint 11): the Account section at the top of the Settings index,
// and its sign-out sheet. Divergence batch C3 (SHT-S6) moved them out of the
// inherited `app/(tabs)/(d.settings)/index.tsx`. Upstream's QF branch puts its
// own `QfAccountCard` at the same place, so a later swap is one line there.
//
// This is a hook that returns two elements, not one component: the section
// goes inside the screen's ScrollView, but the sign-out sheet (a gorhom
// BottomSheet, not a modal) must stay outside it, at the end of the screen
// root, or it scrolls with the content.
import React, {useEffect, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {useRouter} from 'expo-router';
import {Feather} from '@expo/vector-icons';
import {moderateScale} from 'react-native-size-matters';
import {useTranslation} from 'react-i18next';
import {useAuth} from '@/services/auth';
import {fetchQfUserInfo} from '@/services/userState/qfUserInfo';
import {SignOutConfirmModal} from '@/components/auth/SignOutConfirmModal';
import type {SettingsSlotProps} from '@/components/settings/settingsSlot';
import {flipX} from '@/utils/rtl';

export interface QariahAccountSettings {
  /** The Account section; the first child of the Settings ScrollView. */
  section: React.ReactElement;
  /** The sign-out sheet; the last child of the Settings root view. */
  signOutSheet: React.ReactElement;
}

export function useQariahAccountSettings({
  styles,
  renderCard,
  iconColor,
  chevronColor,
}: SettingsSlotProps): QariahAccountSettings {
  const router = useRouter();
  const {t} = useTranslation(['qariah']);
  const {status, signOut} = useAuth();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [signOutModalOpen, setSignOutModalOpen] = useState(false);

  // Pull the signed-in user's email for display. Best-effort — silent on
  // failure (network blip just hides the line; chevron and rows still work).
  useEffect(() => {
    let cancelled = false;
    if (status !== 'authenticated') {
      setUserEmail(null);
      return;
    }
    fetchQfUserInfo()
      .then(info => {
        if (cancelled) return;
        setUserEmail(info?.email ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserEmail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const handleSignOutConfirm = async () => {
    setSignOutModalOpen(false);
    await signOut();
  };

  const section = (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{t('qariah:account.section')}</Text>
      {renderCard(
        status === 'authenticated' ? (
          <>
            <View style={styles.settingsRow}>
              <View style={styles.settingsItemIcon}>
                <Feather
                  name="user-check"
                  size={moderateScale(20)}
                  color={iconColor}
                />
              </View>
              <View style={styles.settingsTextContainer}>
                <Text style={styles.settingsTitle}>
                  {t('qariah:account.signedIn')}
                </Text>
                <Text style={styles.settingsDescription}>
                  {userEmail ?? t('qariah:account.qfAccount')}
                </Text>
              </View>
            </View>
            <View style={styles.divider} />
            <Pressable
              style={({pressed}) => [
                styles.settingsRow,
                pressed && styles.pressed,
              ]}
              onPress={() => router.push('/(d.settings)/data')}>
              <View style={styles.settingsItemIcon}>
                <Feather
                  name="download-cloud"
                  size={moderateScale(20)}
                  color={iconColor}
                />
              </View>
              <View style={styles.settingsTextContainer}>
                <Text style={styles.settingsTitle}>
                  {t('qariah:account.yourData')}
                </Text>
                <Text style={styles.settingsDescription}>
                  {t('qariah:account.yourDataDesc')}
                </Text>
              </View>
              <Feather
                name="chevron-right"
                size={moderateScale(16)}
                color={chevronColor}
                style={flipX}
              />
            </Pressable>
            <View style={styles.divider} />
            <Pressable
              style={({pressed}) => [
                styles.settingsRow,
                pressed && styles.pressed,
              ]}
              onPress={() => setSignOutModalOpen(true)}>
              <View style={styles.settingsItemIcon}>
                <Feather
                  name="log-out"
                  size={moderateScale(20)}
                  color={iconColor}
                />
              </View>
              <View style={styles.settingsTextContainer}>
                <Text style={styles.settingsTitle}>
                  {t('qariah:account.signOut')}
                </Text>
                <Text style={styles.settingsDescription}>
                  {t('qariah:account.signOutDesc')}
                </Text>
              </View>
              <Feather
                name="chevron-right"
                size={moderateScale(16)}
                color={chevronColor}
                style={flipX}
              />
            </Pressable>
          </>
        ) : (
          <Pressable
            style={({pressed}) => [
              styles.settingsRow,
              pressed && styles.pressed,
            ]}
            onPress={() => router.push('/(d.settings)/sign-in')}>
            <View style={styles.settingsItemIcon}>
              <Feather
                name="log-in"
                size={moderateScale(20)}
                color={iconColor}
              />
            </View>
            <View style={styles.settingsTextContainer}>
              <Text style={styles.settingsTitle}>
                {t('qariah:account.signInTitle')}
              </Text>
              <Text style={styles.settingsDescription}>
                {t('qariah:account.signInDesc')}
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={moderateScale(16)}
              color={chevronColor}
              style={flipX}
            />
          </Pressable>
        ),
      )}
    </View>
  );

  const signOutSheet = (
    <SignOutConfirmModal
      isVisible={signOutModalOpen}
      onConfirm={handleSignOutConfirm}
      onCancel={() => setSignOutModalOpen(false)}
    />
  );

  return {section, signOutSheet};
}
