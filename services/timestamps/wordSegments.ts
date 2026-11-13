// @ai-generated
/**
 * Qariah (#847, word highlight B): the word times of a timing file.
 *
 * A published timing file is a top-level array of ayah objects
 * (types/timestamps.ts). The ops console adds `segments` to each one:
 *
 *   "segments": [[word index from 0, start_ms, end_ms], ...]
 *
 * The app accepts two forms of the list:
 *  - the first recitation of each word, in word order (the form of
 *    `buildTimestampFile` in qariah-ops-console today);
 *  - every recitation in time order, repeats included: a word index can
 *    occur more than once (the reciter goes back and recites words again).
 *
 * parseWordSegments() sorts the list by start, so both forms work the same
 * way. The word index counts the whole words of the ayah in the text the
 * aligner used (`recitation-timings/data/text/<rewayah>/<NNN>.json`,
 * `words[].word - 1`), with no verse-end mark.
 */
import type {WordSegment} from '@/types/timestamps';

export type {WordSegment};

/** Larger than the word count of any ayah (2:282 has 128 words). */
const MAX_WORD_INDEX = 1000;

function asSegment(value: unknown): WordSegment | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [word, start, end] = value as unknown[];
  if (
    typeof word !== 'number' ||
    !Number.isSafeInteger(word) ||
    word < 0 ||
    word >= MAX_WORD_INDEX
  ) {
    return null;
  }
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start) return null;
  return [word, start, end];
}

/**
 * The valid segments of a raw `segments` value, sorted by start (a stable
 * sort: two segments with the same start keep their file order). An entry
 * that is not `[integer >= 0, start >= 0, end > start]` is dropped.
 * Undefined when no valid segment is left (also for a missing value).
 */
export function parseWordSegments(raw: unknown): WordSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const segments: WordSegment[] = [];
  for (const value of raw) {
    const segment = asSegment(value);
    if (segment) segments.push(segment);
  }
  if (segments.length === 0) return undefined;
  segments.sort((a, b) => a[1] - b[1]);
  return segments;
}

/**
 * The word index the reciter recites at `positionMs`, from segments sorted
 * by start (parseWordSegments):
 *  - the segment whose [start, end) holds the position (with overlapping
 *    segments, the one that started last);
 *  - else the last segment that started before the position: between two
 *    words the last word stays marked, and after a repeat starts the mark
 *    is on the earlier word that the reciter recites again;
 *  - before the first segment (the start of the ayah, before its first
 *    word): the word of the first segment, so the mark does not go off and
 *    on at each ayah start.
 * Null only when there are no segments.
 */
export function currentWordIndex(
  segments: readonly WordSegment[],
  positionMs: number,
): number | null {
  if (segments.length === 0) return null;
  if (!(positionMs >= segments[0][1])) return segments[0][0];

  // The last segment that started at or before the position.
  let low = 0;
  let high = segments.length - 1;
  let last = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (segments[mid][1] <= positionMs) {
      last = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (positionMs < segments[last][2]) return segments[last][0];
  // Overlapping segments only: an earlier segment that still holds it.
  for (let i = last - 1; i >= 0; i--) {
    if (positionMs < segments[i][2]) return segments[i][0];
  }
  return segments[last][0];
}

/**
 * True when every word index of the segments names a word of an ayah that
 * has `wordCount` whole words in the Mushaf the app shows. False when the
 * aligner's text has more words there: a mark could then fall on the wrong
 * word, so the app shows the ayah tint instead.
 */
export function segmentsFitWordCount(
  segments: readonly WordSegment[],
  wordCount: number,
): boolean {
  if (segments.length === 0 || wordCount <= 0) return false;
  for (const [word] of segments) {
    if (word >= wordCount) return false;
  }
  return true;
}
