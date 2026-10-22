import React from 'react';
import {View, Pressable, StyleSheet} from 'react-native';
import {moderateScale} from 'react-native-size-matters';
import {Feather} from '@expo/vector-icons';
import {Theme} from '@/utils/themeUtils';

interface SectionHeaderProps {
  onViewToggle?: () => void;
  isGridView?: boolean;
  theme: Theme;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  onViewToggle,
  isGridView = false,
  theme,
}) => {
  return (
    <View
      style={[styles.container, {backgroundColor: theme.colors.background}]}>
      {onViewToggle && (
        <Pressable style={styles.toggleButton} onPress={onViewToggle}>
          <Feather
            name={isGridView ? 'list' : 'grid'}
            size={moderateScale(20)}
            color={theme.colors.text}
          />
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(8),
  },
  toggleButton: {
    padding: moderateScale(4),
  },
});
