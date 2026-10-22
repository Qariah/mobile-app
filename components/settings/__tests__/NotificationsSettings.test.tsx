// @ai-generated
// Qariah (Sprint 48, S48.7, Task 17): the Settings → Notifications page.
// - The five switches show the values of the prefs store, in the page order.
// - A toggle writes the store.
// - The banner shows when the system permission is off. Its button asks while
//   the system can still ask (`canAskAgain`), else it opens the system
//   settings. The permission is read again when the app comes back.
// - The switches stay disabled until the stored choices are read; after a
//   failed read they stay disabled and one line says so.
// - A holdout user is sent back to the Settings index.
//
// The screen lives under app/, where a test file would become a route, so
// the test sits here (as components/auth/__tests__/SignInError.test.tsx).
import React from 'react';
import i18n from 'i18next';
import {AppState, Linking} from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import NotificationsSettingsScreen from '@/app/(tabs)/(d.settings)/notifications';
import {
  DEFAULT_NOTIFICATION_TYPE_PREFS,
  useNotificationPrefsStore,
} from '@/services/notifications/prefsStore';
import type * as PrefsStoreModule from '@/services/notifications/prefsStore';
import {NOTIFICATION_TYPES} from '@/services/notifications/types';
import {isNotificationsHoldout} from '@/services/notifications/holdout';
import enQariah from '@/i18n/locales/en/qariah.json';
import arQariah from '@/i18n/locales/ar/qariah.json';

// `mock`-prefixed: jest hoists `jest.mock()`.
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockWhenHydrated = jest.fn();
const mockRedirect = jest.fn((_props: {href: string}) => null);
const mockSync = jest.fn(async (_reason: string) => ({}));

jest.mock('@/services/notifications/notificationsSync', () => ({
  syncNotifications: (reason: string) => mockSync(reason),
}));
const mockPrompted = jest.fn();
const mockResult = jest.fn();
jest.mock('@/services/notifications/notificationAnalytics', () => ({
  trackPermissionPrompted: (...args: unknown[]) => mockPrompted(...args),
  trackPermissionResult: (...args: unknown[]) => mockResult(...args),
}));

jest.mock('@/services/notifications/prefsStore', () => ({
  ...jest.requireActual<typeof PrefsStoreModule>(
    '@/services/notifications/prefsStore',
  ),
  whenNotificationPrefsHydrated: (...args: unknown[]) =>
    mockWhenHydrated(...args),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) =>
    mockRequestPermissions(...args),
}));

jest.mock('expo-router', () => ({
  // Run the focus callback once on mount, as a first focus does.
  useFocusEffect: (callback: () => void) => {
    const {useEffect} = require('react');
    useEffect(callback, [callback]);
  },
  Redirect: (props: {href: string}) => mockRedirect(props),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#ffffff',
        text: '#000000',
        textSecondary: '#666666',
        primary: '#2f5059',
      },
    },
  }),
}));

jest.mock('@/hooks/useBottomInset', () => ({useBottomInset: () => 0}));

jest.mock('expo-glass-effect', () => {
  const {View} = require('react-native');
  return {GlassView: View, isLiquidGlassAvailable: () => false};
});

jest.mock('@/hooks/useGlassProps', () => ({
  USE_GLASS: false,
  useGlassColorScheme: () => 'light',
}));

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('@/services/notifications/holdout', () => ({
  isNotificationsHoldout: jest.fn(() => false),
}));

const mockIsHoldout = isNotificationsHoldout as jest.MockedFunction<
  typeof isNotificationsHoldout
>;

const GRANTED = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
  expires: 'never',
};
const NEVER_ASKED = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
  expires: 'never',
};
const DENIED = {
  status: 'denied',
  granted: false,
  canAskAgain: false,
  expires: 'never',
};

const TITLES = [
  enQariah.settings.notifications.followedRecitation,
  enQariah.settings.notifications.newRecitation,
  enQariah.settings.notifications.kahfFriday,
  enQariah.settings.notifications.continueListening,
  enQariah.settings.notifications.whatsNew,
];

/** The disabled state of a host Switch. */
function isDisabled(testID: string): boolean {
  const element = screen.getByTestId(testID);
  return Boolean(
    element.props.disabled ?? element.props.accessibilityState?.disabled,
  );
}

