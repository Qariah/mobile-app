// @ai — when a rotation turn of the Mushaf reader is ready to show.
//
// The rotation stage (modules/rotation-stage) covers the reader during a
// turn. JS tells it that the new layout is ready when the page the reader was
// on (the target) has painted in the new layout. Any other page that paints
// first (the remounted list mounts neighbours too) does not count. The native
// side then also checks that the target page's view is on screen, waits two
// display frames, and (when JS asks: `waitForMorph`) the end of the UIKit
// morph.
// A touch ends the turn: the user then drives the list.

export type TurnProgress = {
  token: number;
  orientation: 'portrait' | 'landscape';
  /**
   * The page to show after the turn: the page the reader was on. Every new
   * layout shows it (an iPad spread keeps it, on the left or the right).
   */
  target: number;
  /** True once the target page has painted in the new layout. */
  painted: boolean;
};

export function startTurn(
  token: number,
  orientation: 'portrait' | 'landscape',
  target: number,
): TurnProgress {
  return {token, orientation, target, painted: false};
}

/**
 * The orientation of the layout that `metrics` describe: the visible area,
 * which is the scroller in phone landscape (the page in it is taller).
 */
export function layoutOrientation(metrics: {
  screenWidth: number;
  screenHeight: number;
  scrollContainerHeight?: number;
}): 'portrait' | 'landscape' {
  const visibleHeight = metrics.scrollContainerHeight ?? metrics.screenHeight;
  return metrics.screenWidth > visibleHeight ? 'landscape' : 'portrait';
}

/**
 * Notes that `page` has painted in a layout of orientation `paintedIn` (the
 * orientation of the metrics it was drawn with). Only the target page counts,
 * and only in a layout of the new orientation: on iPad the first render of a
 * turn still has the old layout's metrics (main.tsx measures the container
 * one render later), and the list mounts and paints the page in that layout
 * too, just before it mounts it again in the new one.
 */
export function notePainted(
  turn: TurnProgress,
  page: number,
  paintedIn: 'portrait' | 'landscape',
): TurnProgress {
  return page === turn.target && paintedIn === turn.orientation && !turn.painted
    ? {...turn, painted: true}
    : turn;
}

export function isTurnReady(turn: TurnProgress): boolean {
  return turn.painted;
}

/** The right (odd) page of the spread of two facing pages that holds `page`. */
export function spreadRightPage(page: number): number {
  return Math.floor((page - 1) / 2) * 2 + 1;
}

/** The layouts on the two sides of a turn, as the cover rules need them. */
export type TurnLayouts = {
  orientation: 'portrait' | 'landscape';
  /** The horizontal Mushaf pager (else a list or continuous layout). */
  paged: boolean;
  /** The new layout puts the page in a scroller (phone landscape). */
  inScroller: boolean;
  /** The old layout showed two facing pages (iPad landscape). */
  fromFacingPages: boolean;
};

/**
 * True when the stage keeps its cover until the UIKit morph ends: the new
 * layout shows less than the snapshot of the old one, so the live content
 * cannot stand in for the snapshot during the morph.
 *   - A phone-landscape page sits in a scroller and shows only its top.
 *   - A reflow layout (list, continuous) in landscape.
 *   - One portrait page after an iPad spread: during the morph the live
 *     layout shows the page beside empty space where the other page was.
 */
export function waitsForMorph(turn: TurnLayouts): boolean {
  if (turn.orientation === 'landscape') {
    return !turn.paged || turn.inScroller;
  }
  return turn.paged && turn.fromFacingPages;
}

/**
 * The page that a spread (two facing pages, right page `spreadRight`) stands
 * for: the reader's page `current` when the spread shows it, else the right
 * page. With this, an iPad turn to landscape and back keeps an even page too
 * (#258); before, the spread made it the odd page beside it.
 */
export function pageForSpread(current: number, spreadRight: number): number {
  return spreadRightPage(current) === spreadRight ? current : spreadRight;
}
