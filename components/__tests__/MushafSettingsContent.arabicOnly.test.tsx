// @ai-generated
// Qariah (#680): the "Arabic text only" switch is the first control of Mushaf
// Settings. It hides the translation, the transliteration and word by word in
// one tap, and turning it off gives back the aids that the user had. In the
// reader's page view (Arabic only by design) it is on and disabled, and a
// line under it says why.
import React from 'react';
import {Switch} from 'react-native';
import {act, fireEvent, render, screen} from '@testing-library/react-native';

jest.mock('@/hooks/useTheme', () => {
  // Every theme color is the same; the test reads only props and the store.
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
import {
  setArabicOnly,
  showsArabicOnly,
} from '@/components/mushaf/ArabicOnlySwitch';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import {useArabicOnlyStore} from '@/store/arabicOnlyStore';

const SWITCH = 'mushaf-arabic-only-switch';
const PAGE_VIEW_HELP = 'mushaf-arabic-only-page-view-help';
const PAGE_VIEW_TEXT =
  'The Mushaf view shows the Arabic text only. Choose List to see the translation.';

function aids() {
  const {showTranslation, showTransliteration, showWBW} =
    useMushafSettingsStore.getState();
  return {showTranslation, showTransliteration, showWBW};
}

function flip(on: boolean): void {
  act(() => {
    fireEvent(screen.getByTestId(SWITCH), 'valueChange', on);
  });
}

beforeEach(() => {
  // The English defaults: the translation shows, the other aids do not.
  useMushafSettingsStore.setState({
    showTranslation: true,
    showTransliteration: false,
    showWBW: false,
    viewMode: 'list',
  });
  useArabicOnlyStore.setState({savedAids: null});
});

it('is the first switch of the sheet, with its visible title as its label', () => {
  render(<MushafSettingsContent context="mushaf" />);

  const control = screen.getByTestId(SWITCH);
  expect(control.props.accessibilityLabel).toBe('Arabic text only');
  expect(screen.getByText('Arabic text only')).toBeTruthy();
  expect(screen.UNSAFE_getAllByType(Switch)[0].props.testID).toBe(SWITCH);
});

it('hides every reading aid in one tap in the full player', () => {
  useMushafSettingsStore.setState({showTransliteration: true, showWBW: true});
  render(<MushafSettingsContent context="player" />);
  expect(screen.getByTestId(SWITCH).props.value).toBe(false);

  flip(true);

  expect(aids()).toEqual({
    showTranslation: false,
    showTransliteration: false,
    showWBW: false,
  });
  expect(screen.getByTestId(SWITCH).props.value).toBe(true);
});

it('gives back the transliteration that the user had (M1)', () => {
  useMushafSettingsStore.setState({showTransliteration: true});
  render(<MushafSettingsContent context="mushaf" />);

  flip(true);
  expect(showsArabicOnly(aids())).toBe(true);
  flip(false);

  expect(aids()).toEqual({
    showTranslation: true,
    showTransliteration: true,
    showWBW: false,
  });
  expect(screen.getByTestId(SWITCH).props.value).toBe(false);
  expect(useArabicOnlyStore.getState().savedAids).toBeNull();
});

it('gives an Arabic-UI user back word by word, and no translation they never chose', () => {
  // The Arabic UI shows no English reading aid by default.
  useMushafSettingsStore.setState({showTranslation: false, showWBW: true});
  render(<MushafSettingsContent context="player" />);

  flip(true);
  flip(false);

  expect(aids()).toEqual({
    showTranslation: false,
    showTransliteration: false,
    showWBW: true,
  });
});

it('shows the translation when an Arabic-UI user with nothing saved turns it off', () => {
  // The Arabic-UI defaults: no reading aid, so the switch is on, and nothing
  // is saved because the user never turned it on.
  useMushafSettingsStore.setState({showTranslation: false});
  render(<MushafSettingsContent context="player" />);
  expect(screen.getByTestId(SWITCH).props.value).toBe(true);

  flip(false);

  expect(aids()).toEqual({
    showTranslation: true,
    showTransliteration: false,
    showWBW: false,
  });
  expect(screen.getByTestId(SWITCH).props.value).toBe(false);
});

it('keeps one saved set for every place that opens the sheet', () => {
  useMushafSettingsStore.setState({showWBW: true});
  const player = render(<MushafSettingsContent context="player" />);
  flip(true);
  player.unmount();

  // The saved set is in the persisted store, not in the component.
  expect(useArabicOnlyStore.getState().savedAids).toEqual({
    showTranslation: true,
    showTransliteration: false,
    showWBW: true,
  });

  render(<MushafSettingsContent />);
  flip(false);
  expect(aids()).toEqual({
    showTranslation: true,
    showTransliteration: false,
    showWBW: true,
  });
});

it('does not save over the set when it is turned on twice', () => {
  useMushafSettingsStore.setState({showTransliteration: true});
  setArabicOnly(true);
  setArabicOnly(true);
  setArabicOnly(false);

  expect(aids().showTransliteration).toBe(true);
});

it("is on and disabled in the reader's page view, and says why", () => {
  useMushafSettingsStore.setState({viewMode: 'mushaf'});
  render(<MushafSettingsContent context="mushaf" />);

  const control = screen.getByTestId(SWITCH);
  expect(control.props.value).toBe(true);
  expect(control.props.disabled).toBe(true);
  expect(control.props.accessibilityHint).toBe(PAGE_VIEW_TEXT);
  expect(screen.getByTestId(PAGE_VIEW_HELP)).toHaveTextContent(PAGE_VIEW_TEXT);
});

it('shows no page-view line in list view', () => {
  render(<MushafSettingsContent context="mushaf" />);

  expect(screen.getByTestId(SWITCH).props.accessibilityHint).toBeUndefined();
  expect(screen.queryByTestId(PAGE_VIEW_HELP)).toBeNull();
});

it('follows the reading aids in Settings, whatever the view type', () => {
  useMushafSettingsStore.setState({viewMode: 'mushaf'});
  render(<MushafSettingsContent />);

  const control = screen.getByTestId(SWITCH);
  expect(control.props.value).toBe(false);
  expect(control.props.disabled).toBeFalsy();
  expect(screen.queryByTestId(PAGE_VIEW_HELP)).toBeNull();
});

it('counts word by word and transliteration as reading aids', () => {
  const none = {
    showTranslation: false,
    showTransliteration: false,
    showWBW: false,
  };
  expect(showsArabicOnly(none)).toBe(true);
  expect(showsArabicOnly({...none, showTranslation: true})).toBe(false);
  expect(showsArabicOnly({...none, showTransliteration: true})).toBe(false);
  expect(showsArabicOnly({...none, showWBW: true})).toBe(false);
});
