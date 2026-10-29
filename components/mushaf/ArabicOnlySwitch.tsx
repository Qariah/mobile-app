// @ai-generated
// Qariah (#680): one clearly labelled switch for the Arabic text alone, at the
// top of the Mushaf settings sheet. A TestFlight tester could not find how to
// see the Arabic only. Before, the verse Translation switch was halfway down
// the sheet, under a word-by-word "Translation" checkbox that changes nothing
// in the verse text.
//
// The switch hides the translation, the transliteration and word by word
// together. It applies where the app shows these aids: the reader's list view
// and the full player. Turning it off gives back the aids that the user had
// before (store/arabicOnlyStore.ts keeps them, persisted). The reader's page
// view always shows the Arabic text only, so there the switch is on and
// disabled, and a line under it says why; "View Type" below it changes the
// view.
import React from 'react';
import {
  Switch,
  Text,
  View,
  type ColorValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import {useArabicOnlyStore, type ReadingAids} from '@/store/arabicOnlyStore';

export type {ReadingAids};

const NO_AIDS: ReadingAids = {
  showTranslation: false,
  showTransliteration: false,
  showWBW: false,
};

/** When nothing is saved: the translation, the reading aid of the English UI. */
const FALLBACK_AIDS: Partial<ReadingAids> = {showTranslation: true};

/** True when no reading aid shows: the text is Arabic only. */
export function showsArabicOnly(aids: ReadingAids): boolean {
  return !aids.showTranslation && !aids.showTransliteration && !aids.showWBW;
}

function currentAids(): ReadingAids {
  const {showTranslation, showTransliteration, showWBW} =
    useMushafSettingsStore.getState();
  return {showTranslation, showTransliteration, showWBW};
}

/**
 * On: save the aids that show now, then hide them all. Off: give back the
 * saved aids. When nothing is saved (or the saved set shows no aid), show the
 * translation, so that "off" always shows a reading aid.
 */
export function setArabicOnly(on: boolean): void {
  const saved = useArabicOnlyStore.getState();
  if (on) {
    const aids = currentAids();
    // Already Arabic only: keep the set that is saved from before.
    if (!showsArabicOnly(aids)) saved.setSavedAids(aids);
    useMushafSettingsStore.setState(NO_AIDS);
    return;
  }
  const restore =
    saved.savedAids && !showsArabicOnly(saved.savedAids)
      ? saved.savedAids
      : FALLBACK_AIDS;
  useMushafSettingsStore.setState(restore);
  saved.setSavedAids(null);
}

/** The styles of the sheet (MushafSettingsContent), so the card matches. */
export interface ArabicOnlySwitchStyles {
  card: StyleProp<ViewStyle>;
  optionRow: StyleProp<ViewStyle>;
  optionLabel: StyleProp<TextStyle>;
  switchStyle: StyleProp<ViewStyle>;
  helperText: StyleProp<TextStyle>;
}

interface ArabicOnlySwitchProps {
  /** Where the sheet opened: the reader, the full player, or Settings. */
  context?: 'mushaf' | 'player';
  styles: ArabicOnlySwitchStyles;
  trackColor: {false: ColorValue; true: ColorValue};
}

export const ArabicOnlySwitch: React.FC<ArabicOnlySwitchProps> = ({
  context,
  styles,
  trackColor,
}) => {
  const {t} = useTranslation('qariah');
  const showTranslation = useMushafSettingsStore(s => s.showTranslation);
  const showTransliteration = useMushafSettingsStore(
    s => s.showTransliteration,
  );
  const showWBW = useMushafSettingsStore(s => s.showWBW);
  const viewMode = useMushafSettingsStore(s => s.viewMode);

  // The reader's page view never shows a reading aid.
  const pageView = context === 'mushaf' && viewMode === 'mushaf';
  const value =
    pageView ||
    showsArabicOnly({showTranslation, showTransliteration, showWBW});
  const label = t('mushafSettings.arabicOnly');
  const pageViewHelp = t('mushafSettings.arabicOnlyPageView');

  return (
    <View style={styles.card}>
      <View style={styles.optionRow}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Switch
          accessibilityLabel={label}
          accessibilityHint={pageView ? pageViewHelp : undefined}
          testID="mushaf-arabic-only-switch"
          trackColor={trackColor}
          thumbColor="#FFFFFF"
          ios_backgroundColor={trackColor.false}
          value={value}
          disabled={pageView}
          onValueChange={setArabicOnly}
          style={styles.switchStyle}
        />
      </View>
      {pageView && (
        <Text
          style={styles.helperText}
          testID="mushaf-arabic-only-page-view-help">
          {pageViewHelp}
        </Text>
      )}
    </View>
  );
};
