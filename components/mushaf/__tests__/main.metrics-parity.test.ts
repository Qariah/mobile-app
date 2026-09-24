// @ai
// Regression guard for GH #364 — the ONE thing the QCFPage render tests cannot see.
//
// `components/mushaf/qcf/__tests__/QCFPage.layout.test.tsx` passes metrics props
// straight to `QCFPage`, so it proves the component honours props it is given.
// It cannot prove that `main.tsx` actually PASSES them — and that wiring is
// precisely what #364 reports as broken. Reverting the call site leaves that
// suite entirely green.
//
// The real invariant is PARITY. The bug was born as drift between two sibling
// branches of the same ternary: `SkiaPage` gained the layout props upstream and
// `QCFPage` did not, so the QCF renderer silently fell back to the import-time
// portrait constants. `DKPageView` is not exported, and mounting `MushafViewer`
// to reach it would cost more mocking than the assertion is worth, so this
// reads the source instead.
//
// Deliberately tolerant: it looks for `name={metrics.` per prop rather than
// matching formatted JSX, so a prettier reflow on the next upstream merge
// cannot fire it spuriously.

import {readFileSync} from 'fs';
import {join} from 'path';

const SOURCE = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8');

/** Slice out a single JSX element by tag name, from `<Tag` to its closing `/>`. */
function element(tag: string): string {
  const start = SOURCE.indexOf(`<${tag}`);
  expect(start).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('/>', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

/**
 * Every prop in `jsx` whose value is read off the layout metrics object —
 * including negated reads (`{!metrics.x}`). The 2026-09-07 review found the
 * original regex blind to `centerShortPages={!metrics.scrollContainerHeight}`,
 * which let the two branches diverge under a green parity test.
 */
function metricsProps(jsx: string): string[] {
  return [...jsx.matchAll(/(\w+)=\{(!?)metrics\.(\w+)\}/g)]
    .map(m => `${m[1]}=${m[2]}metrics.${m[3]}`)
    .sort();
}

describe('main.tsx passes layout metrics to BOTH page renderers (GH #364)', () => {
  it('gives QCFPage the same metrics props as SkiaPage', () => {
    const qcf = metricsProps(element('QCFPage'));
    const skia = metricsProps(element('SkiaPage'));

    // The parity itself — the invariant whose violation IS the bug.
    expect(qcf).toEqual(skia);
  });

  it('actually passes the layout metrics, rather than both passing none', () => {
    // Guards the degenerate way the parity test above could pass: if a future
    // edit stripped the props from both branches, they would still be "equal".
    const qcf = metricsProps(element('QCFPage'));

    expect(qcf).toEqual(
      [
        'screenWidth=metrics.pageWidth',
        'screenHeight=metrics.screenHeight',
        'contentWidth=metrics.contentWidth',
        'contentHeight=metrics.contentHeight',
        'baseLineHeight=metrics.baseLineHeight',
        'paddingHorizontal=metrics.paddingHorizontal',
        'paddingTop=metrics.paddingTop',
        'centerShortPages=!metrics.scrollContainerHeight',
      ].sort(),
    );
  });
});
