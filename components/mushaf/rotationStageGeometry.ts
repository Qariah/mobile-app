// @ai — geometry for the rotation stage (modules/rotation-stage).
//
// A Mushaf page in landscape is the portrait page scaled to the width: the
// font size follows the content width, and the 15 lines keep their order.
// So one uniform scale plus a translation maps the text block of the old page
// onto the text block of the new page. The stage uses this map to move the
// snapshot of the old frame in step with the UIKit rotation, so that it lands
// where the new page draws its text.
import {digitalKhattDataService} from '@/services/mushaf/DigitalKhattDataService';
import {
  calculateLineYPositions,
  getPageEdgeLayout,
  usesSymmetricPageEdges,
  type MushafLayoutMetrics,
} from './constants';

export type StageRect = {x: number; y: number; width: number};

export type StageGeometry = {
  orientation: 'portrait' | 'landscape';
  metrics: MushafLayoutMetrics;
  page: number;
  /** True when the stage shows the horizontal Mushaf pager. */
  paged: boolean;
  isBookLayout: boolean;
  /** Vertical offset of the phone-landscape page scroller. */
  scrollY: number;
};

/**
 * Where the FIRST LINE of the text block of `page` sits in the stage, or
 * `null` when the layout has no page text block to follow (list and
 * continuous modes). It reads the same functions and inputs as the
 * renderers in main.tsx:
 *   - DKSpreadView puts the page at `pageOffsetX` (centred iPad page, or the
 *     cutout inset in phone landscape; 0 in phone portrait). With facing
 *     pages (iPad landscape) it centres [even page | gap | odd page], so the
 *     odd page sits one page and one gap to the right;
 *   - DKPageView gives the canvas `contentMarginLeft` in the book layout
 *     (`usesSymmetricPageEdges`), and `paddingHorizontal` otherwise;
 *   - SkiaPage and QCFPage put the canvas `paddingTop` below the page top and
 *     the lines at `calculateLineYPositions` (pages 1-2 are centred when the
 *     page is not in a scroller: `centerShortPages`).
 */
export function pageTextRect(geometry: StageGeometry): StageRect | null {
  const {metrics: m, page, paged, isBookLayout, scrollY} = geometry;
  if (!paged || m.contentWidth <= 0) return null;
  const pageX =
    m.pageOffsetX +
    (m.facingPages && page % 2 === 1 ? m.pageWidth + m.facingGap : 0);
  const marginLeft =
    isBookLayout && !usesSymmetricPageEdges(m, isBookLayout)
      ? getPageEdgeLayout(page).contentMarginLeft
      : m.paddingHorizontal;
  const lines = digitalKhattDataService.getPageLines(page);
  const firstLineY =
    lines.length > 0
      ? calculateLineYPositions(
          lines,
          page,
          m.contentHeight,
          m.baseLineHeight,
          // As main.tsx passes `centerShortPages` to both renderers.
          !m.scrollContainerHeight,
        )[0]
      : 0;
  return {
    x: pageX + marginLeft,
    y: m.paddingTop + firstLineY - (m.scrollContainerHeight ? scrollY : 0),
    width: m.contentWidth,
  };
}

/**
 * The stage mapping from the geometry before a turn to the geometry after it.
 * When either side has no text block, the map scales the full width from the
 * top left corner, which keeps the content full-width during the turn.
 */
export function stageMapping(
  token: number,
  from: StageGeometry,
  to: StageGeometry,
): {
  token: number;
  orientation: 'portrait' | 'landscape';
  fromX: number;
  fromY: number;
  fromWidth: number;
  toX: number;
  toY: number;
  toWidth: number;
} {
  const fromRect = pageTextRect(from);
  const toRect = pageTextRect(to);
  const precise = fromRect && toRect && from.page === to.page;
  const a: StageRect = precise
    ? fromRect
    : {x: 0, y: 0, width: from.metrics.screenWidth};
  const b: StageRect = precise
    ? toRect
    : {x: 0, y: 0, width: to.metrics.screenWidth};
  return {
    token,
    orientation: to.orientation,
    fromX: a.x,
    fromY: a.y,
    fromWidth: a.width,
    toX: b.x,
    toY: b.y,
    toWidth: b.width,
  };
}
