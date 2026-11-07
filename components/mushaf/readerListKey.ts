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
import type {MushafLayoutMetrics} from './constants';

export function readerListKey(
  metrics: Pick<MushafLayoutMetrics, 'screenWidth' | 'facingPages'>,
): string {
  const shape = metrics.facingPages ? 'spreads' : 'pages';
  return `${shape}-${metrics.screenWidth}`;
}
