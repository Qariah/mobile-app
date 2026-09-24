import React, {useMemo, useRef} from 'react';
import {View, Text, ScrollView, Image, Pressable, Alert} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {useTheme} from '@/hooks/useTheme';
import {ScaledSheet, moderateScale} from 'react-native-size-matters';
import {Theme} from '@/utils/themeUtils';
import Color from 'color';
import {VersionDisplay} from '@/components/VersionDisplay';

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

// Sprint 8 (S8.3, TECH_DEBT #34): hidden 5-tap-on-version gesture sends a
// synthetic exception to Sentry. Used to validate the crash-reporting
// path end-to-end (event arrival, source-map symbolication, release
// tagging, alert delivery) without waiting for an organic crash.
// Production-safe — requires deliberate gesture; no UI affordance.
// Window: 5 taps within 2s. Resets on timeout or successful trigger.
const SYNTHETIC_CRASH_TAP_COUNT = 5;
const SYNTHETIC_CRASH_TAP_WINDOW_MS = 2000;

export default function AboutScreen() {
  const {theme} = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

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
            accessibilityLabel="App version (tap 5 times for diagnostics)">
            {/* showBuildNumber → "Version 3.1.8 (1315)"; the (NNNN) is the
                versionCode/build number users need when reporting issues.
                NOT showBuildType — getBuildTypeLabel() tags every prod build
                "Preview (qariah-main)" since our branch isn't literally main. */}
            <VersionDisplay showBuildNumber style={styles.version} />
          </Pressable>

          <Text style={styles.tagline}>
            Your Companion for Quranic Recitation
          </Text>

          <View style={styles.section}>
            <Text style={styles.contentHeading}>Alhamdulillah</Text>
            <Text style={styles.bodyText}>
              All praise belongs to Allah, who revealed His Book and made it
              easy to remember. Qariah was built out of love for the Qur&apos;an
              and for the women whose voices carry it. We ask Allah to accept
              this small effort and make it a source of good for our daughters
              and for the whole Ummah.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.contentHeading}>Our Mission</Text>
            <Text style={styles.bodyText}>
              Qariah celebrates the recitation of the Holy Qur&apos;an by women
              — contemporary and historical, gathered from across the world and
              across many narrations. We&apos;ve brought over 60 reciters into
              one calm, beautiful space, so that every listener — and especially
              the next generation of girls — can hear the Qur&apos;an in a voice
              that feels like their own.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionHeader}>FEATURES</Text>
            <View style={styles.featureList}>
              <Feature
                title="Offline Downloads"
                description="Download surahs for offline listening anytime, anywhere without internet connection"
                styles={styles}
              />
              <Feature
                title="Custom Playlists"
                description="Create and manage your own personalized playlists of your favorite recitations"
                styles={styles}
              />
              <Feature
                title="Browse by Juz"
                description="Easily navigate through the Quran with Juz-based organization and grouping"
                styles={styles}
              />
              <Feature
                title="Advanced Audio Controls"
                description="Precise playback control with continuous play and adjustable recitation speed"
                styles={styles}
              />
              <Feature
                title="High-Quality Audio"
                description="Crystal clear recitations from the world's best Qaris with optimized streaming"
                styles={styles}
              />
              <Feature
                title="Curated Collections"
                description="Thoughtfully organized surahs for different occasions and themes"
                styles={styles}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionHeader}>COMING SOON</Text>
            <Text style={styles.bodyText}>
              We&apos;re working hard to bring you even more features to enhance
              your Quranic journey, including:
            </Text>
            <View style={[styles.featureList, {marginTop: moderateScale(12)}]}>
              <Feature
                title="Multiple Translations"
                description="Access Quran translations in various languages to better understand the meanings"
                styles={styles}
              />
              <Feature
                title="Smart Bookmarking"
                description="Save your favorite verses and track your progress across surahs"
                styles={styles}
              />
              <Feature
                title="Community Features"
                description="Connect with others, share your journey, and grow together in your Quranic experience"
                styles={styles}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.contentHeading}>Our Commitment</Text>
            <Text style={styles.bodyText}>
              We&apos;re committed to honoring these reciters, and the Book they
              recite, with the care it deserves. Qariah will stay a respectful,
              thoughtfully curated home for the Qur&apos;an, and we&apos;ll keep
              adding reciters and refining the experience, insha&apos;Allah.
              Thank you for being part of this journey. May Allah accept it from
              us all.
            </Text>
          </View>
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
      letterSpacing: 1.2,
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
