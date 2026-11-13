// @ai-generated
// Qariah (2026-11-08): Settings › What's New in the Arabic UI shows the
// review pack's Arabic for the newest changelog entry
// (i18n/qariahChangelog.ts, called by the screen).
//
// The screen lives under app/, where a test file would become a route, so
// the test sits here (as components/settings/__tests__/NotificationsSettings).
import React from 'react';
import {render, screen} from '@testing-library/react-native';
import WhatsNewScreen from '@/app/(tabs)/(d.settings)/whats-new';
import {
  arabicShown,
  englishShown,
  latestChangelog,
} from '@/test-utils/whatsNewScreen';
import type * as LanguageModule from '@/i18n/language';

// Pass D: Expo SDK 58's expo-font loads the icon font through expo-asset,
// which has no asset registry in Jest. The icons are not under test.
jest.mock('@expo/vector-icons', () => ({Ionicons: () => null}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => require('@/test-utils/whatsNewScreen').mockTheme,
}));
// The app reads the UI language once, at start.
jest.mock('@/i18n/language', () => ({
  ...jest.requireActual<typeof LanguageModule>('@/i18n/language'),
  currentLanguage: 'ar',
}));

describe("Settings › What's New in the Arabic UI", () => {
  it('has an Arabic text for each string of the newest entry', () => {
    expect(latestChangelog.highlights.length).toBeGreaterThan(0);
    expect(arabicShown.length).toBe(englishShown.length);
    expect(arabicShown.every(text => /\p{Script=Arabic}/u.test(text))).toBe(
      true,
    );
  });

  it('shows the Arabic text, and none of the English', () => {
    render(<WhatsNewScreen />);
    for (const text of arabicShown) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    for (const text of englishShown) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });
});
