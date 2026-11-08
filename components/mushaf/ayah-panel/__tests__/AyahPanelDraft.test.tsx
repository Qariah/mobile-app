// @ai-generated
// Sprint 52 Task 8 (re-review fixes 1 and 2): an unsaved note survives the
// panel turning into the card when the window crosses 900 pt (a remount of
// the editor), a close and a reopen of the same ayah's Notes tab; a save or
// a cancel drops it; a tab change away from Notes dismisses the keyboard.
// The real Notes tab and host; NoteContent is a stand-in that keeps its
// contract (it starts from `initialText` and reports `onTextChange`; the
// field's own state is lost on a remount, as in NoteContent).
import React from 'react';
import {Keyboard} from 'react-native';
import {act, fireEvent, render, screen} from '@testing-library/react-native';

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
      },
    },
  }),
}));
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: jest.fn(), hide: () => Promise.resolve()},
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
    anchors: [{key: request.verseKey}],
    linkVerse: {surah: request.surahNumber, ayah: request.ayahNumber},
    linkLabel: request.verseKey,
    units: null,
    model: null,
  }),
}));
jest.mock('@/components/sheets/verse-actions/TafseerContent', () => ({
  TafseerContent: () => null,
}));
jest.mock('@/services/userState/communityReflectionsProvider', () => ({
  qariahCommunityReflectionsProvider: async () => [],
}));
jest.mock('@/components/layout/TabletDialog', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  TabletDialog: ({children}) => children,
}));
const mockNotes = {
  editorPublish: false,
  personalNotes: [],
  refresh: jest.fn(),
  isRange: false,
  hasPersonalNote: false,
  hasReflection: false,
};
jest.mock('@/components/notes/useQariahVerseNotes', () => ({
  useQariahVerseNotes: () => mockNotes,
}));
jest.mock('@/components/notes/QariahVerseNoteRows', () => ({
  QariahVerseNoteRows: () => null,
}));
const mockSaveNote = jest.fn();
jest.mock('@/components/sheets/verse-actions/NoteContent', () => {
  const {createElement, Fragment, useState} = jest.requireActual('react');
  const {Pressable, TextInput} = jest.requireActual('react-native');
  return {
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    NoteContent: ({initialText, onTextChange, onDone}) => {
      const [text, setText] = useState(initialText ?? '');
      return createElement(
        Fragment,
        null,
        createElement(TextInput, {
          testID: 'note-field',
          value: text,
          onChangeText: (next: string) => {
            setText(next);
            onTextChange?.(next);
          },
        }),
        createElement(Pressable, {
          testID: 'note-save',
          onPress: () => {
            mockSaveNote(text);
            onDone();
          },
        }),
      );
    },
  };
});

import {AyahPanelHost} from '../AyahPanelHost';
import {
  ayahPanelDraftKey,
  closeAyahPanel,
  openAyahPanel,
  registerAyahPanelHost,
  useAyahPanelStore,
  type AyahPanelPayload,
} from '../ayahPanelStore';

const AYAH = {
  verseKey: '67:3',
  surahNumber: 67,
  ayahNumber: 3,
  source: 'mushaf',
} as AyahPanelPayload;

let unregister: (() => void) | null = null;

beforeEach(() => {
  mockSaveNote.mockClear();
  useAyahPanelStore.setState({drafts: {}});
  unregister = registerAyahPanelHost();
  act(() => openAyahPanel(AYAH, 'notes', {compose: true}));
});

afterEach(() => {
  act(() => {
    unregister?.();
  });
  unregister = null;
});

const field = () => screen.getByTestId('note-field');

describe('an unsaved note in the ayah panel', () => {
  it('survives the panel turning into the card at 900 pt, and back', () => {
    const view = render(<AyahPanelHost presentation="side" />);
    fireEvent.changeText(field(), 'AP-16 note 67:3');
    // The window crosses 900 pt: the host swaps its root, and the editor
    // mounts again.
    view.rerender(<AyahPanelHost presentation="card" />);
    expect(field().props.value).toBe('AP-16 note 67:3');
    view.rerender(<AyahPanelHost presentation="side" />);
    expect(field().props.value).toBe('AP-16 note 67:3');
  });

  it('is kept when the panel closes, and opens again in the Notes tab', () => {
    const view = render(<AyahPanelHost presentation="side" />);
    fireEvent.changeText(field(), 'kept');
    act(() => closeAyahPanel());
    view.rerender(<AyahPanelHost presentation={null} />);
    expect(
      useAyahPanelStore.getState().drafts[ayahPanelDraftKey(AYAH)]?.text,
    ).toBe('kept');

    act(() => openAyahPanel(AYAH, 'tafsir'));
    view.rerender(<AyahPanelHost presentation="side" />);
    expect(screen.queryByTestId('note-field')).toBeNull();
    fireEvent.press(screen.getByTestId('ayah-panel-tab-notes'));
    expect(field().props.value).toBe('kept');
  });

  it('is dropped by a save', () => {
    render(<AyahPanelHost presentation="side" />);
    fireEvent.changeText(field(), 'saved');
    fireEvent.press(screen.getByTestId('note-save'));
    expect(mockSaveNote).toHaveBeenCalledWith('saved');
    expect(useAyahPanelStore.getState().drafts).toEqual({});
    expect(useAyahPanelStore.getState().compose).toBe(false);
  });

  it('is dropped by a cancel', () => {
    render(<AyahPanelHost presentation="side" />);
    fireEvent.changeText(field(), 'gone');
    fireEvent.press(screen.getByTestId('ayah-panel-cancel-note'));
    expect(useAyahPanelStore.getState().drafts).toEqual({});
    expect(screen.queryByTestId('note-field')).toBeNull();
  });

  it('a tab change away from Notes dismisses the keyboard', () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    render(<AyahPanelHost presentation="side" />);
    fireEvent.press(screen.getByTestId('ayah-panel-tab-tafsir'));
    expect(dismiss).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('ayah-panel-tab-notes'));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(field()).toBeTruthy();
    dismiss.mockRestore();
  });
});
