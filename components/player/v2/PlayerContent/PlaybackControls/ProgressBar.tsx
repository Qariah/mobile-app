import React, {useCallback, useMemo, useState} from 'react';
import {View, Text, StyleSheet} from 'react-native';
import Slider from '@react-native-community/slider';
import {moderateScale} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {usePlayerActions} from '@/hooks/usePlayerActions';
import {useProgress} from '@/services/player/store/progressStore';
// @ai-start
import {localizeDigits} from '@/i18n/format';
import {forceLTR} from '@/utils/rtl';
import {invertLtrNativeSlider} from '@/i18n/qariahIosLanguage'; // Qariah
import {useTranslation} from 'react-i18next'; // Qariah: the slider label
import {Platform, type AccessibilityActionEvent} from 'react-native'; // Qariah
// @ai-end

// Qariah: one VoiceOver swipe on the slider moves the position by this many
// seconds (the same step as the skip buttons).
const A11Y_SEEK_STEP = 15; // @ai

// @ai-start
export const ProgressBar = React.memo(() => {
  const {theme} = useTheme();
  const {t} = useTranslation(['qariah']); // @ai Qariah: the slider label
  const {seekTo} = usePlayerActions();
  const progress = useProgress();
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  const displayTime = useMemo(() => {
    if (isSeeking) return seekValue;
    return progress.seekPosition ?? progress.position;
  }, [isSeeking, seekValue, progress.seekPosition, progress.position]);

  const handleSliderStart = useCallback(() => {
    setIsSeeking(true);
    setSeekValue(progress.seekPosition ?? progress.position);
  }, [progress.seekPosition, progress.position]);

  const handleSliderChange = useCallback((value: number) => {
    setSeekValue(value);
  }, []);

  const handleSlidingComplete = useCallback(
    async (value: number) => {
      try {
        progress.setPosition(value);
        await seekTo(value);
      } catch (error) {
        console.error('Error seeking:', error);
      } finally {
        setIsSeeking(false);
      }
    },
    [progress, seekTo],
  );

  const formatTime = useCallback((seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }, []);

  // @ai-start
  // Qariah (iOS): on Fabric, React Native puts the label and the testID of
  // the Slider on its wrapper view, which is not an accessibility element.
  // VoiceOver focuses the UISlider inside, which has no label. So on iOS the
  // wrapper is the accessibility element: it says the position and moves it
  // by A11Y_SEEK_STEP for each swipe up or down. Android puts the props on
  // the SeekBar itself, so it keeps the native behavior.
  const handleAccessibilityAction = useCallback(
    async (event: AccessibilityActionEvent) => {
      const {actionName} = event.nativeEvent;
      if (actionName !== 'increment' && actionName !== 'decrement') return;
      const step =
        actionName === 'increment' ? A11Y_SEEK_STEP : -A11Y_SEEK_STEP;
      const current = progress.seekPosition ?? progress.position;
      const target = Math.min(
        Math.max(0, current + step),
        progress.duration || 0,
      );
      try {
        progress.setPosition(target);
        await seekTo(target);
      } catch (error) {
        console.error('Error seeking:', error);
      }
    },
    [progress, seekTo],
  );

  const iosAccessibility =
    Platform.OS === 'ios'
      ? {
          accessible: true,
          accessibilityValue: {
            text: t('qariah:a11y.player.positionValue', {
              position: localizeDigits(formatTime(displayTime)),
              duration: localizeDigits(formatTime(progress.duration)),
            }),
          },
          accessibilityActions: [{name: 'increment'}, {name: 'decrement'}],
          onAccessibilityAction: handleAccessibilityAction,
        }
      : {};
  // @ai-end

  return (
    <View style={[styles.container, forceLTR]}>
      <View style={styles.timeContainer}>
        <Text style={[styles.timeText, {color: theme.colors.text}]}>
          {localizeDigits(formatTime(displayTime))}
        </Text>
        <Text style={[styles.timeText, {color: theme.colors.textSecondary}]}>
          {'-'} {localizeDigits(formatTime(progress.duration - displayTime))}
        </Text>
      </View>
      <Slider
        style={styles.slider}
        // Qariah: stays left to right when UIKit runs RTL (iOS Arabic).
        inverted={invertLtrNativeSlider}
        accessibilityRole="adjustable" // @ai
        accessibilityLabel={t('qariah:a11y.player.position')} // @ai
        testID="player-progress" // @ai
        {...iosAccessibility} // @ai
        minimumValue={0}
        maximumValue={progress.duration || 1}
        tapToSeek
        value={displayTime}
        onSlidingStart={handleSliderStart}
        onValueChange={handleSliderChange}
        onSlidingComplete={handleSlidingComplete}
        minimumTrackTintColor={theme.colors.text}
        maximumTrackTintColor={`${theme.colors.text}4D`}
        thumbTintColor={isSeeking ? theme.colors.text : 'transparent'}
      />
    </View>
  );
});
// @ai-end

ProgressBar.displayName = 'ProgressBar';

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: moderateScale(10),
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: moderateScale(4),
  },
  timeText: {
    fontSize: moderateScale(12),
  },
  slider: {
    width: '100%',
    height: 40,
  },
});
