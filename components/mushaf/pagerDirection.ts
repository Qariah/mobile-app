// @ai-generated
// Qariah (Sprint 50, TECH_DEBT #315): the direction of the Mushaf reader's
// horizontal pager.
//
// A horizontal FlatList scrolls and finds its items in the NATIVE layout
// direction (`I18nManager.isRTL`), whatever its `direction` style says (see
// utils/rtl.ts). The app language (`isRTL` in utils/rtl.ts) and the native
// direction differ for one launch after the device language changes between
// two launches: the native direction that React Native read at start is the
// one that the previous session saved. On that launch the pager, set from the
// app language, ran against the native direction. On the test iPhone (Release,
// Arabic launch, then English launch with the reader restored at page 50) the
// page area was blank, and a left-to-right swipe went to page 49, not 51.
//
// So the pager follows the native direction. When the two agree (every other
// launch), the result is the same as before.
import {I18nManager, type ViewStyle} from 'react-native';

export interface PagerDirectionProps {
  inverted: boolean;
  style: ViewStyle;
}

/** The `inverted` prop and the direction style of a page pager. */
export function pagerDirectionProps(
  nativeIsRTL: boolean = I18nManager.isRTL,
): PagerDirectionProps {
  return {
    inverted: !nativeIsRTL,
    style: {direction: nativeIsRTL ? 'rtl' : 'ltr'},
  };
}
