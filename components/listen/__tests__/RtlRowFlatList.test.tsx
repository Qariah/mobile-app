// @ai-generated
// Qariah (TECH_DEBT #314): the horizontal Listen rows start at their first
// card in a right-to-left layout on iOS. See the top of RtlRowFlatList.tsx.
import React from 'react';
import {FlatList, Platform, Text} from 'react-native';
import {act, render, renderHook} from '@testing-library/react-native';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import {
  RtlRowFlatList,
  rtlRowStartEnabled,
  useRtlRowStart,
} from '../RtlRowFlatList';

let mockIsRTL = true;
jest.mock('@/utils/rtl', () => ({
  get isRTL() {
    return mockIsRTL;
  },
}));

const originalOS = Platform.OS;
function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true});
}

function layoutEvent(width: number): LayoutChangeEvent {
  return {
    nativeEvent: {layout: {x: 0, y: 0, width, height: 118}},
  } as LayoutChangeEvent;
}

const dragEvent = {
  nativeEvent: {},
} as NativeSyntheticEvent<NativeScrollEvent>;

/** The hook with a fake list whose native scroll view records scrollTo. */
function setup(handlers = {}) {
  const scrollTo = jest.fn();
  const hook = renderHook(() => useRtlRowStart(handlers));
  (hook.result.current.ref as {current: unknown}).current = {
    getNativeScrollRef: () => ({scrollTo}),
  };
  return {scrollTo, hook};
}

beforeEach(() => {
  mockIsRTL = true;
  setOS('ios');
});

afterAll(() => {
  setOS(originalOS);
});

describe('rtlRowStartEnabled', () => {
  it('is true on iOS in a right-to-left layout only', () => {
    expect(rtlRowStartEnabled()).toBe(true);
    mockIsRTL = false;
    expect(rtlRowStartEnabled()).toBe(false);
    mockIsRTL = true;
    setOS('android');
    expect(rtlRowStartEnabled()).toBe(false);
  });
});

describe('useRtlRowStart', () => {
  it('scrolls to the first card after the first content-size change', () => {
    const {scrollTo, hook} = setup();
    act(() => hook.result.current.onLayout(layoutEvent(402)));
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => hook.result.current.onContentSizeChange(618.5, 118));
    // x counts from the left edge; the first card is at the right end.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({x: 216.5, animated: false});
  });

  it('waits for the width when the content size comes first', () => {
    const {scrollTo, hook} = setup();
    act(() => hook.result.current.onContentSizeChange(3672, 118));
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => hook.result.current.onLayout(layoutEvent(402)));
    expect(scrollTo).toHaveBeenCalledWith({x: 3270, animated: false});
  });

  it('scrolls again when the content size changes before a drag', () => {
    const {scrollTo, hook} = setup();
    act(() => hook.result.current.onLayout(layoutEvent(402)));
    act(() => hook.result.current.onContentSizeChange(3635.5, 118));
    act(() => hook.result.current.onContentSizeChange(3672, 118));
    expect(scrollTo).toHaveBeenLastCalledWith({x: 3270, animated: false});
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('stops after the person drags the row', () => {
    const {scrollTo, hook} = setup();
    act(() => hook.result.current.onLayout(layoutEvent(402)));
    act(() => hook.result.current.onContentSizeChange(1000, 118));
    act(() => hook.result.current.onScrollBeginDrag(dragEvent));
    act(() => hook.result.current.onContentSizeChange(1200, 118));
    act(() => hook.result.current.onLayout(layoutEvent(500)));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('does not scroll a row that fits on the screen', () => {
    const {scrollTo, hook} = setup();
    act(() => hook.result.current.onLayout(layoutEvent(402)));
    act(() => hook.result.current.onContentSizeChange(402, 118));
    act(() => hook.result.current.onContentSizeChange(300, 118));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll in a left-to-right layout', () => {
    mockIsRTL = false;
    const {scrollTo, hook} = setup();
    act(() => hook.result.current.onLayout(layoutEvent(402)));
    act(() => hook.result.current.onContentSizeChange(1000, 118));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll on Android', () => {
    setOS('android');
    const {scrollTo, hook} = setup();
    act(() => hook.result.current.onLayout(layoutEvent(402)));
    act(() => hook.result.current.onContentSizeChange(1000, 118));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('calls the handlers that the list passes in', () => {
    const onLayout = jest.fn();
    const onContentSizeChange = jest.fn();
    const onScrollBeginDrag = jest.fn();
    const {hook} = setup({onLayout, onContentSizeChange, onScrollBeginDrag});
    const layout = layoutEvent(402);
    act(() => hook.result.current.onLayout(layout));
    act(() => hook.result.current.onContentSizeChange(1000, 118));
    act(() => hook.result.current.onScrollBeginDrag(dragEvent));
    expect(onLayout).toHaveBeenCalledWith(layout);
    expect(onContentSizeChange).toHaveBeenCalledWith(1000, 118);
    expect(onScrollBeginDrag).toHaveBeenCalledWith(dragEvent);
  });
});

describe('RtlRowFlatList', () => {
  it('renders a FlatList with the row-start handlers', () => {
    const onLayout = jest.fn();
    const screen = render(
      <RtlRowFlatList
        horizontal
        data={['a', 'b']}
        renderItem={({item}) => <Text>{item}</Text>}
        keyExtractor={item => item}
        onLayout={onLayout}
      />,
    );
    expect(screen.getByText('a')).toBeTruthy();
    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.onContentSizeChange).toEqual(expect.any(Function));
    expect(list.props.onScrollBeginDrag).toEqual(expect.any(Function));
    act(() => list.props.onLayout(layoutEvent(402)));
    expect(onLayout).toHaveBeenCalledTimes(1);
  });
});
