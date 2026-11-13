// @ai-generated
/**
 * Qariah (#847, word highlight B): the word mark of one Mushaf line.
 *
 * Owner decision 2026-11-12 (`planning/ux/mushaf-word-highlight/decision.md`):
 * only the current word has a tint, `text` at 30 % (light) and 28 % (dark),
 * with no ayah tint while a timed word is lit (`usePlaybackWordLit`, the page
 * renderers). No fade: the mark moves at once. Each mark is drawn to the
 * glyph band of its line, exactly as SkiaLine clamps the ayah tint (critique
 * round 2, finding 1).
 *
 * Across the line, the mark grows from the word's advance box into the
 * space on each side, up to the middle of that space (markSpan).
 * SkParagraph.getRectsForRange gives advance boxes, and the DigitalKhatt
 * glyphs often draw ink outside their advance (a separate hamza or a kaf at
 * the word start, a tail at its end), so a mark of the advance box alone
 * cut the ink at its edges (36:10, ءَأَنذَرْتَهُمْ). The ayah tint did not show
 * this, because it also covers the neighbour words. The glyph bounds of
 * SkParagraph.extendedVisit (React Native Skia 2.14) cannot measure the
 * ink: its positions leave out the GPOS offsets (on the A10s, the lam of
 * لَا came out 4 pt to the right of where it is drawn).
 *
 * Each SkiaLine subscribes to the mark store with a selector of its own line
 * (useLineWordMark), so a new word redraws only the line that loses the mark
 * and the line that gets it: no page render, no paragraph build.
 */
import React, {useMemo} from 'react';
import {Group, RoundedRect, type SkParagraph} from '@shopify/react-native-skia';
import Color from 'color';
import {useTheme} from '@/hooks/useTheme';
import {
  FONTSIZE,
  quranTextService,
  SPACEWIDTH,
} from '@/services/mushaf/QuranTextService';
import {useMushafWordMarkStore} from '@/store/mushafWordMarkStore';
import {
  clampBandToSlot,
  clampRectToBand,
  rectsBand,
  shortestRectBand,
  type LineBand,
} from './justifiedSpace';

/** `--word-alone` of the approved mock (`mocks/base.css`). */
export function wordMarkColor(textColor: string, isDarkMode: boolean): string {
  return Color(textColor)
    .alpha(isDarkMode ? 0.28 : 0.3)
    .toString();
}

export interface CharRange {
  start: number;
  end: number;
}

/**
 * The marked character range of this line (inclusive), or null. Changes
 * only when the mark comes to this line, moves on it, or leaves it.
 */
export function useLineWordMarkRange(
  pageNumber: number,
  lineIndex: number,
  textIdentity: string | null | undefined,
): CharRange | null {
  const packed = useMushafWordMarkStore(s => {
    const mark = s.mark;
    if (!mark || mark.pageNumber !== pageNumber) return '';
    if (mark.lineIndex !== lineIndex) return '';
    // The place was found in other text (a rewayah switch, a data reload).
    if (textIdentity !== undefined && mark.textIdentity !== textIdentity) {
      return '';
    }
    return `${mark.start}:${mark.end}`;
  });
  return useMemo(() => {
    if (!packed) return null;
    const [start, end] = packed.split(':').map(Number);
    return {start, end};
  }, [packed]);
}

export interface MarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A horizontal span in the paragraph's coordinates. */
export interface Span {
  left: number;
  right: number;
}

/** How far a mark grows at a line edge, in font sizes: the font's space. */
export const WORD_MARK_EDGE_EM = SPACEWIDTH / FONTSIZE;
/** The most that a mark grows into a space, in font sizes. */
export const WORD_MARK_MAX_GROWTH_EM = (2 * SPACEWIDTH) / FONTSIZE;

/**
 * The x span of a word's mark: the word's advance box, grown on each side
 * into the space to the neighbour word, up to the middle of that space
 * (and not more than WORD_MARK_MAX_GROWTH_EM), so two neighbour marks never
 * overlap. At a line edge (no neighbour on that side) the mark grows by
 * WORD_MARK_EDGE_EM. The spans are advance boxes; `left` is the neighbour
 * on the left, in either reading direction.
 */
export function markSpan(
  word: Span,
  leftNeighbour: Span | null,
  rightNeighbour: Span | null,
  fontSize: number,
): Span {
  const edge = WORD_MARK_EDGE_EM * fontSize;
  const most = WORD_MARK_MAX_GROWTH_EM * fontSize;
  const into = (space: number) => Math.min(most, Math.max(0, space / 2));
  return {
    left:
      word.left -
      (leftNeighbour ? into(word.left - leftNeighbour.right) : edge),
    right:
      word.right +
      (rightNeighbour ? into(rightNeighbour.left - word.right) : edge),
  };
}

function rectsSpan(
  rects: ReadonlyArray<{x: number; width: number}>,
): Span | null {
  let left = Infinity;
  let right = -Infinity;
  for (const r of rects) {
    if (r.width <= 0) continue;
    left = Math.min(left, r.x);
    right = Math.max(right, r.x + r.width);
  }
  return left < right ? {left, right} : null;
}

/**
 * The advance boxes of the words just before and just after `range` in the
 * line text (QuranTextService.analyzeText: the text between two spaces),
 * as the neighbour on the left and on the right of `mark`.
 */
