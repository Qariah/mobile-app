// @ai-generated
/**
 * Qariah (#847, word highlight B): the word times of a timing file and the
 * word the reciter recites at a position.
 */
import {
  currentWordIndex,
  parseWordSegments,
  segmentsFitWordCount,
  type WordSegment,
} from '../wordSegments';
import {toAyahTimestamp} from '../timestampRevision';
import type {AyahTimestamp} from '@/types/timestamps';

// Ya-Sin 36:10, Zaynab Talha (the catalog run of the timing pipeline): words
// 1-6, then back to word 3 at 95.16 s, words 3-6 again, then 7-8.
const YASIN_10_FIRST_ONLY: WordSegment[] = [
  [0, 82715, 85720],
  [1, 86280, 87440],
  [2, 87680, 90480],
  [3, 90720, 91080],
  [4, 91320, 91680],
  [5, 91920, 94120],
  [6, 101960, 102200],
  [7, 102560, 105520],
];
const YASIN_10_RECITED: WordSegment[] = [
  [0, 82715, 85720],
  [1, 86280, 87440],
  [2, 87680, 90480],
  [3, 90720, 91080],
  [4, 91320, 91680],
  [5, 91920, 94120],
  [2, 95160, 97960],
  [3, 98240, 98600],
  [4, 98880, 99200],
  [5, 99440, 101680],
  [6, 101960, 102200],
  [7, 102560, 105520],
];

describe('parseWordSegments', () => {
  it('keeps valid segments and sorts them by start', () => {
    expect(
      parseWordSegments([
        [1, 500, 900],
        [0, 0, 400],
      ]),
    ).toEqual([
      [0, 0, 400],
      [1, 500, 900],
    ]);
  });

  it('keeps a word index that occurs more than once (a repeat)', () => {
    expect(parseWordSegments(YASIN_10_RECITED)).toEqual(YASIN_10_RECITED);
  });

  it('sorts a list in word order with repeats into time order', () => {
    const wordOrder = [...YASIN_10_RECITED].sort(
      (a, b) => a[0] - b[0] || a[1] - b[1],
    );
    expect(parseWordSegments(wordOrder)).toEqual(YASIN_10_RECITED);
  });

  it('drops entries that are not [integer >= 0, start >= 0, end > start]', () => {
    expect(
      parseWordSegments([
        [0, 0, 400],
        [-1, 0, 400],
        [1.5, 0, 400],
        ['2', 0, 400],
        [3, 500, 500],
        [4, 900, 600],
        [5, -10, 400],
        [6, NaN, 400],
        [7, 0],
        {word: 8, start: 0, end: 400},
        null,
      ]),
    ).toEqual([[0, 0, 400]]);
  });

  it('is undefined for no segments', () => {
    expect(parseWordSegments(undefined)).toBeUndefined();
    expect(parseWordSegments(null)).toBeUndefined();
    expect(parseWordSegments([])).toBeUndefined();
    expect(parseWordSegments('[[0,0,1]]')).toBeUndefined();
    expect(parseWordSegments([[0, 5, 5]])).toBeUndefined();
  });
});

describe('currentWordIndex', () => {
  it('word order: the segment whose [start, end) holds the position', () => {
    expect(currentWordIndex(YASIN_10_FIRST_ONLY, 82715)).toBe(0);
    expect(currentWordIndex(YASIN_10_FIRST_ONLY, 87000)).toBe(1);
    expect(currentWordIndex(YASIN_10_FIRST_ONLY, 93000)).toBe(5);
    expect(currentWordIndex(YASIN_10_FIRST_ONLY, 102000)).toBe(6);
    expect(currentWordIndex(YASIN_10_FIRST_ONLY, 105519)).toBe(7);
  });

  it('a gap between two words: the last word stays marked', () => {
    // 85720-86280: after word 1, before word 2.
    expect(currentWordIndex(YASIN_10_FIRST_ONLY, 86000)).toBe(0);
    // The end is not part of the segment, but the word stays marked.
    expect(currentWordIndex(YASIN_10_FIRST_ONLY, 85720)).toBe(0);
    // After the last word, to the next ayah.
    expect(currentWordIndex(YASIN_10_FIRST_ONLY, 106000)).toBe(7);
  });

  it('a repeat: the mark goes back to the earlier word', () => {
    expect(currentWordIndex(YASIN_10_RECITED, 93000)).toBe(5); // 93.0 s
    expect(currentWordIndex(YASIN_10_RECITED, 96000)).toBe(2); // 96.0 s
    expect(currentWordIndex(YASIN_10_RECITED, 99500)).toBe(5);
    expect(currentWordIndex(YASIN_10_RECITED, 102000)).toBe(6);
    // The gap before the repeat (94.12-95.16 s) keeps word 6.
    expect(currentWordIndex(YASIN_10_RECITED, 94500)).toBe(5);
  });

  it('the first-recitation-only list does not go back at a repeat', () => {
    // Without the repeats, word 6 stays marked through the repeat.
    expect(currentWordIndex(YASIN_10_FIRST_ONLY, 96000)).toBe(5);
  });

  it('before the first word of the ayah: the first word', () => {
    expect(currentWordIndex(YASIN_10_RECITED, 80000)).toBe(0);
    expect(currentWordIndex(YASIN_10_RECITED, NaN)).toBe(0);
  });

  it('overlapping segments: one that still holds the position wins', () => {
    const overlap: WordSegment[] = [
      [0, 0, 1000],
      [1, 200, 400],
    ];
    expect(currentWordIndex(overlap, 300)).toBe(1);
    expect(currentWordIndex(overlap, 600)).toBe(0);
  });

  it('no segments: no word', () => {
    expect(currentWordIndex([], 1000)).toBeNull();
  });
});

describe('segmentsFitWordCount', () => {
  it('is true when every index names a word of the ayah', () => {
    expect(segmentsFitWordCount(YASIN_10_RECITED, 8)).toBe(true);
  });

  it('a count mismatch (the aligner has more words): false, the ayah tint shows', () => {
    expect(segmentsFitWordCount(YASIN_10_RECITED, 7)).toBe(false);
  });

  it('no segments or no words: false', () => {
    expect(segmentsFitWordCount([], 8)).toBe(false);
    expect(segmentsFitWordCount(YASIN_10_RECITED, 0)).toBe(false);
  });
});

describe('the test timing file (Zaynab Talha, Ya-Sin)', () => {
  const file =
    require('@/assets/data/timings/word-times-test/f543c610-837d-5fc5-825f-0b51752aa3a4-036.json') as AyahTimestamp[];
  const timings = file.map(toAyahTimestamp);

  it('has the published shape: 83 ayat, each with its word times', () => {
    expect(timings).toHaveLength(83);
    for (const t of timings) {
      expect(t.surahNumber).toBe(36);
      expect(t.durationMs).toBe(t.timestampTo - t.timestampFrom);
      expect(t.segments?.length).toBeGreaterThan(0);
    }
    expect(timings.map(t => t.ayahNumber)).toEqual(
      Array.from({length: 83}, (_, i) => i + 1),
    );
  });

  it('36:10 at 93.0 s marks word 6, and at 96.0 s word 3 again', () => {
    const segments = timings[9].segments ?? [];
    expect(segments).toEqual(YASIN_10_RECITED);
    expect(currentWordIndex(segments, 93000)).toBe(5);
    expect(currentWordIndex(segments, 96000)).toBe(2);
  });
});
