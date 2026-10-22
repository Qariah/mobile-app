import React, {useCallback, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ToastAndroid,
  Platform,
} from 'react-native';
import {useTheme} from '@/hooks/useTheme';
import {moderateScale} from 'react-native-size-matters';
import {pickRandomRecitations} from '@/utils/randomRecitation';
import * as Haptics from 'expo-haptics';
import {usePlayerActions} from '@/hooks/usePlayerActions';
import {createTracksForReciter} from '@/utils/track';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import {Theme} from '@/utils/themeUtils';
import {
  renderFullWidthBackground,
  getTextColors,
} from './random-recitation/backgrounds';
// Sprint 13 — COPY_VARIANTS intentionally retained in
// `./random-recitation/types` for fork-discipline (don't delete upstream
// data). We bypass it here and render a single "Shuffle" title.
// @ai-start
import {latinLetterSpacing} from '@/utils/rtl';
import {useTranslation} from 'react-i18next';
import {getReciterDisplayName, getSurahDisplayName} from '@/i18n/format';
// @ai-end

function showToast(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
}

interface RandomRecitationHeroProps {
  style?: object;
  isCompact?: boolean;
}

const SECTION_HEIGHT = moderateScale(150);
const RANDOM_HERO_HEIGHT = SECTION_HEIGHT / 2;

// @ai-start
export function RandomRecitationHero({
  style,
  isCompact = false,
}: RandomRecitationHeroProps) {
  const {theme} = useTheme();
  const {t} = useTranslation(['home', 'common']);
  const {updateQueue, play} = usePlayerActions();
  const startNewChain = useRecentlyPlayedStore(s => s.startNewChain);

  // Animation
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, {damping: 20, stiffness: 400, mass: 0.5});
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, {damping: 20, stiffness: 400, mass: 0.5});
  };

  const handleRandomPlay = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showToast(t('randomHero.finding'));

      const picks = pickRandomRecitations(15);
      if (picks.length === 0) {
        showToast(t('randomHero.findFailed'));
        return;
      }

      const {reciter, surah, rewayatId} = picks[0];
      showToast(
        t('randomHero.playing', {
          surah: getSurahDisplayName(surah),
          reciter: getReciterDisplayName(reciter),
        }),
      );

      const trackBatches = await Promise.all(
        picks.map(item =>
          createTracksForReciter(item.reciter, [item.surah], item.rewayatId),
        ),
      );
      const tracks = trackBatches.flat();
      await updateQueue(tracks, 0);
      await play();

      await startNewChain(reciter, surah, 0, 0, rewayatId);
    } catch (error) {
      console.error('Error playing random recitation:', error);
      showToast(t('randomHero.playFailed'));
    }
  }, [updateQueue, play, startNewChain, t]);

  const containerHeight = useMemo(
    () => ({height: isCompact ? moderateScale(75) : RANDOM_HERO_HEIGHT}),
    [isCompact],
  );

  const styles = useMemo(() => createStyles(theme), [theme]);
  const textColors = getTextColors('fw-ribbon', theme);

  return (
    <Animated.View
      style={[styles.container, containerHeight, animatedStyle, style]}>
      <Pressable
        onPress={handleRandomPlay}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={{flex: 1}}>
        {/* Always gradient ribbon background */}
        {renderFullWidthBackground('fw-ribbon', theme)}

        {/* Content — Sprint 13: simplified to a single "Shuffle" label */}
        <View style={styles.content}>
          <View style={styles.textContainer}>
            <Text style={[styles.title, {color: textColors.labelColor}]}>
              {t('common:actions.shuffle')}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
// @ai-end

// @ai-start
const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      borderRadius: moderateScale(20),
      overflow: 'hidden',
    },
    content: {
      flex: 1,
      padding: moderateScale(14),
      flexDirection: 'row',
      alignItems: 'center',
    },
    textContainer: {
      flex: 1,
      justifyContent: 'center',
    },
    title: {
      textAlign: 'left',
      fontFamily: 'Manrope-Bold',
      fontSize: moderateScale(13),
      letterSpacing: latinLetterSpacing(moderateScale(0.3)),
      textTransform: 'uppercase',
    },
  });
// @ai-end
