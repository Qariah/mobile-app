// @ai-generated
// Qariah (TECH_DEBT #314): the exact item layout of the horizontal Listen rows
// in components/RecitersView.tsx (`MemoizedFlatList`).
//
// Upstream's `getItemLayout` used raw lengths (130, 140, ...) without
// `moderateScale` and without the gap between the cards. On an iPhone 16 Pro
// a country card and its gap take 148.25 points, not 130, so the list put
// its spacers and its render window in the wrong place: an error of about one
// card for every eight cards. The values here are the ones that
// `RenderSectionItem` and the `sectionContent` style in RecitersView.tsx use;
// change them together.
import {moderateScale} from 'react-native-size-matters';

export type RowVariant =
  | 'recent'
  | 'circular'
  | 'default'
  | 'featured'
  | 'rewayat'
  | 'playlist'
  | 'country'
  | 'translation';

/** `styles.sectionContent.paddingHorizontal` in RecitersView.tsx. */
export const ROW_PADDING = moderateScale(16);
/** `styles.sectionContent.gap` in RecitersView.tsx. */
export const ROW_GAP = moderateScale(8);

/** The width of one card, as `RenderSectionItem` renders it. */
export function rowCardWidth(variant: RowVariant): number {
  switch (variant) {
    case 'circular':
      // CircularReciterCard, size "medium" (64), plus its moderateScale(6).
      return 64 + moderateScale(6);
    case 'recent':
      // RECENT_CARD_WIDTH in components/cards/recentCardStyles.ts.
      return moderateScale(120);
    case 'featured':
      return moderateScale(140);
    case 'rewayat':
    case 'country':
    case 'translation':
      return moderateScale(130);
    case 'playlist':
      return moderateScale(110);
    case 'default':
      return moderateScale(120);
  }
}

/**
 * The `getItemLayout` result for item `index` of a row. `length` is the card
 * width. `offset` counts from the start of the content: the padding, then
 * `leading` (a header and its gap), then one card and one gap for each item
 * before this one. VirtualizedList then sizes its spacers to the real length
 * of the cards and the gaps between them.
 */
export function rowItemLayout(
  variant: RowVariant,
  index: number,
  leading = 0,
): {length: number; offset: number; index: number} {
  const length = rowCardWidth(variant);
  return {
    length,
    offset: ROW_PADDING + leading + index * (length + ROW_GAP),
    index,
  };
}
