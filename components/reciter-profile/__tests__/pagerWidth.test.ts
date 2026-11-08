// @ai-generated
// Qariah (TECH_DEBT #354): on an iPad the sidebar takes part of the window, so
// a pager page as wide as the window ran past the right edge of the screen and
// hid the "More options" button of each surah row.
//
// Pass D (2026-11-07): upstream fixed the same defect (the measured pager
// width, `measuredPagerWidth` / `pageWidth`), and the merge took upstream's
// code. This test now guards upstream's lines. It reads the source of
// ReciterProfile.tsx, as stickyTitleInset.test.tsx does: a mount of the
// profile costs more mocks than the assertion is worth, and a wholesale
// upstream take of ReciterProfile.tsx is the known way to lose lines
// (TECH_DEBT #114, #115).
import {readFileSync} from 'fs';
import {join} from 'path';

// DO NOT DROP — guards the pager width in ReciterProfile.tsx (TECH_DEBT #354).
describe('ReciterProfile.tsx pager width (TECH_DEBT #354)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'ReciterProfile.tsx'),
    'utf8',
  );

  it('reads the window width only as the value before the first layout', () => {
    expect(source).toMatch(
      /const \{height: screenHeight, width: windowWidth\} = useWindowDimensions\(\);/,
    );
    expect(source).toMatch(
      /const pageWidth = measuredPagerWidth \?\? windowWidth;/,
    );
    // No other window-size read may size a page.
    expect(source.match(/useWindowDimensions\(\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/Dimensions\.get\(/);
  });

  it('measures the pager', () => {
    const start = source.indexOf('{/* Child 2: Horizontal pager');
    const end = source.indexOf('onContentSizeChange=', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).toMatch(/onLayout=\{handlePagerLayout\}/);
  });

  it('sizes each page from the measured width, after the first layout', () => {
    const start = source.indexOf('{measuredPagerWidth !== null &&');
    const page = source.slice(start, source.indexOf('}}>', start));
    expect(start).toBeGreaterThan(-1);
    expect(page).toMatch(/width: pageWidth,/);
  });

  it('scrolls back to the active page when the page width changes', () => {
    const start = source.indexOf('const lastPageWidthRef = useRef(pageWidth);');
    expect(start).toBeGreaterThan(-1);
    const effect = source.slice(start, source.indexOf('}, [', start));
    expect(effect).toMatch(/activeTabRef\.current/);
    expect(effect).toMatch(/horizontalRef\.current\?\.scrollTo\(/);
  });
});
