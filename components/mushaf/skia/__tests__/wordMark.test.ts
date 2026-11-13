// @ai-generated
/**
 * Qariah (#847, word highlight B): while a timed word is lit, the page
 * shows no ayah tint (only the word has a tint), and the word mark is drawn
 * to the glyph band of its line, as the ayah tint is. Across the line, the
 * mark grows into the spaces beside the word, up to their middle, so it
 * holds the ink that DigitalKhatt draws outside the advance box.
 */
import type {SkParagraph} from '@shopify/react-native-skia';

jest.mock('@shopify/react-native-skia', () => ({
  Group: 'Group',
  RoundedRect: 'RoundedRect',
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({isDarkMode: false}),
}));

// The tokens (the text between two spaces) of the line under test.
const mockLine: {wordInfos: {startIndex: number; endIndex: number}[]} = {
  wordInfos: [{startIndex: 0, endIndex: 3}],
};

jest.mock('@/services/mushaf/QuranTextService', () => ({
  FONTSIZE: 1000,
  SPACEWIDTH: 100,
  quranTextService: {
    analyzeText: () => ({wordInfos: mockLine.wordInfos}),
  },
}));

import {
  computePageHighlightLayers,
  type PageHighlightLayersInput,
  type VerseLineSegment,
} from '../verseHighlightLayers';
import {
  markSpan,
  wordMarkColor,
  wordMarkRects,
  WORD_MARK_EDGE_EM,
  WORD_MARK_MAX_GROWTH_EM,
} from '../wordMark';

// Line 0: 36:9 (chars 0-9), 36:10 (11-40); line 1: 36:10 (0-20), 36:11.
const SEGMENTS: Record<string, VerseLineSegment[]> = {
  '36:9': [{lineIndex: 0, segment: {startCharIndex: 0, endCharIndex: 9}}],
  '36:10': [
    {lineIndex: 0, segment: {startCharIndex: 11, endCharIndex: 40}},
    {lineIndex: 1, segment: {startCharIndex: 0, endCharIndex: 20}},
  ],
  '36:11': [{lineIndex: 1, segment: {startCharIndex: 22, endCharIndex: 50}}],
};

function input(
  over: Partial<PageHighlightLayersInput> = {},
): PageHighlightLayersInput {
  return {
    getVerseSegments: key => SEGMENTS[key] ?? [],
    diffHighlights: new Map(),
    themes: null,
    bookmarkedVerseKeys: new Set(['36:10', '36:11']),
    bookmarkColor: 'BOOKMARK',
    persistentHighlights: {'36:10': 'yellow', '36:9': 'yellow'},
    highlightColors: {yellow: 'Y'},
    playbackVerseKeys: ['36:10'],
    playbackColor: 'PLAY',
    selectedVerseKeys: null,
    selectionColor: 'SELECT',
    ...over,
  };
}

describe('the playback layer while a timed word is lit', () => {
  it('without a lit word: the ayah tint as before', () => {
    const map = computePageHighlightLayers(input()) ?? new Map();
    expect(map.get(0)).toEqual([
      {start: 0, end: 9, color: 'Y'},
      {start: 11, end: 40, color: 'PLAY'},
    ]);
    expect(map.get(1)).toEqual([
      {start: 22, end: 50, color: 'BOOKMARK'},
      {start: 0, end: 20, color: 'PLAY'},
    ]);
  });

  it('with a lit word: no ayah tint, and the bookmark and colour of the recited ayah stay hidden', () => {
    const map =
      computePageHighlightLayers(input({playbackTintHidden: true})) ??
      new Map();
    // Only the other verses keep their tints.
    expect(map.get(0)).toEqual([{start: 0, end: 9, color: 'Y'}]);
    expect(map.get(1)).toEqual([{start: 22, end: 50, color: 'BOOKMARK'}]);
  });

  it('with a lit word: the basmala band is not painted either', () => {
    const map = computePageHighlightLayers(
      input({
        playbackVerseKeys: [],
        bookmarkedVerseKeys: new Set(),
        persistentHighlights: {},
        playbackBasmalaLines: [{lineIndex: 2, length: 20}],
        playbackTintHidden: true,
      }),
    );
    expect(map?.get(2)).toBeUndefined();
  });

  it('a selection still paints over the recited ayah', () => {
    const map =
      computePageHighlightLayers(
        input({playbackTintHidden: true, selectedVerseKeys: ['36:10']}),
      ) ?? new Map();
    expect(map.get(0)).toContainEqual({start: 11, end: 40, color: 'SELECT'});
  });
});

