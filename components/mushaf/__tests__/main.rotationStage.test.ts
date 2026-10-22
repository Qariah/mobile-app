// @ai
// DO NOT DROP — guards the wiring of the rotation stage in main.tsx.
//
// Without the stage, an iOS rotation of the reader shows a blank page, then a
// cropped page or two pages side by side for about 0.3 s (the 2026-10-16
// rotation-artifact report). The stage needs three lines in main.tsx, and a
// wholesale upstream take of that file is the known way to lose such lines
// (see ReciterProfile.tsx). Like `main.metrics-parity.test.ts`, this reads
// the source: mounting `MushafViewer` would cost more mocking than the
// assertion is worth.
import {readFileSync} from 'fs';
import {join} from 'path';

const SOURCE = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8');

function element(tag: string): string {
  const start = SOURCE.indexOf(`<${tag}`);
  expect(start).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('/>', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe('main.tsx wires the rotation stage', () => {
  it('wraps every list branch in MushafRotationStage', () => {
    const open = SOURCE.indexOf('<MushafRotationStage');
    const close = SOURCE.indexOf('</MushafRotationStage>');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const inside = SOURCE.slice(open, close);
    for (const branch of [
      '<ContinuousMushafView',
      '<ContinuousListView',
      '<FlatList',
    ]) {
      expect(inside).toContain(branch);
    }
  });

  it('reports the paint of BOTH page renderers to the stage', () => {
    // The stage uncovers the new layout when the current page reports. A
    // renderer that does not report keeps the cover up to its timeout.
    expect(element('SkiaPage')).toMatch(/onReady=\{handleReady\}/);
    expect(element('QCFPage')).toMatch(/onReady=\{handleReady\}/);
    expect(SOURCE).toMatch(/rotationStage\.notePagePainted\(pageNumber\)/);
  });

  it('gives each page view the testID that the stage looks for', () => {
    // The stage lifts its cover only when this view is on screen.
    expect(SOURCE).toMatch(/testID=\{mushafPageTestID\(pageNumber\)\}/);
  });

  it("keeps the reader's page when a spread shows it", () => {
    // Without this, an iPad turn to landscape and back moved an even page to
    // the odd page beside it (#258 keeps the page across a turn).
    expect(SOURCE).toMatch(/pageForSpread\(\s*currentPageRef\.current,/);
    expect(SOURCE).toMatch(/currentPageRef\.current = currentPage;/);
  });

  it('reports each later draw of a page to the stage (TECH_DEBT #272)', () => {
    // Without it the stage could show a portrait snapshot of a page that has
    // drawn again (a highlight, the player's verse, the theme...).
    expect(SOURCE).toMatch(
      /const handleDraw = usePageDrawReport\(\s*pageNumber,\s*pageReady,\s*pageFrameKey\(metrics, insets\),\s*\);/,
    );
    expect(element('SkiaPage')).toMatch(/onDraw=\{handleDraw\}/);
    expect(element('QCFPage')).toMatch(/onDraw=\{handleDraw\}/);
  });

  it('gives the stage the status bar state of <StatusBar hidden> (TECH_DEBT #272)', () => {
    // Immersive mode hides the status bar and moves the page labels; on a
    // Home-button iPhone in landscape the page does not commit at all.
    const bar = SOURCE.match(/<StatusBar hidden=\{([^}]+)\}/);
    expect(bar).not.toBeNull();
    const open = SOURCE.indexOf('<MushafRotationStage');
    const end = SOURCE.indexOf('>', SOURCE.indexOf('backdropColor', open));
    expect(SOURCE.slice(open, end)).toContain(`statusBarHidden={${bar![1]}}`);
  });

  it('memoizes the page view, so a render of the list alone is no draw (TECH_DEBT #272)', () => {
    // Without React.memo every render of the list commits each page view
    // again, and the stage drops its portrait snapshot at every turn.
    expect(SOURCE).toMatch(/const DKPageView = React\.memo\(DKPageViewBase\);/);
  });

  it('keeps the page reveal gate (opacity 0 until the text paints)', () => {
    expect(SOURCE).toMatch(
      /const \[pageReady, setPageReady\] = useState\(false\)/,
    );
  });
});
