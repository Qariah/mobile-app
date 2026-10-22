import React from 'react';
import {Pressable, ViewStyle, StyleProp} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {ScaledSheet, moderateScale} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {useNavigation} from 'expo-router';
// @ai-start
import {flipX} from '@/utils/rtl';
// @ai-end

interface BackButtonProps {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
}

// @ai-start
export const BackButton: React.FC<BackButtonProps> = ({
  onPress,
  style,
  iconSize = 24,
}) => {
  const {theme} = useTheme();
  const navigation = useNavigation();

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      navigation.goBack();
    }
  };

  // @ai — the button does not add the safe-area inset. Its container
  // owns the inset: the Mushaf reader header (its only user) pads both
  // sides by the inset. A second inset here made the button wider than its
  // header slot in landscape, and the "Search surahs" button then covered
  // it (TECH_DEBT #274).
  return (
    <Pressable style={[styles.backButton, style]} onPress={handlePress}>
      <Feather
        name="arrow-left"
        color={theme.colors.text}
        size={moderateScale(iconSize)}
        style={flipX}
      />
    </Pressable>
  );
};
// @ai-end

const styles = ScaledSheet.create({
  backButton: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(22),
    justifyContent: 'center',
    alignItems: 'center',
    padding: moderateScale(10),
  },
});