describe('wordMarkColor (`--word-alone` of the approved mock)', () => {
  it('is the text colour at 30 % (light) and 28 % (dark)', () => {
    expect(wordMarkColor('#06151c', false)).toBe('rgba(6, 21, 28, 0.3)');
    expect(wordMarkColor('#ffffff', true)).toBe('rgba(255, 255, 255, 0.28)');
  });
});

const span = (left: number, right: number) => ({left, right});

describe('markSpan (the mark grows into the spaces beside the word)', () => {
  // Font size 20: 2 at a line edge, at most 4 into a space.
  const FONT = 20;

  it('grows by the font space at a line edge and by twice it at most', () => {
    expect(WORD_MARK_EDGE_EM).toBe(0.1);
    expect(WORD_MARK_MAX_GROWTH_EM).toBe(0.2);
  });

  it('grows into the space up to its middle', () => {
    // A space of 6 between the advance boxes: each mark takes 3 of it.
    const a = span(100, 140);
    const b = span(146, 190);
    expect(markSpan(a, null, b, FONT)).toEqual(span(98, 143));
    expect(markSpan(b, a, null, FONT)).toEqual(span(143, 192));
  });

  it('grows no more than 0.2 em into a wide space', () => {
    const a = span(100, 140);
    const b = span(160, 200);
    expect(markSpan(a, null, b, FONT).right).toBe(144);
    expect(markSpan(b, a, null, FONT).left).toBe(156);
  });

  it('holds the separate hamza of 36:10 word 3 (the A10s line)', () => {
    // The advance boxes of page 440 line 12 on the Galaxy A10s (font 20.93).
    // The hamza at the right edge of ءَأَنذَرْتَهُمْ draws about 0.45 pt past its
    // box (CanvasKit, the same font and justification).
    const word = span(683.84, 749.01);
    const am = span(670.53, 680.63); // أَمْ, on the left
    const alayhim = span(752.22, 790); // عَلَيْهِمْ, on the right
    const hamzaInkRight = 749.01 + 0.45;
    const mark = markSpan(word, am, alayhim, 20.93445378151261);
    expect(mark.left).toBeCloseTo((680.63 + 683.84) / 2, 5);
    expect(mark.right).toBeCloseTo((749.01 + 752.22) / 2, 5);
    // Before the fix the mark ended at the box: the hamza was cut.
    expect(word.right).toBeLessThan(hamzaInkRight);
    expect(mark.right - hamzaInkRight).toBeGreaterThan(1);
  });

  it('holds a long tail at the word end (the left end in RTL)', () => {
    // A final ن or ي: its tail draws 1.5 past the box, into a space of 5.
    const tailInkLeft = 98.5;
    const mark = markSpan(span(100, 140), span(55, 95), null, FONT);
    expect(mark).toEqual(span(97.5, 142));
    expect(mark.left).toBeLessThan(tailInkLeft);
  });

  it('at a line edge, the edge margin applies', () => {
    // The first word of an RTL line (nothing to its right) ...
    expect(markSpan(span(300, 336), span(250, 296), null, FONT)).toEqual(
      span(298, 338),
    );
    // ... and the last word (nothing to its left).
    expect(markSpan(span(20, 60), null, span(64, 90), FONT)).toEqual(
      span(18, 62),
    );
  });

  it('two neighbour marks never overlap, and each holds its advance box', () => {
    const words = [
      span(10, 40),
      span(43, 70),
      span(70, 99), // touches its neighbour: no space to grow into
      span(105, 130),
      span(160, 200), // a wide space before it
      span(201.5, 230),
    ];
    const marks = words.map((w, i) =>
      markSpan(w, words[i - 1] ?? null, words[i + 1] ?? null, FONT),
    );
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].left).toBeGreaterThanOrEqual(marks[i - 1].right);
    }
    marks.forEach((m, i) => {
      expect(m.left).toBeLessThanOrEqual(words[i].left);
      expect(m.right).toBeGreaterThanOrEqual(words[i].right);
    });
    expect(marks[1].right).toBe(70);
    expect(marks[2].left).toBe(70);
  });

  it('does not grow toward a box that overlaps it', () => {
    expect(markSpan(span(100, 140), span(90, 101), null, FONT).left).toBe(100);
  });
});

