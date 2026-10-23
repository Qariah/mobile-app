import React, {useCallback} from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import {GlassView} from 'expo-glass-effect';
import {USE_GLASS, useGlassColorScheme} from '@/hooks/useGlassProps';
import {FrostedView} from '@/components/FrostedView';
import {moderateScale} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {usePlayerActions} from '@/hooks/usePlayerActions';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {
  TimerIcon,
  RepeatIcon,
  RepeatOneIcon,
  QueueIcon,
  AmbientIcon,
} from '@/components/Icons';
import {Ionicons} from '@expo/vector-icons';
import {useAmbientStore} from '@/store/ambientStore';
import Color from 'color';
// @ai-start
import {localizeDigits} from '@/i18n/format';
import {useTranslation} from 'react-i18next'; // Qariah: the control labels
// @ai-end

interface ControlButtonsProps {
  onSpeedPress: () => void;
  onSleepTimerPress: () => void;
  onQueuePress: () => void;
  showQueue: boolean;
  onMushafLayoutPress?: () => void;
  onAmbientPress?: () => void;
  onFollowAlongPress: () => void;
  followAlongActive: boolean;
  followAlongAvailable: boolean;
}

interface Styles {
  wrapper: ViewStyle;
  button: ViewStyle;
  glassButton: ViewStyle;
  glassButtonInner: ViewStyle;
  speedButtonText: TextStyle;
}

