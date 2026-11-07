// @ai-generated
// Qariah (Sprint 50 Task 20, TECH_DEBT #339): the accessibility props of a
// player progress slider. The phone ProgressBar and the two iPad players
// spread them on their Slider, so each player says the same thing.
import {useCallback} from 'react';
import {Platform, type AccessibilityActionEvent} from 'react-native';
import {useTranslation} from 'react-i18next';
import {localizeDigits} from '@/i18n/format';

/** The seconds that one VoiceOver swipe on the slider moves (the skip-button step). */
export const A11Y_SEEK_STEP = 15;

interface SliderProgress {
  position: number;
  duration: number;
  seekPosition: number | null;
  setPosition: (position: number) => void;
}

interface PlayerSliderA11yInput {
  progress: SliderProgress;
  seekTo: (position: number) => Promise<void> | void;
  /** The time the slider shows (the drag value while the user drags). */
  displayTime: number;
  formatTime: (seconds: number) => string;
}

export function usePlayerSliderA11y({
  progress,
  seekTo,
  displayTime,
  formatTime,
}: PlayerSliderA11yInput) {
  const {t} = useTranslation(['qariah']);

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

  // iOS: Fabric puts the Slider's label on a wrapper view, which is not an
  // accessibility element, and VoiceOver focuses the unlabeled UISlider in
  // it. So the wrapper becomes the adjustable element. Android puts the
  // props on the SeekBar itself and keeps the native behavior.
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

  return {
    accessibilityRole: 'adjustable' as const,
    accessibilityLabel: t('qariah:a11y.player.position'),
    testID: 'player-progress',
    ...iosAccessibility,
  };
}
