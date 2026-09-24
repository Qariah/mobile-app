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
const openSupportEmail = async (subjectSuffix: string): Promise<void> => {
  const subject = encodeURIComponent(`${branding.appName} ${subjectSuffix}`);
  const body = encodeURIComponent(`\n\n${getDebugIdBlock()}\n`);
  const mailto = `mailto:${branding.supportEmail}?subject=${subject}&body=${body}`;
  try {
    await Linking.openURL(mailto);
  } catch {
    Alert.alert('Email us', `Please reach us at ${branding.supportEmail}`);
  }
};

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

const settingsItems = [
  {
    section: 'Quran',
    items: [
      {
        title: 'Mushaf Settings',
        type: 'mushafSettings',
        description: 'Customize Quran display options',
        icon: 'quran',
        iconType: 'custom',
      },
      {
        title: 'Translations & Tafaseer',
        type: 'translations',
        description: 'Manage Quran translations and commentary',
        icon: 'dualPages',
        iconType: 'custom',
      },
    ],
  },
  {
    section: 'Audio & Playback',
    items: [
      {
        title: 'Default Reciter',
        type: 'defaultReciter',
        description: 'Choose your preferred reciter',
        icon: 'personAudio',
        iconType: 'custom',
      },
      {
        title: 'Reciter Choice',
        type: 'reciterChoice',
        description: 'Customize reciter selection',
        icon: 'selectionList',
        iconType: 'custom',
      },
      // Android-only: OEM battery restriction (Samsung "Sleeping apps" etc.)
      // can stop background audio. This row keeps the fix discoverable beyond
      // the bounded kill-triggered prompt (hooks/useBackgroundPlaybackPrompt).
      ...(Platform.OS === 'android'
        ? [
            {
              title: 'Background Playback',
              type: 'backgroundPlayback',
              description: 'Keep audio playing when the screen is off',
              icon: 'battery-charging',
              iconType: 'feather',
            },
          ]
        : []),
    ],
  },
  {
    section: 'App & Data',
    items: [
      {
        title: 'Storage',
        type: 'storage',
        description: 'View and manage storage usage',
        icon: 'database',
        iconType: 'custom',
      },
    ],
  },
  {
    section: 'Feedback',
    items: [
      {
        title: 'Write a Review',
        type: 'rateApp',
        description: 'Share your experience with others',
        icon: 'star',
        iconType: 'custom',
      },
      {
        title: 'Feature Requests',
        type: 'featureRequest',
        description: 'Suggest improvements and new features',
        icon: 'lightbulb',
        iconType: 'custom',
      },
      {
        title: 'Help & Support',
        type: 'support',
        description: `Get assistance with using ${branding.appName}`,
        icon: 'chatBubble',
        iconType: 'custom',
      },
    ],
  },
  {
    section: `About ${branding.appName}`,
    items: [
      {
        title: "What's New",
        type: 'whatsNew',
        description: "See what's new in this version",
        icon: 'giftBox',
        iconType: 'custom',
      },
      {
        title: `About ${branding.appName}`,
        type: 'about',
        description: 'Learn more about our mission',
        icon: 'infoRounded',
        iconType: 'custom',
      },
      {
        title: 'Credits',
        type: 'credits',
        description: 'View contributors and acknowledgments',
        icon: 'medal',
        iconType: 'custom',
      },
      {
        title: 'Contribute on GitHub',
        type: 'github',
        description: `${branding.appName} is open source. Star, report issues, or submit a PR`,
        icon: 'github',
        iconType: 'feather',
      },
      {
        title: 'Terms of Service',
        type: 'terms',
        description: 'Read our terms of service',
        icon: 'docCheck',
        iconType: 'custom',
      },
      {
        title: 'Privacy Policy',
        type: 'privacy',
        description: 'View our privacy policy',
        icon: 'shieldLock',
        iconType: 'custom',
      },
    ],
  },
];

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

export default function SettingsScreen() {
  const router = useRouter();
  const {theme} = useTheme();
  const bottomInset = useBottomInset();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const glassColorScheme = useGlassColorScheme();
  const {showFloatingDevMenu, toggleFloatingDevMenu} = useDevSettingsStore();
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
      showToast('Debug ID copied', debugId);
    } catch {
      Alert.alert('Debug ID', debugId);
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
        await openSupportEmail('support');
        break;
      case 'featureRequest':
        await openSupportEmail('feature request');
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
          <Text style={styles.sectionHeader}>ACCOUNT</Text>
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
                    <Text style={styles.settingsTitle}>Signed in</Text>
                    <Text style={styles.settingsDescription}>
                      {userEmail ?? 'Quran Foundation account'}
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
                    <Text style={styles.settingsTitle}>Your data</Text>
                    <Text style={styles.settingsDescription}>
                      Export, import, or restore favorites from the original
                      Qariah app
                    </Text>
                  </View>
                  <Feather
                    name="chevron-right"
                    size={moderateScale(16)}
                    color={chevronColor}
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
                    <Text style={styles.settingsTitle}>Sign out</Text>
                    <Text style={styles.settingsDescription}>
                      Your data stays on this device
                    </Text>
                  </View>
                  <Feather
                    name="chevron-right"
                    size={moderateScale(16)}
                    color={chevronColor}
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
                  <Text style={styles.settingsTitle}>Sign in to Qariah</Text>
                  <Text style={styles.settingsDescription}>
                    Restore your favorites from the original Qariah app
                  </Text>
                </View>
                <Feather
                  name="chevron-right"
                  size={moderateScale(16)}
                  color={chevronColor}
                />
              </Pressable>
            ),
          )}
        </View>

        {/* Appearance */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>APPEARANCE</Text>
          <ThemePicker />
        </View>

        {/* Settings Sections */}
        {settingsItems.map(section => (
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
                    />
                  </Pressable>
                </React.Fragment>
              )),
            )}
          </View>
        ))}

        {/* Privacy Section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>PRIVACY</Text>
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
                    Share anonymous usage data
                  </Text>
                  <Text style={styles.settingsDescription}>
                    Help improve {branding.appName} with anonymous, non-personal
                    analytics. Your name and account are never shared.
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
                accessibilityLabel="Copy debug ID"
                onPress={handleCopyDebugId}>
                <View style={styles.settingsItemIcon}>
                  <Feather
                    name="hash"
                    size={moderateScale(20)}
                    color={iconColor}
                  />
                </View>
                <View style={styles.settingsTextContainer}>
                  <Text style={styles.settingsTitle}>Copy debug ID</Text>
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
      fontSize: moderateScale(10.5),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.textSecondary,
      letterSpacing: 1.2,
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
      fontSize: moderateScale(13.5),
      fontFamily: 'Manrope-Medium',
      color: theme.colors.text,
    },
    settingsDescription: {
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
