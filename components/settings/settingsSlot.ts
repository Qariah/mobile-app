// @ai
// Qariah: what the inherited Settings index (`app/(tabs)/(d.settings)/index.tsx`)
// gives to the Qariah parts that it renders (divergence batch C3, SHT-S6). The
// Qariah rows use the styles and the card of that screen, so that they look
// the same as the upstream rows beside them.
import type React from 'react';
import type {StyleProp, TextStyle, ViewStyle} from 'react-native';

/** The styles of the Settings index that the Qariah rows use. */
export interface SettingsSlotStyles {
  section: StyleProp<ViewStyle>;
  sectionHeader: StyleProp<TextStyle>;
  divider: StyleProp<ViewStyle>;
  settingsRow: StyleProp<ViewStyle>;
  pressed: StyleProp<ViewStyle>;
  settingsItemIcon: StyleProp<ViewStyle>;
  settingsTextContainer: StyleProp<ViewStyle>;
  settingsTitle: StyleProp<TextStyle>;
  settingsDescription: StyleProp<TextStyle>;
}

export interface SettingsSlotProps {
  styles: SettingsSlotStyles;
  /** The card of the Settings index (glass on iOS 26+, plain elsewhere). */
  renderCard: (children: React.ReactNode) => React.ReactNode;
  iconColor: string;
  chevronColor: string;
}
