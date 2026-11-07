// @ai
// Divergence batch C3 (SHT-S6): the Qariah parts of the Settings index moved
// out of the inherited app/(tabs)/(d.settings)/index.tsx. These tests check
// the moved helpers, and a source check makes sure that the upstream file
// still uses each slot (an upstream sync that takes the file whole would drop
// the Qariah rows without an error).
import {readFileSync} from 'fs';
import {join} from 'path';
import {Alert, Linking, Platform} from 'react-native';
import type {TFunction} from 'i18next';

const mockShowGuide = jest.fn();
jest.mock('@/hooks/useBackgroundPlaybackPrompt', () => ({
  showBackgroundPlaybackGuide: () => mockShowGuide(),
}));

jest.mock('@/services/diagnostics/debugId', () => ({
  getDebugIdBlock: () => 'Debug ID: abc',
}));

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string, options?: {lng?: string; email?: string}) =>
      [key, options?.lng, options?.email].filter(Boolean).join('|'),
  },
}));

jest.mock('@/config/branding', () => ({
  __esModule: true,
  default: {supportEmail: 'support@example.org'},
}));

import {
  BACKGROUND_PLAYBACK_SETTINGS_TYPE,
  getBackgroundPlaybackSettingsItems,
  handleQariahSettingPress,
} from '../backgroundPlaybackSettingsItem';
import {openSupportEmail} from '@/utils/openSupportEmail';

const t = ((key: string) => key) as unknown as TFunction<
  ['settings', 'common', 'qariah']
>;

const INDEX_SOURCE = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'app',
    '(tabs)',
    '(d.settings)',
    'index.tsx',
  ),
  'utf8',
);

function setPlatform(os: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true});
}

describe('background playback row (S33)', () => {
  const originalOs = Platform.OS;
  afterEach(() => setPlatform(originalOs as 'ios' | 'android'));

  it('is one row on Android', () => {
    setPlatform('android');
    expect(getBackgroundPlaybackSettingsItems(t)).toEqual([
      {
        title: 'qariah:settings.backgroundPlayback',
        type: 'backgroundPlayback',
        description: 'qariah:settings.backgroundPlaybackDesc',
        icon: 'battery-charging',
        iconType: 'feather',
      },
    ]);
  });

  it('is no row on iOS', () => {
    setPlatform('ios');
    expect(getBackgroundPlaybackSettingsItems(t)).toEqual([]);
  });

  it('opens the guide on a press of the row, and nothing for another type', () => {
    handleQariahSettingPress('somethingElse');
    expect(mockShowGuide).not.toHaveBeenCalled();
    handleQariahSettingPress(BACKGROUND_PLAYBACK_SETTINGS_TYPE);
    expect(mockShowGuide).toHaveBeenCalledTimes(1);
  });
});

describe('openSupportEmail (Sprint 32)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('opens a mail with the English subject and the debug block', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    await openSupportEmail('support');
    await openSupportEmail('featureRequest');

    const body = encodeURIComponent('\n\nDebug ID: abc\n');
    expect(open.mock.calls).toEqual([
      [
        `mailto:support@example.org?subject=${encodeURIComponent(
          'qariah:support.emailSubjectSupport|en',
        )}&body=${body}`,
      ],
      [
        `mailto:support@example.org?subject=${encodeURIComponent(
          'qariah:support.emailSubjectFeatureRequest|en',
        )}&body=${body}`,
      ],
    ]);
  });

  it('shows the address in an Alert when no mail app opens', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    await openSupportEmail('support');

    expect(alert).toHaveBeenCalledWith(
      'qariah:support.emailUsTitle',
      'qariah:support.emailUsBody|support@example.org',
    );
  });
});

describe('the inherited Settings index uses each Qariah slot', () => {
  it.each([
    'useQariahAccountSettings(qariahSlot)',
    '{qariahAccount.section}',
    '{qariahAccount.signOutSheet}',
    '<DebugIdRow {...qariahSlot} />',
    '...getBackgroundPlaybackSettingsItems(t)',
    'handleQariahSettingPress(type)',
    "openSupportEmail('support')",
    "openSupportEmail('featureRequest')",
  ])('%s', slot => {
    expect(INDEX_SOURCE).toContain(slot);
  });
});
