// @ai
// DO NOT DROP — guards patches/@shopify+flash-list+2.0.2.patch (TECH_DEBT #376).
//
// The defect (Android, the reader in List + Vertical with Community
// Reflections on): the reader was on page 50, the app was stopped, and the
// session restore opened it on page 25. The list mounts with
// `initialScrollIndex` at the first verse of the page. Before the rows are
// measured, FlashList estimates every row, and it moves the target row in
// each progressive render: on the Pixel 3 the y of verse 3:1 went 59200,
// 69535, 180749, 162885, 120409. FlashList 2.0.2 read the target offset
// BEFORE it recomputed the rows above it, so its internal scroll offset kept
// the value of the previous render (162982 against a real 120506). Its
// maintainVisibleContentPosition then took a reference row from that wrong
// offset, and it "corrected" the scroll by -50408 when the row moved to its
// real place. The reflection rows are much taller than the estimate, so the
// error was large only with Community Reflections on.
//
// FlashList 2.3.0 fixes the read (Shopify/flash-list#2133). The patch is a
// backport. These tests drive FlashList's RecyclerViewManager without React,
// as the list does during its first layout.
import {readFileSync} from 'fs';
import {dirname, join} from 'path';

// The file that Metro bundles ("main": "dist/index.js").
const DIST = join(
  dirname(require.resolve('@shopify/flash-list/package.json')),
  'dist',
  'recyclerview',
  'RecyclerViewManager.js',
);

const {RecyclerViewManager} = require(DIST) as {
  RecyclerViewManager: new (props: Record<string, unknown>) => Manager;
};

type Layout = {x: number; y: number; width: number; height: number};
type Manager = {
  firstItemOffset: number;
  updateLayoutParams: (
    windowSize: {width: number; height: number},
    firstItemOffset: number,
  ) => void;
  modifyChildrenLayout: (
    layoutInfo: {index: number; dimensions: {width: number; height: number}}[],
    dataLength: number,
  ) => boolean;
  computeVisibleIndices: () => {toArray: () => number[]};
  getLayout: (index: number) => Layout;
  getAbsoluteLastScrollOffset: () => number;
  getIsFirstLayoutComplete: () => boolean;
};

const WIDTH = 392;
const WINDOW = {width: WIDTH, height: 700};
const COUNT = 600;
const TARGET = 300;
const HEADER_OFFSET = 97; // the list's top padding, as on the Pixel 3

function newList(): Manager {
  const data = Array.from({length: COUNT}, (_, i) => i);
  const manager = new RecyclerViewManager({
    data,
    keyExtractor: (item: number) => String(item),
    renderItem: () => null,
    initialScrollIndex: TARGET,
  });
  manager.updateLayoutParams(WINDOW, HEADER_OFFSET);
  return manager;
}

/** One progressive render: the rows on screen are measured at `height`. */
function measureVisible(manager: Manager, height: number, rows = 99): void {
  const visible = manager.computeVisibleIndices().toArray().slice(0, rows);
  manager.modifyChildrenLayout(
    visible.map(index => ({index, dimensions: {width: WIDTH, height}})),
    COUNT,
  );
}

describe('FlashList initial scroll offset (TECH_DEBT #376)', () => {
  it('keeps its scroll offset on the target row while the estimates change', () => {
    const list = newList();
    // First render: every row has FlashList's default estimate.
    list.modifyChildrenLayout([], COUNT);
    // One row is measured in each progressive render, so the first layout is
    // not complete yet. The rows are much taller than the estimate (a verse
    // row with a translation and a reflection card), then shorter, as on the
    // device.
    for (const height of [640, 560, 420]) {
      measureVisible(list, height, 1);
      expect(list.getIsFirstLayoutComplete()).toBe(false);
      const target = list.getLayout(TARGET).y;
      expect(list.getAbsoluteLastScrollOffset()).toBe(target + HEADER_OFFSET);
    }
  });

  it('puts the target row on screen in the first layout', () => {
    const list = newList();
    list.modifyChildrenLayout([], COUNT);
    for (let i = 0; i < 6 && !list.getIsFirstLayoutComplete(); i += 1) {
      measureVisible(list, 640);
    }
    expect(list.getIsFirstLayoutComplete()).toBe(true);
    expect(list.computeVisibleIndices().toArray()).toContain(TARGET);
  });

  it('is the patched FlashList build', () => {
    // A clear message when `npx patch-package` did not run.
    const source = readFileSync(DIST, 'utf8');
    if (source.includes('initialItemOffset : 0 + this.firstItemOffset')) {
      throw new Error(
        'FlashList reads the initial offset before the recompute. Run ' +
          '`npx patch-package`: patches/@shopify+flash-list+2.0.2.patch is not applied.',
      );
    }
  });
});
