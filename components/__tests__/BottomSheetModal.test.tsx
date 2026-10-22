// @ai
// Unit tests for the shared bottom-sheet wrapper:
//   - the Settings touch-eater fix (S38.1), and
//   - the mount rule for the closed sheet (TECH_DEBT #267).
//
// S38.1: gorhom's BottomSheetBackdrop mounts with pointerEvents:'auto' and only
// flips to 'none' via a racing reanimated -> runOnJS -> setState chain. On slow
// CPUs (Helio G85 / Redmi Note 9) this makes an invisible closed-sheet backdrop
// eat every touch in the Settings tab. The fix gates renderBackdrop on the
// LOGICAL `isVisible` prop, returning null when the modal is closed (mirrors
// c70efb62 which applied the same pattern to PlayerSheet's sheetMode).
//
// #267: gorhom 5.2.14 does not move a sheet that mounts closed to its real
// closed position, so on Android the top of the closed sign-out sheet showed
// under the tab bar. The wrapper now puts the sheet in the tree only from its
// first open until its close animation ends (gorhom's `onClose`).
//
// Rather than fully rendering the heavy gorhom tree in jsdom (which requires
// reanimated + worklets + gesture handler native modules), we replace the
// mocked BottomSheet with a thin stub. The stub renders a marker view with the
// children, captures the backdropComponent callback and the onClose prop, and
// records the imperative expand()/close() calls.

import React from 'react';
import {Text} from 'react-native';
import {act, render, screen} from '@testing-library/react-native';
import BottomSheetModal from '../BottomSheetModal';

// mockCapture must be prefixed with 'mock' — babel-jest's jest.mock() factory
// hoisting check only allows out-of-scope names prefixed 'mock' (case-insensitive).
const mockCapture: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  backdropFn: ((props: any) => any) | undefined;
  onClose: (() => void) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastProps: any;
  renders: number;
  expand: jest.Mock;
  close: jest.Mock;
} = {
  backdropFn: undefined,
  onClose: undefined,
  lastProps: undefined,
  renders: 0,
  expand: jest.fn(),
  close: jest.fn(),
};

// NOTE: jest.mock() factory bodies must not contain TypeScript type annotations —
// babel-jest's hoisting transform parses annotation parameter names as variable
// accesses and rejects them (out-of-scope variable error). The `require`-only
// pattern is intentional per jest docs for mocks that need module state.
// The @ts-expect-error comments below suppress TS7006 (implicit any) on each
// unannotated function parameter; they must be placed immediately before the
// function declaration they suppress.
jest.mock('@gorhom/bottom-sheet', () => {
  const ReactLib = require('react');
  const {View} = require('react-native');

  // Thin stub: capture the props, render a marker view with the children.
  const MockBottomSheet = ReactLib.forwardRef(
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    function MockBottomSheet(props, ref) {
      ReactLib.useImperativeHandle(ref, () => ({
        expand: mockCapture.expand,
        close: mockCapture.close,
      }));
      mockCapture.renders += 1;
      mockCapture.lastProps = props;
      mockCapture.backdropFn = props.backdropComponent;
      mockCapture.onClose = props.onClose;
      return ReactLib.createElement(
        View,
        {testID: 'mock-sheet'},
        props.children,
      );
    },
  );

  // Sentinel backdrop so tests can assert a non-null typed element is returned
  // (gorhom's own mock NOOP returns undefined, preventing the assertion).
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  function MockBackdrop(props) {
    return ReactLib.createElement(
      ReactLib.Fragment,
      null,
      ReactLib.createElement('View', {testID: 'backdrop-sentinel', ...props}),
    );
  }

  return {
    __esModule: true,
    default: MockBottomSheet,
    BottomSheetBackdrop: MockBackdrop,
    BottomSheetHandleProps: {},
    BottomSheetBackdropProps: {},
  };
});

jest.mock('react-native-size-matters', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  moderateScale: v => v,
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  ScaledSheet: {create: s => s},
}));

jest.mock('color', () => {
  const chain = {alpha: () => chain, toString: () => 'rgba(0,0,0,0.2)'};
  return jest.fn(() => chain);
});

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {background: '#ffffff', text: '#000000'}},
  }),
}));

// Fake backdrop props — the gate checks `isVisible`, not the props object.
const fakeProps = {};

function sheet(isVisible: boolean, onClose: () => void = jest.fn()) {
  return (
    <BottomSheetModal isVisible={isVisible} onClose={onClose}>
      <Text>Sign out of Qariah?</Text>
    </BottomSheetModal>
  );
}

function captured<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`${name} not captured`);
  }
  return value;
}

