// @ai-generated
// Sprint 52 Task 8: the ayah panel. Its header ("Ayah 2:2", the surah name,
// "Close panel"), the three 44 pt tabs, the reused content (Tafsir, the
// Reflections empty state with Qariah's hint, Personal Notes), close, a move
// to another ayah, and where it shows (beside the reader, or a card).
import React from 'react';
import {View} from 'react-native';
import {act, fireEvent, render, screen} from '@testing-library/react-native';

const mockTafsirProps: {surahNumber: number; ayahNumber: number}[] = [];
const mockReflections = jest.fn(async () => [] as unknown[]);

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      isDarkMode: false,
      colors: {
        text: '#06151C',
        textSecondary: '#052c39',
        background: '#f4f3ec',
        backgroundSecondary: '#edebe3',
        light: '#f4f4f4',
        border: '#a4a4a4',
      },
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({Feather: () => null}));

const mockShow = jest.fn();
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {
    show: (...args: unknown[]) => mockShow(...args),
    hide: () => Promise.resolve(),
  },
}));

jest.mock('@/store/mushafSettingsStore', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useMushafSettingsStore: selector => selector({rewayah: 'hafs'}),
}));

jest.mock('@/components/share/useVerseSelection', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  useVerseSelection: request => ({
    status: 'ready',
    rewayah: 'hafs',
    keys: [request.verseKey],
    label: request.verseKey,
    surahNumber: request.surahNumber,
    isRange: false,
    hafsKeys: [request.verseKey],
    anchors: [
      {
        key: request.verseKey,
        surah: request.surahNumber,
        ayah: request.ayahNumber,
      },
    ],
    linkVerse: {surah: request.surahNumber, ayah: request.ayahNumber},
    linkLabel: request.verseKey,
    units: null,
    model: null,
  }),
}));

jest.mock('@/components/sheets/verse-actions/TafseerContent', () => {
  const {createElement} = jest.requireActual('react');
  const {Text: RNText} = jest.requireActual('react-native');
  return {
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    TafseerContent: props => {
      mockTafsirProps.push(props);
      return createElement(
        RNText,
        {testID: 'tafsir-content'},
        `tafsir ${props.surahNumber}:${props.ayahNumber} ${props.inPanel}`,
      );
    },
  };
});

// The notes tab: its label, and a field that holds a draft in its own state
// (as NoteContent does), so a remount would lose it.
jest.mock('../AyahPanelNotesTab', () => {
  const {createElement, Fragment, useState} = jest.requireActual('react');
  const {Text: RNText, TextInput} = jest.requireActual('react-native');
  return {
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    AyahPanelNotesTab: ({payload: tabPayload}) => {
      const [draft, setDraft] = useState('');
      return createElement(
        Fragment,
        null,
        createElement(
          RNText,
          {testID: 'notes-content'},
          `notes ${tabPayload.verseKey}`,
        ),
        createElement(TextInput, {
          testID: 'notes-draft',
          value: draft,
          onChangeText: setDraft,
        }),
      );
    },
  };
});

jest.mock('@/services/userState/communityReflectionsProvider', () => ({
  qariahCommunityReflectionsProvider: () => mockReflections(),
}));

jest.mock('@/components/layout/TabletDialog', () => {
  const {createElement} = jest.requireActual('react');
  const {Pressable, View: RNView} = jest.requireActual('react-native');
  return {
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    TabletDialog: ({onClose, children}) =>
      createElement(
        RNView,
        {testID: 'tablet-dialog'},
        createElement(Pressable, {testID: 'dialog-backdrop', onPress: onClose}),
        children,
      ),
  };
});

import {useMushafVerseSelectionStore} from '@/store/mushafVerseSelectionStore';
import {AyahSidePanel} from '../AyahSidePanel';
import {AyahPanelHost} from '../AyahPanelHost';
import {
  AYAH_PANEL_WIDTH,
  closeAyahPanel,
  isAyahPanelOpen,
  moveAyahPanel,
  openAyahPanel,
  registerAyahPanelHost,
  useAyahPanelStore,
  type AyahPanelPayload,
  type AyahPanelTab,
} from '../ayahPanelStore';
import {
  ayahPanelPresentation,
  readerAccessibility,
} from '../useAyahPanelPresentation';
import {dockedKeyboardHeight, keyboardOverlap} from '../AyahSidePanel';
import {showVerseActions} from '../showVerseActions';

function payload(key: string): AyahPanelPayload {
  const [surah, ayah] = key.split(':').map(Number);
  return {
    verseKey: key,
    surahNumber: surah,
    ayahNumber: ayah,
    source: 'mushaf',
  } as AyahPanelPayload;
}

let unregister: (() => void) | null = null;

function open(key: string, tab: AyahPanelTab = 'tafsir') {
  useMushafVerseSelectionStore.getState().selectVerse(key, 2);
  act(() => openAyahPanel(payload(key), tab));
}

