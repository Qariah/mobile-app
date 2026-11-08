// @ai Qariah — the "now playing" bars that components/NowPlayingIndicator.tsx
// shows: still bars in Lite mode, and otherwise bars on React Native's native
// animation driver (every phone; planning/lite-mode-design.md, section 5b).
//
// The upstream bars (components/NowPlayingIndicator.tsx) animate with
// Reanimated. On Android, Reanimated sends each frame of an animated style
// through a React Native commit (its ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS
// flag is off), so the three small bars kept the UI thread about 55% busy on a
// Pixel 3 while audio played. The native driver sets transform and opacity on
// the views directly, without a commit. The bar heights, timings and colours
// follow the upstream bars.
import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, AppState, Easing, StyleSheet, View} from 'react-native';
import {moderateScale} from '@/utils/scale';
import {LinearGradient} from 'expo-linear-gradient';
import {NavigationContext} from 'expo-router/build/react-navigation/core/index';
import {getRandomColors} from '@/utils/gradientColors';

const MAX_BAR_HEIGHT = moderateScale(16);
const MIN_BAR_HEIGHT = moderateScale(3);
const MIN_SCALE = MIN_BAR_HEIGHT / MAX_BAR_HEIGHT;

/** The upstream sequence of each bar: [height 0..1, share of the duration]. */
const SEQUENCES: readonly (readonly [number, number])[][] = [
  [
    [0.1, 0.2],
    [0.4, 0.3],
    [0.5, 0.2],
    [0.2, 0.3],
  ],
  [
    [0.8, 0.2],
    [1.0, 0.2],
    [0.9, 0.2],
    [0.7, 0.2],
    [0.8, 0.2],
  ],
  [
    [0.2, 0.25],
    [0.5, 0.25],
    [0.3, 0.3],
    [0.1, 0.2],
  ],
];

/** True while the bars can be seen: their screen is focused and the app is active. */
export function useBarsOnScreen(): boolean {
  const navigation = React.useContext(NavigationContext);
  const [focused, setFocused] = React.useState(
    () => navigation?.isFocused?.() ?? true,
  );
  const [active, setActive] = React.useState(
    AppState.currentState === 'active',
  );
  useEffect(() => {
    if (!navigation) return;
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state =>
      setActive(state === 'active'),
    );
    return () => sub.remove();
  }, []);
  return focused && active;
}

export interface QariahNowPlayingBarsProps {
  isPlaying: boolean;
  /** Upstream's prop; the bars take their colours from the surah. */
  color?: string;
  barCount?: number;
  gap?: number;
  barWidth?: number;
  animationDuration?: number;
  surahId?: number;
}

export const NowPlayingBarsNative: React.FC<QariahNowPlayingBarsProps> = ({
  isPlaying,
  barCount = 3,
  gap = moderateScale(2),
  barWidth = moderateScale(3),
  animationDuration = 1200,
  surahId,
}) => {
  const gradientColors = useMemo(() => getRandomColors(surahId), [surahId]);
  const allValues = useRef(
    SEQUENCES.map(() => new Animated.Value(MIN_SCALE)),
  ).current;
  const values = useMemo(
    () => allValues.slice(0, barCount),
    [allValues, barCount],
  );
  const onScreen = useBarsOnScreen();
  const animating = isPlaying && onScreen;

  useEffect(() => {
    if (!animating) {
      if (!isPlaying) {
        values.forEach(value =>
          Animated.timing(value, {
            toValue: MIN_SCALE,
            duration: animationDuration / 3,
            useNativeDriver: true,
          }).start(),
        );
      } else {
        values.forEach(value => value.stopAnimation());
      }
      return undefined;
    }
    const easing = Easing.inOut(Easing.cubic);
    const loops = values.map((value, index) => {
      const sequence = SEQUENCES[index % SEQUENCES.length];
      const peak = Math.max(...sequence.map(([height]) => height));
      const scaleOf = (height: number) =>
        MIN_SCALE + (peak - MIN_SCALE) * (height / peak);
      const loop = Animated.loop(
        Animated.sequence(
          sequence.map(([height, share]) =>
            Animated.timing(value, {
              toValue: scaleOf(height),
              duration: animationDuration * share,
              easing,
              useNativeDriver: true,
            }),
          ),
        ),
      );
      return Animated.sequence([
        Animated.delay((index * 150) % (animationDuration / 2)),
        loop,
      ]);
    });
    loops.forEach(loop => loop.start());
    return () => loops.forEach(loop => loop.stop());
  }, [animating, isPlaying, animationDuration, values]);

  return (
    <View style={styles.container}>
      {values.map((value, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {width: barWidth, marginRight: i < values.length - 1 ? gap : 0},
            {
              transform: [{scaleY: value}],
              opacity: value.interpolate({
                inputRange: [MIN_SCALE, 1],
                outputRange: [0.7, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}>
          <LinearGradient
            colors={[gradientColors[0], gradientColors[1]]}
            start={{x: 0, y: 0}}
            end={{x: 0, y: 1}}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MAX_BAR_HEIGHT,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bar: {
    height: MAX_BAR_HEIGHT,
    borderRadius: moderateScale(2),
    overflow: 'hidden',
  },
});

/** Lite mode: still bars at fixed heights (planning/lite-mode-design.md). */
const STILL_HEIGHTS = [0.5, 1, 0.5];

export const NowPlayingBarsStill: React.FC<QariahNowPlayingBarsProps> = ({
  isPlaying,
  barCount = 3,
  gap = moderateScale(2),
  barWidth = moderateScale(3),
  surahId,
}) => {
  const color = useMemo(() => getRandomColors(surahId)[0], [surahId]);
  return (
    <View style={styles.container}>
      {STILL_HEIGHTS.slice(0, barCount).map((height, i) => (
        <View
          key={i}
          style={{
            width: barWidth,
            height: isPlaying ? MAX_BAR_HEIGHT * height : MIN_BAR_HEIGHT,
            marginRight: i < barCount - 1 ? gap : 0,
            borderRadius: moderateScale(2),
            backgroundColor: color,
            opacity: 0.85,
          }}
        />
      ))}
    </View>
  );
};
