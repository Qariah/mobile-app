// @ai-generated
/**
 * The ayah panel of the Mushaf reader on a tablet (Sprint 52 Task 8;
 * docs/design/ipad-standards.md §8, "a trailing side panel (360–400pt) when
 * the content relates to what is on screen"). Tafsir, Reflections and
 * Personal Notes of one ayah show beside the page (a window of 900 pt or
 * more) or in a centred card (a narrower tablet window). Phones keep the
 * verse-actions sheet.
 *
 * This store holds which ayah the panel shows and which tab. It also keeps
 * the ayah highlighted while the panel is open: the verse-actions sheet
 * clears the selection when it closes, and the panel puts its ayah back.
 */
import {create} from 'zustand';
import type {Sheets} from 'react-native-actions-sheet';
import {
  useMushafVerseSelectionStore,
  type SelectedVerseUnit,
} from '@/store/mushafVerseSelectionStore';
import {useVerseSelectionStore} from '@/store/verseSelectionStore';
import type {RewayahId} from '@/services/rewayah/RewayahIdentity';

export type AyahPanelTab = 'tafsir' | 'reflections' | 'notes';

/** A verse-actions payload: the panel shows the ayah that it names. */
export type AyahPanelPayload = Sheets['verse-actions']['payload'];

/** Width of the panel beside the reader. */
export const AYAH_PANEL_WIDTH = 360;
/** The narrowest window that shows the panel beside the reader. */
export const AYAH_PANEL_MIN_WINDOW = 900;

interface AyahPanelState {
  /** The ayah of the panel, or null while it is closed. */
  payload: AyahPanelPayload | null;
  tab: AyahPanelTab;
  /** The Personal Notes tab shows the note editor. */
  compose: boolean;
  /** The Mushaf page of the ayah, when a Mushaf page selected it. */
  page: number | null;
  /** Counts each open and move, so the tab content remounts for the ayah. */
  revision: number;
  /** Readers mounted that can show the panel (the Mushaf on a tablet). */
  hosts: number;
  /**
   * Unsaved notes, by ayah (`ayahPanelDraftKey`). A draft outlives a remount
   * of the editor (the panel turns into the card at 900 pt) and a close of
   * the panel; a save or a cancel clears it.
   */
  drafts: Record<string, AyahPanelDraft>;
}

/** An unsaved note: its text, and whether it publishes (a Reflection). */
export interface AyahPanelDraft {
  text: string;
  publish: boolean;
}

const CLOSED = {
  payload: null,
  tab: 'tafsir' as AyahPanelTab,
  compose: false,
  page: null,
  revision: 0,
};

export const useAyahPanelStore = create<AyahPanelState>(() => ({
  ...CLOSED,
  hosts: 0,
  drafts: {},
}));

// ---------------------------------------------------------------------------
// The highlight of the panel's ayah
// ---------------------------------------------------------------------------

type MushafHighlight = {
  rewayah: RewayahId;
  units: readonly SelectedVerseUnit[];
  page: number;
};
type ListHighlight = {
  verseKey: string;
  surah: number;
  ayah: number;
  rewayah: RewayahId;
};
type Highlight = {mushaf: MushafHighlight | null; list: ListHighlight | null};

let highlight: Highlight = {mushaf: null, list: null};
let keeping = false;

/** The ayah key in the payload's own numbering ('S:A'). */
export function ayahPanelKey(payload: AyahPanelPayload): string {
  return payload.unitKeys?.[0] ?? payload.verseKey;
}

/** The key of the ayah's draft: its key in its rewayah's own numbering. */
export function ayahPanelDraftKey(payload: AyahPanelPayload): string {
  return `${payload.rewayah ?? 'hafs'} ${ayahPanelKey(payload)}`;
}

function hasDraft(payload: AyahPanelPayload): boolean {
  const draft = useAyahPanelStore.getState().drafts[ayahPanelDraftKey(payload)];
  return !!draft && draft.text.length > 0;
}

