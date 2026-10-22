// @ai-generated
// Qariah (Sprint 48, S48.8, Task 18): the update pages of the next release, as
// the What's New onboarding filters them (utils/versionUtils.ts).
import i18n from 'i18next';
import ioniconsGlyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
import {getOnboardingPages} from '../onboardingPages';
import {
  getQariahReleasePages,
  isReleasePagesVersion,
  QARIAH_RELEASE_PAGES_VERSION,
} from '../qariahReleasePages';
import {
  filterPagesByVersion,
  getCurrentVersion,
  isMinorOrMajorUpdate,
} from '@/utils/versionUtils';
import en from '@/i18n/locales/en/qariah.json';
import ar from '@/i18n/locales/ar/qariah.json';

// The version of the running app (the Expo config version in the app).
jest.mock('@/utils/versionUtils', () => ({
  ...jest.requireActual('@/utils/versionUtils'),
  getCurrentVersion: jest.fn(() => '3.3.0'),
}));
const mockedCurrentVersion = getCurrentVersion as jest.MockedFunction<
  typeof getCurrentVersion
>;

const RELEASE_IDS = [
  'qariah-3-3-arabic',
  'qariah-3-3-widgets',
  'qariah-3-3-recitations',
];

const ids = (pages: {id: string}[]) => pages.map(page => page.id);

/** The pages that the onboarding shows to an app of `current` after `lastSeen`. */
function shown(current: string, lastSeen: string | null): string[] {
  mockedCurrentVersion.mockReturnValue(current);
  return ids(filterPagesByVersion(getOnboardingPages(), lastSeen));
}

describe('the Qariah release pages', () => {
  beforeEach(() => {
    mockedCurrentVersion.mockReturnValue('3.3.0');
  });

  it('are draft pages for 3.3.0, shown only after an upgrade', () => {
    expect(QARIAH_RELEASE_PAGES_VERSION).toBe('3.3.0');
    const pages = getQariahReleasePages();
    expect(ids(pages)).toEqual(RELEASE_IDS);
    for (const page of pages) {
      expect({id: page.id, updateOnly: page.updateOnly}).toEqual({
        id: page.id,
        updateOnly: true,
      });
      expect(page.minVersion).toBe(QARIAH_RELEASE_PAGES_VERSION);
    }
  });

  it('are in the onboarding page list, after the tour pages', () => {
    const all = ids(getOnboardingPages());
    expect(all.slice(-RELEASE_IDS.length)).toEqual(RELEASE_IDS);
    expect(new Set(all).size).toBe(all.length);
  });

  it('show when a 3.3.0 app upgrades from production 3.2.1', () => {
    expect(shown('3.3.0', '3.2.1')).toEqual(RELEASE_IDS);
    // The onboarding shows pages only for a minor or major upgrade.
    expect(isMinorOrMajorUpdate('3.2.1', QARIAH_RELEASE_PAGES_VERSION)).toBe(
      true,
    );
  });

  it('do not show in a 3.2.2 beta, also after a minor upgrade from 3.1.x', () => {
    expect(shown('3.2.2', '3.2.1')).toEqual([]);
    expect(shown('3.2.2', '3.1.8')).toEqual([]);
    expect(isMinorOrMajorUpdate('3.2.1', '3.2.2')).toBe(false);
  });

  it('show in a later release too, for a user who skipped 3.3.0', () => {
    expect(shown('3.4.0', '3.2.1')).toEqual(RELEASE_IDS);
  });

  it('do not show again after the user saw 3.3.0', () => {
    expect(shown('3.3.0', '3.3.0')).toEqual([]);
  });

  it('are left out of the first-launch tour of a fresh install', () => {
    const tour = shown('3.3.0', null);
    expect(tour.length).toBeGreaterThan(0);
    for (const id of RELEASE_IDS) expect(tour).not.toContain(id);
  });

  it('compare the app version with the release version', () => {
    expect(isReleasePagesVersion('3.3.0')).toBe(true);
    expect(isReleasePagesVersion('3.3.1')).toBe(true);
    expect(isReleasePagesVersion('4.0')).toBe(true);
    expect(isReleasePagesVersion('3.2.2')).toBe(false);
    expect(isReleasePagesVersion('1.0.0')).toBe(false);
    expect(isReleasePagesVersion('not a version')).toBe(false);
    expect(getQariahReleasePages('3.2.2')).toEqual([]);
    expect(ids(getQariahReleasePages('3.3.0'))).toEqual(RELEASE_IDS);
  });

  it('use Ionicons names and no custom icon', () => {
    for (const page of getQariahReleasePages()) {
      expect({id: page.id, isCustomIcon: page.isCustomIcon}).toEqual({
        id: page.id,
        isCustomIcon: undefined,
      });
      expect({icon: page.icon, known: page.icon in ioniconsGlyphs}).toEqual({
        icon: page.icon,
        known: true,
      });
    }
  });

  it('do not name the notifications (the holdout must not hear of them)', () => {
    for (const page of getQariahReleasePages()) {
      expect({id: page.id, text: `${page.title} ${page.description}`}).toEqual({
        id: page.id,
        text: expect.not.stringMatching(/notification/i),
      });
    }
    for (const value of Object.values(en.onboarding.release_3_3)) {
      expect(value).not.toMatch(/notification/i);
    }
  });

  it('have English and Arabic text', () => {
    const keys = Object.keys(en.onboarding.release_3_3);
    expect(keys.sort()).toEqual(Object.keys(ar.onboarding.release_3_3).sort());
    for (const key of keys) {
      const english = (en.onboarding.release_3_3 as Record<string, string>)[
        key
      ];
      const arabic = (ar.onboarding.release_3_3 as Record<string, string>)[key];
      expect({key, english: english.length > 0}).toEqual({key, english: true});
      expect({key, arabic: /[\u0600-\u06FF]/.test(arabic)}).toEqual({
        key,
        arabic: true,
      });
    }
  });

  it('read their text in the app language', async () => {
    await i18n.changeLanguage('ar');
    try {
      const [arabic] = getQariahReleasePages();
      expect(arabic.title).toBe(ar.onboarding.release_3_3.arabicTitle);
      expect(arabic.description).toBe(ar.onboarding.release_3_3.arabicBody);
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
