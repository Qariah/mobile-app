// @ai Sprint 52: the visible page of the update sheet, from the list's
// viewability index. On Android in RTL a horizontal list lays the pages out
// from the left edge, where the last page sits, so the index it reports
// counts from the last page.
export function visiblePageIndex(
  reported: number,
  pageCount: number,
  countsFromLastPage: boolean,
): number {
  if (!countsFromLastPage || pageCount <= 0) return reported;
  return Math.min(Math.max(pageCount - 1 - reported, 0), pageCount - 1);
}
