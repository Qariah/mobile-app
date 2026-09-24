import React from 'react';
import {View, StyleSheet} from 'react-native';
import {moderateScale} from '@/utils/scale';
import Animated, {
  useAnimatedStyle,
  interpolate,
  SharedValue,
} from 'react-native-reanimated';
import {useTheme} from '@/hooks/useTheme';

interface DotIndicatorProps {
  totalPages: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
}

function DotIndicatorComponent({
  totalPages,
  scrollX,
  pageWidth,
}: DotIndicatorProps) {
  const {theme} = useTheme();

  return (
    <View style={styles.container}>
      {Array.from({length: totalPages}).map((_, i) => (
        <Dot
          key={i}
          index={i}
          scrollX={scrollX}
          pageWidth={pageWidth}
          color={theme.colors.text}
        />
      ))}
    </View>
  );
}

interface DotProps {
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
  color: string;
}

const DOT_SIZE_INACTIVE = moderateScale(8);
const DOT_SIZE_ACTIVE = moderateScale(20);
const DOT_PADDING_VERTICAL = moderateScale(16);

/**
 * Total laid-out height of the indicator row. Exported so the modal can
 * reserve exactly this much space for it and never let the card's content
 * spill past the rounded edge.
 */
export const DOT_INDICATOR_HEIGHT =
  DOT_SIZE_INACTIVE + DOT_PADDING_VERTICAL * 2;

function Dot({index, scrollX, pageWidth, color}: DotProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * pageWidth,
      index * pageWidth,
      (index + 1) * pageWidth,
    ];

    const width = interpolate(
      scrollX.value,
      inputRange,
      [DOT_SIZE_INACTIVE, DOT_SIZE_ACTIVE, DOT_SIZE_INACTIVE],
      'clamp',
    );

    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0.3, 1, 0.3],
      'clamp',
    );

    return {width, opacity};
  });

  return (
    <Animated.View
      style={[styles.dot, {backgroundColor: color}, animatedStyle]}
    />
  );
}

export default React.memo(DotIndicatorComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: moderateScale(6),
    paddingVertical: DOT_PADDING_VERTICAL,
  },
  dot: {
    height: DOT_SIZE_INACTIVE,
    borderRadius: moderateScale(4),
  },
});
