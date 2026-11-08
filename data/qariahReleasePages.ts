// @ai-generated
// Qariah (Sprint 48, S48.8): the update pages of the Qariah releases.
//
// `data/onboardingPages.ts` adds these pages at the end of its list. Each one
// is `updateOnly`: the What's New onboarding
// (`components/modals/WhatsNewOnboarding`) shows them after an upgrade, also a
// patch upgrade (`branding.whatsNewOnPatchUpdate`, TECH_DEBT #390;
// `utils/versionUtils.ts`: `hasVersionChanged`, `filterPagesByVersion`). The
// first-launch tour of a fresh install leaves them out.
//
// One set of pages for each release (`QARIAH_RELEASE_SETS`, newest first).
// Each page of a set has the set version as its `minVersion`. The gate has
// two halves:
//
// - The lower half is upstream's `filterPagesByVersion`: it keeps a page when
//   its `minVersion` is above the last version that the user saw.
// - The upper half is here: a set exists only in an app of its version or
//   newer (`getQariahReleaseSets`). `filterPagesByVersion` compares a page
//   with the last seen version only, so without this check an older build
//   (for example a 3.2.4 hotfix) would show the pages of a newer release.
//
// A user who skipped a release sees every set above the last version that
// the user saw, newest set first. Example: 3.2.1 → 3.2.5 shows the 3.2.5
// pages, then the 3.2.3 pages. This is the rule that the upstream filter
// gives with no change.
//
// Every set shows the one feedback page at the end (owner rule, 2026-10-30:
// every release notes screen ends with it). Its `minVersion` is the version of
// the newest set in the app, so it shows when one set or more shows, and only
// one time.
//
// To add a release: put its set at the start of `QARIAH_RELEASE_SETS`, add
// its rows to the review pack (`planning/pass-c/arabic-review/ui-strings.csv`,
// section P), and run `node scripts/i18n-qariah-from-review.mjs`. The owner
// approves the text and the screenshots (`qariah-post-sprint` Step 6.7).
//
// The text is in the `qariah` namespace, generated from the review pack:
// - 3.2.3: `qariah:onboarding.release_3_3.*` (rows 330–335). The keys keep the
//   Sprint 48 name `release_3_3`, so the review pack rows do not change.
// - 3.2.5: `qariah:onboarding.release_3_2_5.*` (rows 390–393).
// - The feedback page: `qariah:onboarding.release_3_3.feedback*` (rows 375–376).
// The icons are Ionicons names, as on the other pages; no new image asset.
//
// The page model has no platform filter, so the iPad page shows on iPhone and
// Android too.
//
// Content rules: each page names only what its release gives to users. No
// page names a feature that `config/featureFlags.ts` hides. No page names the
// notifications (controller decision 2026-10-20): the holdout arm is not
// known when the pages are built, the holdout arm must not hear of the
// feature (the experiment measures it), and the notifications introduce
// themselves (the iOS permission card, Settings → Notifications).
import * as semver from 'semver';
import i18n from '@/i18n';
import {getCurrentVersion} from '@/utils/versionUtils';
import type {OnboardingPage} from './onboardingPages';

/** One update page, before the gate adds its version. */
interface ReleasePageSpec {
  id: string;
  icon: string;
  gradientColors: [string, string];
  /**
   * The title and the text, read at call time in the app language. A closure
   * with a literal key, so that tsc checks the key.
   */
  title: () => string;
  description: () => string;
}

/** The update pages of one release. */
export interface QariahReleaseSet {
  /** The release that the pages announce. */
  version: string;
  /** The pages, in show order, without the feedback page. */
  pages: readonly ReleasePageSpec[];
}

/** The release sets, newest first. */
export const QARIAH_RELEASE_SETS: readonly QariahReleaseSet[] = [
  {
    version: '3.2.5',
    pages: [
      {
        id: 'qariah-3-2-5-ipad',
        icon: 'tablet-portrait-outline',
        gradientColors: ['#6366F1', '#4338CA'],
        title: () => i18n.t('qariah:onboarding.release_3_2_5.ipadTitle'),
        description: () => i18n.t('qariah:onboarding.release_3_2_5.ipadBody'),
      },
      {
        id: 'qariah-3-2-5-fixes',
        icon: 'checkmark-circle-outline',
        gradientColors: ['#14B8A6', '#0F766E'],
        title: () => i18n.t('qariah:onboarding.release_3_2_5.fixesTitle'),
        description: () => i18n.t('qariah:onboarding.release_3_2_5.fixesBody'),
      },
    ],
  },
  {
    version: '3.2.3',
    pages: [
      {
        id: 'qariah-3-3-arabic',
        icon: 'language-outline',
        gradientColors: ['#10B981', '#047857'],
        title: () => i18n.t('qariah:onboarding.release_3_3.arabicTitle'),
        description: () => i18n.t('qariah:onboarding.release_3_3.arabicBody'),
      },
      {
        id: 'qariah-3-3-widgets',
        icon: 'grid-outline',
        gradientColors: ['#3B82F6', '#4F46E5'],
        title: () => i18n.t('qariah:onboarding.release_3_3.widgetsTitle'),
        description: () => i18n.t('qariah:onboarding.release_3_3.widgetsBody'),
      },
      {
        id: 'qariah-3-3-recitations',
        icon: 'sparkles-outline',
        gradientColors: ['#EC4899', '#BE185D'],
        title: () => i18n.t('qariah:onboarding.release_3_3.recitationsTitle'),
        description: () =>
          i18n.t('qariah:onboarding.release_3_3.recitationsBody'),
      },
    ],
  },
];

/** The last page of every set: the feedback link in Settings. */
const FEEDBACK_PAGE: ReleasePageSpec = {
  id: 'qariah-release-feedback',
  icon: 'chatbubbles-outline',
  gradientColors: ['#F59E0B', '#B45309'],
  title: () => i18n.t('qariah:onboarding.release_3_3.feedbackTitle'),
  description: () => i18n.t('qariah:onboarding.release_3_3.feedbackBody'),
};

/** The newest release that has update pages. */
export const QARIAH_RELEASE_PAGES_VERSION = QARIAH_RELEASE_SETS[0].version;

/**
 * The release sets that an app of `version` has: each set of `version` or
 * older, newest first. A version that cannot be read gives no set: no page,
 * never a wrong one.
 */
export function getQariahReleaseSets(version: string): QariahReleaseSet[] {
  const current = semver.coerce(version);
  if (current === null) return [];
  return QARIAH_RELEASE_SETS.filter(set => {
    const release = semver.coerce(set.version);
    return release !== null && semver.gte(current, release);
  });
}

function toPage(spec: ReleasePageSpec, minVersion: string): OnboardingPage {
  return {
    id: spec.id,
    icon: spec.icon,
    gradientColors: spec.gradientColors,
    title: spec.title(),
    description: spec.description(),
    minVersion,
    updateOnly: true,
  };
}

/**
 * The update pages of every release that the running app has, newest set
 * first, then the feedback page. No page when the running app is older than
 * every release set.
 *
 * @param currentVersion The version of the running app (default: the Expo
 *   config version).
 */
export function getQariahReleasePages(
  currentVersion: string = getCurrentVersion(),
): OnboardingPage[] {
  const sets = getQariahReleaseSets(currentVersion);
  if (sets.length === 0) return [];
  return [
    ...sets.flatMap(set => set.pages.map(spec => toPage(spec, set.version))),
    toPage(FEEDBACK_PAGE, sets[0].version),
  ];
}
