// @ai-generated
// TECH_DEBT #411 (issue #899): a bookmark opened from Collection in a List
// view opened at the top of the verse's page (2:253 on page 42 for a 2:255
// bookmark, Pixel 3, vc4570), not at the verse. The List views now start at
// the row of the verse when it is on the start page.
import {listStartIndex} from '@/components/mushaf/reading/listStartIndex';

describe('listStartIndex (the start row of a List view)', () => {
  // Rows of page 42 in the vertical list: 2:253 is row 260, 2:254 row 261,
  // 2:255 row 262, 2:256 row 263; page 43 starts at row 264.
  const PAGE_42 = 260;
  const PAGE_43 = 264;

  it('starts at the bookmarked verse, not at the first verse of its page', () => {
    expect(listStartIndex(PAGE_42, 262, PAGE_43)).toBe(262);
  });

  it('starts at the page when no verse is named', () => {
    expect(listStartIndex(PAGE_42, undefined, PAGE_43)).toBe(PAGE_42);
  });

  it('starts at the page when the verse is on another page', () => {
    // A remount after the reader turned to page 42 keeps the old verse key.
    expect(listStartIndex(PAGE_42, 12, PAGE_43)).toBe(PAGE_42);
    expect(listStartIndex(PAGE_42, PAGE_43, PAGE_43)).toBe(PAGE_42);
  });

  it('accepts the verse on the last page (no next page)', () => {
    expect(listStartIndex(6230, 6234, undefined)).toBe(6234);
  });

  it('keeps an unknown page unknown', () => {
    expect(listStartIndex(undefined, 262, PAGE_43)).toBeUndefined();
  });

  it('starts at the first verse of page 1 (1:7) at its own row', () => {
    // Al-Fatihah fills page 1: 1:1 is row 1 after the surah header row 0.
    expect(listStartIndex(0, 7, 8)).toBe(7);
  });
});
