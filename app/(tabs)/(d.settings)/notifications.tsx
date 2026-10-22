// @ai-generated
/**
 * Settings → Notifications (Qariah, Sprint 48, S48.7).
 *
 * One switch for each local-notification type, bound to the persisted prefs
 * store (`services/notifications/prefsStore.ts`). The switches only record the
 * choice; the engine (Tasks 15 and 16) reads the store when it schedules.
 *
 * The system permission is read on focus and when the app comes back to the
 * foreground (the user can change it in the system settings and return).
 * When it is off, a banner shows at the top. Its button shows the system
 * dialog while the system can still ask (iOS before the first answer), else
 * it opens the system settings of the app. The switches stay usable while the
 * permission is off, but they look secondary.
 *
 * The switches stay disabled until the stored choices are read
 * (`whenNotificationPrefsHydrated()`, checked on each focus). When the read
 * fails, they stay disabled and one line says so: a switch changed over the
 * defaults would write the defaults over the stored choices.
 *
 * A user in the notifications holdout gets no page (S48.6): the route
 * redirects to the Settings index, because a deep link or a row built before
 * the arm was written can still reach it. The Settings row is hidden too
 * (`components/settings/notificationsSettingsItem.ts`). The holdout is read
 * again on each focus.
 *
 * RTL: the rows use `flexDirection: 'row'` and `textAlign: 'left'`, which
 * React Native mirrors in Arabic (`I18nManager.swapLeftAndRightInRTL`, see
 * `i18n/language.ts`), so the switches sit on the left and the text is
 * right-aligned, as on the Settings index.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import {Redirect, useFocusEffect} from 'expo-router';
import type {NotificationPermissionsStatus} from 'expo-notifications';
import {Feather} from '@expo/vector-icons';
import {moderateScale, ScaledSheet} from 'react-native-size-matters';
import Color from 'color';
import {GlassView} from 'expo-glass-effect';
import {useTranslation} from 'react-i18next';
import {useTheme} from '@/hooks/useTheme';
import {useBottomInset} from '@/hooks/useBottomInset';
import {USE_GLASS, useGlassColorScheme} from '@/hooks/useGlassProps';
import type {Theme} from '@/utils/themeUtils';
import {latinLetterSpacing} from '@/utils/rtl';
import branding from '@/config/branding';
import {
  useNotificationPrefsStore,
  whenNotificationPrefsHydrated,
} from '@/services/notifications/prefsStore';
import {useNotificationsHoldout} from '@/components/settings/notificationsSettingsItem';
import {notificationPermissionAction} from '@/services/notifications/permissionAction';
import type {NotificationType} from '@/services/notifications/types';

/**
 * expo-notifications, required on first use: expo-router loads each route
 * module at startup, and the page must not add the native module to the cold
 * start (PERF-01). services/audio/ExpoAudioProvider.tsx loads it on demand
 * too. A `require`, not `import()`: Jest runs without ESM dynamic imports.
 */
function notificationsModule(): typeof import('expo-notifications') {
  return require('expo-notifications') as typeof import('expo-notifications');
}

/** The notification analytics, required on first use (as expo-notifications). */
function analyticsModule(): typeof import('@/services/notifications/notificationAnalytics') {
  return require('@/services/notifications/notificationAnalytics') as typeof import('@/services/notifications/notificationAnalytics');
}

/** The iOS options of the request (GATE 1: no badge). */
const IOS_PERMISSION_REQUEST = {
  ios: {allowAlert: true, allowSound: true, allowBadge: false},
} as const;

type RowText = {
  title:
    | 'qariah:settings.notifications.followedRecitation'
    | 'qariah:settings.notifications.newRecitation'
    | 'qariah:settings.notifications.kahfFriday'
    | 'qariah:settings.notifications.continueListening'
    | 'qariah:settings.notifications.whatsNew';
  description:
    | 'qariah:settings.notifications.followedRecitationDesc'
    | 'qariah:settings.notifications.newRecitationDesc'
    | 'qariah:settings.notifications.kahfFridayDesc'
    | 'qariah:settings.notifications.continueListeningDesc'
    | 'qariah:settings.notifications.whatsNewDesc';
};

/** The page order of the switches (not the priority of `scheduler.ts`). */
const ROWS: ReadonlyArray<{type: NotificationType} & RowText> = [
  {
    type: 'followed_recitation',
    title: 'qariah:settings.notifications.followedRecitation',
    description: 'qariah:settings.notifications.followedRecitationDesc',
  },
  {
    type: 'new_recitation',
    title: 'qariah:settings.notifications.newRecitation',
    description: 'qariah:settings.notifications.newRecitationDesc',
  },
  {
    type: 'kahf_friday',
    title: 'qariah:settings.notifications.kahfFriday',
    description: 'qariah:settings.notifications.kahfFridayDesc',
  },
  {
    type: 'continue_listening',
    title: 'qariah:settings.notifications.continueListening',
    description: 'qariah:settings.notifications.continueListeningDesc',
  },
  {
    type: 'whats_new',
    title: 'qariah:settings.notifications.whatsNew',
    description: 'qariah:settings.notifications.whatsNewDesc',
  },
];

