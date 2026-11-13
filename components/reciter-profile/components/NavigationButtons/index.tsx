import React from 'react';
import {Animated, Pressable, View} from 'react-native';
import {moderateScale, ScaledSheet} from '@/utils/scale';
import {useTheme} from '@/hooks/useTheme';
import {Feather} from '@expo/vector-icons';
import {useRouter} from 'expo-router';
// @ai-start
import {flipX, isRTL} from '@/utils/rtl'; // @ai Qariah: isRTL
// @ai-end
import {useTranslation} from 'react-i18next'; // @ai Qariah: TalkBack labels

// @ai-start Qariah (TECH_DEBT #320): edge 15 + two icons 20 + gap 16 + title gap 8. Keep equal to the icons below.
export const NAVIGATION_TITLE_INSET = moderateScale(15 + 20 + 16 + 20 + 8);
// @ai-end

// @ai-start Qariah (UX critique 2026-11-11): 44 pt hit areas, with no visible
// change. An icon is as tall and as wide as its size. Share and search are
// END_GAP apart, so each takes half of that gap and grows the rest on its
// outer side. The sticky section pins about 32 pt below the icon tops (the
// sticky title bar), so a hit area grows at most 6 pt below its icon and the
// rest above it. A hit slop is physical (React Native does not mirror it), so
// in RTL, where the row and the positions mirror, its left and right swap.
// navigationHitSlop.test.tsx checks the sizes and the gaps.
const MIN_HIT = 44;
const BACK_ICON = moderateScale(24); // the arrow-left size below
const END_ICON = moderateScale(20); // the share and search size
const END_GAP = moderateScale(16); // the marginRight of share
const BELOW = 6;
const grow = (size: number, other: number) =>
  Math.max(0, MIN_HIT - size - other);
type Slop = {top: number; bottom: number; left: number; right: number};
export const mirrorInRTL = (slop: Slop, rtl: boolean): Slop =>
  rtl ? {...slop, left: slop.right, right: slop.left} : slop;
export const BACK_HIT_SLOP: Slop = {
  top: grow(BACK_ICON, BELOW),
  bottom: BELOW,
  left: grow(BACK_ICON, 0) / 2,
  right: grow(BACK_ICON, 0) / 2,
};
export const SHARE_HIT_SLOP: Slop = {
  top: grow(END_ICON, BELOW),
  bottom: BELOW,
  left: grow(END_ICON, END_GAP / 2),
  right: END_GAP / 2,
};
export const SEARCH_HIT_SLOP: Slop = {
  top: grow(END_ICON, BELOW),
  bottom: BELOW,
  left: END_GAP / 2,
  right: grow(END_ICON, END_GAP / 2),
};
// @ai-end

interface NavigationButtonsProps {
  insets: {
    top: number;
  };
  iconsOpacity: Animated.Value;
  iconsZIndex: Animated.Value;
  onSearchPress: () => void;
  onSharePress?: () => void;
}

// @ai-start
export const NavigationButtons: React.FC<NavigationButtonsProps> = ({
  insets,
  iconsOpacity,
  iconsZIndex,
  onSearchPress,
  onSharePress,
}) => {
  const router = useRouter();
  const {theme} = useTheme();
  const {t} = useTranslation('common'); // @ai Qariah

  return (
    <>
      <Animated.View
        style={[
          styles.backButton,
          {
            top: insets.top,
            left: moderateScale(15),
            opacity: iconsOpacity,
            zIndex: iconsZIndex,
          },
        ]}>
        {/* @ai Qariah: a label for TalkBack and a 44 pt hit area */}
        <Pressable
          onPress={() => router.back()}
          hitSlop={mirrorInRTL(BACK_HIT_SLOP, isRTL)}
          accessibilityRole="button"
          accessibilityLabel={t('actions.back')}>
          <Feather
            name="arrow-left"
            size={moderateScale(24)}
            color={theme.colors.text}
            style={flipX}
          />
        </Pressable>
      </Animated.View>
      <Animated.View
        style={[
          styles.rightButtons,
          {
            top: insets.top,
            right: moderateScale(15),
            opacity: iconsOpacity,
            zIndex: iconsZIndex,
          },
        ]}>
        {onSharePress && (
          <Pressable
            onPress={onSharePress}
            hitSlop={mirrorInRTL(SHARE_HIT_SLOP, isRTL)} // @ai Qariah: was 8
            accessibilityRole="button" // @ai Qariah
            accessibilityLabel={t('actions.share')} // @ai Qariah
            style={{marginRight: moderateScale(16)}}>
            <Feather
              name="share"
              size={moderateScale(20)}
              color={theme.colors.text}
            />
          </Pressable>
        )}
        {/* @ai Qariah: a label for TalkBack; the hit slop was 8 */}
        <Pressable
          onPress={onSearchPress}
          hitSlop={mirrorInRTL(SEARCH_HIT_SLOP, isRTL)}
          accessibilityRole="button"
          accessibilityLabel={t('actions.search')}>
          <Feather
            name="search"
            size={moderateScale(20)}
            color={theme.colors.text}
          />
        </Pressable>
      </Animated.View>
    </>
  );
};
// @ai-end

const styles = ScaledSheet.create({
  backButton: {
    position: 'absolute',
    zIndex: 10,
  },
  rightButtons: {
    position: 'absolute',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
