// @ai-generated
// Qariah (Sprint 50, TECH_DEBT #316): the word-by-word checkboxes in Mushaf
// Settings have a label of their own (the visible title) and a checked
// state. Before the fix, VoiceOver on iOS read only "checkbox".
import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react-native';

jest.mock('@/hooks/useTheme', () => {
  // Every theme color is the same; the test reads only accessibility props.
  const colors = new Proxy({}, {get: () => '#222222'});
  return {
    useTheme: () => ({
      theme: {isDarkMode: false, colors},
      themeMode: 'light',
    }),
  };
});
jest.mock('@/components/Icons', () => new Proxy({}, {get: () => () => null}));
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));
jest.mock(
  '@/components/player/v2/PlayerContent/QuranView/SkiaVerseText',
  () => () => null,
);
jest.mock('@/components/utils/FormattedText', () => () => null);
jest.mock('@/store/tajweedStore', () => ({
  useTajweedStore: () => ({indexedTajweedData: null, isLoading: true}),
}));
jest.mock('@/services/mushaf/MushafPreloadService', () => ({
  mushafPreloadService: {initialized: false},
}));
jest.mock('@/hooks/useMushafFontMgr', () => ({
  useMushafFontMgr: () => null,
}));
jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  digitalKhattDataService: {initialized: false},
}));
jest.mock('@/components/sheets/rewayahSelection', () => ({
  chooseMushafRenderer: jest.fn(),
  chooseMushafRewayah: jest.fn(),
}));

import {MushafSettingsContent} from '../MushafSettingsContent';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';

beforeEach(() => {
  useMushafSettingsStore.setState({
    wbwShowTranslation: true,
    wbwShowTransliteration: false,
  });
});

it('gives each word-by-word checkbox its title and its checked state', () => {
  render(<MushafSettingsContent context="mushaf" />);

  const translation = screen.getByRole('checkbox', {name: 'Translation'});
  const transliteration = screen.getByRole('checkbox', {
    name: 'Transliteration',
  });
  // RNTL also finds a name in the child text. iOS did not, so check the
  // label prop itself.
  expect(translation.props.accessibilityLabel).toBe('Translation');
  expect(transliteration.props.accessibilityLabel).toBe('Transliteration');
  expect(translation.props.accessibilityState).toEqual({checked: true});
  expect(transliteration.props.accessibilityState).toEqual({checked: false});
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});

it('sets the checked state when the user presses the row', () => {
  render(<MushafSettingsContent context="mushaf" />);

  act(() => {
    fireEvent.press(screen.getByRole('checkbox', {name: 'Transliteration'}));
  });

  expect(
    screen.getByRole('checkbox', {name: 'Transliteration'}).props
      .accessibilityState,
  ).toEqual({checked: true});
});
