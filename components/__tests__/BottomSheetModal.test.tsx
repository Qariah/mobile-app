// @ai
// Unit tests for the Settings touch-eater fix (S38.1).
//
// gorhom's BottomSheetBackdrop mounts with pointerEvents:'auto' and only flips
// to 'none' via a racing reanimated -> runOnJS -> setState chain. On slow CPUs
// (Helio G85 / Redmi Note 9) this makes an invisible closed-sheet backdrop eat
// every touch in the Settings tab. The fix gates renderBackdrop on the LOGICAL
// `isVisible` prop, returning null when the modal is closed (mirrors c70efb62
// which applied the same pattern to PlayerSheet's sheetMode).
//
// We test the gating logic by directly verifying the useCallback closure
// behaviour. Rather than fully rendering the heavy gorhom tree in jsdom (which
// requires reanimated + worklets + gesture handler native modules), we replace
// the mocked BottomSheet with a thin stub that captures the backdropComponent
// callback, then invoke it directly and assert its return value.

import React from 'react';
import {render} from '@testing-library/react-native';
import BottomSheetModal from '../BottomSheetModal';

// mockCapture must be prefixed with 'mock' — babel-jest's jest.mock() factory
// hoisting check only allows out-of-scope names prefixed 'mock' (case-insensitive).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCapture: {backdropFn: ((props: any) => any) | undefined} = {
  backdropFn: undefined,
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

  // Thin wrapper: capture backdropComponent prop, render nothing.
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  function MockBottomSheet(props) {
    mockCapture.backdropFn = props.backdropComponent;
    return null;
  }

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

beforeEach(() => {
  mockCapture.backdropFn = undefined;
});

describe('BottomSheetModal — renderBackdrop gate (S38.1 Settings touch-eater fix)', () => {
  it('renderBackdrop returns null when isVisible=false — closed sheet must not mount a hit-testable backdrop', () => {
    render(
      <BottomSheetModal isVisible={false} onClose={jest.fn()}>
        <></>
      </BottomSheetModal>,
    );

    expect(mockCapture.backdropFn).toBeDefined();
    if (!mockCapture.backdropFn) {
      throw new Error('backdropFn not captured');
    }
    // Invoke exactly as gorhom calls backdropComponent during render.
    const result = mockCapture.backdropFn(fakeProps);
    expect(result).toBeNull();
  });

  it('renderBackdrop returns a React element when isVisible=true — open sheet must have a backdrop', () => {
    render(
      <BottomSheetModal isVisible={true} onClose={jest.fn()}>
        <></>
      </BottomSheetModal>,
    );

    expect(mockCapture.backdropFn).toBeDefined();
    if (!mockCapture.backdropFn) {
      throw new Error('backdropFn not captured');
    }
    const result = mockCapture.backdropFn(fakeProps);
    expect(result).not.toBeNull();
    // React.createElement returns an object with a `type` field.
    expect(result).toHaveProperty('type');
  });

  it('renderBackdrop updates on isVisible false → true transition', () => {
    const {rerender} = render(
      <BottomSheetModal isVisible={false} onClose={jest.fn()}>
        <></>
      </BottomSheetModal>,
    );

    if (!mockCapture.backdropFn) {
      throw new Error('backdropFn not captured');
    }
    // Closed: must return null.
    expect(mockCapture.backdropFn(fakeProps)).toBeNull();

    rerender(
      <BottomSheetModal isVisible={true} onClose={jest.fn()}>
        <></>
      </BottomSheetModal>,
    );

    if (!mockCapture.backdropFn) {
      throw new Error('backdropFn not captured after rerender');
    }
    // Open: must return a renderable element.
    expect(mockCapture.backdropFn(fakeProps)).not.toBeNull();
  });
});
