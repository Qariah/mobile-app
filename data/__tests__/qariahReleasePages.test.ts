// @ai-generated
// Qariah (Sprint 48, S48.8, Task 18; release sets 2026-11-08): the update pages
// of the Qariah releases, as the What's New onboarding filters them
// (utils/versionUtils.ts).
import i18n from 'i18next';
import ioniconsGlyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
import {getOnboardingPages} from '../onboardingPages';
import {
  getQariahReleasePages,
  getQariahReleaseSets,
  QARIAH_RELEASE_PAGES_VERSION,
  QARIAH_RELEASE_SETS,
} from '../qariahReleasePages';
import {
  filterPagesByVersion,
  getCurrentVersion,
  isMinorOrMajorUpdate,
} from '@/utils/versionUtils';
import branding from '@/config/branding';
import en from '@/i18n/locales/en/qariah.json';
import ar from '@/i18n/locales/ar/qariah.json';
import enSettings from '@/i18n/locales/en/settings.json';
import arSettings from '@/i18n/locales/ar/settings.json';
import enCommon from '@/i18n/locales/en/common.json';
import arCommon from '@/i18n/locales/ar/common.json';

// The version of the running app (the Expo config version in the app).
jest.mock('@/utils/versionUtils', () => ({
  ...jest.requireActual('@/utils/versionUtils'),
  getCurrentVersion: jest.fn(() => '3.2.5'),
}));
const mockedCurrentVersion = getCurrentVersion as jest.MockedFunction<
  typeof getCurrentVersion
>;

const SET_3_2_5 = ['qariah-3-2-5-ipad', 'qariah-3-2-5-fixes'];
const SET_3_2_3 = [
  'qariah-3-3-arabic',
  'qariah-3-3-widgets',
  'qariah-3-3-recitations',
];
const FEEDBACK = 'qariah-release-feedback';
const ALL_IDS = [...SET_3_2_5, ...SET_3_2_3, FEEDBACK];

/** The text keys of each release, in the `qariah` namespace. */
const RELEASE_TEXT = [
  {en: en.onboarding.release_3_3, ar: ar.onboarding.release_3_3},
  {en: en.onboarding.release_3_2_5, ar: ar.onboarding.release_3_2_5},
];

const ids = (pages: {id: string}[]) => pages.map(page => page.id);

/** The pages that the onboarding shows to an app of `current` after `lastSeen`. */
function shown(current: string, lastSeen: string | null): string[] {
  mockedCurrentVersion.mockReturnValue(current);
  return ids(filterPagesByVersion(getOnboardingPages(), lastSeen));
}