type Styles = ReturnType<typeof createStyles>;

function NotificationTypeRow({
  type,
  title,
  description,
  muted,
  disabled,
  styles,
  trackColor,
}: {
  type: NotificationType;
  title: string;
  description: string;
  muted: boolean;
  disabled: boolean;
  styles: Styles;
  trackColor: {false: string; true: string};
}) {
  const enabled = useNotificationPrefsStore(s => s[type]);
  const setTypeEnabled = useNotificationPrefsStore(s => s.setTypeEnabled);
  const onValueChange = useCallback(
    (value: boolean) => setTypeEnabled(type, value),
    [setTypeEnabled, type],
  );
  return (
    <View style={styles.row}>
      <View style={[styles.textContainer, muted && styles.muted]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Switch
        testID={`notification-switch-${type}`}
        accessibilityLabel={title}
        accessibilityHint={description}
        value={enabled}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={trackColor}
        thumbColor="#FFFFFF"
        ios_backgroundColor={trackColor.false}
        style={[styles.switch, muted && styles.muted]}
      />
    </View>
  );
}

export default function NotificationsSettingsScreen() {
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah', 'common']);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const glassColorScheme = useGlassColorScheme();
  const bottomInset = useBottomInset();
  const holdout = useNotificationsHoldout();
  const [permission, setPermission] =
    useState<NotificationPermissionsStatus | null>(null);
  // `hasHydrated()` is true only after a read that succeeded; it avoids one
  // frame of disabled switches when the store is already read.
  const [prefsRead, setPrefsRead] = useState<'pending' | 'ok' | 'failed'>(() =>
    useNotificationPrefsStore.persist.hasHydrated() ? 'ok' : 'pending',
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const readPermission = useCallback(async () => {
    try {
      const next = await notificationsModule().getPermissionsAsync();
      if (mountedRef.current) setPermission(next);
    } catch (error) {
      // Keep the last value: no banner is better than a wrong one.
      if (__DEV__) {
        console.warn('[notifications] permission read failed', error);
      }
    }
  }, []);

  // After a failed read, `whenNotificationPrefsHydrated()` reads once more, so
  // a new focus is a new try.
  const checkPrefsRead = useCallback(async () => {
    setPrefsRead(previous => (previous === 'ok' ? previous : 'pending'));
    let ok = false;
    try {
      ok = await whenNotificationPrefsHydrated();
    } catch {
      ok = false;
    }
    if (mountedRef.current) setPrefsRead(ok ? 'ok' : 'failed');
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (holdout) return;
      // Neither function rejects.
      readPermission();
      checkPrefsRead();
    }, [holdout, readPermission, checkPrefsRead]),
  );

  useEffect(() => {
    if (holdout) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') readPermission();
    });
    return () => subscription.remove();
  }, [holdout, readPermission]);

  const action = permission ? notificationPermissionAction(permission) : 'none';

  const handleBannerPress = useCallback(async () => {
    if (action === 'ask') {
      try {
        void analyticsModule().trackPermissionPrompted('settings');
        const next = await notificationsModule().requestPermissionsAsync(
          IOS_PERMISSION_REQUEST,
        );
        void analyticsModule().trackPermissionResult(
          'settings',
          'system',
          next,
        );
        if (mountedRef.current) setPermission(next);
        // A grant registers the background task and schedules the Al-Kahf
        // reminder now, not at the next start (S48.6).
        if (next.granted || next.status === 'granted') {
          const {syncNotifications} =
            require('@/services/notifications/notificationsSync') as typeof import('@/services/notifications/notificationsSync');
          void syncNotifications('permission_granted');
        }
        return;
      } catch (error) {
        // Fall through: the system settings can still turn them on.
        if (__DEV__) {
          console.warn('[notifications] permission request failed', error);
        }
      }
    }
    try {
      await Linking.openSettings();
    } catch (error) {
      if (__DEV__) {
        console.warn('[notifications] openSettings failed', error);
      }
    }
  }, [action]);

  const trackColor = useMemo(
    () => ({
      false: Color(theme.colors.text).alpha(0.1).toString(),
      true: Color(theme.colors.text).alpha(0.65).toString(),
    }),
    [theme.colors.text],
  );

  if (holdout) return <Redirect href="/(d.settings)" />;

  const permissionOff = action !== 'none';
  const switchesEnabled = prefsRead === 'ok';

  const renderCard = (children: React.ReactNode) =>
    USE_GLASS ? (
      <GlassView
        style={styles.card}
        glassEffectStyle="regular"
        colorScheme={glassColorScheme}>
        {children}
      </GlassView>
    ) : (
      <View style={styles.card}>{children}</View>
    );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          {paddingBottom: bottomInset + moderateScale(40)},
        ]}
        showsVerticalScrollIndicator={false}>
        {permissionOff && (
          <View style={styles.banner} testID="notifications-permission-banner">
            <View style={styles.bannerRow}>
              <Feather
                name="bell-off"
                size={moderateScale(18)}
                color={theme.colors.text}
                style={styles.bannerIcon}
              />
              <Text style={styles.bannerText}>
                {t('qariah:settings.notifications.permissionOff', {
                  appName: branding.appName,
                })}
              </Text>
            </View>
            <Pressable
              testID="notifications-permission-button"
              accessibilityRole="button"
              onPress={handleBannerPress}
              style={({pressed}) => [
                styles.bannerButton,
                pressed && styles.bannerButtonPressed,
              ]}>
              <Text style={styles.bannerButtonText}>
                {action === 'ask'
                  ? t('qariah:settings.notifications.allow')
                  : t('qariah:common.openSettings')}
              </Text>
            </Pressable>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            {t('qariah:settings.notifications.typesSection')}
          </Text>
          {prefsRead === 'failed' && (
            <Text
              style={styles.readFailed}
              testID="notifications-prefs-read-failed">
              {t('qariah:settings.notifications.readFailed')}
            </Text>
          )}
          {renderCard(
            ROWS.map((row, index) => (
              <React.Fragment key={row.type}>
                {index > 0 && <View style={styles.divider} />}
                <NotificationTypeRow
                  type={row.type}
                  title={t(row.title)}
                  description={t(row.description, {
                    appName: branding.appName,
                  })}
                  muted={permissionOff || !switchesEnabled}
                  disabled={!switchesEnabled}
                  styles={styles}
                  trackColor={trackColor}
                />
              </React.Fragment>
            )),
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    // flex: 1 lets the iOS 26 NativeTabs accessory track this scroll view
    // (see mushaf-settings.tsx).
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: moderateScale(16),
      paddingTop: moderateScale(16),
    },
    banner: {
      backgroundColor: Color(theme.colors.text).alpha(0.07).toString(),
      borderRadius: moderateScale(14),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.1).toString(),
      padding: moderateScale(14),
      marginBottom: moderateScale(16),
    },
    bannerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    bannerIcon: {
      marginRight: moderateScale(10),
      marginTop: moderateScale(1),
    },
    bannerText: {
      flex: 1,
      textAlign: 'left',
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Medium',
      color: theme.colors.text,
      lineHeight: moderateScale(18),
    },
    bannerButton: {
      alignSelf: 'flex-start',
      marginTop: moderateScale(12),
      paddingVertical: moderateScale(8),
      paddingHorizontal: moderateScale(14),
      borderRadius: moderateScale(10),
      backgroundColor: theme.colors.text,
    },
    bannerButtonPressed: {
      opacity: 0.8,
    },
    bannerButtonText: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.background,
    },
    section: {
      marginBottom: moderateScale(14),
    },
    sectionHeader: {
      textAlign: 'left',
      fontSize: moderateScale(10.5),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.textSecondary,
      letterSpacing: latinLetterSpacing(1.2),
      textTransform: 'uppercase',
      marginBottom: moderateScale(6),
      marginLeft: moderateScale(2),
    },
    card: {
      backgroundColor: USE_GLASS
        ? undefined
        : Color(theme.colors.text).alpha(0.04).toString(),
      borderRadius: moderateScale(14),
      borderWidth: USE_GLASS ? 0 : 1,
      borderColor: USE_GLASS
        ? undefined
        : Color(theme.colors.text).alpha(0.06).toString(),
      overflow: 'hidden',
    },
    divider: {
      height: 1,
      backgroundColor: Color(theme.colors.text)
        .alpha(USE_GLASS ? 0.1 : 0.06)
        .toString(),
      marginHorizontal: moderateScale(16),
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(14),
    },
    textContainer: {
      flex: 1,
      marginRight: moderateScale(10),
    },
    title: {
      textAlign: 'left',
      fontSize: moderateScale(13.5),
      fontFamily: 'Manrope-Medium',
      color: theme.colors.text,
    },
    description: {
      textAlign: 'left',
      fontSize: moderateScale(11),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.textSecondary,
      marginTop: moderateScale(1),
    },
    switch: {
      transform: [{scaleX: 0.8}, {scaleY: 0.8}],
    },
    readFailed: {
      textAlign: 'left',
      fontSize: moderateScale(12),
      fontFamily: 'Manrope-Medium',
      color: theme.colors.text,
      lineHeight: moderateScale(17),
      marginBottom: moderateScale(8),
      marginLeft: moderateScale(2),
    },
    // The permission is off (the switches still record the choice), or the
    // stored choices are not read yet (the switches are disabled).
    muted: {
      opacity: 0.5,
    },
  });
