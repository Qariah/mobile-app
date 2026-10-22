import React, {useMemo, useRef} from 'react';
import {View, Text, ScrollView, Image, Pressable, Alert} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {useTheme} from '@/hooks/useTheme';
import {ScaledSheet, moderateScale} from 'react-native-size-matters';
import {Theme} from '@/utils/themeUtils';
import Color from 'color';
import {VersionDisplay} from '@/components/VersionDisplay';
// @ai-start
import {latinLetterSpacing} from '@/utils/rtl';
import {useTranslation} from 'react-i18next';
import branding from '@/config/branding';
// @ai-end

// @ai-start
const FEATURE_KEYS = [
  'offlineDownloads',
  'customPlaylists',
  'browseByJuz',
  'audioControls',
  'highQualityAudio',
  'curatedCollections',
  'personalization',
] as const;
// @ai-end

// @ai-start
const COMING_SOON_KEYS = [
  'translations',
  'wordByWord',
  'bookmarking',
  'learningTools',
  'community',
] as const;
// @ai-end

interface FeatureProps {
  title: string;
  description: string;
  styles: ReturnType<typeof createStyles>;
}

const Feature = ({title, description, styles}: FeatureProps) => (
  <View style={styles.featureItem}>
    <Text style={styles.featureTitle}>{title}</Text>
    <Text style={styles.featureDescription}>{description}</Text>
  </View>
);

// @ai Qariah (Sprint 32 About rewrite) drops these upstream rows. Filtered at
// render so upstream's key lists stay byte-identical.
const QARIAH_HIDDEN_ABOUT_KEYS: ReadonlySet<string> = new Set([
  'personalization',
  'wordByWord',
  'learningTools',
]);

// Sprint 8 (S8.3, TECH_DEBT #34): hidden 5-tap-on-version gesture sends a
// synthetic exception to Sentry. Used to validate the crash-reporting
// path end-to-end (event arrival, source-map symbolication, release
// tagging, alert delivery) without waiting for an organic crash.
// Production-safe — requires deliberate gesture; no UI affordance.
// Window: 5 taps within 2s. Resets on timeout or successful trigger.
const SYNTHETIC_CRASH_TAP_COUNT = 5;
const SYNTHETIC_CRASH_TAP_WINDOW_MS = 2000;