/** True when a style array (with `false` entries) has pointerEvents 'none'. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bodyIgnoresTouches(style: any): boolean {
  const entries: unknown[] = Array.isArray(style) ? style : [style];
  return entries.some(
    entry =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as {pointerEvents?: string}).pointerEvents === 'none',
  );
}

beforeEach(() => {
  mockCapture.backdropFn = undefined;
  mockCapture.onClose = undefined;
  mockCapture.lastProps = undefined;
  mockCapture.renders = 0;
  mockCapture.expand.mockClear();
  mockCapture.close.mockClear();
});

describe('BottomSheetModal — renderBackdrop gate (S38.1 Settings touch-eater fix)', () => {
  it('renderBackdrop returns null while the sheet closes — a closing sheet must not keep a hit-testable backdrop', () => {
    const {rerender} = render(sheet(true));
    // The parent closes the sheet; the close animation runs.
    rerender(sheet(false));

    const backdropFn = captured(mockCapture.backdropFn, 'backdropFn');
    // Invoke exactly as gorhom calls backdropComponent during render.
    expect(backdropFn(fakeProps)).toBeNull();
  });

  it('renderBackdrop returns a React element when isVisible=true — open sheet must have a backdrop', () => {
    render(sheet(true));

    const result = captured(mockCapture.backdropFn, 'backdropFn')(fakeProps);
    expect(result).not.toBeNull();
    // React.createElement returns an object with a `type` field.
    expect(result).toHaveProperty('type');
  });

  it('renderBackdrop follows isVisible: closed → open → closing', () => {
    const {rerender} = render(sheet(false));
    // Closed: no sheet, so no backdrop at all.
    expect(mockCapture.backdropFn).toBeUndefined();

    rerender(sheet(true));
    expect(
      captured(mockCapture.backdropFn, 'backdropFn')(fakeProps),
    ).not.toBeNull();

    rerender(sheet(false));
    expect(
      captured(mockCapture.backdropFn, 'backdropFn')(fakeProps),
    ).toBeNull();
  });

  it('the sheet Body ignores touches while it closes (the second sibling)', () => {
    const {rerender} = render(sheet(true));
    expect(bodyIgnoresTouches(mockCapture.lastProps.style)).toBe(false);

    rerender(sheet(false));
    expect(bodyIgnoresTouches(mockCapture.lastProps.style)).toBe(true);
  });
});

describe('BottomSheetModal — the closed sheet is not in the tree (TECH_DEBT #267)', () => {
  it('draws nothing while closed (the Settings sign-out sheet at rest)', () => {
    render(sheet(false));

    expect(mockCapture.renders).toBe(0);
    expect(screen.queryByTestId('mock-sheet')).toBeNull();
    expect(screen.queryByText('Sign out of Qariah?')).toBeNull();
  });

  it('mounts open at index 0 when the parent opens it', () => {
    const {rerender} = render(sheet(false));
    rerender(sheet(true));

    expect(screen.getByTestId('mock-sheet')).toBeTruthy();
    expect(screen.getByText('Sign out of Qariah?')).toBeTruthy();
    expect(mockCapture.lastProps.index).toBe(0);
  });

  it('stays in the tree during the close animation, then unmounts and calls onClose', () => {
    const onClose = jest.fn();
    const {rerender} = render(sheet(true, onClose));

    // The parent closes the sheet (Cancel, or Sign out).
    rerender(sheet(false, onClose));
    expect(mockCapture.close).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mock-sheet')).toBeTruthy();
    expect(mockCapture.lastProps.index).toBe(-1);

    // gorhom calls onClose when the close animation ends.
    const sheetOnClose = captured(mockCapture.onClose, 'onClose');
    act(() => sheetOnClose());

    expect(screen.queryByTestId('mock-sheet')).toBeNull();
    expect(screen.queryByText('Sign out of Qariah?')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a pan-down close unmounts the sheet when the parent closes it', () => {
    const onClose = jest.fn();
    const {rerender} = render(sheet(true, onClose));

    // The user pans the sheet down; gorhom closes it and calls onClose.
    const sheetOnClose = captured(mockCapture.onClose, 'onClose');
    act(() => sheetOnClose());
    expect(onClose).toHaveBeenCalledTimes(1);

    // The parent answers onClose with isVisible=false.
    rerender(sheet(false, onClose));
    expect(screen.queryByTestId('mock-sheet')).toBeNull();
  });

  it('opens again after a full close', () => {
    const onClose = jest.fn();
    const {rerender} = render(sheet(true, onClose));
    rerender(sheet(false, onClose));
    act(() => captured(mockCapture.onClose, 'onClose')());
    expect(screen.queryByTestId('mock-sheet')).toBeNull();

    rerender(sheet(true, onClose));
    expect(screen.getByTestId('mock-sheet')).toBeTruthy();
    expect(mockCapture.lastProps.index).toBe(0);
  });
});
