// @ai-generated
/**
 * Qariah (#847, word highlight B): the word the Mushaf marks while a timed
 * ayah plays. services/audio/mushafWordTracker.ts writes it; each SkiaLine
 * reads only whether the mark is on its own line (components/mushaf/skia/
 * wordMark.tsx), and the page renderers read only whether a word is lit (to
 * hide the ayah tint). So a new word redraws the mark, not the page.
 */
import {create} from 'zustand';

export interface WordMark {
  /** The verse unit of the shown text ('S:A' in its rewayah's numbering). */
  readonly unitKey: string;
  /** The word index in the unit, from 0 (the timing file's index). */
  readonly wordIndex: number;
  readonly pageNumber: number;
  /** Index of the line in DigitalKhattDataService.getPageLines(pageNumber). */
  readonly lineIndex: number;
  /** First and last index (inclusive) of the word in the line text. */
  readonly start: number;
  readonly end: number;
  /** The text the place was found in (getPageTextIdentity). */
  readonly textIdentity: string | null;
}

interface WordMarkState {
  mark: WordMark | null;
}

export const useMushafWordMarkStore = create<WordMarkState>(() => ({
  mark: null,
}));

function sameMark(a: WordMark | null, b: WordMark | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.unitKey === b.unitKey &&
    a.wordIndex === b.wordIndex &&
    a.pageNumber === b.pageNumber &&
    a.lineIndex === b.lineIndex &&
    a.start === b.start &&
    a.end === b.end &&
    a.textIdentity === b.textIdentity
  );
}

/** Sets the mark; no store change when it is the same mark. */
export function setWordMark(mark: WordMark | null): void {
  if (sameMark(useMushafWordMarkStore.getState().mark, mark)) return;
  useMushafWordMarkStore.setState({mark});
}

/** True while a word is lit: the playback layer then paints no ayah tint. */
export function usePlaybackWordLit(): boolean {
  return useMushafWordMarkStore(s => s.mark !== null);
}
