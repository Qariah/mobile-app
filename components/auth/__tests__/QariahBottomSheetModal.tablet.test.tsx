// @ai Sprint 52 Task 7: on a tablet QariahBottomSheetModal is a centred card
// (upstream's TabletDialog in a transparent Modal), not a gorhom sheet. A tap
// outside and the Modal's close request call `onClose`; a closed dialog draws
// nothing. On a phone the gorhom sheet is used (see QariahBottomSheetModal.test).
import React from 'react';
import {Modal, StyleSheet, Text} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactLib = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: ReactLib.forwardRef(
      // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
      function MockSheet(props, _ref) {
        return ReactLib.createElement(
          View,
          {testID: 'mock-sheet'},
          props.children,
        );
      },
    ),
    BottomSheetBackdrop: () => null,
  };
});
// @ai Sprint 52: the card width constant lives in the action sheet module,
// which pulls in reanimated; Jest needs only the numbers.
jest.mock('@/components/sheets/AdaptiveActionSheet', () => ({
  SHEET_MAX_WIDTH: 560,
  SHEET_MAX_HEIGHT: 760,
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {background: '#ffffff', text: '#000000'}},
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));
let mockIsTablet = true;
jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: mockIsTablet}),
}));

import QariahBottomSheetModal from '../QariahBottomSheetModal';

function modal(isVisible: boolean, onClose: () => void = jest.fn()) {
  return (
    <QariahBottomSheetModal isVisible={isVisible} onClose={onClose}>
      <Text>Sign out of Qariah?</Text>
    </QariahBottomSheetModal>
  );
}

describe('QariahBottomSheetModal on a tablet', () => {
  beforeEach(() => {
    mockIsTablet = true;
  });

  it('shows a centred card of at most 560 pt in a transparent Modal, not a gorhom sheet', () => {
    const screen = render(modal(true));
    expect(screen.queryByTestId('mock-sheet')).toBeNull();
    expect(screen.UNSAFE_getByType(Modal).props.transparent).toBe(true);
    expect(screen.getByText('Sign out of Qariah?')).toBeTruthy();
    const card = screen
      .UNSAFE_getAllByType(require('react-native').View)
      .map(v => StyleSheet.flatten(v.props.style))
      .find(s => s && s.maxWidth === 560);
    expect(card).toBeTruthy();
  });

  it('a tap outside and the Modal close request call onClose', () => {
    const onClose = jest.fn();
    const screen = render(modal(true, onClose));
    fireEvent.press(
      screen.getByLabelText('actions.close', {includeHiddenElements: true}),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    screen.UNSAFE_getByType(Modal).props.onRequestClose();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('draws nothing while closed', () => {
    const screen = render(modal(false));
    expect(screen.queryByText('Sign out of Qariah?')).toBeNull();
  });

  it('on a phone it still uses the gorhom sheet', () => {
    mockIsTablet = false;
    const screen = render(modal(true));
    expect(screen.getByTestId('mock-sheet')).toBeTruthy();
    expect(screen.UNSAFE_queryByType(Modal)).toBeNull();
  });
});
