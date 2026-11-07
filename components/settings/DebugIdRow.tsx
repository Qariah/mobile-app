// @ai
// Qariah: the "Copy debug ID" row at the end of the Analytics card of the
// Settings index. Divergence batch C3 (SHT-S6) moved it out of the inherited
// `app/(tabs)/(d.settings)/index.tsx`; that file passes it to `renderCard` as
// the card footer.
import React, {useMemo} from 'react';
import {Alert, Pressable, Text, View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {moderateScale} from 'react-native-size-matters';
import * as Clipboard from 'expo-clipboard';
import {useTranslation} from 'react-i18next';
import {getDebugId, getDebugIdBlock} from '@/services/diagnostics/debugId';
import {showToast} from '@/utils/toastUtils';
import type {SettingsSlotProps} from './settingsSlot';

type DebugIdRowProps = Pick<
  SettingsSlotProps,
  'styles' | 'iconColor' | 'chevronColor'
>;

export function DebugIdRow({styles, iconColor, chevronColor}: DebugIdRowProps) {
  const {t} = useTranslation(['qariah']);

  // The debug ID is stable for the install, so read it once per mount.
  const debugId = useMemo(() => getDebugId(), []);

  // Copies the full diagnostic block. The toast repeats the ID, so the user
  // sees the value even if the paste target is another app. Never rejects: a
  // clipboard failure falls back to an Alert that shows the ID to read or type.
  const handleCopyDebugId = async (): Promise<void> => {
    try {
      await Clipboard.setStringAsync(getDebugIdBlock());
      showToast(t('qariah:debug.copied'), debugId);
    } catch {
      Alert.alert(t('qariah:debug.title'), debugId);
    }
  };

  return (
    <>
      <View style={styles.divider} />
      {/*
       * Copy debug ID. The subtitle shows the ID itself, so a user who
       * cannot paste can read it aloud or type it. The tap copies the
       * full diagnostic block. The ID is the anonymous device UUID —
       * it holds no name, no email, and no account link.
       */}
      <Pressable
        style={({pressed}) => [styles.settingsRow, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t('qariah:debug.copy')}
        onPress={handleCopyDebugId}>
        <View style={styles.settingsItemIcon}>
          <Feather name="hash" size={moderateScale(20)} color={iconColor} />
        </View>
        <View style={styles.settingsTextContainer}>
          <Text style={styles.settingsTitle}>{t('qariah:debug.copy')}</Text>
          <Text style={styles.settingsDescription} selectable>
            {debugId}
          </Text>
        </View>
        <Feather name="copy" size={moderateScale(16)} color={chevronColor} />
      </Pressable>
    </>
  );
}
