// @ai
// TECH_DEBT #267 — the Settings sign-out sheet at rest draws nothing.
//
// Settings renders <SignOutConfirmModal> all the time. Before the fix, the
// wrapper mounted the gorhom sheet closed, and on Android the top of that
// closed sheet ("Sign out of Qariah?") showed under the tab bar. gorhom is a
// stub here (its native parts cannot run under jest); the stub renders the
// children and captures `onClose`, which gorhom calls when the close
// animation ends.

import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react-native';
import {SignOutConfirmModal} from '../SignOutConfirmModal';

const mockSheet: {onClose: (() => void) | undefined} = {onClose: undefined};

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactLib = require('react');
  const {View} = require('react-native');
  const MockBottomSheet = ReactLib.forwardRef(
    // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
    function MockBottomSheet(props, ref) {
      ReactLib.useImperativeHandle(ref, () => ({
        expand: () => undefined,
        close: () => undefined,
      }));
      mockSheet.onClose = props.onClose;
      return ReactLib.createElement(
        View,
        {testID: 'mock-sheet'},
        props.children,
      );
    },
  );
  return {
    __esModule: true,
    default: MockBottomSheet,
    BottomSheetBackdrop: () => null,
  };
});

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {background: '#ffffff', text: '#000000', textSecondary: '#666'},
    },
  }),
}));

jest.mock('@/hooks/useBottomInset', () => ({useBottomInset: () => 0}));

const TITLE = 'Sign out of Qariah?';

function modal(
  isVisible: boolean,
  onCancel = jest.fn(),
  onConfirm = jest.fn(),
) {
  return (
    <SignOutConfirmModal
      isVisible={isVisible}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

beforeEach(() => {
  mockSheet.onClose = undefined;
});

describe('SignOutConfirmModal (TECH_DEBT #267)', () => {
  it('draws nothing while closed', () => {
    render(modal(false));

    expect(screen.queryByTestId('mock-sheet')).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('opens, cancels, and draws nothing after the close animation', () => {
    const onCancel = jest.fn();
    const {rerender} = render(modal(false, onCancel));

    rerender(modal(true, onCancel));
    expect(screen.getByText(TITLE)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Cancel sign-out'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Settings answers onCancel with isVisible=false; the sheet animates out.
    rerender(modal(false, onCancel));
    expect(screen.getByText(TITLE)).toBeTruthy();

    // gorhom calls onClose when the close animation ends.
    act(() => mockSheet.onClose?.());
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('confirms sign-out from the open sheet', () => {
    const onConfirm = jest.fn();
    render(modal(true, jest.fn(), onConfirm));

    fireEvent.press(screen.getByLabelText('Sign out'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
