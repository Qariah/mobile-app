// @ai-generated
// Qariah (Sprint 48, S48.7, Task 17): the "Notifications" row of the Settings
// index, its holdout rule, and the hook that reads the holdout on each focus.
//
// The row comes from `getNotificationsSettingsItems`; since Sprint 52 Task 5
// `components/settings/qariahSettingsSections.ts` adds it to the shared
// Settings list (the phone list and the iPad list).
import {readFileSync} from 'fs';
import {join} from 'path';
import i18n from 'i18next';
import type {TFunction} from 'i18next';
import {act, renderHook} from '@testing-library/react-native';
import branding from '@/config/branding';
import {
  getNotificationsSettingsItems,
  NOTIFICATIONS_SETTINGS_ROUTE,
  NOTIFICATIONS_SETTINGS_TYPE,
  useNotificationsHoldout,
} from '../notificationsSettingsItem';
import {
  isNotificationsHoldout,
  readNotificationsHoldoutArm,
} from '@/services/notifications/holdout';

// The last focus callback, so a test can focus the screen again.
let mockFocus: (() => void) | undefined;

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    const {useEffect} = require('react');
    mockFocus = callback;
    useEffect(callback, [callback]);
  },
}));

jest.mock('@/services/notifications/holdout', () => ({
  isNotificationsHoldout: jest.fn(() => false),
  readNotificationsHoldoutArm: jest.fn(() => null),
}));

const mockIsHoldout = isNotificationsHoldout as jest.MockedFunction<
  typeof isNotificationsHoldout
>;

const SETTINGS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'app',
  '(tabs)',
  '(d.settings)',
);
const PAGE_SOURCE = readFileSync(
  join(SETTINGS_DIR, 'notifications.tsx'),
  'utf8',
);

const t = i18n.t.bind(i18n) as unknown as TFunction<
  ['settings', 'common', 'qariah']
>;

beforeEach(() => {
  mockIsHoldout.mockReturnValue(false);
});

describe('getNotificationsSettingsItems', () => {
  it('gives the Notifications row, in the shape of the other rows', () => {
    expect(getNotificationsSettingsItems(t, false)).toEqual([
      {
        title: 'Notifications',
        type: NOTIFICATIONS_SETTINGS_TYPE,
        description: 'Choose the notifications you get',
        icon: 'bell',
        iconType: 'feather',
      },
    ]);
  });

  it('gives no row in the holdout', () => {
    expect(getNotificationsSettingsItems(t, true)).toEqual([]);
  });

  it('reads the holdout when the caller passes nothing', () => {
    mockIsHoldout.mockReturnValue(true);
    expect(getNotificationsSettingsItems(t)).toEqual([]);
    mockIsHoldout.mockReturnValue(false);
    expect(getNotificationsSettingsItems(t)).toHaveLength(1);
    // The default reads the arm through isNotificationsHoldout only.
    expect(readNotificationsHoldoutArm).not.toHaveBeenCalled();
  });
});

describe('useNotificationsHoldout', () => {
  it('reads the holdout again on each focus', () => {
    mockIsHoldout.mockReturnValue(true);
    const {result} = renderHook(() => useNotificationsHoldout());
    expect(result.current).toBe(true);

    // Task 16 writes the "notify" arm; the screen gets the focus again.
    mockIsHoldout.mockReturnValue(false);
    act(() => mockFocus?.());
    expect(result.current).toBe(false);

    mockIsHoldout.mockReturnValue(true);
    act(() => mockFocus?.());
    expect(result.current).toBe(true);
  });

  it('reads the holdout again when the re-read key changes (Sprint 52 Task 5, the iPad split)', () => {
    mockIsHoldout.mockReturnValue(false);
    const {result, rerender} = renderHook(
      ({page}: {page: string}) => useNotificationsHoldout(page),
      {initialProps: {page: 'storage'}},
    );
    expect(result.current).toBe(false);

    // The flag arrives; a page beside the list changes, with no new focus.
    mockIsHoldout.mockReturnValue(true);
    rerender({page: 'storage'});
    expect(result.current).toBe(false);
    rerender({page: 'language'});
    expect(result.current).toBe(true);
  });
});

describe('the Settings files use the row', () => {
  // Sprint 52 Task 5: the row reaches the phone list and the iPad list from
  // components/settings/qariahSettingsSections.ts; its place (after Language)
  // and its route are tested in qariahSettingsSections.test.tsx.
  it('opens the Notifications page of the Settings stack', () => {
    expect(branding.settingsRouteNames?.[NOTIFICATIONS_SETTINGS_TYPE]).toBe(
      'notifications',
    );
    expect(NOTIFICATIONS_SETTINGS_ROUTE).toBe('/(d.settings)/notifications');
  });

  it('notifications.tsx sets its own title', () => {
    expect(PAGE_SOURCE).toMatch(
      /<Stack\.Screen\s*options=\{\{title: t\('qariah:settings\.screens\.notifications'\)\}\}/,
    );
  });
});
