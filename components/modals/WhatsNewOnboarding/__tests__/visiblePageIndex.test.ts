// @ai Sprint 52: the Android RTL index of the update sheet.
import {visiblePageIndex} from '../visiblePageIndex';

describe('visiblePageIndex', () => {
  it('keeps the index in LTR and on iOS', () => {
    expect([0, 1, 2].map(i => visiblePageIndex(i, 3, false))).toEqual([
      0, 1, 2,
    ]);
  });

  it('counts from the first page on Android in RTL', () => {
    // Page one sits at the right edge, so the list reports the last index.
    expect([2, 1, 0].map(i => visiblePageIndex(i, 3, true))).toEqual([0, 1, 2]);
  });

  it('stays in range', () => {
    expect(visiblePageIndex(5, 3, true)).toBe(0);
    expect(visiblePageIndex(0, 0, true)).toBe(0);
  });
});
