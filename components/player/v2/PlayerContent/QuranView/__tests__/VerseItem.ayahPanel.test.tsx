// @ai-generated
/**
 * Sprint 52 Task 8: the ••• button of a verse card says "More options for
 * ayah {key}" and has a 44 pt touch area on every device. On a tablet the
 * card is not one accessibility element, so VoiceOver and XCUITest reach the
 * •••; a phone keeps the card as one element, as before. With the ayah
 * panel open, a long-press on a card moves the panel; the ••• still opens
 * the verse actions.
 */

import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';

let mockIsTablet = false;
jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: mockIsTablet}),
}));
jest.mock('../SkiaVerseText', () => ({__esModule: true, default: () => null}));
jest.mock('../WBWVerseView', () => ({WBWVerseView: () => null}));
jest.mock('@/components/mushaf/AyahCommunityReflections', () => ({
  AyahCommunityReflections: () => null,
}));
jest.mock('@/components/utils/FormattedText', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
  Ionicons: () => null,
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({theme: {isDarkMode: false}, isDarkMode: false}),
}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn(() => Promise.resolve())},
}));
jest.mock('@/utils/haptics', () => ({mediumHaptics: jest.fn()}));
jest.mock('@/utils/translationLookup', () => ({
  isBundledTranslation: () => true,
  getBundledFootnotes: () => undefined,
}));
jest.mock('@/store/tajweedStore', () => {
  const {create} = jest.requireActual('zustand');
  return {useTajweedStore: create(() => ({indexedTajweedData: null}))};
});
jest.mock('@/store/verseAnnotationsStore', () => {
  const {create} = jest.requireActual('zustand');
  return {
    useVerseAnnotationsStore: create(() => ({
      bookmarkedVerseKeys: new Set(),
      notedVerseKeys: new Set(),
    })),
  };
});

import {SheetManager} from 'react-native-actions-sheet';
import {VerseItem} from '../VerseItem';
import {
  closeAyahPanel,
  openAyahPanel,
  registerAyahPanelHost,
  useAyahPanelStore,
  type AyahPanelPayload,
} from '@/components/mushaf/ayah-panel/ayahPanelStore';
import type {SkTypefaceFontProvider} from '@shopify/react-native-skia';

declare const global: {IS_REACT_ACT_ENVIRONMENT?: boolean};
global.IS_REACT_ACT_ENVIRONMENT = true;

const VERSE = {
  verse_key: '67:1',
  surah_number: 67,
  ayah_number: 1,
  text: 'TEXT',
  translation: 'TRANSLATION',
} as never;

function render(): TestRenderer.ReactTestRenderer {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  act(() => {
    renderer = TestRenderer.create(
      <VerseItem
        verse={VERSE}
        onVersePress={() => undefined}
        textColor="#111111"
        borderColor="#cccccc"
        showTranslation
        showTransliteration={false}
        showTajweed={false}
        arabicFontFamily="Uthmani"
        transliterationFontSize={15}
        translationFontSize={14}
        arabicFontSize={24}
        fontMgr={{} as unknown as SkTypefaceFontProvider}
        dkFontFamily="DigitalKhattV2"
        indexedTajweedData={null}
        source="mushaf"
      />,
    );
  });
  if (!renderer) throw new Error('nothing rendered');
  return renderer;
}

/** The host views: the card (the outermost) and the ••• button. */
function pressables(renderer: TestRenderer.ReactTestRenderer) {
  const hosts = renderer.root.findAll(n => typeof n.type === 'string');
  const more = hosts.find(
    n => n.props.accessibilityLabel === 'More options for ayah 67:1',
  );
  if (!more) throw new Error('no ••• button');
  return {card: hosts[0], more};
}

describe('VerseItem accessibility (Sprint 52 Task 8)', () => {
  it('labels the ••• button and gives it a 44 pt touch area', () => {
    const {more} = pressables(render());
    expect(more.props.accessibilityRole).toBe('button');
    expect(more.props.hitSlop).toBe(10);
  });

  it('keeps the card one element on a phone', () => {
    mockIsTablet = false;
    const {card} = pressables(render());
    expect(card.props.accessible).toBe(true);
  });

  it('opens the card on a tablet, so the ••• is its own element', () => {
    mockIsTablet = true;
    const {card} = pressables(render());
    expect(card.props.accessible).toBe(false);
  });
});

describe('VerseItem and the ayah panel (Sprint 52 Task 8)', () => {
  let unregister: (() => void) | null = null;
  beforeEach(() => {
    (SheetManager.show as jest.Mock).mockClear();
    unregister = registerAyahPanelHost();
    act(() =>
      openAyahPanel(
        {
          verseKey: '67:2',
          surahNumber: 67,
          ayahNumber: 2,
          source: 'mushaf',
        } as AyahPanelPayload,
        'notes',
      ),
    );
  });
  afterEach(() => {
    unregister?.();
    unregister = null;
    closeAyahPanel();
  });

  it('a long-press on a card moves the open panel to its ayah', () => {
    const renderer = render();
    const card = renderer.root.findAll(n => !!n.props.onLongPress)[0];
    act(() => card.props.onLongPress());
    expect(SheetManager.show).not.toHaveBeenCalled();
    expect(useAyahPanelStore.getState().payload?.verseKey).toBe('67:1');
    expect(useAyahPanelStore.getState().tab).toBe('notes');
  });

  it('the ••• opens the verse actions, also with the panel open', () => {
    const renderer = render();
    const more = renderer.root.findAll(
      n =>
        n.props.accessibilityLabel === 'More options for ayah 67:1' &&
        !!n.props.onPress,
    )[0];
    act(() => more.props.onPress());
    expect(SheetManager.show).toHaveBeenCalledWith(
      'verse-actions',
      expect.objectContaining({
        payload: expect.objectContaining({verseKey: '67:1'}),
      }),
    );
    expect(useAyahPanelStore.getState().payload?.verseKey).toBe('67:2');
  });
});
