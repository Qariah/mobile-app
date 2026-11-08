// @ai-generated
// Sprint 52 Task 8: the iPad Mushaf shows two facing pages only when each
// page is at least 420 pt wide (docs/design/ipad-standards.md §9.1). Before,
// any landscape pane got a spread: the 360 pt ayah panel left an 820 pt pane
// on an iPad (A16) in landscape, and that gave two pages of 404 pt.
import {getMushafLayout, MIN_SPREAD_PAGE_WIDTH} from '../constants';

const insets = {top: 24, bottom: 20, left: 0, right: 0};
const tablet = {isTablet: true, insets, headerHeight: 0, toolbarHeight: 0};

/** The reader pane beside the 360 pt ayah panel, in a landscape window. */
function besidePanel(
  windowWidth: number,
  windowHeight: number,
  paneWidth = windowWidth - 360,
) {
  return getMushafLayout({
    ...tablet,
    width: windowWidth,
    height: windowHeight,
    containerWidth: paneWidth,
    containerHeight: windowHeight,
    landscapeWindow: true,
  });
}

describe('getMushafLayout — the 420 pt spread floor', () => {
  it('shows one page in an 820 x 820 pane (iPad A16 landscape with the panel)', () => {
    const m = besidePanel(1180, 820);
    expect(m.screenWidth).toBe(820);
    expect(m.facingPages).toBe(false);
    // The page keeps the width of each page of the window's own spread.
    expect(m.pageWidth).toBe(584);
    expect(m.pageOffsetX).toBe((820 - 584) / 2);
  });

  it('shows one page in an 820 x 820 window', () => {
    const m = getMushafLayout({...tablet, width: 820, height: 820});
    expect(m.facingPages).toBe(false);
    expect(m.pageWidth).toBe(404);
    expect(m.pageOffsetX).toBe(208);
  });

  it('shows one page in an 850 x 834 pane (iPad Pro 11-inch M4/M5 with the panel)', () => {
    // Two pages would be (850 - 12) / 2 = 419 pt: 1 pt under the floor.
    const m = besidePanel(1210, 834);
    expect(m.screenWidth).toBe(850);
    expect(m.facingPages).toBe(false);
    expect(m.pageWidth).toBe(599);

    const window = getMushafLayout({...tablet, width: 850, height: 834});
    expect(window.facingPages).toBe(false);
    expect(window.pageWidth).toBe(419);
  });

  it('keeps a spread of 497 pt pages in a 1006 x 1024 pane (iPad Air 13-inch with the panel)', () => {
    const m = besidePanel(1366, 1024);
    expect(m.screenWidth).toBe(1006);
    expect(m.facingPages).toBe(true);
    expect(m.pageWidth).toBe(497);
    expect(m.facingGap).toBe(12);
    expect(m.pageOffsetX).toBe(0);
  });

  it('keeps a spread of about 502 pt pages beside the panel on a 13-inch iPad Pro', () => {
    const m = besidePanel(1376, 1032);
    expect(m.facingPages).toBe(true);
    expect(m.pageWidth).toBe(502);
  });

  it('decides from the pane shape when the caller does not name the window', () => {
    // A 1006 x 1024 pane is portrait by itself: one page, as before.
    const m = getMushafLayout({...tablet, width: 1006, height: 1024});
    expect(m.facingPages).toBe(false);
    expect(m.pageWidth).toBe(720);
  });

  it('shows the portrait page beside the panel in a portrait window', () => {
    const m = getMushafLayout({
      ...tablet,
      width: 1032,
      height: 1376,
      containerWidth: 672,
      containerHeight: 1376,
      landscapeWindow: false,
    });
    expect(m.facingPages).toBe(false);
    expect(m.pageWidth).toBe(672);
  });

  it('keeps the spread of every full landscape iPad window', () => {
    for (const [w, h, page] of [
      [1376, 1032, 640], // iPad Pro 13-inch
      [1366, 1024, 640], // iPad Air 13-inch
      [1210, 834, 599], // iPad Pro 11-inch (M4, M5)
      [1194, 834, 591], // iPad Pro 11-inch (4th generation)
      [1180, 820, 584], // iPad (A16), iPad Air 11-inch
      [1133, 744, 560], // iPad mini
    ]) {
      const m = getMushafLayout({...tablet, width: w, height: h});
      expect(m.facingPages).toBe(true);
      expect(m.pageWidth).toBe(page);
    }
  });

  it('keeps the text size when the panel turns a spread into one page', () => {
    // fontSize ~ contentWidth x 0.053 (SkiaPage): the same contentWidth is
    // the same text size.
    const spread = getMushafLayout({...tablet, width: 1194, height: 834});
    const single = besidePanel(1194, 834);
    expect(spread.facingPages).toBe(true);
    expect(single.facingPages).toBe(false);
    expect(single.pageWidth).toBe(spread.pageWidth);
    expect(single.contentWidth).toBe(spread.contentWidth);
    expect(single.baseLineHeight).toBe(spread.baseLineHeight);
  });

  it('never shows two pages narrower than 420 pt', () => {
    expect(MIN_SPREAD_PAGE_WIDTH).toBe(420);
    for (let w = 600; w <= 1400; w += 2) {
      for (const landscapeWindow of [undefined, true]) {
        const m = getMushafLayout({
          ...tablet,
          width: 1400,
          height: 700,
          containerWidth: w,
          containerHeight: 700,
          landscapeWindow,
        });
        if (m.facingPages) {
          expect(m.pageWidth).toBeGreaterThanOrEqual(MIN_SPREAD_PAGE_WIDTH);
        } else {
          expect(m.pageWidth).toBeLessThanOrEqual(w);
          expect(m.pageOffsetX).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('does not change phones, also a phone wider than 900 pt in landscape', () => {
    const m = getMushafLayout({
      width: 956,
      height: 440,
      isTablet: false,
      landscapeWindow: true,
    });
    expect(m.facingPages).toBe(false);
    // The phone-landscape branch alone sets the scroller height.
    expect(m.scrollContainerHeight).toBe(440);
    expect(m.pageWidth).toBe(956);
  });
});