function neighbourSpans(
  paragraph: SkParagraph,
  wordInfos: ReadonlyArray<{startIndex: number; endIndex: number}>,
  range: CharRange,
  mark: Span,
): {left: Span | null; right: Span | null} {
  let before: {startIndex: number; endIndex: number} | null = null;
  let after: {startIndex: number; endIndex: number} | null = null;
  for (const info of wordInfos) {
    if (info.endIndex < info.startIndex) continue;
    if (
      info.endIndex < range.start &&
      (!before || info.endIndex > before.endIndex)
    ) {
      before = info;
    }
    if (
      info.startIndex > range.end &&
      (!after || info.startIndex < after.startIndex)
    ) {
      after = info;
    }
  }
  const centre = (mark.left + mark.right) / 2;
  let left: Span | null = null;
  let right: Span | null = null;
  for (const info of [before, after]) {
    if (!info) continue;
    let span: Span | null;
    try {
      span = rectsSpan(
        paragraph.getRectsForRange(info.startIndex, info.endIndex + 1),
      );
    } catch {
      span = null;
    }
    if (!span) continue;
    if ((span.left + span.right) / 2 < centre) left = span;
    else right = span;
  }
  return {left, right};
}

/**
 * The mark of `range` in a line's paragraph: one rect, from the word's
 * advance box grown into the spaces beside it (markSpan), clamped to the
 * line's glyph band in its slot: the band of the line's first word, as
 * SkiaLine finds it for the ayah tint (a justified space's rect is taller
 * than the words). `slotTop` is the slot's top relative to the paragraph
 * (yPos - adjustedYPos). `fontSize` sets how far the mark grows.
 */
export function wordMarkRects(
  paragraph: SkParagraph,
  pageNumber: number,
  lineIndex: number,
  range: CharRange,
  slotTop: number,
  lineHeight: number | undefined,
  fontSize: number,
): MarkRect[] {
  const {wordInfos} = quranTextService.analyzeText(pageNumber, lineIndex);
  const firstWord = wordInfos[0];
  let band: LineBand | null = null;
  if (firstWord) {
    try {
      band = rectsBand(
        paragraph.getRectsForRange(
          firstWord.startIndex,
          firstWord.endIndex + 1,
        ),
      );
    } catch {
      band = null;
    }
  }
  let skRects: MarkRect[];
  try {
    skRects = paragraph
      .getRectsForRange(range.start, range.end + 1)
      .map(r => ({x: r.x, y: r.y, width: r.width, height: r.height}));
  } catch {
    return [];
  }
  const markBand = clampBandToSlot(
    band ?? shortestRectBand(skRects),
    slotTop,
    lineHeight,
  );
  let top = Infinity;
  let bottom = -Infinity;
  for (const rect of skRects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const clamped = clampRectToBand(rect, markBand);
    top = Math.min(top, clamped.y);
    bottom = Math.max(bottom, clamped.y + clamped.height);
  }
  const advance = rectsSpan(skRects);
  if (!advance || !(bottom > top)) return [];
  const {left, right} = neighbourSpans(paragraph, wordInfos, range, advance);
  const span = markSpan(advance, left, right, fontSize);
  return [
    {x: span.left, y: top, width: span.right - span.left, height: bottom - top},
  ];
}

export interface LineWordMarkInput {
  paragraph: SkParagraph | null | undefined;
  pageNumber: number;
  lineIndex: number;
  textIdentity: string | null | undefined;
  textColor: string;
  /** Where SkiaLine draws the paragraph. */
  xPos: number;
  yPos: number;
  adjustedYPos: number;
  lineHeight: number | undefined;
  /** The page's font size (sets how far the mark grows). */
  fontSize: number;
}

/**
 * The word mark of a line as a Skia element to draw under its text, or
 * null when the mark is not on this line.
 */
export function useLineWordMark(
  input: LineWordMarkInput,
): React.ReactElement | null {
  const {
    paragraph,
    pageNumber,
    lineIndex,
    textIdentity,
    textColor,
    xPos,
    yPos,
    adjustedYPos,
    lineHeight,
    fontSize,
  } = input;
  const range = useLineWordMarkRange(pageNumber, lineIndex, textIdentity);
  const {isDarkMode} = useTheme();
  const color = useMemo(
    () => wordMarkColor(textColor, isDarkMode),
    [textColor, isDarkMode],
  );
  const rects = useMemo(
    () =>
      paragraph && range
        ? wordMarkRects(
            paragraph,
            pageNumber,
            lineIndex,
            range,
            yPos - adjustedYPos,
            lineHeight,
            fontSize,
          )
        : null,
    [
      paragraph,
      range,
      pageNumber,
      lineIndex,
      yPos,
      adjustedYPos,
      lineHeight,
      fontSize,
    ],
  );
  return useMemo(() => {
    if (!rects || rects.length === 0) return null;
    return (
      <Group>
        {rects.map((rect, i) => (
          <RoundedRect
            key={i}
            x={xPos + rect.x}
            y={adjustedYPos + rect.y}
            width={rect.width}
            height={rect.height}
            r={4}
            color={color}
          />
        ))}
      </Group>
    );
  }, [rects, xPos, adjustedYPos, color]);
}