// @ai-start
export default function AboutScreen() {
  const {theme} = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const {t} = useTranslation(['settings', 'qariah']);
  const appName = branding.appName;

  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleVersionTap = () => {
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    tapCountRef.current += 1;
    if (tapCountRef.current >= SYNTHETIC_CRASH_TAP_COUNT) {
      tapCountRef.current = 0;
      Sentry.captureException(
        new Error('Sprint 8 synthetic crash test (About → version 5-tap)'),
      );
      Alert.alert(
        'Synthetic crash reported',
        'A test exception was sent to Sentry. Check the Sentry UI to confirm the event arrived with symbolicated frames.',
      );
    } else {
      tapTimerRef.current = setTimeout(() => {
        tapCountRef.current = 0;
      }, SYNTHETIC_CRASH_TAP_WINDOW_MS);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}>
        <View>
          <View style={styles.logoContainer}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          <Pressable
            onPress={handleVersionTap}
            hitSlop={12}
            accessibilityLabel={t('qariah:about.versionA11y')}>
            {/* showBuildNumber → "Version 3.1.8 (1315)"; the (NNNN) is the
                versionCode/build number users need when reporting issues.
                NOT showBuildType — getBuildTypeLabel() tags every prod build
                "Preview (qariah-main)" since our branch isn't literally main. */}
            <VersionDisplay showBuildNumber style={styles.version} />
          </Pressable>

          <Text style={styles.tagline}>{t('about.tagline')}</Text>

          <View style={styles.section}>
            <Text style={styles.contentHeading}>
              {t('about.alhamdulillahHeading')}
            </Text>
            <Text style={styles.bodyText}>
              {/* @ai Qariah copy (Sprint 32). */}
              {t('qariah:about.alhamdulillahBody')}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.contentHeading}>
              {t('about.missionHeading')}
            </Text>
            <Text style={styles.bodyText}>
              {/* @ai Qariah copy (Sprint 32). */}
              {t('qariah:about.missionBody')}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionHeader}>
              {t('about.featuresHeader')}
            </Text>
            <View style={styles.featureList}>
              {FEATURE_KEYS.filter(
                key => !QARIAH_HIDDEN_ABOUT_KEYS.has(key),
              ).map(key => (
                <Feature
                  key={key}
                  title={t(`about.features.${key}.title`)}
                  description={t(`about.features.${key}.description`)}
                  styles={styles}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionHeader}>
              {t('about.comingSoonHeader')}
            </Text>
            <Text style={styles.bodyText}>{t('about.comingSoonIntro')}</Text>
            <View style={[styles.featureList, {marginTop: moderateScale(12)}]}>
              {COMING_SOON_KEYS.filter(
                key => !QARIAH_HIDDEN_ABOUT_KEYS.has(key),
              ).map(key => (
                <Feature
                  key={key}
                  title={t(`about.comingSoon.${key}.title`)}
                  description={t(`about.comingSoon.${key}.description`)}
                  styles={styles}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.contentHeading}>
              {t('about.commitmentHeading')}
            </Text>
            <Text style={styles.bodyText}>
              {/* @ai Qariah copy (Sprint 32). */}
              {t('qariah:about.commitmentBody')}
            </Text>
          </View>
        </View>
      </ScrollView>
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
    content: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: moderateScale(24),
      paddingVertical: moderateScale(20),
      paddingBottom: moderateScale(160),
    },
    logoContainer: {
      alignItems: 'center',
      marginVertical: moderateScale(32),
    },
    logo: {
      width: moderateScale(120),
      height: moderateScale(120),
      borderRadius: moderateScale(15),
    },
    version: {
      textAlign: 'center',
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Regular',
      marginBottom: moderateScale(8),
    },
    tagline: {
      textAlign: 'center',
      fontSize: moderateScale(17),
      fontFamily: 'Manrope-SemiBold',
      color: theme.colors.text,
      marginBottom: moderateScale(32),
    },
    section: {
      marginBottom: moderateScale(28),
    },
    sectionHeader: {
      fontSize: moderateScale(10.5),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.textSecondary).alpha(0.5).toString(),
      letterSpacing: latinLetterSpacing(1.2),
      textTransform: 'uppercase',
      marginBottom: moderateScale(10),
      marginLeft: moderateScale(2),
    },
    contentHeading: {
      fontSize: moderateScale(14),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.text).alpha(0.85).toString(),
      marginBottom: moderateScale(10),
    },
    bodyText: {
      fontSize: moderateScale(13),
      fontFamily: 'Manrope-Regular',
      color: Color(theme.colors.textSecondary).alpha(0.45).toString(),
      lineHeight: moderateScale(20),
    },
    featureList: {
      gap: moderateScale(10),
    },
    featureItem: {
      backgroundColor: Color(theme.colors.text).alpha(0.04).toString(),
      borderWidth: 1,
      borderColor: Color(theme.colors.text).alpha(0.06).toString(),
      padding: moderateScale(14),
      borderRadius: moderateScale(14),
    },
    featureTitle: {
      fontSize: moderateScale(13.5),
      fontFamily: 'Manrope-SemiBold',
      color: Color(theme.colors.text).alpha(0.85).toString(),
      marginBottom: moderateScale(3),
    },
    featureDescription: {
      fontSize: moderateScale(11.5),
      fontFamily: 'Manrope-Regular',
      color: Color(theme.colors.textSecondary).alpha(0.45).toString(),
      lineHeight: moderateScale(17),
    },
  });
// @ai-end
