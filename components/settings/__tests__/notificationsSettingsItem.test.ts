// @ai-generated
// Qariah (Sprint 48, S48.7, Task 17): the "Notifications" row of the Settings
// index, its holdout rule, and the hook that reads the holdout on each focus.
//
// `getSettingsSections` in app/(tabs)/(d.settings)/index.tsx (upstream) is not
// exported, so the row comes from `getNotificationsSettingsItems`, and a
// source check makes sure that the upstream file still uses it (an upstream
// sync that takes the file whole would drop the row without an error).
import {readFileSync} from 'fs';
import {join} from 'path';
import i18n from 'i18next';
import type {TFunction} from 'i18next';
import {act, renderHook} from '@testing-library/react-native';
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
const INDEX_SOURCE = readFileSync(join(SETTINGS_DIR, 'index.tsx'), 'utf8');
const LAYOUT_SOURCE = readFileSync(join(SETTINGS_DIR, '_layout.tsx'), 'utf8');

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
});

describe('the Settings files use the row', () => {
  it('index.tsx puts the row in the APP & DATA section, after Language', () => {
    const appData = INDEX_SOURCE.indexOf(
      "t('settings:index.sections.appData')",
    );
    const language = INDEX_SOURCE.indexOf("type: 'language'", appData);
    const row = INDEX_SOURCE.indexOf(
      '...getNotificationsSettingsItems(t, notificationsHoldout),',
      language,
    );
    const storage = INDEX_SOURCE.indexOf("type: 'storage'", appData);
    const feedback = INDEX_SOURCE.indexOf(
      "t('settings:index.sections.feedback')",
    );
    expect(appData).toBeGreaterThan(-1);
    expect(language).toBeGreaterThan(appData);
    expect(row).toBeGreaterThan(language);
    expect(row).toBeLessThan(storage);
    expect(storage).toBeLessThan(feedback);
  });

  it('index.tsx reads the holdout on each focus and rebuilds the sections', () => {
    expect(INDEX_SOURCE).toContain(
      'const notificationsHoldout = useNotificationsHoldout();',
    );
    expect(INDEX_SOURCE).toMatch(
      /useMemo\(\s*\(\) => getSettingsSections\(t, notificationsHoldout\),\s*\[t, notificationsHoldout\],?\s*\)/,
    );
  });

  it('index.tsx opens the page for the row', () => {
    expect(INDEX_SOURCE).toMatch(
      /case NOTIFICATIONS_SETTINGS_TYPE:[^\n]*\n\s*router\.push\(NOTIFICATIONS_SETTINGS_ROUTE\);/,
    );
    expect(NOTIFICATIONS_SETTINGS_ROUTE).toBe('/(d.settings)/notifications');
  });

  it('_layout.tsx registers the route with its title', () => {
    expect(LAYOUT_SOURCE).toMatch(
      /name="notifications"\s*\n\s*options=\{\{title: t\('qariah:settings\.screens\.notifications'\)\}\}/,
    );
  });
});
