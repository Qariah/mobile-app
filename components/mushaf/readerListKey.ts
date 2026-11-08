// @ai — the key that remounts the Mushaf reader's page lists (#258, #275).
//
// A paged, `inverted` FlatList keeps its pixel scroll offset when its items
// change size. The page on screen then becomes another page (the old offset
// divided by the new item width). `initialScrollIndex` acts only at mount.
// So the reader remounts its list each time that the item geometry changes,
// and the new list starts again at the reader's page.
//
// The key names the geometry that the pixel offset depends on:
//   - the item width (`metrics.screenWidth`, which `getItemLayout` uses),
//     exactly: a change of a fraction of a point under a mounted list moves
//     the page by index x the change (page 600 x 0.4 pt = 240 pt);
//   - the item shape: one page, or a spread of two facing pages.
// A rotation changes the width, so it remounts the list as before (#258).
// A window resize that keeps the orientation (iPad Split View, Stage Manager
// and Windowed Apps; Android tablets, foldables and free-form windows) also
// changes the width (#275). The key does not name the height, so a keyboard,
// which changes only the height, never remounts the reader.
//
// The key reads the metrics that the list uses, not the window: on a tablet
// the first render after a resize still has the old measured container
// (main.tsx measures it one render later). A window key would remount the
// list in that render, with the old item width, and the next render would
// then change the item width under the mounted list.
import {moderateScale} from '@/utils/scale';
import {readingColumnPadding, type MushafLayoutMetrics} from './constants';

export function readerListKey(
  metrics: Pick<MushafLayoutMetrics, 'screenWidth' | 'facingPages'>,
): string {
  const shape = metrics.facingPages ? 'spreads' : 'pages';
  return `${shape}-${metrics.screenWidth}`;
}

// @ai-start Sprint 52 Task 8
/**
 * Side padding of the vertical list view (List + Vertical) in a pane of
 * `paneWidth` on a tablet: the text sits in a centred column of at most
 * READING_COLUMN_MAX_WIDTH, at least 8 (scaled) from each side.
 * ContinuousListView lays out with it, and `readingListKey` keys on the same
 * column, so the two cannot drift.
 */
export function readingListSidePadding(paneWidth: number): number {
  return readingColumnPadding(paneWidth, moderateScale(8));
}

/**
 * The key of the vertical list view on a tablet. Its rows reflow to its text
 * column, so its pixel offset keeps its verse while the column keeps its
 * width. The pane around a 680 pt column can change (the ayah panel opens
 * beside it, an iPad turns) and the list stays on its verse. It remounts at
 * its page only when the column itself changes width.
 */
export function readingListKey(paneWidth: number): string {
  return `list-${paneWidth - 2 * readingListSidePadding(paneWidth)}`;
}
// @ai-end