/** Renders the page and waits for the first permission read. */
async function renderPage() {
  render(<NotificationsSettingsScreen />);
  await waitFor(() => expect(mockGetPermissions).toHaveBeenCalled());
  // Let the read resolve and the state settle.
  await act(() => Promise.resolve());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsHoldout.mockReturnValue(false);
  mockGetPermissions.mockResolvedValue(GRANTED);
  mockRequestPermissions.mockResolvedValue(GRANTED);
  mockWhenHydrated.mockResolvedValue(true);
  useNotificationPrefsStore.setState({...DEFAULT_NOTIFICATION_TYPE_PREFS});
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('Notifications settings page', () => {
  it('renders the five switches in the page order with the store values', async () => {
    useNotificationPrefsStore.setState({
      new_recitation: false,
      continue_listening: false,
    });
    await renderPage();

    const titles = screen
      .getAllByRole('switch')
      .map(s => s.props.accessibilityLabel);
    expect(titles).toEqual(TITLES);

    expect(
      screen.getByTestId('notification-switch-followed_recitation').props.value,
    ).toBe(true);
    expect(
      screen.getByTestId('notification-switch-new_recitation').props.value,
    ).toBe(false);
    expect(
      screen.getByTestId('notification-switch-kahf_friday').props.value,
    ).toBe(true);
    expect(
      screen.getByTestId('notification-switch-continue_listening').props.value,
    ).toBe(false);
    expect(
      screen.getByTestId('notification-switch-whats_new').props.value,
    ).toBe(true);
    // The app name is filled in the description.
    expect(screen.getByText('When Qariah adds a new recitation')).toBeTruthy();
  });

  it('writes the store when a switch is toggled', async () => {
    await renderPage();

    fireEvent(
      screen.getByTestId('notification-switch-kahf_friday'),
      'valueChange',
      false,
    );
    expect(useNotificationPrefsStore.getState().kahf_friday).toBe(false);
    expect(
      screen.getByTestId('notification-switch-kahf_friday').props.value,
    ).toBe(false);

    fireEvent(
      screen.getByTestId('notification-switch-kahf_friday'),
      'valueChange',
      true,
    );
    expect(useNotificationPrefsStore.getState().kahf_friday).toBe(true);

    // The other types keep their values.
    for (const type of NOTIFICATION_TYPES) {
      expect(useNotificationPrefsStore.getState()[type]).toBe(true);
    }
  });

  it('shows no banner when the permission is granted', async () => {
    await renderPage();
    expect(screen.queryByTestId('notifications-permission-banner')).toBeNull();
  });

  it('asks for the permission when the system can still ask', async () => {
    mockGetPermissions.mockResolvedValue(NEVER_ASKED);
    await renderPage();

    expect(
      screen.getByText(
        'Notifications are off for Qariah in your phone settings.',
      ),
    ).toBeTruthy();
    const button = screen.getByTestId('notifications-permission-button');
    expect(screen.getByText('Allow notifications')).toBeTruthy();

    await act(async () => {
      fireEvent.press(button);
    });

    expect(mockRequestPermissions).toHaveBeenCalledWith({
      ios: {allowAlert: true, allowSound: true, allowBadge: false},
    });
    expect(Linking.openSettings).not.toHaveBeenCalled();
    // The request granted it: the banner goes away.
    expect(screen.queryByTestId('notifications-permission-banner')).toBeNull();
    // The grant registers the task and schedules the Al-Kahf reminder now.
    expect(mockSync).toHaveBeenCalledWith('permission_granted');
    expect(mockPrompted).toHaveBeenCalledWith('settings');
    expect(mockResult).toHaveBeenCalledWith('settings', 'system', GRANTED);
  });

  it('does not sync when the request is refused', async () => {
    mockGetPermissions.mockResolvedValue(NEVER_ASKED);
    mockRequestPermissions.mockResolvedValue(DENIED);
    await renderPage();
    await act(async () => {
      fireEvent.press(screen.getByTestId('notifications-permission-button'));
    });
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('opens the system settings when the system cannot ask again', async () => {
    mockGetPermissions.mockResolvedValue(DENIED);
    await renderPage();

    expect(screen.getByTestId('notifications-permission-banner')).toBeTruthy();
    expect(screen.getByText('Open Settings')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('notifications-permission-button'));
    });

    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    // Opening the system settings is not a prompt.
    expect(mockPrompted).not.toHaveBeenCalled();
  });

  it('keeps the switches usable while the permission is off', async () => {
    mockGetPermissions.mockResolvedValue(DENIED);
    await renderPage();

    fireEvent(
      screen.getByTestId('notification-switch-whats_new'),
      'valueChange',
      false,
    );
    expect(useNotificationPrefsStore.getState().whats_new).toBe(false);
  });

  it('reads the permission again when the app comes back to the foreground', async () => {
    let onChange: ((state: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      listener: (state: string) => void,
    ) => {
      onChange = listener;
      return {remove: jest.fn()};
    }) as unknown as typeof AppState.addEventListener);
    mockGetPermissions.mockResolvedValue(DENIED);
    await renderPage();
    expect(screen.getByTestId('notifications-permission-banner')).toBeTruthy();

    // The user allowed notifications in the system settings and came back.
    mockGetPermissions.mockResolvedValue(GRANTED);
    await act(async () => {
      onChange?.('active');
    });

    expect(mockGetPermissions).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('notifications-permission-banner')).toBeNull();
  });

  it('enables the switches once the stored choices are read', async () => {
    jest
      .spyOn(useNotificationPrefsStore.persist, 'hasHydrated')
      .mockReturnValue(false);
    let finishRead: (ok: boolean) => void = () => undefined;
    mockWhenHydrated.mockReturnValue(
      new Promise<boolean>(resolve => {
        finishRead = resolve;
      }),
    );
    await renderPage();

    // The read is pending: every switch is disabled, and no error shows.
    for (const type of NOTIFICATION_TYPES) {
      expect(isDisabled(`notification-switch-${type}`)).toBe(true);
    }
    expect(screen.queryByTestId('notifications-prefs-read-failed')).toBeNull();

    await act(async () => {
      finishRead(true);
    });

    for (const type of NOTIFICATION_TYPES) {
      expect(isDisabled(`notification-switch-${type}`)).toBe(false);
    }
    expect(screen.queryByTestId('notifications-prefs-read-failed')).toBeNull();
  });

  it('keeps the switches disabled and says so when the read fails', async () => {
    jest
      .spyOn(useNotificationPrefsStore.persist, 'hasHydrated')
      .mockReturnValue(false);
    mockWhenHydrated.mockResolvedValue(false);
    await renderPage();

    expect(mockWhenHydrated).toHaveBeenCalledTimes(1);
    for (const type of NOTIFICATION_TYPES) {
      expect(isDisabled(`notification-switch-${type}`)).toBe(true);
    }
    expect(
      screen.getByText(enQariah.settings.notifications.readFailed),
    ).toBeTruthy();
  });

  it('enables the switches at once when the store is already read', async () => {
    jest
      .spyOn(useNotificationPrefsStore.persist, 'hasHydrated')
      .mockReturnValue(true);
    // The check of the focus is still pending; the first frame is enabled.
    mockWhenHydrated.mockReturnValue(new Promise<boolean>(() => undefined));
    await renderPage();

    expect(isDisabled('notification-switch-kahf_friday')).toBe(false);
  });

  it('sends a holdout user back to the Settings index', async () => {
    mockIsHoldout.mockReturnValue(true);
    render(<NotificationsSettingsScreen />);
    await act(() => Promise.resolve());

    expect(mockRedirect).toHaveBeenCalledWith({href: '/(d.settings)'});
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByTestId('notifications-permission-banner')).toBeNull();
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockWhenHydrated).not.toHaveBeenCalled();
  });

  it('renders the Arabic text from the qariah namespace', async () => {
    await i18n.changeLanguage('ar');
    mockGetPermissions.mockResolvedValue(DENIED);
    await renderPage();

    expect(
      screen.getByText(arQariah.settings.notifications.typesSection),
    ).toBeTruthy();
    expect(
      screen.getByText(arQariah.settings.notifications.kahfFriday),
    ).toBeTruthy();
    expect(screen.getByText(arQariah.common.openSettings)).toBeTruthy();
    // The banner sentence. The test i18n has no `qariahAppName`
    // post-processor, so only the text around the app name is checked.
    const escape = (text: string) =>
      text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const [before, after] =
      arQariah.settings.notifications.permissionOff.split('{{appName}}');
    expect(
      screen.getByText(new RegExp(`^${escape(before)}.+${escape(after)}$`)),
    ).toBeTruthy();
  });
});
