import React from 'react';
import {Pressable, ViewStyle, StyleProp} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {ScaledSheet, moderateScale} from '@/utils/scale';
import {useTheme} from '@/hooks/useTheme';
import {useNavigation} from 'expo-router';
// @ai-start
import {flipX} from '@/utils/rtl';
// @ai-end
import {useTranslation} from 'react-i18next'; // @ai Qariah: the TalkBack label

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
  const {t} = useTranslation('common'); // @ai Qariah

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      navigation.goBack();
    }
  };

  // @ai The container owns the safe-area inset; a second inset here broke the landscape header (TECH_DEBT #274).
  return (
    <Pressable
      style={[styles.backButton, style]}
      onPress={handlePress}
      accessibilityRole="button" // @ai Qariah: the Mushaf back button had no label
      accessibilityLabel={t('actions.back')}>
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
