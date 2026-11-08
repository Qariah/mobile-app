// @ai-generated
// Qariah (Sprint 52 Task 5): the Qariah rows of the Settings list come from
// one source for the phone list and the iPad list (`useSettingsSections`, the
// seam in settingsItems.ts, with `branding.useSettingsSections`). These tests
// use the real `config/branding.js`, so they check the seam as the app wires
// it: the rows (signed out, signed in, Android, the holdout), where they sit,
// how `openSettingsItem` routes each one, and the iPad list in the split
// (titles only) and below 900 pt (descriptions kept).
//
// The expected phone rows are the phone list at b700a828e (before Task 5):
// `app/(tabs)/(d.settings)/index.tsx` kept its own `getSettingsSections`, with
// "Write a Review" and "Contribute on GitHub" always on. The shared list keeps
// both for Qariah (`branding.appStoreId`, `branding.githubUrl`).
import React from 'react';
import {existsSync} from 'fs';
import {join} from 'path';
import {Alert, Linking, Platform, Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {renderHook, waitFor} from '@testing-library/react-native';
import i18n from 'i18next';
import type {TFunction} from 'i18next';

let mockAuthStatus = 'unauthenticated';
const mockSignOut = jest.fn().mockResolvedValue(undefined);
jest.mock('@/services/auth/AuthContext', () => ({
  useAuthStatus: () => mockAuthStatus,
}));
jest.mock('@/services/auth', () => ({
  useAuth: () => ({status: mockAuthStatus, signOut: mockSignOut}),
}));
jest.mock('@/services/userState/qfUserInfo', () => ({
  fetchQfUserInfo: jest.fn(() =>
    Promise.resolve({email: 'reader@example.org'}),
  ),
}));
jest.mock('@/services/notifications/holdout', () => ({
  isNotificationsHoldout: jest.fn(() => false),
}));
const mockShowGuide = jest.fn();
jest.mock('@/hooks/useBackgroundPlaybackPrompt', () => ({
  showBackgroundPlaybackGuide: () => mockShowGuide(),
}));
jest.mock('@/services/lite/liteMode', () => ({
  getLiteModeSetting: () => 'auto',
  isLiteModeAutoOn: () => false,
  setLiteModeSetting: jest.fn(),
}));
jest.mock('@/services/diagnostics/debugId', () => ({
  getDebugIdBlock: () => 'Debug ID: abc',
}));
let mockSegments: string[] = ['(tabs)', '(d.settings)'];
const mockDismissAll = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({push: jest.fn(), dismissAll: mockDismissAll}),
  useSegments: () => mockSegments,
  useFocusEffect: (callback: () => void) => {
    const {useEffect} = require('react');
    useEffect(callback, [callback]);
  },
}));
let mockResponsive = {isTablet: false, width: 390};
jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => mockResponsive,
}));
// The sheet itself (gorhom) has its own suite; here only its props matter.
jest.mock('@/components/auth/SignOutConfirmModal', () => ({
  SignOutConfirmModal: (props: {isVisible: boolean}) => {
    const {Text: RNText} = require('react-native');
    return props.isVisible ? <RNText>sign-out-sheet</RNText> : null;
  },
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {text: '#111111', textSecondary: '#555555'}},
  }),
}));
jest.mock('@/store/devSettingsStore', () => ({
  useDevSettingsStore: () => ({
    showFloatingDevMenu: false,
    toggleFloatingDevMenu: jest.fn(),
  }),
}));
jest.mock('@/store/analyticsConsentStore', () => ({
  useAnalyticsConsentStore: () => ({
    analyticsEnabled: true,
    setAnalyticsEnabled: jest.fn(),
  }),
}));
jest.mock('@/components/settings/ThemePicker', () => ({
  ThemePicker: () => null,
}));
jest.mock('@/components/Icons', () => new Proxy({}, {get: () => () => null}));
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));
jest.mock('@/hooks/useGlassProps', () => ({USE_GLASS: false}));
jest.mock('@/hooks/useBottomInset', () => ({useBottomInset: () => 0}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 24, bottom: 20, left: 0, right: 0}),
}));
jest.mock('@/utils/reviewUtils', () => ({
  canOpenAppStoreForReview: () => true,
  markAsRated: jest.fn(),
  openAppStoreForReview: jest.fn(),
}));

