// @ai
// Sprint 47 (Pass C, section P): the sign-in screen shows one localized
// sentence when sign-in fails, never the technical English that qfOAuth.ts
// returns ("State mismatch (possible CSRF)"). AuthContext keeps that text for
// the sign-in telemetry.
//
// The screen lives under app/, where a test file would become a route, so
// the test sits here.
import React from 'react';
import i18n from 'i18next';
import {render, screen} from '@testing-library/react-native';
import SettingsSignIn from '@/app/(tabs)/(d.settings)/sign-in';
import arQariah from '@/i18n/locales/ar/qariah.json';

const RAW_ERROR = 'State mismatch (possible CSRF)';

jest.mock('expo-router', () => ({
  useRouter: () => ({back: jest.fn()}),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#ffffff',
        text: '#000000',
        textSecondary: '#666666',
        primary: '#2f5059',
        error: '#dc2626',
      },
    },
  }),
}));

jest.mock('@/hooks/useBottomInset', () => ({useBottomInset: () => 0}));

jest.mock('@/services/auth', () => ({
  useAuth: () => ({
    status: 'unauthenticated',
    lastError: 'State mismatch (possible CSRF)',
    signIn: jest.fn(),
  }),
}));

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('sign-in error box', () => {
  it('shows the localized sentence, not the technical error', () => {
    render(<SettingsSignIn />);

    expect(screen.getByText('Sign-in failed. Please try again.')).toBeTruthy();
    expect(screen.queryByText(RAW_ERROR)).toBeNull();
  });

  it('renders the Arabic text from the qariah namespace', async () => {
    await i18n.changeLanguage('ar');
    render(<SettingsSignIn />);

    expect(screen.getByText(arQariah.auth.signInFailed)).toBeTruthy();
    expect(screen.getByText(arQariah.account.signInTitle)).toBeTruthy();
    expect(screen.queryByText(RAW_ERROR)).toBeNull();
  });
});
