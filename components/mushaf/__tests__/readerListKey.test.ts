// @ai
// The Mushaf reader remounts its page lists on `readerListKey` (#258, #275).
// A list that keeps its pixel offset while its items change width shows
// another page: on an iPad window resize, page 50 became page 136 (#275).
import {readFileSync} from 'fs';
import {join} from 'path';
import {getMushafLayout} from '../constants';
import {readerListKey, readingListKey} from '../readerListKey';

const SOURCE = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8');

const insets = {top: 24, bottom: 20, left: 0, right: 0};

describe('readerListKey', () => {
  it('changes when the item width changes in one orientation (#275)', () => {
    // iPad 13-inch, portrait, full screen and then a narrow window.
    const full = getMushafLayout({
      width: 1032,
      height: 1376,
      insets,
      isTablet: true,
    });
    const narrow = getMushafLayout({
      width: 375,
      height: 1300,
      insets,
      isTablet: true,
    });
    expect(full.facingPages).toBe(false);
    expect(narrow.facingPages).toBe(false);
    expect(readerListKey(full)).not.toBe(readerListKey(narrow));
  });

  it('changes on a rotation (#258)', () => {
    const portrait = getMushafLayout({width: 402, height: 874, insets});
    const landscape = getMushafLayout({
      width: 874,
      height: 402,
      insets: {top: 0, bottom: 21, left: 62, right: 62},
    });
    expect(readerListKey(portrait)).not.toBe(readerListKey(landscape));
  });

  it('changes when one page becomes a spread at the same width', () => {
    // A tablet window that goes from portrait-shaped to landscape-shaped and
    // keeps its width: the data changes from pages to spreads.
    const pages = getMushafLayout({
      width: 900,
      height: 1000,
      insets,
      isTablet: true,
    });
    const spreads = getMushafLayout({
      width: 900,
      height: 800,
      insets,
      isTablet: true,
    });
    expect(pages.facingPages).toBe(false);
    expect(spreads.facingPages).toBe(true);
    expect(readerListKey(pages)).not.toBe(readerListKey(spreads));
  });

  it('does not change when only the height changes (a keyboard)', () => {
    const open = getMushafLayout({width: 402, height: 874, insets});
    const keyboard = getMushafLayout({width: 402, height: 520, insets});
    expect(readerListKey(open)).toBe(readerListKey(keyboard));
  });

  it('changes on a width change of a fraction of a point', () => {
    // A paged list at page 600 moves by 600 x 0.3 pt = 180 pt for a 0.3 pt
    // change: a rounded key would keep that list mounted.
    expect(readerListKey({screenWidth: 1032.2, facingPages: false})).not.toBe(
      readerListKey({screenWidth: 1031.9, facingPages: false}),
    );
  });
});

describe('main.tsx keys every reader list on readerListKey', () => {
  it('derives the key from the metrics that the lists use', () => {
    expect(SOURCE).toMatch(/const listKey = readerListKey\(metrics\);/);
  });

  it('gives the three page list branches the key', () => {
    const open = SOURCE.indexOf('<MushafRotationStage');
    const close = SOURCE.indexOf('</MushafRotationStage>');
    const inside = SOURCE.slice(open, close);
    // ContinuousMushafView.
    expect(inside.match(/key=\{listKey\}/g)).toHaveLength(1);
    // The spread list and the page list (Sprint 52 Task 8): listKey and what
    // the list shows.
    expect(inside.match(/key=\{pagerKey\}/g)).toHaveLength(2);
    expect(SOURCE).toMatch(/const pagerKey = `\$\{listKey\}\|\$\{viewMode\}\|/);
    expect(inside).not.toMatch(/key=\{orientationKey\}/);
  });

  // Sprint 52 Task 8: the vertical list reflows to its text column.
  it('gives the vertical list view the key of its text column', () => {
    const start = SOURCE.indexOf('<ContinuousListView\n');
    expect(start).toBeGreaterThan(-1);
    expect(SOURCE.slice(start, start + 120)).toMatch(/key=\{verticalListKey\}/);
    expect(SOURCE).toMatch(
      /const verticalListKey = readingPageSize\s*\?\s*readingListKey\(readingPageSize\.width\)\s*:\s*listKey;/,
    );
  });
});

describe('readingListKey (Sprint 52 Task 8)', () => {
  it('stays the same while the 680 pt column keeps its width', () => {
    // An 11-inch iPad in landscape, then the same window beside the 360 pt
    // ayah panel; a 13-inch iPad in landscape and portrait.
    expect(readingListKey(1194)).toBe(readingListKey(834));
    expect(readingListKey(1376)).toBe(readingListKey(1032));
    expect(readingListKey(1376)).toBe(readingListKey(1016));
  });

  it('changes when the column itself gets narrower', () => {
    // A 13-inch iPad in portrait beside the panel: a 672 pt pane.
    expect(readingListKey(672)).not.toBe(readingListKey(1032));
    expect(readingListKey(600)).not.toBe(readingListKey(620));
  });
});
