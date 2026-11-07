// @ai
// Regression guard for GH #358 (and #364): both page renderers in `main.tsx`
// must get the same layout inputs. Bug #364 was born as drift between the two
// branches of one ternary: `SkiaPage` gained the layout props and `QCFPage`
// did not. Upstream `699dccb5` gives `QCFPage` the whole `metrics` object;
// Qariah's `centerShortPages` (#358) must reach both renderers with the same
// value. `DKPageView` is not exported, so this reads the source.
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

/** Every prop in `jsx` whose value reads a field of `metrics` (`{!metrics.x}` too). */
function metricsProps(jsx: string): string[] {
  return [...jsx.matchAll(/(\w+)=\{(!?)metrics\.(\w+)\}/g)]
    .map(m => `${m[1]}=${m[2]}metrics.${m[3]}`)
    .sort();
}

describe('main.tsx gives both page renderers the same layout inputs (GH #358, #364)', () => {
  it('passes the whole metrics object to QCFPage', () => {
    expect(element('QCFPage')).toMatch(/\bmetrics=\{metrics\}/);
  });

  it('passes the same centerShortPages value to QCFPage and SkiaPage', () => {
    const centre = 'centerShortPages=!metrics.scrollContainerHeight';
    expect(metricsProps(element('QCFPage'))).toContain(centre);
    expect(metricsProps(element('SkiaPage'))).toContain(centre);
  });
});
