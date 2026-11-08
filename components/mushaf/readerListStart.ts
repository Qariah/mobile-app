// @ai-generated
/**
 * The page that a Mushaf pager list starts at, and the gate on its first
 * viewability reports (Sprint 52 Task 8, test case AP-19).
 *
 * A horizontal FlatList takes `initialScrollIndex` once, when its content is
 * first laid out (VirtualizedList `_maybeScrollToInitialScrollIndex`). On
 * Android in RTL, a new list's scroll view reports its start first: when its
 * content grows, the native view scrolls to keep its distance from the right
 * edge (ReactHorizontalScrollView `adjustPositionForContentChangeRTL`), and
 * that scroll event clears the list's wait for its first scroll. The
 * viewability report of that event (index 0, page 1) could reach the reader
 * before the initial scroll to the reader's page. The reader then took
 * page 1, the list's `initialScrollIndex` became 0, and the initial scroll
 * never ran. In Arabic, the first ayah-panel open after a fresh launch
 * remounts the pager on the narrower pane and showed page 1 (2 of 2 runs).
 *
 * So a list keeps the start page that it mounted with, for its whole life
 * (its key), and its reports move the reader only from the first report that
 * shows that start, or from a drag or a scroll that the reader asks for.
 */
import {useCallback, useRef} from 'react';

interface StartState {
  key: string;
  page: number;
  index: number;
  settled: boolean;
}

export interface ReaderListStart {
  /** The page the list starts at: fixed while the list keeps its key. */
  page: number;
  /** True when a viewability report whose first item is `index` may move the reader. */
  accepts: (index: number | null | undefined) => boolean;
  /** The user or the reader moves the list: every later report counts. */
  release: () => void;
}

/**
 * The start of the list that has `listKey`. A new key (a remount) starts at
 * the reader's `currentPage`; `pageIndex` gives the list index of a page (a
 * spread index, or page - 1). `accepts` and `release` keep their identity,
 * so the list's `onViewableItemsChanged` can use them.
 */
export function useReaderListStart(
  listKey: string,
  currentPage: number,
  pageIndex: (page: number) => number,
): ReaderListStart {
  const ref = useRef<StartState | null>(null);
  if (ref.current === null || ref.current.key !== listKey) {
    ref.current = {
      key: listKey,
      page: currentPage,
      index: pageIndex(currentPage),
      settled: false,
    };
  }
  const accepts = useCallback((reported: number | null | undefined) => {
    const state = ref.current;
    if (!state || state.settled) return true;
    if (reported !== state.index) return false;
    state.settled = true;
    return true;
  }, []);
  const release = useCallback(() => {
    if (ref.current) ref.current.settled = true;
  }, []);
  return {page: ref.current.page, accepts, release};
}