import branding from '@/config/branding';
import {isNotificationsHoldout} from '@/services/notifications/holdout';
import {
  SETTINGS_ROUTE_NAMES,
  getSettingsSections,
  openSettingsItem,
  useSettingsSections,
} from '../settingsItems';
import {QARIAH_ROW_ANCHORS} from '../qariahSettingsSections';
import {TabletSettingsList} from '../TabletSettingsList';
import {useSignOutPromptStore} from '@/components/auth/QariahAccountSection';
import {SignOutPrompt} from '@/components/auth/SignOutPrompt';

const t = i18n.t.bind(i18n) as unknown as TFunction<['settings', 'common']>;

const originalOs = Platform.OS;
function setPlatform(os: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true});
}

beforeEach(() => {
  mockAuthStatus = 'unauthenticated';
  mockSegments = ['(tabs)', '(d.settings)'];
  mockResponsive = {isTablet: false, width: 390};
  jest.mocked(isNotificationsHoldout).mockReturnValue(false);
  useSignOutPromptStore.setState({open: false});
  jest.clearAllMocks();
});
afterEach(() => {
  setPlatform(originalOs as 'ios' | 'android');
  jest.restoreAllMocks();
});

/** Each section as [leading, item types]. */
async function sectionTypes() {
  const {result} = renderHook(() => useSettingsSections(t));
  if (mockAuthStatus === 'authenticated') {
    await waitFor(() =>
      expect(result.current[0].items[0].description).toBe('reader@example.org'),
    );
  }
  return {
    sections: result.current,
    types: result.current.map(s => [
      s.leading ?? false,
      s.items.map(i => i.type),
    ]),
  };
}

const UPSTREAM_REST = [
  [false, ['rateApp', 'featureRequest', 'support']],
  [false, ['whatsNew', 'about', 'credits', 'github', 'terms', 'privacy']],
];

describe('the Settings list of the phone and the iPad (one source)', () => {
  it('signed out on iOS: the same rows as the phone list before Task 5', async () => {
    setPlatform('ios');
    const {types} = await sectionTypes();
    expect(types).toEqual([
      [true, ['signIn']],
      [false, ['mushafSettings', 'translations']],
      [false, ['defaultReciter', 'reciterChoice']],
      [false, ['language', 'notifications', 'storage']],
      ...UPSTREAM_REST,
    ]);
  });

  it('signed in: the account row shows the email and opens nothing', async () => {
    setPlatform('ios');
    mockAuthStatus = 'authenticated';
    const {sections, types} = await sectionTypes();
    expect(types[0]).toEqual([true, ['account', 'yourData', 'signOut']]);
    expect(sections[0].section).toBe('ACCOUNT');
    expect(sections[0].items[0]).toMatchObject({
      title: 'Signed in',
      description: 'reader@example.org',
      readOnly: true,
    });
    expect(sections[0].items[1].readOnly).toBeUndefined();
  });

  it('Android adds Background playback after the reciter choice and Lite mode after Notifications', async () => {
    setPlatform('android');
    const {types} = await sectionTypes();
    expect(types).toEqual([
      [true, ['signIn']],
      [false, ['mushafSettings', 'translations']],
      [false, ['defaultReciter', 'reciterChoice', 'backgroundPlayback']],
      [false, ['language', 'notifications', 'liteMode', 'storage']],
      ...UPSTREAM_REST,
    ]);
  });

  it('a user in the notifications holdout gets no Notifications row', async () => {
    setPlatform('ios');
    jest.mocked(isNotificationsHoldout).mockReturnValue(true);
    const {types} = await sectionTypes();
    expect(types[3]).toEqual([false, ['language', 'storage']]);
  });

  it('follows upstream rows that exist (an upstream sync that moves them fails here)', () => {
    const upstreamTypes = getSettingsSections(t).flatMap(s =>
      s.items.map(i => i.type),
    );
    for (const anchor of Object.values(QARIAH_ROW_ANCHORS)) {
      expect(upstreamTypes).toContain(anchor);
    }
  });
});

