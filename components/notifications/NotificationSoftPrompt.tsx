// @ai-generated
/**
 * The notification card (Qariah, Sprint 48, S48.6, Task 16).
 *
 * After the first completed play, a small card at the bottom of the screen
 * lists the five notification types (the titles of the Notifications page)
 * and says that the user chooses them in Settings.
 * - iOS: "Allow" (the system dialog follows) and "Not now".
 * - Android: "Choose notifications" (opens the Notifications page) and "OK".
 *   Android asks for the permission at the first launch, so this card asks
 *   for nothing.
 * The rules are in `services/notifications/softPrompt.ts`; this component
 * only shows the card and passes the answer.
 *
 * `components/QariahRootEffects.tsx` renders it. That is outside the theme
 * provider and the layout direction of the app, so the card reads the theme
 * from the store (`useTheme`) and sets the direction itself (`appDirection`).
 * A React Native `Modal`, not a gorhom sheet: the root effects are outside
 * `GestureHandlerRootView`.
 */
import React, {useCallback, useEffect, useMemo} from 'react';
import {Modal, Platform, Pressable, Text, View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';
import Color from 'color';
import {useTranslation} from 'react-i18next';
import {useRouter} from 'expo-router';
import {useTheme} from '@/hooks/useTheme';
import type {Theme} from '@/utils/themeUtils';
import {appDirection} from '@/utils/rtl';
import branding from '@/config/branding';
import {NOTIFICATIONS_SETTINGS_ROUTE} from '@/components/settings/notificationsSettingsItem';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {closePlayerSheet} from '@/services/player/sheetRef';
import {
  answerSoftPrompt,
  confirmSoftPromptShown,
  startSoftPrompt,
  useSoftPromptStore,
} from '@/services/notifications/softPrompt';

/** The five types, in the order of the Notifications page. */
export const SOFT_PROMPT_TYPE_KEYS = [
  'qariah:settings.notifications.followedRecitation',
  'qariah:settings.notifications.newRecitation',
  'qariah:settings.notifications.kahfFriday',
  'qariah:settings.notifications.continueListening',
  'qariah:settings.notifications.whatsNew',
] as const;

export function NotificationSoftPrompt(): React.JSX.Element | null {
  const visible = useSoftPromptStore(s => s.visible);
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah', 'common']);
  const router = useRouter();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isAndroid = Platform.OS === 'android';

  // Once in a process; an unmount does not stop it (the root mounts once).
  useEffect(() => {
    startSoftPrompt();
  }, []);

  const onAllow = useCallback(() => {
    void answerSoftPrompt('allow');
  }, []);
  const onNotNow = useCallback(() => {
    void answerSoftPrompt('not_now');
  }, []);
  const onChoose = useCallback(() => {
    void answerSoftPrompt('choose');
    // The card shows when a track ends, often over the full player: close it,
    // or the page opens under the player sheet (as tapActions.ts does).
    if (usePlayerStore.getState().sheetMode === 'full') closePlayerSheet();
    router.push(NOTIFICATIONS_SETTINGS_ROUTE as never);
  }, [router]);
  const onOk = useCallback(() => {
    void answerSoftPrompt('ok');
  }, []);

  if (Platform.OS !== 'ios' && !isAndroid) return null;

  const onSecondary = isAndroid ? onOk : onNotNow;
  const onPrimary = isAndroid ? onChoose : onAllow;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // The card counts as shown (and the prompted event goes out) only here.
      onShow={confirmSoftPromptShown}
      onRequestClose={onSecondary}
      testID="notification-soft-prompt">
      <View style={[styles.backdrop, {direction: appDirection}]}>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.iconCircle}>
              <Feather
                name="bell"
                size={moderateScale(18)}
                color={theme.colors.text}
              />
            </View>
            <Text style={styles.title}>
              {t('qariah:notifications.softPrompt.title', {
                appName: branding.appName,
              })}
            </Text>
          </View>
          <View style={styles.list}>
            {SOFT_PROMPT_TYPE_KEYS.map(key => (
              <View key={key} style={styles.listRow}>
                <View
                  style={[
                    styles.listDot,
                    {backgroundColor: theme.colors.textSecondary},
                  ]}
                />
                <Text style={styles.listText}>{t(key)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.footer}>
            {t('qariah:notifications.softPrompt.footer')}
          </Text>
          <View style={styles.actions}>
            <Pressable
              testID={
                isAndroid
                  ? 'notification-soft-prompt-ok'
                  : 'notification-soft-prompt-not-now'
              }
              accessibilityRole="button"
              onPress={onSecondary}
              style={({pressed}) => [
                styles.secondaryButton,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.secondaryText}>
                {isAndroid ? t('common:actions.ok') : t('qariah:common.notNow')}
              </Text>
            </Pressable>
            <Pressable
              testID={
                isAndroid
                  ? 'notification-soft-prompt-choose'
                  : 'notification-soft-prompt-allow'
              }
              accessibilityRole="button"
              onPress={onPrimary}
              style={({pressed}) => [
                styles.primaryButton,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.primaryText}>
                {isAndroid
                  ? t('qariah:notifications.softPrompt.choose')
                  : t('qariah:notifications.softPrompt.allow')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
      paddingHorizontal: moderateScale(16),
      paddingBottom: moderateScale(40),
    },
    card: {
      backgroundColor: theme.colors.background,
      borderRadius: moderateScale(16),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.08).toString(),
      padding: moderateScale(16),
      shadowColor: '#000000',
      shadowOpacity: 0.15,
      shadowRadius: moderateScale(12),
      shadowOffset: {width: 0, height: moderateScale(4)},
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconCircle: {
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(18),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: Color(theme.colors.text).alpha(0.07).toString(),
      marginRight: moderateScale(12),
    },
    title: {
      flex: 1,
      textAlign: 'left',
      fontSize: moderateScale(15),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.text,
      lineHeight: moderateScale(21),
    },
    list: {
      marginTop: moderateScale(10),
      marginLeft: moderateScale(48),
    },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: moderateScale(3),
    },
    listDot: {
      width: moderateScale(5),
      height: moderateScale(5),
      borderRadius: moderateScale(2.5),
      marginRight: moderateScale(10),
    },
    listText: {
      flex: 1,
      textAlign: 'left',
      fontSize: moderateScale(14),
      fontFamily: 'Manrope-Medium',
      color: theme.colors.text,
      lineHeight: moderateScale(20),
    },
    footer: {
      marginTop: moderateScale(8),
      marginLeft: moderateScale(48),
      textAlign: 'left',
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.textSecondary,
      lineHeight: moderateScale(18),
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: moderateScale(14),
    },
    secondaryButton: {
      paddingVertical: moderateScale(9),
      paddingHorizontal: moderateScale(14),
      marginRight: moderateScale(8),
      borderRadius: moderateScale(10),
    },
    secondaryText: {
      fontSize: moderateScale(14),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.textSecondary,
    },
    primaryButton: {
      paddingVertical: moderateScale(9),
      paddingHorizontal: moderateScale(18),
      borderRadius: moderateScale(10),
      backgroundColor: theme.colors.text,
    },
    primaryText: {
      fontSize: moderateScale(14),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.background,
    },
    pressed: {
      opacity: 0.8,
    },
  });
