// @ai-generated
/**
 * Qariah (#847, word highlight B): the words of one verse unit of the text
 * the Mushaf shows, with the place where each one is drawn.
 *
 * A word is a word slot of the unit that draws a whole word: a blank slot
 * draws nothing, and a slot that holds only a verse-end marker (۝N) is not
 * a word. A slot with several tokens ('إِلْ يَاسِينَ', or two rewayah words in
 * one Hafs slot) is one word, and a slot that ends with an inline verse
 * marker ('word ۝N') is its word without the marker. This is the word rule
 * of the timing pipeline (`recitation-timings/tools/prepare_pilot.py`,
 * `export_text`), so word N of a timing file is word N here.
 *
 * The places come from getLineWordSpans and the unit of each slot
 * (ShownVerseUnits.unitOfSlot): the same spans the page renderers paint the
 * unit segments from, so a word mark lies exactly inside its ayah's tint.
 */
import type {DKLine, DKWordInfo} from './DigitalKhattDataService';
import {getLineWordSpans} from './lineWordSpans';
import type {ShownVerseUnits} from './MushafVerseMapService';

/** The reads of DigitalKhattDataService this module needs. */
export interface UnitWordSource {
  getPageForVerse(verseKey: string): number | undefined;
  getPageLines(pageNumber: number): DKLine[];
  getWordText(wordId: number): string;
  getWordInfo(wordId: number): DKWordInfo | undefined;
}

export interface UnitWord {
  wordId: number;
  pageNumber: number;
  /** Index of the line in getPageLines(pageNumber). */
  lineIndex: number;
  /** First and last index (inclusive) of the whole word in the line text. */
  start: number;
  end: number;
}

const LAST_PAGE = 604;
/** A verse unit never runs over more than this many pages. */
const MAX_UNIT_PAGES = 3;

/**
 * The words of unit `unitKey` of `shown`, in reading order. Empty when the
 * unit is not known or has no word on the pages.
 */
export function unitWords(
  shown: ShownVerseUnits,
  unitKey: string,
  source: UnitWordSource,
): UnitWord[] {
  const unit = shown.describe(unitKey);
  const firstHafsKey = unit?.hafsKeys[0];
  if (!firstHafsKey) return [];
  const firstPage = source.getPageForVerse(firstHafsKey);
  if (!firstPage) return [];

  const words: UnitWord[] = [];
  let seen = false;
  const lastPage = Math.min(LAST_PAGE, firstPage + MAX_UNIT_PAGES - 1);
  for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber++) {
    const lines = source.getPageLines(pageNumber);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      for (const span of getLineWordSpans(lines[lineIndex], source)) {
        const owner = shown.unitOfSlot(span.wordId, span.info.verseKey);
        if (owner?.key !== unitKey) {
          // The slots of a unit are one run: after it, the unit has ended.
          if (seen) return words;
          continue;
        }
        seen = true;
        if (span.wordEnd < span.start) continue; // only a verse marker
        words.push({
          wordId: span.wordId,
          pageNumber,
          lineIndex,
          start: span.start,
          end: span.wordEnd,
        });
      }
    }
  }
  return words;
}