// @ai-start
export const ControlButtons: React.FC<ControlButtonsProps> = ({
  onSpeedPress,
  onSleepTimerPress,
  onQueuePress,
  showQueue,
  onMushafLayoutPress,
  onAmbientPress,
  onFollowAlongPress,
  followAlongActive,
  followAlongAvailable,
}) => {
  const {theme} = useTheme();
  const {t} = useTranslation(['common', 'qariah', 'reader', 'sheets']); // Qariah: the control labels
  const glassColorScheme = useGlassColorScheme();
  const {updateSettings} = usePlayerActions();
  const playbackRate = usePlayerStore(s => s.playback.rate);
  const settings = usePlayerStore(s => s.settings);
  const ambientEnabled = useAmbientStore(s => s.isEnabled);

  const handleMushafLayoutPress = useCallback(() => {
    if (onMushafLayoutPress) {
      onMushafLayoutPress();
    }
  }, [onMushafLayoutPress]);

  const handleRepeatPress = () => {
    const nextMode = {
      none: 'queue',
      queue: 'track',
      track: 'none',
    }[settings.repeatMode] as 'none' | 'queue' | 'track';

    updateSettings({repeatMode: nextMode});
  };

  // Check if timer is active based on sleepTimerEnd
  const isTimerActive =
    settings.sleepTimerEnd !== null && settings.sleepTimerEnd > Date.now();

  // @ai-start
  // Qariah: the screen reader says the repeat mode after the "Repeat" label.
  const repeatModeLabel = {
    none: t('qariah:a11y.player.repeatOff'),
    queue: t('qariah:a11y.player.repeatQueue'),
    track: t('qariah:a11y.player.repeatTrack'),
  }[settings.repeatMode];
  const followAlongOn = followAlongAvailable && followAlongActive;
  // @ai-end

  const activeBackgroundColor = Color(theme.colors.text).alpha(0.08).toString();
  const defaultIconColor = theme.colors.text;
  const activeIconColor = theme.colors.text;

  const PillWrapper = USE_GLASS ? GlassView : FrostedView;
  const pillProps = USE_GLASS
    ? {
        glassEffectStyle: 'regular' as const,
        colorScheme: glassColorScheme,
        isInteractive: true,
      }
    : {};

  return (
    <View style={styles.wrapper}>
      {onMushafLayoutPress && (
        <PillWrapper style={styles.glassButton} {...pillProps}>
          <Pressable
            onPress={handleMushafLayoutPress}
            accessibilityRole="button" // @ai
            accessibilityLabel={t('reader:mushaf.settings')} // @ai
            testID="player-mushaf-settings" // @ai
            style={styles.glassButtonInner}>
            <Ionicons
              name="options-outline"
              size={moderateScale(20)}
              color={defaultIconColor}
            />
          </Pressable>
        </PillWrapper>
      )}

      <Pressable
        onPress={onSpeedPress}
        accessibilityRole="button" // @ai
        accessibilityLabel={t('sheets:playbackSpeed.title')} // @ai
        accessibilityValue={{text: localizeDigits(`${playbackRate}x`)}} // @ai
        testID="player-speed" // @ai
        style={[
          styles.button,
          playbackRate !== 1 && {backgroundColor: activeBackgroundColor},
        ]}>
        <Text
          style={[
            styles.speedButtonText,
            {
              color: playbackRate !== 1 ? activeIconColor : defaultIconColor,
            },
          ]}>
          {localizeDigits(`${playbackRate}x`)}
        </Text>
      </Pressable>

      <Pressable
        onPress={handleRepeatPress}
        accessibilityRole="button" // @ai
        accessibilityLabel={t('sheets:verseActions.repeat')} // @ai
        accessibilityValue={{text: repeatModeLabel}} // @ai
        testID="player-repeat" // @ai
        style={[
          styles.button,
          settings.repeatMode !== 'none' && {
            backgroundColor: activeBackgroundColor,
          },
        ]}>
        {settings.repeatMode === 'track' ? (
          <RepeatOneIcon size={moderateScale(20)} color={activeIconColor} />
        ) : (
          <RepeatIcon
            size={moderateScale(20)}
            color={
              settings.repeatMode === 'queue'
                ? activeIconColor
                : defaultIconColor
            }
          />
        )}
      </Pressable>

      <Pressable
        onPress={onSleepTimerPress}
        accessibilityRole="button" // @ai
        accessibilityLabel={t('sheets:sleepTimer.title')} // @ai
        accessibilityState={{selected: isTimerActive}} // @ai
        testID="player-sleep-timer" // @ai
        style={[
          styles.button,
          isTimerActive && {backgroundColor: activeBackgroundColor},
        ]}>
        <TimerIcon
          color={isTimerActive ? activeIconColor : defaultIconColor}
          size={moderateScale(20)}
          filled={!!isTimerActive}
        />
      </Pressable>

      {onAmbientPress && (
        <Pressable
          onPress={onAmbientPress}
          accessibilityRole="button" // @ai
          accessibilityLabel={t('sheets:ambient.title')} // @ai
          accessibilityState={{selected: ambientEnabled}} // @ai
          testID="player-ambient" // @ai
          style={[
            styles.button,
            ambientEnabled && {backgroundColor: activeBackgroundColor},
          ]}>
          <AmbientIcon
            color={ambientEnabled ? activeIconColor : defaultIconColor}
            size={moderateScale(20)}
            filled={ambientEnabled}
          />
        </Pressable>
      )}

      <Pressable
        onPress={onFollowAlongPress}
        accessibilityRole="button" // @ai
        accessibilityLabel={t('sheets:followAlong.title')} // @ai
        accessibilityState={{selected: followAlongOn}} // @ai
        testID="player-locate-verse" // @ai
        style={[
          styles.button,
          followAlongAvailable &&
            followAlongActive && {backgroundColor: activeBackgroundColor},
          !followAlongAvailable && {opacity: 0.35},
        ]}>
        <Ionicons
          name="locate-outline"
          size={moderateScale(20)}
          color={
            followAlongAvailable && followAlongActive
              ? activeIconColor
              : defaultIconColor
          }
        />
      </Pressable>

      <PillWrapper style={styles.glassButton} {...pillProps}>
        {/* @ai TECH_DEBT #258: a testID and a label, so the Maestro queue
         * flow (PLY-06) and a screen reader can find the queue control. */}
        <Pressable
          onPress={onQueuePress}
          style={styles.glassButtonInner}
          testID="player-queue-button"
          accessibilityRole="button"
          accessibilityLabel={t('terms.queue')}>
          <QueueIcon
            size={moderateScale(20)}
            color={showQueue ? activeIconColor : defaultIconColor}
          />
        </Pressable>
      </PillWrapper>
    </View>
  );
};
// @ai-end

const styles = StyleSheet.create<Styles>({
  wrapper: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingVertical: moderateScale(10),
    width: '100%',
  },
  button: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(14),
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glassButton: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(22),
    overflow: 'hidden',
  },
  glassButtonInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  speedButtonText: {
    fontSize: moderateScale(13),
    fontFamily: 'Manrope-SemiBold',
  },
});
