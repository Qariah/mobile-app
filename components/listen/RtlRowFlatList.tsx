// @ai-generated
// Qariah (TECH_DEBT #314): a horizontal FlatList that starts at its first
// item in a right-to-left layout on iOS.
//
// The defect: on the first launch after install, in Arabic on iOS, the
// horizontal Listen rows showed their LAST items, and a long row ("Browse by
// Country") showed no card at all. In a right-to-left layout the first item
// sits at the right end of the content, and these scroll views opened at the
// left end. A long row renders only its first batch of cards (at the right
// end); the left end is an empty spacer, so the row looked empty. The next
// launch was correct.
//
// Evidence (Release build, iPhone 16 Pro simulator, iOS 18.2): JS and native
// both run right to left on the first launch (`I18nManager.isRTL` is true),
// and the scroll offset of the unfixed rows was at the left end of the
// content. On that launch the Listen screen mounts twice (once before the
// onboarding redirect, once after it); the next launch mounts it once. The
// likely trigger is that the second mount gets iOS scroll views that React
// Native recycled from the first mount. Android is not affected.
//
// The fix: until the person drags the row, scroll it to its start after each
// change of its content size or its width. `ScrollView.scrollTo` counts `x`
// from the left edge of the content in both directions, so in a right-to-left
// layout `x = contentWidth - viewportWidth` shows the first item. This does
// not depend on `I18nManager.isRTL`, which can differ from the app's layout
// direction for one launch (see utils/rtl.ts). The scroll repeats for each
// content-size change, because the content can still change after the first
// scroll, and the command runs against the content size at that time.
import React, {useCallback, useRef} from 'react';
import {
  FlatList,
  Platform,
  type FlatListProps,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import {isRTL} from '@/utils/rtl';

type RowStartHandlers = Pick<
  FlatListProps<unknown>,
  'onLayout' | 'onContentSizeChange' | 'onScrollBeginDrag'
>;

/** True when a horizontal row needs the start scroll: iOS, right to left. */
export function rtlRowStartEnabled(): boolean {
  return Platform.OS === 'ios' && isRTL;
}

/**
 * The props that start a horizontal FlatList at its first item in a
 * right-to-left layout on iOS. Spread the result on the FlatList; the
 * handlers also call the ones passed in.
 */
export function useRtlRowStart<ItemT>(handlers: RowStartHandlers = {}) {
  const {onLayout, onContentSizeChange, onScrollBeginDrag} = handlers;
  const ref = useRef<FlatList<ItemT>>(null);
  const metrics = useRef({contentWidth: 0, viewportWidth: 0, dragged: false});

  const scrollToStart = useCallback(() => {
    const {contentWidth, viewportWidth, dragged} = metrics.current;
    if (dragged || !rtlRowStartEnabled()) return;
    // A row that fits on the screen has nothing to scroll.
    if (viewportWidth <= 0 || contentWidth <= viewportWidth) return;
    const scrollView = ref.current?.getNativeScrollRef() as
      | Partial<Pick<ScrollView, 'scrollTo'>>
      | null
      | undefined;
    scrollView?.scrollTo?.({x: contentWidth - viewportWidth, animated: false});
  }, []);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      metrics.current.viewportWidth = event.nativeEvent.layout.width;
      scrollToStart();
      onLayout?.(event);
    },
    [onLayout, scrollToStart],
  );

  const handleContentSizeChange = useCallback(
    (width: number, height: number) => {
      metrics.current.contentWidth = width;
      scrollToStart();
      onContentSizeChange?.(width, height);
    },
    [onContentSizeChange, scrollToStart],
  );

  const handleScrollBeginDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      metrics.current.dragged = true;
      onScrollBeginDrag?.(event);
    },
    [onScrollBeginDrag],
  );

  return {
    ref,
    onLayout: handleLayout,
    onContentSizeChange: handleContentSizeChange,
    onScrollBeginDrag: handleScrollBeginDrag,
  };
}

/**
 * A FlatList for a horizontal row that starts at its first item in a
 * right-to-left layout on iOS (see the top of this file). It takes the props
 * of FlatList; it does not forward a ref.
 */
export function RtlRowFlatList<ItemT>(props: FlatListProps<ItemT>) {
  const rowStart = useRtlRowStart<ItemT>(props);
  return <FlatList {...props} {...rowStart} />;
}