beforeEach(() => {
  mockTafsirProps.length = 0;
  mockReflections.mockClear();
  unregister = registerAyahPanelHost();
});

afterEach(() => {
  act(() => {
    unregister?.();
  });
  unregister = null;
});

describe('AyahSidePanel', () => {
  it('renders nothing while the panel is closed', () => {
    render(<AyahSidePanel presentation="side" />);
    expect(screen.queryByTestId('ayah-panel')).toBeNull();
  });

  it('shows the header, the close button and the three tabs', () => {
    open('2:2');
    render(<AyahSidePanel presentation="side" />);

    const panel = screen.getByTestId('ayah-panel');
    expect(panel.props.accessible).toBe(false);
    expect(panel).toHaveStyle({width: AYAH_PANEL_WIDTH});

    const title = screen.getByText('Ayah 2:2');
    expect(title.props.accessibilityRole).toBe('header');
    expect(screen.getByText('Al-Baqarah')).toBeTruthy();

    const close = screen.getByLabelText('Close panel');
    expect(close.props.accessibilityRole).toBe('button');
    expect(close).toHaveStyle({width: 44, height: 44});

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.props.accessibilityState?.selected)).toEqual([
      true,
      false,
      false,
    ]);
    // AP-22: each segment looks 38 pt high and takes touches over 44 pt.
    for (const tab of tabs) {
      expect(tab).toHaveStyle({minHeight: 38});
      const slop = tab.props.hitSlop as {top: number; bottom: number};
      expect(38 + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    }
    expect(screen.getByText('Tafseer')).toBeTruthy();
    expect(screen.getByText('Reflections')).toBeTruthy();
    expect(screen.getByText('Personal Notes')).toBeTruthy();

    // The Tafsir tab: the verse-actions content, without its pager.
    expect(screen.getByTestId('tafsir-content').props.children).toBe(
      'tafsir 2:2 true',
    );
  });

  it('switches the tab', () => {
    open('2:2');
    render(<AyahSidePanel presentation="side" />);
    fireEvent.press(screen.getByTestId('ayah-panel-tab-notes'));
    expect(useAyahPanelStore.getState().tab).toBe('notes');
    expect(screen.getByTestId('notes-content').props.children).toBe(
      'notes 2:2',
    );
    expect(
      screen.getByTestId('ayah-panel-tab-notes').props.accessibilityState,
    ).toEqual({selected: true});
  });

  it('shows the Reflections empty state with the hint', async () => {
    open('67:1', 'reflections');
    render(<AyahSidePanel presentation="side" />);
    expect(await screen.findByText('No reflections yet')).toBeTruthy();
    expect(
      screen.getByText(
        'Publish reflections from a verse long-press to share them on QuranReflect.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('ayah-panel-reflections-empty')).toBeTruthy();
    expect(mockReflections).toHaveBeenCalled();
  });

  it('closes, and clears the highlight', () => {
    open('2:2');
    render(<AyahSidePanel presentation="side" />);
    fireEvent.press(screen.getByLabelText('Close panel'));
    expect(isAyahPanelOpen()).toBe(false);
    expect(screen.queryByTestId('ayah-panel')).toBeNull();
    expect(useMushafVerseSelectionStore.getState().selectedVerseKeys).toEqual(
      [],
    );
  });

  it('follows a long-press on another ayah, on the same tab', () => {
    open('2:2');
    render(<AyahSidePanel presentation="side" />);
    useMushafVerseSelectionStore.getState().selectVerse('2:3', 2);
    act(() => {
      moveAyahPanel(payload('2:3'));
    });
    expect(screen.getByText('Ayah 2:3')).toBeTruthy();
    expect(screen.getByTestId('tafsir-content').props.children).toBe(
      'tafsir 2:3 true',
    );
  });

  it('has the same header and tabs in the card', () => {
    open('2:2');
    render(<AyahSidePanel presentation="card" />);
    expect(screen.getByTestId('ayah-panel')).not.toHaveStyle({
      width: AYAH_PANEL_WIDTH,
    });
    expect(screen.getByText('Ayah 2:2')).toBeTruthy();
    expect(screen.getByLabelText('Close panel')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
});

describe('AyahPanelHost', () => {
  it('shows the panel beside the reader', () => {
    open('2:2');
    render(
      <View>
        <AyahPanelHost presentation="side" topInset={74} bottomInset={20} />
      </View>,
    );
    expect(screen.getByTestId('ayah-panel')).toHaveStyle({paddingTop: 74});
    expect(screen.queryByTestId('tablet-dialog')).toBeNull();
  });

  it('shows the card below 900 pt, and a tap outside closes it', () => {
    open('2:2');
    render(<AyahPanelHost presentation="card" />);
    // Modal over the reader for VoiceOver.
    expect(
      screen.getByTestId('ayah-panel-card-layer').props
        .accessibilityViewIsModal,
    ).toBe(true);
    expect(screen.getByTestId('tablet-dialog')).toBeTruthy();
    expect(screen.getByText('Ayah 2:2')).toBeTruthy();
    fireEvent.press(screen.getByTestId('dialog-backdrop'));
    expect(isAyahPanelOpen()).toBe(false);
  });

  it('shows nothing while the panel is closed', () => {
    render(<AyahPanelHost presentation={null} />);
    expect(screen.queryByTestId('ayah-panel')).toBeNull();
    // A closed store, and no stray text.
    expect(screen.queryByText(/Ayah/)).toBeNull();
    closeAyahPanel();
  });
});

describe('readerAccessibility', () => {
  it('hides the reader from VoiceOver and TalkBack under the modal card', () => {
    expect(readerAccessibility('card')).toEqual({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
  });

  it('keeps the reader reachable beside the panel and with no panel', () => {
    for (const presentation of ['side', null] as const) {
      expect(readerAccessibility(presentation)).toEqual({
        accessibilityElementsHidden: false,
        importantForAccessibility: 'auto',
      });
    }
  });
});

describe('ayahPanelPresentation', () => {
  it('puts the panel beside the reader from 900 pt on a tablet', () => {
    expect(ayahPanelPresentation(true, 1376)).toBe('side');
    expect(ayahPanelPresentation(true, 1032)).toBe('side');
    expect(ayahPanelPresentation(true, 900)).toBe('side');
  });

  it('shows the card on a narrower tablet window', () => {
    expect(ayahPanelPresentation(true, 899)).toBe('card');
    expect(ayahPanelPresentation(true, 834)).toBe('card');
    expect(ayahPanelPresentation(true, 680)).toBe('card');
  });

  it('never shows it on a phone, also a phone wider than 900 pt', () => {
    expect(ayahPanelPresentation(false, 956)).toBeNull();
    expect(ayahPanelPresentation(false, 402)).toBeNull();
  });
});

// Review fix 1: a note that is being written is not lost.
describe('an unsaved note', () => {
  function startDraft() {
    open('2:2', 'notes');
    act(() => {
      useAyahPanelStore.setState({compose: true});
    });
    render(<AyahSidePanel presentation="side" />);
    fireEvent.changeText(screen.getByTestId('notes-draft'), 'my draft');
  }

  it('survives a tab change', () => {
    startDraft();
    fireEvent.press(screen.getByTestId('ayah-panel-tab-tafsir'));
    expect(screen.getByTestId('tafsir-content')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ayah-panel-tab-notes'));
    expect(screen.getByTestId('notes-draft').props.value).toBe('my draft');
  });

  it('keeps the panel on its ayah after a long-press on another ayah', () => {
    startDraft();
    useMushafVerseSelectionStore.getState().selectVerse('2:3', 2);
    act(() => showVerseActions(payload('2:3')));
    expect(mockShow).not.toHaveBeenCalled();
    expect(screen.getByText('Ayah 2:2')).toBeTruthy();
    expect(screen.getByTestId('notes-draft').props.value).toBe('my draft');
    expect(useMushafVerseSelectionStore.getState().selectedVerseKeys).toEqual([
      '2:2',
    ]);
  });
});

// Review fix 4: the keyboard overlap comes from the panel's measured frame.
// Window coordinates only: the panel's measured bottom, the window height,
// and the docked keyboard's height.
describe('keyboardOverlap', () => {
  it('is the part of the panel under the docked keyboard', () => {
    // An 11-inch iPad in landscape: the panel ends at the window bottom
    // (834 pt) and the keyboard is 364 pt high.
    expect(keyboardOverlap(834, 834, 364)).toBe(364);
    // A panel that ends 100 pt above the window bottom.
    expect(keyboardOverlap(734, 834, 364)).toBe(264);
  });

  it('is 0 while the keyboard is hidden, below the panel, or not measured', () => {
    expect(keyboardOverlap(834, 834, 0)).toBe(0);
    expect(keyboardOverlap(400, 834, 364)).toBe(0);
    expect(keyboardOverlap(null, 834, 364)).toBe(0);
  });
});

describe('dockedKeyboardHeight', () => {
  it('counts a keyboard as wide as the window or wider', () => {
    expect(dockedKeyboardHeight({width: 1194, height: 364}, 1194)).toBe(364);
    // Split View: the docked keyboard spans the screen, wider than the window.
    expect(dockedKeyboardHeight({width: 1376, height: 380}, 680)).toBe(380);
  });

  it('ignores a floating (undocked) iPad keyboard', () => {
    expect(dockedKeyboardHeight({width: 320, height: 260}, 1194)).toBe(0);
  });
});
