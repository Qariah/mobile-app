// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the notification card lists the five
// types and passes each answer: "Allow" / "Not now" on iOS, "Choose
// notifications" (opens the Notifications page) / "OK" on Android.
import React from 'react';
import {Modal, Platform} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
const mockAnswer = jest.fn(async (_answer: string) => null);
const mockStart = jest.fn();
const mockConfirm = jest.fn();
jest.mock('@/services/notifications/softPrompt', () => {
  const {create} = jest.requireActual('zustand');
  return {
    useSoftPromptStore: create(() => ({visible: true})),
    answerSoftPrompt: (answer: string) => mockAnswer(answer),
    startSoftPrompt: () => mockStart(),
    confirmSoftPromptShown: () => mockConfirm(),
  };
});

const mockPush = jest.fn();
const mockClosePlayerSheet = jest.fn();
let mockSheetMode = 'full';
jest.mock('@/services/player/sheetRef', () => ({
  closePlayerSheet: () => mockClosePlayerSheet(),
}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {getState: () => ({sheetMode: mockSheetMode})},
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({push: mockPush}),
}));

import {NotificationSoftPrompt} from '../NotificationSoftPrompt';

const TYPE_TITLES = [
  'New from reciters you follow',
  'New recitations',
  'Friday Al-Kahf reminder',
  'Continue listening',
  'New features',
];

const originalOS = Platform.OS;
function setOS(os: typeof Platform.OS): void {
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true});
}

afterEach(() => {
  setOS(originalOS);
  jest.clearAllMocks();
});

describe('NotificationSoftPrompt', () => {
  it('on iOS: lists the five types, with "Allow" and "Not now", and passes the answer', () => {
    setOS('ios');
    const screen = render(<NotificationSoftPrompt />);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Notifications from Qariah')).toBeTruthy();
    for (const title of TYPE_TITLES) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(
      screen.getByText('You choose which ones you get in Settings.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId('notification-soft-prompt-allow'));
    expect(mockAnswer).toHaveBeenCalledWith('allow');
    fireEvent.press(screen.getByTestId('notification-soft-prompt-not-now'));
    expect(mockAnswer).toHaveBeenCalledWith('not_now');
    expect(screen.getByText('Allow')).toBeTruthy();
    expect(screen.getByText('Not now')).toBeTruthy();
  });

  it("the Modal's onShow confirms the card (the prompted event goes out there)", () => {
    setOS('ios');
    const screen = render(<NotificationSoftPrompt />);
    const modal = screen.UNSAFE_getByType(Modal);
    modal.props.onShow();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it('on Android: lists the five types, with "Choose notifications" and "OK"; asks for nothing', () => {
    setOS('android');
    const screen = render(<NotificationSoftPrompt />);
    for (const title of TYPE_TITLES) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.queryByTestId('notification-soft-prompt-allow')).toBeNull();
    expect(screen.getByText('Choose notifications')).toBeTruthy();
    expect(screen.getByText('OK')).toBeTruthy();
    fireEvent.press(screen.getByTestId('notification-soft-prompt-ok'));
    expect(mockAnswer).toHaveBeenCalledWith('ok');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClosePlayerSheet).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('notification-soft-prompt-choose'));
    expect(mockAnswer).toHaveBeenCalledWith('choose');
    // The full player was open: it closes, so the page is not under it.
    expect(mockClosePlayerSheet).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/(d.settings)/notifications');
  });

  it('on Android: "Choose notifications" leaves a mini player as it is', () => {
    setOS('android');
    mockSheetMode = 'mini';
    const screen = render(<NotificationSoftPrompt />);
    fireEvent.press(screen.getByTestId('notification-soft-prompt-choose'));
    expect(mockClosePlayerSheet).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/(d.settings)/notifications');
    mockSheetMode = 'full';
  });

  it('on another platform: renders nothing', () => {
    setOS('web');
    const screen = render(<NotificationSoftPrompt />);
    expect(screen.queryByTestId('notification-soft-prompt')).toBeNull();
  });
});
