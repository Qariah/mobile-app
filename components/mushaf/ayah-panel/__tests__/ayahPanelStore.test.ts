// @ai-generated
// Sprint 52 Task 8: the ayah panel's store. Which payloads the panel takes,
// the highlight of its ayah while it is open (the verse-actions sheet clears
// the selection when it closes), a long-press that moves it, and close.
const mockShow = jest.fn();
jest.mock('react-native-actions-sheet', () => ({
  SheetManager: {show: (...args: unknown[]) => mockShow(...args)},
}));

import {useMushafVerseSelectionStore} from '@/store/mushafVerseSelectionStore';
import {useVerseSelectionStore} from '@/store/verseSelectionStore';
import {
  ayahPanelKeepsDraft,
  canShowInAyahPanel,
  closeAyahPanel,
  isAyahPanelOpen,
  moveAyahPanel,
  openAyahPanel,
  registerAyahPanelHost,
  setAyahPanelCompose,
  setAyahPanelTab,
  useAyahPanelStore,
  type AyahPanelPayload,
} from '../ayahPanelStore';
import {showVerseActions} from '../showVerseActions';

function mushafPayload(key: string, extra: Partial<AyahPanelPayload> = {}) {
  const [surah, ayah] = key.split(':').map(Number);
  return {
    verseKey: key,
    surahNumber: surah,
    ayahNumber: ayah,
    source: 'mushaf',
    ...extra,
  } as AyahPanelPayload;
}

/** A Mushaf long-press on Hafs ayah `key` of `page` (QCF and Skia Hafs). */
function longPressPage(key: string, page: number) {
  useMushafVerseSelectionStore.getState().selectVerse(key, page);
}

let unregister: (() => void) | null = null;

beforeEach(() => {
  mockShow.mockClear();
  unregister = registerAyahPanelHost();
});

afterEach(() => {
  unregister?.();
  unregister = null;
  useMushafVerseSelectionStore.getState().clearSelection();
  useVerseSelectionStore.getState().clearSelection();
});

describe('canShowInAyahPanel', () => {
  it('takes one ayah from the Mushaf reader on a tablet', () => {
    expect(canShowInAyahPanel(mushafPayload('2:2'), true)).toBe(true);
  });

  it('refuses phones, the player, ranges and a reader that is not mounted', () => {
    expect(canShowInAyahPanel(mushafPayload('2:2'), false)).toBe(false);
    expect(
      canShowInAyahPanel(mushafPayload('2:2', {source: 'player'}), true),
    ).toBe(false);
    expect(
      canShowInAyahPanel(
        mushafPayload('2:2', {verseKeys: ['2:2', '2:3']}),
        true,
      ),
    ).toBe(false);
    unregister?.();
    unregister = null;
    expect(canShowInAyahPanel(mushafPayload('2:2'), true)).toBe(false);
  });
});

describe('openAyahPanel and closeAyahPanel', () => {
  it('opens on the tab, with the page of the selected ayah', () => {
    longPressPage('2:2', 2);
    openAyahPanel(mushafPayload('2:2'), 'reflections');
    const state = useAyahPanelStore.getState();
    expect(state.payload?.verseKey).toBe('2:2');
    expect(state.tab).toBe('reflections');
    expect(state.page).toBe(2);
    expect(state.compose).toBe(false);
  });

  it('keeps the ayah highlighted when the verse-actions sheet clears the selection', () => {
    longPressPage('2:2', 2);
    openAyahPanel(mushafPayload('2:2'), 'tafsir');
    // VerseActionsSheet handleOnClose:
    useVerseSelectionStore.getState().clearSelection();
    useMushafVerseSelectionStore.getState().clearSelection();
    const mushaf = useMushafVerseSelectionStore.getState();
    expect(mushaf.selectedVerseKeys).toEqual(['2:2']);
    expect(mushaf.selectedPageNumber).toBe(2);
  });

  it('keeps a list-view selection too', () => {
    useVerseSelectionStore.getState().selectVerse('67:1', 67, 1);
    openAyahPanel(mushafPayload('67:1'), 'notes');
    useVerseSelectionStore.getState().clearSelection();
    expect(useVerseSelectionStore.getState().selectedVerseKey).toBe('67:1');
  });

  it('clears the highlight on close', () => {
    longPressPage('2:2', 2);
    openAyahPanel(mushafPayload('2:2'), 'tafsir');
    closeAyahPanel();
    expect(isAyahPanelOpen()).toBe(false);
    expect(useMushafVerseSelectionStore.getState().selectedVerseKeys).toEqual(
      [],
    );
    // And no longer puts it back.
    longPressPage('2:5', 2);
    useMushafVerseSelectionStore.getState().clearSelection();
    expect(useMushafVerseSelectionStore.getState().selectedVerseKeys).toEqual(
      [],
    );
  });

  it('opens the note editor only on the notes tab', () => {
    openAyahPanel(mushafPayload('2:2'), 'tafsir', {compose: true});
    expect(useAyahPanelStore.getState().compose).toBe(false);
    openAyahPanel(mushafPayload('2:2'), 'notes', {compose: true});
    expect(useAyahPanelStore.getState().compose).toBe(true);
  });

  it('closes when the last reader unmounts', () => {
    openAyahPanel(mushafPayload('2:2'), 'tafsir');
    unregister?.();
    unregister = null;
    expect(isAyahPanelOpen()).toBe(false);
  });
});