describe('openSettingsItem routes each Qariah row', () => {
  it.each([
    ['signIn', 'sign-in'],
    ['yourData', 'data'],
    ['notifications', 'notifications'],
  ])('%s opens the %s page', async (type, route) => {
    const navigate = jest.fn();
    await openSettingsItem(type, navigate);
    expect(navigate).toHaveBeenCalledWith(route);
    expect(SETTINGS_ROUTE_NAMES[type]).toBe(route);
    const page = join(
      __dirname,
      '..',
      '..',
      '..',
      'app',
      '(tabs)',
      '(d.settings)',
      `${route}.tsx`,
    );
    expect(existsSync(page)).toBe(true);
  });

  it.each([
    ['support', 'Support'],
    ['featureRequest', 'Feature'],
  ])('%s opens a mail, not the support page', async type => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);
    const navigate = jest.fn();
    await openSettingsItem(type, navigate);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL.mock.calls[0][0]).toMatch(
      new RegExp(`^mailto:${branding.supportEmail}\\?subject=`),
    );
    expect(openURL).not.toHaveBeenCalledWith(branding.supportUrl);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('Sign out opens the sign-out sheet', async () => {
    await openSettingsItem('signOut', jest.fn());
    expect(useSignOutPromptStore.getState().open).toBe(true);
  });

  it('the account row opens nothing', async () => {
    const openURL = jest.spyOn(Linking, 'openURL');
    const navigate = jest.fn();
    await openSettingsItem('account', navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('Background playback opens its guide; Lite mode asks for the mode', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    await openSettingsItem('backgroundPlayback', jest.fn());
    expect(mockShowGuide).toHaveBeenCalledTimes(1);
    await openSettingsItem('liteMode', jest.fn());
    expect(alert).toHaveBeenCalledWith(
      'Lite mode',
      expect.any(String),
      expect.any(Array),
    );
  });
});

function render(props: React.ComponentProps<typeof TabletSettingsList>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<TabletSettingsList {...props} />);
  });
  return renderer;
}

const texts = (node: TestRenderer.ReactTestInstance) =>
  node
    .findAll(n => (n.type as unknown) === Text)
    .map(n => [n.props.children].flat().join(''));

/** The pressable row whose title is `title`. */
const row = (r: TestRenderer.ReactTestRenderer, title: string) =>
  r.root.find(
    n =>
      typeof n.props.onPress === 'function' &&
      !!n.props.accessibilityRole &&
      texts(n)[0] === title,
  );

