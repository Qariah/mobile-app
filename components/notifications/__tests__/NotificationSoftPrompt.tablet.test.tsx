// @ai Sprint 52 Task 7: on a tablet the soft prompt is a centred card of at
// most 560 pt; on a phone it keeps the bottom card.
import React from 'react';
import {Platform, StyleSheet, View} from 'react-native';
import {render} from '@testing-library/react-native';

// @ai Sprint 52: the card width constant lives in the action sheet module,
// which pulls in reanimated; Jest needs only the numbers.
jest.mock('@/components/sheets/AdaptiveActionSheet', () => ({
  SHEET_MAX_WIDTH: 560,
  SHEET_MAX_HEIGHT: 760,
}));
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));
jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('@/services/notifications/softPrompt', () => {
  const {create} = jest.requireActual('zustand');
  return {
    useSoftPromptStore: create(() => ({visible: true})),
    answerSoftPrompt: jest.fn(),
    startSoftPrompt: jest.fn(),
    confirmSoftPromptShown: jest.fn(),
  };
});
jest.mock('@/services/player/sheetRef', () => ({closePlayerSheet: jest.fn()}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {getState: () => ({sheetMode: 'mini'})},
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({push: jest.fn()}),
}));
let mockIsTablet = false;
jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: mockIsTablet}),
}));

import {NotificationSoftPrompt} from '../NotificationSoftPrompt';

const originalOS = Platform.OS;
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', {value: 'ios', configurable: true});
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', {
    value: originalOS,
    configurable: true,
  });
});

function cardAndBackdrop() {
  const screen = render(<NotificationSoftPrompt />);
  const card = StyleSheet.flatten(
    screen.getByTestId('notification-soft-prompt-card').props.style,
  );
  // The backdrop is the only View that centres or bottom-aligns its child.
  const backdrop = screen
    .UNSAFE_getAllByType(View)
    .map(v => StyleSheet.flatten(v.props.style))
    .find(s => s && s.flex === 1 && s.justifyContent !== undefined);
  return {card, backdrop: backdrop ?? {}};
}

describe('NotificationSoftPrompt on a tablet', () => {
  it('is a centred card of at most 560 pt', () => {
    mockIsTablet = true;
    const {card, backdrop} = cardAndBackdrop();
    expect(card.maxWidth).toBe(560);
    expect(card.width).toBe('100%');
    expect(backdrop.justifyContent).toBe('center');
    expect(backdrop.alignItems).toBe('center');
  });

  it('on a phone keeps the bottom card with no width cap', () => {
    mockIsTablet = false;
    const {card, backdrop} = cardAndBackdrop();
    expect(card.maxWidth).toBeUndefined();
    expect(backdrop.justifyContent).toBe('flex-end');
  });
});