describe('the Qariah release pages', () => {
  beforeEach(() => {
    mockedCurrentVersion.mockReturnValue('3.2.5');
  });

  it('are one set for each release, newest first, then the feedback page', () => {
    expect(QARIAH_RELEASE_SETS.map(set => set.version)).toEqual([
      '3.2.5',
      '3.2.3',
    ]);
    expect(QARIAH_RELEASE_PAGES_VERSION).toBe('3.2.5');
    const pages = getQariahReleasePages();
    expect(ids(pages)).toEqual(ALL_IDS);
    for (const page of pages) {
      expect({id: page.id, updateOnly: page.updateOnly}).toEqual({
        id: page.id,
        updateOnly: true,
      });
    }
  });

  it('carry the version of their set; the feedback page carries the newest', () => {
    const minVersions = Object.fromEntries(
      getQariahReleasePages().map(page => [page.id, page.minVersion]),
    );
    for (const id of SET_3_2_5) expect(minVersions[id]).toBe('3.2.5');
    for (const id of SET_3_2_3) expect(minVersions[id]).toBe('3.2.3');
    expect(minVersions[FEEDBACK]).toBe('3.2.5');
    // In a build that has only the 3.2.3 set, the feedback page goes with it.
    const older = getQariahReleasePages('3.2.4');
    expect(older[older.length - 1]).toMatchObject({
      id: FEEDBACK,
      minVersion: '3.2.3',
    });
  });

  it('are in the onboarding page list, after the tour pages', () => {
    const all = ids(getOnboardingPages());
    expect(all.slice(-ALL_IDS.length)).toEqual(ALL_IDS);
    expect(new Set(all).size).toBe(all.length);
  });

  describe('after an update to 3.2.5', () => {
    it('from production 3.2.1, show both sets, newest first (a skipped release)', () => {
      expect(shown('3.2.5', '3.2.1')).toEqual(ALL_IDS);
      // A patch upgrade: the onboarding shows pages only because of the seam.
      expect(isMinorOrMajorUpdate('3.2.1', '3.2.5')).toBe(false);
      expect(branding.whatsNewOnPatchUpdate).toBe(true);
    });

    it('from a 3.2.2 beta, show both sets', () => {
      expect(shown('3.2.5', '3.2.2')).toEqual(ALL_IDS);
    });

    it('from 3.2.3, show only the 3.2.5 set and the feedback page', () => {
      expect(shown('3.2.5', '3.2.3')).toEqual([...SET_3_2_5, FEEDBACK]);
    });

    it('from the 3.2.4 hotfix, show only the 3.2.5 set and the feedback page', () => {
      expect(shown('3.2.5', '3.2.4')).toEqual([...SET_3_2_5, FEEDBACK]);
    });

    it('from 3.2.5, show nothing', () => {
      expect(shown('3.2.5', '3.2.5')).toEqual([]);
    });

    it('show nothing in the first-launch tour of a fresh install', () => {
      const tour = shown('3.2.5', null);
      expect(tour.length).toBeGreaterThan(0);
      for (const id of ALL_IDS) expect(tour).not.toContain(id);
    });
  });

  describe('the guard: a build never shows the pages of a newer release', () => {
    it('a 3.2.4 build has the 3.2.3 set only', () => {
      expect(ids(getQariahReleasePages('3.2.4'))).toEqual([
        ...SET_3_2_3,
        FEEDBACK,
      ]);
      expect(shown('3.2.4', '3.2.1')).toEqual([...SET_3_2_3, FEEDBACK]);
      expect(shown('3.2.4', '3.2.3')).toEqual([]);
    });

    it('a 3.2.3 build has the 3.2.3 set only', () => {
      expect(shown('3.2.3', '3.2.1')).toEqual([...SET_3_2_3, FEEDBACK]);
      expect(shown('3.2.3', '3.2.2')).toEqual([...SET_3_2_3, FEEDBACK]);
      expect(shown('3.2.3', '3.2.3')).toEqual([]);
    });

    it('a 3.2.2 beta has no set, also after a minor upgrade from 3.1.x', () => {
      expect(shown('3.2.2', '3.2.1')).toEqual([]);
      expect(shown('3.2.2', '3.1.8')).toEqual([]);
      expect(isMinorOrMajorUpdate('3.2.1', '3.2.2')).toBe(false);
    });

    it('a later release still has both sets, for a user who skipped them', () => {
      expect(shown('3.4.0', '3.2.1')).toEqual(ALL_IDS);
    });
  });

  it('compare the app version with the version of each set', () => {
    const versions = (version: string) =>
      getQariahReleaseSets(version).map(set => set.version);
    expect(versions('3.2.5')).toEqual(['3.2.5', '3.2.3']);
    expect(versions('3.3.0')).toEqual(['3.2.5', '3.2.3']);
    expect(versions('4.0')).toEqual(['3.2.5', '3.2.3']);
    expect(versions('3.2.4')).toEqual(['3.2.3']);
    expect(versions('3.2.3')).toEqual(['3.2.3']);
    expect(versions('3.2.2')).toEqual([]);
    expect(versions('1.0.0')).toEqual([]);
    expect(versions('not a version')).toEqual([]);
    expect(getQariahReleasePages('3.2.2')).toEqual([]);
    expect(getQariahReleasePages('not a version')).toEqual([]);
  });

  it('end with the feedback page, which names the Settings labels exactly', () => {
    for (const version of ['3.2.3', '3.2.4', '3.2.5']) {
      const pages = getQariahReleasePages(version);
      expect({version, last: pages[pages.length - 1].id}).toEqual({
        version,
        last: FEEDBACK,
      });
      expect(ids(pages).filter(id => id === FEEDBACK)).toHaveLength(1);
    }
    const path = (common: typeof enCommon, settings: typeof enSettings) =>
      [
        common.tabs.settings,
        settings.index.sections.feedback,
        settings.index.items.support.title,
      ].join(' › ');
    expect(en.onboarding.release_3_3.feedbackBody).toContain(
      path(enCommon, enSettings),
    );
    expect(ar.onboarding.release_3_3.feedbackBody).toContain(
      path(arCommon, arSettings),
    );
  });

  it('name the iPad screens with the labels that the app shows', () => {
    const ipad = en.onboarding.release_3_2_5.ipadBody;
    expect(ipad).toContain(enCommon.tabs.collection);
    expect(ipad).toContain(enCommon.tabs.settings);
    const ipadAr = ar.onboarding.release_3_2_5.ipadBody;
    expect(ipadAr).toContain(arCommon.tabs.collection);
    expect(ipadAr).toContain(arCommon.tabs.settings);
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
    for (const release of RELEASE_TEXT) {
      for (const value of Object.values(release.en)) {
        expect(value).not.toMatch(/notification/i);
      }
    }
  });

  it('have English and Arabic text', () => {
    for (const release of RELEASE_TEXT) {
      const english = release.en as Record<string, string>;
      const arabic = release.ar as Record<string, string>;
      const keys = Object.keys(english);
      expect(keys.sort()).toEqual(Object.keys(arabic).sort());
      for (const key of keys) {
        expect({key, english: english[key].length > 0}).toEqual({
          key,
          english: true,
        });
        expect({key, arabic: /[؀-ۿ]/.test(arabic[key])}).toEqual({
          key,
          arabic: true,
        });
      }
    }
  });

  it('have a title and a text for every page (no raw key)', () => {
    for (const page of getQariahReleasePages()) {
      expect({id: page.id, title: page.title}).toEqual({
        id: page.id,
        title: expect.not.stringMatching(/^qariah:|onboarding\./),
      });
      expect({id: page.id, text: page.description}).toEqual({
        id: page.id,
        text: expect.not.stringMatching(/^qariah:|onboarding\./),
      });
    }
  });

  it('read their text in the app language', async () => {
    await i18n.changeLanguage('ar');
    try {
      const [ipad, , , , , feedback] = getQariahReleasePages();
      expect(ipad.title).toBe(ar.onboarding.release_3_2_5.ipadTitle);
      expect(ipad.description).toBe(ar.onboarding.release_3_2_5.ipadBody);
      expect(feedback.title).toBe(ar.onboarding.release_3_3.feedbackTitle);
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