describe('wordMarkRects (the mark in the glyph band)', () => {
  type Rect = {x: number; y: number; width: number; height: number};
  const fakeParagraph = (rectsByRange: Record<string, Rect[]>) =>
    ({
      getRectsForRange: (start: number, end: number) =>
        rectsByRange[`${start}:${end}`] ?? [],
    }) as unknown as SkParagraph;

  // The first word's rects give the band 10-40; a justified space is taller.
  const paragraph = fakeParagraph({
    '0:4': [{x: 300, y: 10, width: 40, height: 30}],
    '6:11': [
      {x: 200, y: 4, width: 30, height: 44}, // a run with a taller box
      {x: 230, y: 10, width: 20, height: 30},
    ],
  });

  beforeEach(() => {
    mockLine.wordInfos = [{startIndex: 0, endIndex: 3}];
  });

  // Font size 20. The first word (300-340) is the word to the mark's right,
  // 50 away: the mark grows 4 into that space, and 2 at the line edge.
  it('clamps the word to the band of the line, as one rect', () => {
    // The band 10-40 of the first word, cut at the slot's bottom (37).
    expect(
      wordMarkRects(paragraph, 440, 0, {start: 6, end: 10}, 0, 37, 20),
    ).toEqual([{x: 198, y: 10, width: 56, height: 27}]);
    // A tall slot: the band of the first word.
    expect(
      wordMarkRects(paragraph, 440, 0, {start: 6, end: 10}, 0, 60, 20),
    ).toEqual([{x: 198, y: 10, width: 56, height: 30}]);
  });

  it('stays inside the line slot', () => {
    // A slot that starts 12 px below the paragraph's top cuts the band.
    expect(
      wordMarkRects(paragraph, 440, 0, {start: 6, end: 10}, 12, 37, 20),
    ).toEqual([{x: 198, y: 12, width: 56, height: 28}]);
  });

  it('gives nothing for a range with no rects', () => {
    expect(
      wordMarkRects(paragraph, 440, 0, {start: 50, end: 52}, 0, 37, 20),
    ).toEqual([]);
  });

  // An RTL line of three words: chars 0-2 on the right, 4-6 in the middle,
  // 8-10 on the left.
  const line = fakeParagraph({
    '0:3': [{x: 300, y: 10, width: 36, height: 30}],
    '4:7': [{x: 240, y: 10, width: 57, height: 30}],
    '8:11': [{x: 200, y: 10, width: 36, height: 30}],
    '4:11': [{x: 200, y: 10, width: 97, height: 30}],
  });
  const LINE = [
    {startIndex: 0, endIndex: 2},
    {startIndex: 4, endIndex: 6},
    {startIndex: 8, endIndex: 10},
  ];

  it('meets each neighbour at the middle of the space', () => {
    mockLine.wordInfos = LINE;
    // Spaces of 3 (to the right) and 4 (to the left).
    expect(wordMarkRects(line, 440, 0, {start: 4, end: 6}, 0, 60, 20)).toEqual([
      {x: 238, y: 10, width: 60.5, height: 30},
    ]);
  });

  it('a word of two tokens grows from both, as one word', () => {
    // 'إِلْ يَاسِينَ' (37:130): chars 4-10, the last word of the line.
    mockLine.wordInfos = LINE;
    expect(wordMarkRects(line, 440, 0, {start: 4, end: 10}, 0, 60, 20)).toEqual(
      [{x: 198, y: 10, width: 100.5, height: 30}],
    );
  });
});