/** Keeps (or, with empty text, drops) the draft of `payload`'s ayah. */
export function setAyahPanelDraft(
  payload: AyahPanelPayload,
  text: string,
  publish: boolean,
): void {
  const key = ayahPanelDraftKey(payload);
  useAyahPanelStore.setState(s => {
    const drafts = {...s.drafts};
    if (text.length > 0) drafts[key] = {text, publish};
    else delete drafts[key];
    return {drafts};
  });
}

/** Drops the draft of `payload`'s ayah (after a save or a cancel). */
export function clearAyahPanelDraft(payload: AyahPanelPayload): void {
  setAyahPanelDraft(payload, '', false);
}

/**
 * Takes the selection that names the payload's ayah from each store, and
 * clears a store whose selection names another ayah (the panel's previous
 * ayah, which the panel itself put back).
 */
function takeHighlight(payload: AyahPanelPayload): Highlight {
  const key = ayahPanelKey(payload);
  const mushaf = useMushafVerseSelectionStore.getState();
  const list = useVerseSelectionStore.getState();
  const next: Highlight = {
    mushaf:
      mushaf.selectedRewayah &&
      mushaf.selectedVerseKeys.length === 1 &&
      mushaf.selectedVerseKeys[0] === key &&
      mushaf.selectedPageNumber !== null
        ? {
            rewayah: mushaf.selectedRewayah,
            units: mushaf.selectedUnits,
            page: mushaf.selectedPageNumber,
          }
        : null,
    list:
      list.selectedVerseKey === key &&
      list.selectedSurahNumber !== null &&
      list.selectedAyahNumber !== null
        ? {
            verseKey: key,
            surah: list.selectedSurahNumber,
            ayah: list.selectedAyahNumber,
            rewayah: list.selectedRewayah ?? 'hafs',
          }
        : null,
  };
  // Set first: the clears below must not put the old ayah back.
  highlight = next;
  if (!next.mushaf && mushaf.selectedVerseKeys.length > 0) {
    mushaf.clearSelection();
  }
  if (!next.list && list.selectedVerseKey) list.clearSelection();
  return next;
}

function restoreMushaf() {
  const h = highlight.mushaf;
  const store = useMushafVerseSelectionStore.getState();
  if (h && store.selectedVerseKeys.length === 0) {
    store.selectUnits(h.rewayah, h.units, h.page);
  }
}

function restoreList() {
  const h = highlight.list;
  const store = useVerseSelectionStore.getState();
  if (h && !store.selectedVerseKey) {
    store.selectVerse(h.verseKey, h.surah, h.ayah, h.rewayah);
  }
}

/**
 * The selection shows the panel's ayah again, also when another ayah took it
 * (a long-press that the panel refused while a note is being written).
 */
function putHighlightBack() {
  const mushaf = useMushafVerseSelectionStore.getState();
  if (highlight.mushaf) {
    const h = highlight.mushaf;
    mushaf.selectUnits(h.rewayah, h.units, h.page);
  } else if (mushaf.selectedVerseKeys.length > 0) {
    mushaf.clearSelection();
  }
  const list = useVerseSelectionStore.getState();
  if (highlight.list) {
    const h = highlight.list;
    list.selectVerse(h.verseKey, h.surah, h.ayah, h.rewayah);
  } else if (list.selectedVerseKey) {
    list.clearSelection();
  }
}