describe('the iPad list shows the Qariah rows', () => {
  beforeEach(() => setPlatform('ios'));

  it('in the split: Account above Appearance, titles only, the page marked', () => {
    const r = render({onOpenPage: jest.fn(), selectedRoute: 'notifications'});
    const all = texts(r.root);
    expect(all.indexOf('ACCOUNT')).toBeGreaterThan(-1);
    expect(all.indexOf('ACCOUNT')).toBeLessThan(all.indexOf('Appearance'));
    expect(texts(row(r, 'Sign in to Qariah'))).toEqual(['Sign in to Qariah']);
    expect(texts(row(r, 'Notifications'))).toEqual(['Notifications']);
    expect(row(r, 'Notifications').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(row(r, 'Storage').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('below 900 pt the rows keep their description', () => {
    const r = render({onOpenPage: jest.fn()});
    expect(texts(row(r, 'Sign in to Qariah'))).toEqual([
      'Sign in to Qariah',
      'Restore your favorites from the original Qariah app',
    ]);
    expect(texts(row(r, 'Notifications'))).toEqual([
      'Notifications',
      'Choose the notifications you get',
    ]);
  });

  it('opens the sign-in page from its row', async () => {
    const onOpenPage = jest.fn();
    const r = render({onOpenPage, selectedRoute: 'storage'});
    await act(async () => {
      await row(r, 'Sign in to Qariah').props.onPress();
    });
    expect(onOpenPage).toHaveBeenCalledWith('sign-in');
  });

  it('signed in, in the split: the account row keeps its email, has no press and is one element', async () => {
    mockAuthStatus = 'authenticated';
    const r = render({onOpenPage: jest.fn(), selectedRoute: 'storage'});
    await waitFor(() => expect(texts(r.root)).toContain('reader@example.org'));
    const account = r.root.find(
      n => n.props.accessible === true && texts(n)[0] === 'Signed in',
    );
    expect(account.props.onPress).toBeUndefined();
    expect(texts(account)).toEqual(['Signed in', 'reader@example.org']);
    // The other rows show titles only.
    expect(texts(row(r, 'Your data'))).toEqual(['Your data']);
  });

  it('signed in: the account row is one element with no press; Your data and Sign out open', async () => {
    mockAuthStatus = 'authenticated';
    const onOpenPage = jest.fn();
    const r = render({onOpenPage});
    // The email arrives after the user-info request resolves.
    await waitFor(() => expect(texts(r.root)).toContain('reader@example.org'));
    const account = r.root.find(
      n => n.props.accessible === true && texts(n)[0] === 'Signed in',
    );
    expect(account.props.onPress).toBeUndefined();
    expect(texts(account)).toEqual(['Signed in', 'reader@example.org']);

    await act(async () => {
      await row(r, 'Your data').props.onPress();
    });
    expect(onOpenPage).toHaveBeenCalledWith('data');
    await act(async () => {
      await row(r, 'Sign out').props.onPress();
    });
    expect(useSignOutPromptStore.getState().open).toBe(true);
  });

  it('in the split the Notifications row follows the holdout on a page change, with no tab focus', () => {
    mockSegments = ['(tabs)', '(d.settings)', 'storage'];
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <TabletSettingsList onOpenPage={jest.fn()} selectedRoute="storage" />,
      );
    });
    expect(texts(renderer.root)).toContain('Notifications');

    // The flag arrives; the user opens another page beside the list.
    jest.mocked(isNotificationsHoldout).mockReturnValue(true);
    mockSegments = ['(tabs)', '(d.settings)', 'language'];
    act(() => {
      renderer.update(
        <TabletSettingsList onOpenPage={jest.fn()} selectedRoute="language" />,
      );
    });
    expect(texts(renderer.root)).not.toContain('Notifications');
  });

  it('a switch row is the switch for VoiceOver: the title text is hidden, the switch has the title', () => {
    const r = render({onOpenPage: jest.fn(), selectedRoute: 'storage'});
    const title = r.root.find(
      n =>
        (n.type as unknown) === Text &&
        n.props.children === 'Share anonymous usage data',
    );
    expect(title.props.accessibilityElementsHidden).toBe(true);
    expect(
      r.root.findAll(
        n => n.props.accessibilityLabel === 'Share anonymous usage data',
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe('SignOutPrompt (the sheet the Sign out row opens)', () => {
  it('shows while the store is open, and signs out on confirm', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<SignOutPrompt />);
    });
    expect(texts(renderer.root)).toEqual([]);

    act(() => useSignOutPromptStore.getState().setOpen(true));
    expect(texts(renderer.root)).toEqual(['sign-out-sheet']);

    const modal = renderer.root.find(
      n => typeof n.props.onConfirm === 'function',
    );
    await act(async () => {
      await modal.props.onConfirm();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(useSignOutPromptStore.getState().open).toBe(false);
    act(() => renderer.unmount());
  });

  it.each([
    [
      'in the split, signed out, on Your data: opens the default page',
      true,
      'unauthenticated',
      'data',
      1,
    ],
    [
      'in the split, signed in, on Your data: stays',
      true,
      'authenticated',
      'data',
      0,
    ],
    [
      'in the split, signed out, on another page: stays',
      true,
      'unauthenticated',
      'storage',
      0,
    ],
    [
      'on a phone, signed out, on Your data: stays (phones do not change)',
      false,
      'unauthenticated',
      'data',
      0,
    ],
  ])('%s', (_name, split, status, page, calls) => {
    mockResponsive = split
      ? {isTablet: true, width: 1180}
      : {isTablet: false, width: 390};
    mockAuthStatus = status as string;
    mockSegments = ['(tabs)', '(d.settings)', page as string];
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<SignOutPrompt />);
    });
    expect(mockDismissAll).toHaveBeenCalledTimes(calls as number);
    act(() => renderer.unmount());
  });

  it('closes on cancel without a sign-out', () => {
    useSignOutPromptStore.setState({open: true});
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<SignOutPrompt />);
    });
    const modal = renderer.root.find(
      n => typeof n.props.onCancel === 'function',
    );
    act(() => modal.props.onCancel());
    expect(useSignOutPromptStore.getState().open).toBe(false);
    expect(mockSignOut).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
