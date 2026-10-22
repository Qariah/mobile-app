// @ai
// The rotation stage (modules/rotation-stage) moves the old frame and
// the new page so that the page text stays in one place while iOS rotates.
// These tests hold the geometry that feeds it: where the text block of a page
// sits in each layout, and the map from the old text block to the new one.
// The real service pulls in Sentry (a module-level interval); the geometry
// needs only the page lines: 8 on pages 1-2 (centred), 15 elsewhere.
jest.mock('@/services/mushaf/DigitalKhattDataService', () => ({
  digitalKhattDataService: {
    getPageLines: (page: number) =>
      Array.from({length: page <= 2 ? 8 : 15}, () => ({line_type: 'ayah'})),
  },
}));

import {getMushafLayout, getPageEdgeLayout} from '../constants';
import {
  pageTextRect,
  stageMapping,
  type StageGeometry,
} from '../rotationStageGeometry';

// iPhone 16 Pro, non-glass chrome (main.tsx passes 60/60 below iOS 26).
const PORTRAIT = getMushafLayout({
  width: 402,
  height: 874,
  insets: {top: 62, bottom: 34, left: 0, right: 0},
  toolbarHeight: 60,
  headerHeight: 60,
  isTablet: false,
});
const LANDSCAPE = getMushafLayout({
  width: 874,
  height: 402,
  insets: {top: 0, bottom: 21, left: 62, right: 62},
  toolbarHeight: 60,
  headerHeight: 60,
  isTablet: false,
});

function geometry(over: Partial<StageGeometry> = {}): StageGeometry {
  return {
    orientation: 'portrait',
    metrics: PORTRAIT,
    page: 50,
    paged: true,
    isBookLayout: true,
    scrollY: 0,
    ...over,
  };
}

describe('pageTextRect', () => {
  it('puts the portrait text block at the book margin, below the top padding', () => {
    // Page 50 is a left page: the outer edge is on the left.
    const rect = pageTextRect(geometry({page: 50}));
    expect(rect).toEqual({
      x: getPageEdgeLayout(50).contentMarginLeft,
      y: PORTRAIT.paddingTop,
      width: PORTRAIT.contentWidth,
    });
  });

  it('follows the page parity of the book layout', () => {
    const left = pageTextRect(geometry({page: 50}));
    const right = pageTextRect(geometry({page: 51}));
    expect(left?.x).not.toEqual(right?.x);
    expect(right?.x).toBe(getPageEdgeLayout(51).contentMarginLeft);
  });

  it('uses the horizontal padding outside the book layout', () => {
    const rect = pageTextRect(geometry({isBookLayout: false}));
    expect(rect?.x).toBe(PORTRAIT.paddingHorizontal);
  });

  it('offsets the landscape page by the cutout inset and its scroll position', () => {
    const rect = pageTextRect(
      geometry({orientation: 'landscape', metrics: LANDSCAPE, scrollY: 120}),
    );
    expect(LANDSCAPE.pageOffsetX).toBe(62);
    expect(rect).toEqual({
      x: 62 + getPageEdgeLayout(50).contentMarginLeft,
      y: LANDSCAPE.paddingTop - 120,
      width: LANDSCAPE.contentWidth,
    });
  });

  it('has no text block for list and continuous layouts', () => {
    expect(pageTextRect(geometry({paged: false}))).toBeNull();
  });

  it('puts the odd page on the right of an iPad spread', () => {
    // iPad landscape (DKSpreadView): [even page | gap | odd page], centred.
    const spread = getMushafLayout({
      width: 1210,
      height: 834,
      insets: {top: 24, bottom: 20, left: 0, right: 0},
      toolbarHeight: 0,
      headerHeight: 0,
      isTablet: true,
    });
    expect(spread.facingPages).toBe(true);
    const left = pageTextRect(geometry({metrics: spread, page: 50}));
    const right = pageTextRect(geometry({metrics: spread, page: 49}));
    expect(left?.x).toBeCloseTo(
      spread.pageOffsetX + getPageEdgeLayout(50).contentMarginLeft,
      5,
    );
    expect(right?.x).toBeCloseTo(
      spread.pageOffsetX +
        spread.pageWidth +
        spread.facingGap +
        getPageEdgeLayout(49).contentMarginLeft,
      5,
    );
  });
});

describe('stageMapping', () => {
  it('maps the portrait text block onto the landscape text block', () => {
    const from = geometry();
    const to = geometry({orientation: 'landscape', metrics: LANDSCAPE});
    const m = stageMapping(7, from, to);
    expect(m.token).toBe(7);
    expect(m.orientation).toBe('landscape');
    expect({x: m.fromX, y: m.fromY, width: m.fromWidth}).toEqual(
      pageTextRect(from),
    );
    expect({x: m.toX, y: m.toY, width: m.toWidth}).toEqual(pageTextRect(to));
  });

  it('is a near-uniform zoom: the line pitch scales with the width', () => {
    // The landscape page is the portrait page scaled to the width. If the
    // line pitch did not follow, the old frame would not land on the new
    // page and the stage would show a jump when it uncovers.
    const m = stageMapping(
      1,
      geometry(),
      geometry({orientation: 'landscape', metrics: LANDSCAPE}),
    );
    const scale = m.toWidth / m.fromWidth;
    const pitch = LANDSCAPE.baseLineHeight / PORTRAIT.baseLineHeight;
    expect(Math.abs(pitch / scale - 1)).toBeLessThan(0.03);
  });

  it('starts a turn back to portrait from the scrolled landscape position', () => {
    const from = geometry({
      orientation: 'landscape',
      metrics: LANDSCAPE,
      scrollY: 300,
    });
    const m = stageMapping(2, from, geometry());
    expect(m.fromY).toBe(LANDSCAPE.paddingTop - 300);
    expect(m.toY).toBe(PORTRAIT.paddingTop);
  });

  it('scales the full width from the top left when there is no text block', () => {
    const m = stageMapping(
      3,
      geometry({paged: false}),
      geometry({orientation: 'landscape', metrics: LANDSCAPE, paged: false}),
    );
    expect(m).toMatchObject({
      fromX: 0,
      fromY: 0,
      fromWidth: 402,
      toX: 0,
      toY: 0,
      toWidth: 874,
    });
  });

  it('does not map one page onto another', () => {
    const m = stageMapping(
      4,
      geometry({page: 50}),
      geometry({orientation: 'landscape', metrics: LANDSCAPE, page: 51}),
    );
    expect(m.fromWidth).toBe(402);
    expect(m.toWidth).toBe(874);
  });
});
