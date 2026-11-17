// @ai-generated
// Qariah (TECH_DEBT #411, issue #899): the row that a List view of the Mushaf
// reader starts at. A saved verse (a bookmark opened from Collection) opens
// the reader at the page of the verse; the list then starts at the verse, not
// at the first verse of the page.

/**
 * The index the list starts at.
 *
 * - `pageStart`: the index of the first row of the start page.
 * - `verseIndex`: the index of the row of the verse to open at, if any.
 * - `nextPageStart`: the index of the first row of the next page, if any.
 *
 * The verse counts only when its row is on the start page. Otherwise (no
 * verse, an unknown verse, or a verse on another page, for example after the
 * list remounts on a page the reader turned to) the list starts at the page.
 */
export function listStartIndex(
  pageStart: number | undefined,
  verseIndex: number | undefined,
  nextPageStart: number | undefined,
): number | undefined {
  if (pageStart === undefined || verseIndex === undefined) return pageStart;
  if (verseIndex < pageStart) return pageStart;
  if (nextPageStart !== undefined && verseIndex >= nextPageStart) {
    return pageStart;
  }
  return verseIndex;
}
