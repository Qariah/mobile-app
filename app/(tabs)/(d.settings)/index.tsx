import React, {useMemo, useState, useEffect} from 'react';
import {
  Text,
  Pressable,
  ScrollView,
  View,
  Linking,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import {useRouter} from 'expo-router';
import {useTheme} from '@/hooks/useTheme';
import {ScaledSheet, moderateScale} from 'react-native-size-matters';
import {Theme} from '@/utils/themeUtils';
import {Feather, MaterialIcons} from '@expo/vector-icons';
import {clearPlayerCache} from '@/services/player/utils/storage';
import Color from 'color';
import {useBottomInset} from '@/hooks/useBottomInset';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {USE_GLASS, useGlassColorScheme} from '@/hooks/useGlassProps';
import {GlassView} from 'expo-glass-effect';
import {openAppStoreForReview, markAsRated} from '@/utils/reviewUtils';
import {useAuth} from '@/services/auth';
import {fetchQfUserInfo} from '@/services/userState/qfUserInfo';
import {SignOutConfirmModal} from '@/components/auth/SignOutConfirmModal';
import {
  QuranIcon,
  DualPagesIcon,
  PersonAudioIcon,
  SelectionListIcon,
  DatabaseIcon,
  ThreeStarsReviewIcon,
  LightbulbIcon,
  ChatBubbleIcon,
  GiftBoxIcon,
  InfoRoundedIcon,
  MedalIcon,
  DocCheckIcon,
  ShieldLockIcon,
} from '@/components/Icons';
import {useDevSettingsStore} from '@/store/devSettingsStore';
import {useAnalyticsConsentStore} from '@/store/analyticsConsentStore';
import {ThemePicker} from '@/components/settings/ThemePicker';
import {showBackgroundPlaybackGuide} from '@/hooks/useBackgroundPlaybackPrompt';
import branding from '@/config/branding';
import * as Clipboard from 'expo-clipboard';
import {getDebugId, getDebugIdBlock} from '@/services/diagnostics/debugId';
import {showToast} from '@/utils/toastUtils';

// Opens the user's mail composer pre-addressed to branding.supportEmail.
// Calls Linking.openURL('mailto:…') directly instead of gating on
// Linking.canOpenURL: on iOS canOpenURL('mailto:') returns false unless the
// scheme is whitelisted in LSApplicationQueriesSchemes, which made the old
// code fall back to branding.supportUrl (the marketing homepage) and read as
// a dead link. If no mail handler exists, surface the address in an Alert so
// the user can still reach us — never bounce to a web page.
// The body carries the anonymous diagnostic block, so a report arrives with the
// debug ID that finds the sender's telemetry in Sentry and PostHog. The user
// sees the text in the composer before they send it — it is never hidden.
// `subject` is the subject line (qariah:support.emailSubject*). Callers pass
// the English text in every language, so the support inbox can sort by it.
// @ai
const openSupportEmail = async (subject: string): Promise<void> => {
  const encodedSubject = encodeURIComponent(subject);
  const body = encodeURIComponent(`\n\n${getDebugIdBlock()}\n`);
  const mailto = `mailto:${branding.supportEmail}?subject=${encodedSubject}&body=${body}`;
  try {
    await Linking.openURL(mailto);
  } catch {
    Alert.alert(
      i18n.t('qariah:support.emailUsTitle'),
      // No digit post-processing: an e-mail address keeps Latin digits.
      i18n.t('qariah:support.emailUsBody', {
        email: branding.supportEmail,
        postProcess: [],
      }),
    );
  }
};
// @ai-start
import {flipX, latinLetterSpacing} from '@/utils/rtl';
import {useTranslation} from 'react-i18next';
import type {TFunction} from 'i18next';
import i18n from '@/i18n';
import {
  getNotificationsSettingsItems,
  NOTIFICATIONS_SETTINGS_ROUTE,
  NOTIFICATIONS_SETTINGS_TYPE,
  useNotificationsHoldout,
} from '@/components/settings/notificationsSettingsItem';
// @ai-end

const isExternalLink = (type: string): boolean => {
  return [
    'support',
    'featureRequest',
    'terms',
    'privacy',
    'rateApp',
    'github',
  ].includes(type);
};

// @ai-start
const getSettingsSections = (
  t: TFunction<['settings', 'common', 'qariah']>,
  notificationsHoldout?: boolean, // @ai Qariah (S48.7)
) => {
  const appName = branding.appName;
  return [
    {
      section: t('settings:index.sections.quran'),
      items: [
        {
          title: t('settings:index.items.mushafSettings.title'),
          type: 'mushafSettings',
          description: t('settings:index.items.mushafSettings.description'),
          icon: 'quran',
          iconType: 'custom',
        },
        {
          title: t('settings:index.items.translations.title'),
          type: 'translations',
          description: t('settings:index.items.translations.description'),
          icon: 'dualPages',
          iconType: 'custom',
        },
      ],
    },
    {
      section: t('settings:index.sections.audio'),
      items: [
        {
          title: t('settings:index.items.defaultReciter.title'),
          type: 'defaultReciter',
          description: t('settings:index.items.defaultReciter.description'),
          icon: 'personAudio',
          iconType: 'custom',
        },
        {
          title: t('settings:index.items.reciterChoice.title'),
          type: 'reciterChoice',
          description: t('settings:index.items.reciterChoice.description'),
          icon: 'selectionList',
          iconType: 'custom',
        },
        // @ai Qariah (S33): Android-only. OEM battery restriction (Samsung
        // "Sleeping apps" etc.) can stop background audio. This row keeps the
        // fix discoverable beyond the bounded kill-triggered prompt
        // (hooks/useBackgroundPlaybackPrompt).
        ...(Platform.OS === 'android'
          ? [
              {
                title: t('qariah:settings.backgroundPlayback'),
                type: 'backgroundPlayback',
                description: t('qariah:settings.backgroundPlaybackDesc'),
                icon: 'battery-charging',
                iconType: 'feather',
              },
            ]
          : []),
      ],
    },
    {
      section: t('settings:index.sections.appData'),
      items: [
        {
          title: t('common:language.title'),
          type: 'language',
          description: t('common:language.description'),
          icon: 'globe',
          iconType: 'feather',
        },
        // @ai Qariah (S48.7): the Notifications page; no row in the holdout.
        ...getNotificationsSettingsItems(t, notificationsHoldout),
        {
          title: t('settings:index.items.storage.title'),
          type: 'storage',
          description: t('settings:index.items.storage.description'),
          icon: 'database',
          iconType: 'custom',
        },
      ],
    },
    {
      section: t('settings:index.sections.feedback'),
      items: [
        {
          title: t('settings:index.items.rateApp.title'),
          type: 'rateApp',
          description: t('settings:index.items.rateApp.description'),
          icon: 'star',
          iconType: 'custom',
        },
        {
          title: t('settings:index.items.featureRequest.title'),
          type: 'featureRequest',
          description: t('settings:index.items.featureRequest.description'),
          icon: 'lightbulb',
          iconType: 'custom',
        },
        {
          title: t('settings:index.items.support.title'),
          type: 'support',
          description: t('settings:index.items.support.description', {appName}),
          icon: 'chatBubble',
          iconType: 'custom',
        },
      ],
    },
    {
      section: t('settings:index.sections.about', {appName}),
      items: [
        {
          title: t('settings:index.items.whatsNew.title'),
          type: 'whatsNew',
          description: t('settings:index.items.whatsNew.description'),
          icon: 'giftBox',
          iconType: 'custom',
        },
        {
          title: t('settings:index.items.about.title', {appName}),
          type: 'about',
          description: t('settings:index.items.about.description'),
          icon: 'infoRounded',
          iconType: 'custom',
        },
        {
          title: t('settings:index.items.credits.title'),
          type: 'credits',
          description: t('settings:index.items.credits.description'),
          icon: 'medal',
          iconType: 'custom',
        },
        {
          title: t('settings:index.items.github.title'),
          type: 'github',
          description: t('settings:index.items.github.description', {appName}),
          icon: 'github',
          iconType: 'feather',
        },
        {
          title: t('settings:index.items.terms.title'),
          type: 'terms',
          description: t('settings:index.items.terms.description'),
          icon: 'docCheck',
          iconType: 'custom',
        },
        {
          title: t('settings:index.items.privacy.title'),
          type: 'privacy',
          description: t('settings:index.items.privacy.description'),
          icon: 'shieldLock',
          iconType: 'custom',
        },
      ],
    },
  ];
};
// @ai-end

const customIconMap: Record<string, React.FC<{size: number; color: string}>> = {
  quran: QuranIcon,
  dualPages: DualPagesIcon,
  personAudio: PersonAudioIcon,
  selectionList: SelectionListIcon,
  database: DatabaseIcon,
  star: ThreeStarsReviewIcon,
  lightbulb: LightbulbIcon,
  chatBubble: ChatBubbleIcon,
  giftBox: GiftBoxIcon,
  infoRounded: InfoRoundedIcon,
  medal: MedalIcon,
  docCheck: DocCheckIcon,
  shieldLock: ShieldLockIcon,
};

const renderIcon = (
  item: {icon: string; iconType: string},
  iconColor: string,
) => {
  if (item.iconType === 'custom') {
    const IconComponent = customIconMap[item.icon];
    if (IconComponent) {
      return <IconComponent size={moderateScale(22)} color={iconColor} />;
    }
  }
  if (item.iconType === 'material') {
    return (
      <MaterialIcons
        name={item.icon as any}
        size={moderateScale(20)}
        color={iconColor}
      />
    );
  }
  return (
    <Feather
      name={item.icon as any}
      size={moderateScale(20)}
      color={iconColor}
    />
  );
};

// @ai-start
export default function SettingsScreen() {
  const router = useRouter();
  const {theme} = useTheme();
  const bottomInset = useBottomInset();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const glassColorScheme = useGlassColorScheme();
  const {showFloatingDevMenu, toggleFloatingDevMenu} = useDevSettingsStore();
  const {t} = useTranslation(['settings', 'common', 'qariah']);
  // @ai Qariah (S48.7): the holdout is read again on each focus.
  const notificationsHoldout = useNotificationsHoldout();
  const settingsSections = useMemo(
    () => getSettingsSections(t, notificationsHoldout),
    [t, notificationsHoldout],
  );
  const {analyticsEnabled, setAnalyticsEnabled} = useAnalyticsConsentStore();
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

  // The debug ID is stable for the install, so read it once per mount.
  const debugId = useMemo(() => getDebugId(), []);

  // Copies the full diagnostic block. The toast repeats the ID, so the user
  // sees the value even if the paste target is another app. Never rejects: a
  // clipboard failure falls back to an Alert that shows the ID to read or type.
  const handleCopyDebugId = async (): Promise<void> => {
    try {
      await Clipboard.setStringAsync(getDebugIdBlock());
      showToast(t('qariah:debug.copied'), debugId);
    } catch {
      Alert.alert(t('qariah:debug.title'), debugId);
    }
  };

  const handleAnalyticsToggle = (value: boolean): void => {
    // The analytics service subscribes to this store and pushes the choice
    // straight to the PostHog SDK, so flipping the flag is all we do here.
    setAnalyticsEnabled(value);
  };

  const handleSignOutConfirm = async () => {
    setSignOutModalOpen(false);
    await signOut();
  };

  const iconColor = theme.colors.text;
  const chevronColor = theme.colors.textSecondary;

  const trackColor = useMemo(
    () => ({
      false: Color(theme.colors.text).alpha(0.1).toString(),
      true: Color(theme.colors.text).alpha(0.65).toString(),
    }),
    [theme.colors.text],
  );

  const handleSettingPress = async (type: string) => {
    switch (type) {
      case 'mushafSettings':
        router.push('/(d.settings)/mushaf-settings');
        break;
      case 'translations':
        router.push('/(d.settings)/translations');
        break;
      case 'defaultReciter':
        router.push('/(d.settings)/default-reciter');
        break;
      case 'reciterChoice':
        router.push('/(d.settings)/reciter-choice');
        break;
      case 'language':
        router.push('/(d.settings)/language');
        break;
      case NOTIFICATIONS_SETTINGS_TYPE: // @ai Qariah (S48.7)
        router.push(NOTIFICATIONS_SETTINGS_ROUTE);
        break;
      case 'storage':
        router.push('/(d.settings)/storage');
        break;
      case 'backgroundPlayback':
        showBackgroundPlaybackGuide();
        break;
      case 'clearCache':
        await clearPlayerCache();
        break;
      case 'rateApp':
        await markAsRated();
        await openAppStoreForReview();
        break;
      case 'whatsNew':
        router.push('/(d.settings)/whats-new');
        break;
      case 'support':
        await openSupportEmail(
          t('qariah:support.emailSubjectSupport', {lng: 'en'}),
        );
        break;
      case 'featureRequest':
        await openSupportEmail(
          t('qariah:support.emailSubjectFeatureRequest', {lng: 'en'}),
        );
        break;
      case 'terms':
        await Linking.openURL(branding.termsUrl);
        break;
      case 'privacy':
        await Linking.openURL(branding.privacyUrl);
        break;
      case 'about':
        router.push('/(d.settings)/about');
        break;
      case 'credits':
        router.push('/(d.settings)/credits');
        break;
      case 'github':
        await Linking.openURL(branding.urls.github);
        break;
      default:
        break;
    }
  };

  // iOS 26+ NativeTabs: automatic content insets handle top/bottom; manual
  // padding would double-pad. Other platforms: opt out of automatic and pad
  // manually.
  const contentPadding = USE_GLASS
    ? undefined
    : {
        paddingTop: insets.top + moderateScale(10),
        paddingBottom: bottomInset,
      };

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
        contentInsetAdjustmentBehavior={USE_GLASS ? 'automatic' : 'never'}
        contentContainerStyle={[styles.scrollContent, contentPadding]}
        showsVerticalScrollIndicator={false}>
        {/* Account (Sprint 11) */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            {t('qariah:account.section')}
          </Text>
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

        {/* Appearance */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            {t('settings:index.appearance')}
          </Text>
          <ThemePicker />
        </View>

        {/* Settings Sections */}
        {settingsSections.map(section => (
          <View key={section.section} style={styles.section}>
            <Text style={styles.sectionHeader}>
              {section.section.toUpperCase()}
            </Text>
            {renderCard(
              section.items.map((item, itemIndex) => (
                <React.Fragment key={item.type}>
                  {itemIndex > 0 && <View style={styles.divider} />}
                  <Pressable
                    style={({pressed}) => [
                      styles.settingsRow,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => handleSettingPress(item.type)}>
                    <View style={styles.settingsItemIcon}>
                      {renderIcon(item, iconColor)}
                    </View>
                    <View style={styles.settingsTextContainer}>
                      <Text style={styles.settingsTitle}>{item.title}</Text>
                      <Text style={styles.settingsDescription}>
                        {item.description}
                      </Text>
                    </View>
                    <Feather
                      name={
                        isExternalLink(item.type)
                          ? 'external-link'
                          : 'chevron-right'
                      }
                      size={moderateScale(16)}
                      color={chevronColor}
                      style={isExternalLink(item.type) ? undefined : flipX}
                    />
                  </Pressable>
                </React.Fragment>
              )),
            )}
          </View>
        ))}

        {/* Privacy Section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            {t('settings:index.analytics.section')}
          </Text>
          {renderCard(
            <>
              <View style={styles.settingsRow}>
                <View style={styles.settingsItemIcon}>
                  <Feather
                    name="bar-chart-2"
                    size={moderateScale(20)}
                    color={iconColor}
                  />
                </View>
                <View style={styles.settingsTextContainer}>
                  <Text style={styles.settingsTitle}>
                    {t('settings:index.analytics.title')}
                  </Text>
                  <Text style={styles.settingsDescription}>
                    {t('settings:index.analytics.description', {
                      appName: branding.appName,
                    })}
                  </Text>
                </View>
                <Switch
                  value={analyticsEnabled}
                  onValueChange={handleAnalyticsToggle}
                  trackColor={trackColor}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor={trackColor.false}
                  style={styles.switchStyle}
                />
              </View>
              <View style={styles.divider} />
              {/*
               * Copy debug ID. The subtitle shows the ID itself, so a user who
               * cannot paste can read it aloud or type it. The tap copies the
               * full diagnostic block. The ID is the anonymous device UUID —
               * it holds no name, no email, and no account link.
               */}
              <Pressable
                style={({pressed}) => [
                  styles.settingsRow,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('qariah:debug.copy')}
                onPress={handleCopyDebugId}>
                <View style={styles.settingsItemIcon}>
                  <Feather
                    name="hash"
                    size={moderateScale(20)}
                    color={iconColor}
                  />
                </View>
                <View style={styles.settingsTextContainer}>
                  <Text style={styles.settingsTitle}>
                    {t('qariah:debug.copy')}
                  </Text>
                  <Text style={styles.settingsDescription} selectable>
                    {debugId}
                  </Text>
                </View>
                <Feather
                  name="copy"
                  size={moderateScale(16)}
                  color={chevronColor}
                />
              </Pressable>
            </>,
          )}
        </View>

        {/* Developer Section */}
        {__DEV__ && (
          // Dev-only tools stay in English. // @ai
          // i18next-instrument-ignore
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>DEVELOPER</Text>
            {renderCard(
              <View style={styles.settingsRow}>
                <View style={styles.settingsItemIcon}>
                  <Feather
                    name="tool"
                    size={moderateScale(20)}
                    color={iconColor}
                  />
                </View>
                <View style={styles.settingsTextContainer}>
                  <Text style={styles.settingsTitle}>Floating Dev Menu</Text>
                  <Text style={styles.settingsDescription}>
                    Show the floating developer tools button
                  </Text>
                </View>
                <Switch
                  value={showFloatingDevMenu}
                  onValueChange={toggleFloatingDevMenu}
                  trackColor={trackColor}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor={trackColor.false}
                  style={styles.switchStyle}
                />
              </View>,
            )}
          </View>
        )}
      </ScrollView>
      <SignOutConfirmModal
        isVisible={signOutModalOpen}
        onConfirm={handleSignOutConfirm}
        onCancel={() => setSignOutModalOpen(false)}
      />
    </View>
  );
}
// @ai-end

// @ai-start
const createStyles = (theme: Theme) =>
  ScaledSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollContent: {
      paddingHorizontal: moderateScale(16),
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

    // --- Cards ---
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

    // --- Settings Rows ---
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(14),
    },
    pressed: {
      backgroundColor: Color(theme.colors.text).alpha(0.06).toString(),
    },
    settingsItemIcon: {
      marginRight: moderateScale(12),
      width: moderateScale(24),
      alignItems: 'center',
    },
    settingsTextContainer: {
      flex: 1,
      marginRight: moderateScale(10),
    },
    settingsTitle: {
      textAlign: 'left',
      fontSize: moderateScale(13.5),
      fontFamily: 'Manrope-Medium',
      color: theme.colors.text,
    },
    settingsDescription: {
      textAlign: 'left',
      fontSize: moderateScale(11),
      fontFamily: 'Manrope-Regular',
      color: theme.colors.textSecondary,
      marginTop: moderateScale(1),
    },

    // --- Switch ---
    switchStyle: {
      transform: [{scaleX: 0.8}, {scaleY: 0.8}],
    },
  });
// @ai-end
