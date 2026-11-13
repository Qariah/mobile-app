// @ai-generated
// Qariah (2026-11-08): Settings › What's New in the English UI shows
// data/changelog.json as it is; the Arabic of i18n/qariahChangelog.ts does
// not reach it.
//
// The screen lives under app/, where a test file would become a route, so
// the test sits here (as components/settings/__tests__/NotificationsSettings).
import React from 'react';
import {render, screen} from '@testing-library/react-native';
import WhatsNewScreen from '@/app/(tabs)/(d.settings)/whats-new';
import {arabicShown, englishShown} from '@/test-utils/whatsNewScreen';
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
  currentLanguage: 'en',
}));

describe("Settings › What's New in the English UI", () => {
  it('shows the English of data/changelog.json, and none of the Arabic', () => {
    render(<WhatsNewScreen />);
    for (const text of englishShown) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    for (const text of arabicShown) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });
});