/** While the panel is open, an emptied selection gets the panel's ayah back. */
function keepHighlight() {
  if (keeping) return;
  keeping = true;
  useMushafVerseSelectionStore.subscribe(state => {
    if (state.selectedVerseKeys.length === 0 && isAyahPanelOpen()) {
      restoreMushaf();
    }
  });
  useVerseSelectionStore.subscribe(state => {
    if (!state.selectedVerseKey && isAyahPanelOpen()) restoreList();
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function isAyahPanelOpen(): boolean {
  return useAyahPanelStore.getState().payload !== null;
}

/**
 * True while the Personal Notes tab holds a note that is not saved and the
 * payload names another ayah: the panel then keeps its ayah, so the draft
 * is not lost.
 */
export function ayahPanelKeepsDraft(payload: AyahPanelPayload): boolean {
  const state = useAyahPanelStore.getState();
  return (
    state.compose &&
    state.payload !== null &&
    ayahPanelKey(state.payload) !== ayahPanelKey(payload)
  );
}

/**
 * True when the panel can show this payload: a tablet with a Mushaf reader
 * mounted, one ayah, from the reader (not from the player's verse view, which
 * covers the reader).
 */
export function canShowInAyahPanel(
  payload: AyahPanelPayload | null | undefined,
  isTablet: boolean,
): payload is AyahPanelPayload {
  if (!payload || !isTablet) return false;
  if (useAyahPanelStore.getState().hosts === 0) return false;
  if (payload.source !== 'mushaf') return false;
  const count = (payload.unitKeys ?? payload.verseKeys ?? []).length;
  return count <= 1;
}

/** Shows the panel on the payload's ayah, on `tab`. */
export function openAyahPanel(
  payload: AyahPanelPayload,
  tab: AyahPanelTab,
  options: {compose?: boolean} = {},
): void {
  keepHighlight();
  const current = useAyahPanelStore.getState();
  if (
    current.compose &&
    current.payload &&
    ayahPanelKey(current.payload) === ayahPanelKey(payload)
  ) {
    // The same ayah while a note is being written: change the tab only, so
    // the editor and its draft stay.
    useAyahPanelStore.setState({tab});
    putHighlightBack();
    return;
  }
  const h = takeHighlight(payload);
  useAyahPanelStore.setState(s => ({
    payload,
    tab,
    // A kept draft of this ayah opens in the editor again.
    compose: tab === 'notes' && (!!options.compose || hasDraft(payload)),
    page: h.mushaf?.page ?? null,
    revision: s.revision + 1,
  }));
  restoreMushaf();
  restoreList();
}

/**
 * A long-press on another ayah while the panel is open moves the panel there
 * (same tab, no verse-actions sheet). Returns false when the panel does not
 * take the payload: it is closed, or the payload names a range or comes
 * from the player. While a note is being written, the panel takes the
 * long-press from the reader but stays on its ayah, with the draft.
 */
export function moveAyahPanel(payload: AyahPanelPayload): boolean {
  const state = useAyahPanelStore.getState();
  if (!state.payload) return false;
  if (state.compose && payload.source === 'mushaf') {
    putHighlightBack();
    return true;
  }
  if (!canShowInAyahPanel(payload, true)) return false;
  const h = takeHighlight(payload);
  useAyahPanelStore.setState(s => ({
    payload,
    compose: s.tab === 'notes' && hasDraft(payload),
    page: h.mushaf?.page ?? null,
    revision: s.revision + 1,
  }));
  restoreMushaf();
  restoreList();
  return true;
}

/** A tab change keeps a note that is being written (the editor stays mounted). */
export function setAyahPanelTab(tab: AyahPanelTab): void {
  const {payload, compose} = useAyahPanelStore.getState();
  useAyahPanelStore.setState({
    tab,
    // The Notes tab shows a kept draft of the ayah in the editor again.
    compose:
      compose || (tab === 'notes' && payload !== null && hasDraft(payload)),
  });
}

export function setAyahPanelCompose(compose: boolean): void {
  useAyahPanelStore.setState({compose});
}

/** Closes the panel and clears the highlight of its ayah. */
export function closeAyahPanel(): void {
  if (!isAyahPanelOpen()) return;
  highlight = {mushaf: null, list: null};
  useAyahPanelStore.setState(CLOSED);
  useMushafVerseSelectionStore.getState().clearSelection();
  useVerseSelectionStore.getState().clearSelection();
}

/**
 * A reader that can show the panel is mounted. Returns the unregister
 * function; the panel closes when the last such reader goes.
 */
export function registerAyahPanelHost(): () => void {
  useAyahPanelStore.setState(s => ({hosts: s.hosts + 1}));
  return () => {
    const hosts = Math.max(useAyahPanelStore.getState().hosts - 1, 0);
    useAyahPanelStore.setState({hosts});
    if (hosts === 0) closeAyahPanel();
  };
}
