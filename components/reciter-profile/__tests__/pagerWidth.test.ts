// @ai-generated
// Qariah (TECH_DEBT #354): on an iPad the sidebar takes part of the window, so
// a pager page as wide as the window ran past the right edge of the screen and
// hid the "More options" button of each surah row.
//
// This test reads the source of ReciterProfile.tsx, as stickyTitleInset.test.tsx
// does: a mount of the profile costs more mocks than the assertion is worth,
// and a wholesale upstream take of ReciterProfile.tsx is the known way to lose
// Qariah lines (TECH_DEBT #114, #115).
import {readFileSync} from 'fs';
import {join} from 'path';

// DO NOT DROP — guards the TECH_DEBT #354 lines in ReciterProfile.tsx.
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
      /const screenWidth =\s+pagerWidth > 0 && Math\.abs\(pagerWidth - windowWidth\) >= 1\s+\? pagerWidth\s+: windowWidth;/,
    );
    // No other window-size read may size a page.
    expect(source.match(/useWindowDimensions\(\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/Dimensions\.get\(/);
  });

  it('measures the pager container', () => {
    const start = source.indexOf('{/* Child 2: Horizontal pager');
    const end = source.indexOf('<RNAnimated.ScrollView', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).toMatch(
      /onLayout=\{e => setPagerWidth\(e\.nativeEvent\.layout\.width\)\}/,
    );
  });

  it('sizes each page from the measured width', () => {
    const start = source.indexOf('{tabs.map(tab => (');
    const page = source.slice(start, source.indexOf('}}>', start));
    expect(start).toBeGreaterThan(-1);
    expect(page).toMatch(/width: screenWidth,/);
  });

  it('scrolls back to the active page when the page width changes', () => {
    const start = source.indexOf(
      'const lastPageWidthRef = useRef(screenWidth);',
    );
    expect(start).toBeGreaterThan(-1);
    const effect = source.slice(start, source.indexOf('}, [', start));
    expect(effect).toMatch(/activeTabRef\.current/);
    expect(effect).toMatch(/horizontalRef\.current\?\.scrollTo\(/);
  });
});