describe('a long-press while the panel is open', () => {
  it('opens the verse actions while the panel is closed', () => {
    longPressPage('2:3', 2);
    showVerseActions(mushafPayload('2:3'));
    expect(mockShow).toHaveBeenCalledWith('verse-actions', {
      payload: mushafPayload('2:3'),
    });
    expect(isAyahPanelOpen()).toBe(false);
  });

  it('moves the panel to the ayah, on the same tab, with no sheet', () => {
    longPressPage('2:2', 2);
    openAyahPanel(mushafPayload('2:2'), 'reflections');
    const revision = useAyahPanelStore.getState().revision;

    longPressPage('1:3', 1);
    showVerseActions(mushafPayload('1:3'));

    expect(mockShow).not.toHaveBeenCalled();
    const state = useAyahPanelStore.getState();
    expect(state.payload?.verseKey).toBe('1:3');
    expect(state.tab).toBe('reflections');
    expect(state.page).toBe(1);
    expect(state.revision).toBe(revision + 1);
    // The highlight moved: only 1:3.
    expect(useMushafVerseSelectionStore.getState().selectedVerseKeys).toEqual([
      '1:3',
    ]);
  });

  it('drops the old list highlight when the new ayah is on a Mushaf page', () => {
    useVerseSelectionStore.getState().selectVerse('67:1', 67, 1);
    openAyahPanel(mushafPayload('67:1'), 'notes');
    longPressPage('67:2', 562);
    expect(moveAyahPanel(mushafPayload('67:2'))).toBe(true);
    expect(useVerseSelectionStore.getState().selectedVerseKey).toBeNull();
  });

  it('opens the verse actions for a range, and keeps the panel', () => {
    longPressPage('2:2', 2);
    openAyahPanel(mushafPayload('2:2'), 'tafsir');
    const range = mushafPayload('2:3', {verseKeys: ['2:3', '2:4']});
    showVerseActions(range);
    expect(mockShow).toHaveBeenCalledWith('verse-actions', {payload: range});
    expect(useAyahPanelStore.getState().payload?.verseKey).toBe('2:2');
  });

  it('opens the verse actions from the player, and keeps the panel', () => {
    openAyahPanel(mushafPayload('2:2'), 'tafsir');
    const player = mushafPayload('2:255', {source: 'player'});
    showVerseActions(player);
    expect(mockShow).toHaveBeenCalledWith('verse-actions', {payload: player});
    expect(useAyahPanelStore.getState().payload?.verseKey).toBe('2:2');
  });
});

// Review fix 1: a note that is being written is not lost.
describe('an unsaved note in the Personal Notes tab', () => {
  beforeEach(() => {
    longPressPage('2:2', 2);
    openAyahPanel(mushafPayload('2:2'), 'notes', {compose: true});
  });

  it('keeps the editor when the tab changes', () => {
    const revision = useAyahPanelStore.getState().revision;
    setAyahPanelTab('tafsir');
    setAyahPanelTab('notes');
    const state = useAyahPanelStore.getState();
    expect(state.compose).toBe(true);
    expect(state.revision).toBe(revision);
  });

  it('keeps the panel on its ayah after a long-press on another ayah', () => {
    const revision = useAyahPanelStore.getState().revision;
    longPressPage('2:3', 2);
    showVerseActions(mushafPayload('2:3'));
    expect(mockShow).not.toHaveBeenCalled();
    const state = useAyahPanelStore.getState();
    expect(state.payload?.verseKey).toBe('2:2');
    expect(state.compose).toBe(true);
    expect(state.revision).toBe(revision);
    // The highlight goes back to the ayah of the note.
    expect(useMushafVerseSelectionStore.getState().selectedVerseKeys).toEqual([
      '2:2',
    ]);
  });

  it('names a draft only for another ayah', () => {
    expect(ayahPanelKeepsDraft(mushafPayload('2:3'))).toBe(true);
    expect(ayahPanelKeepsDraft(mushafPayload('2:2'))).toBe(false);
    setAyahPanelCompose(false);
    expect(ayahPanelKeepsDraft(mushafPayload('2:3'))).toBe(false);
  });

  it('a hand-off for the same ayah changes the tab only', () => {
    const revision = useAyahPanelStore.getState().revision;
    openAyahPanel(mushafPayload('2:2'), 'tafsir');
    const state = useAyahPanelStore.getState();
    expect(state.tab).toBe('tafsir');
    expect(state.compose).toBe(true);
    expect(state.revision).toBe(revision);
  });
});
