/**
 * What's-New / first-launch onboarding pages.
 *
 * Filtered + rewritten for Qariah v2: dropped pages for features hidden by
 * `config/featureFlags.ts` (adhkar, user uploads, word-by-word, colored
 * highlights, per-verse notes), and rewrote copy to lead with Qariah's
 * mission — the first Quran app celebrating contemporary women reciters.
 *
 * Upstream keeps the full page list; this is a Qariah-only edit.
 * Tracked in DIVERGENCE_LEDGER.md row "data/onboardingPages.ts".
 *
 * Sprint 25 (#283) — converted from top-level const to a `getOnboardingPages()`
 * factory so `branding.appName` resolves at call time, not module load. Forks
 * that override `branding` no longer need to fork this file just to retitle
 * the welcome card. Qariah's curated copy is preserved verbatim.
 */

import branding from '@/config/branding';
// @ai-start
import i18n from '@/i18n';
import {getQariahReleasePages} from './qariahReleasePages';
// @ai-end

export interface OnboardingPage {
  id: string;
  icon: string;
  isCustomIcon?: boolean;
  gradientColors?: [string, string];
  title: string;
  subtitle?: string;
  description: string;
  /** The minimum app version where this page was introduced (e.g. "2.0") */
  minVersion: string;
  /**
   * Release announcement: shown to people updating from an earlier version
   * and left out of the first-launch tour.
   */
  updateOnly?: boolean;
}

/**
 * Onboarding pages factory. Brand strings (e.g. `branding.appName`)
 * resolve at call time, not module load — this lets a fork override
 * `branding` without having to fork this file. Originally a top-level
 * const, but top-level const arrays evaluate before any `branding`
 * resolution, baking the upstream brand name into the bundle.
 */
// @ai-start
export function getOnboardingPages(): OnboardingPage[] {
  return [
    // @ai Qariah keeps its own page set (Sprint 12/13 onboarding): no uploads,
    // ambient, adhkar or word-by-word pages, and none of upstream's 2.3
    // release pages (widgets, CarPlay, Arabic, adhkar playback, Mushaf 1440,
    // search, iPad), which describe a Bayaan release. Pages whose text matches
    // upstream use upstream's keys; Qariah's own copy uses the qariah
    // i18n namespace.
    {
      id: 'welcome',
      icon: 'app-icon',
      title: i18n.t('content:onboarding.welcome.title', {
        appName: branding.appName,
      }),
      subtitle: i18n.t('qariah:onboarding.tagline'),
      description: i18n.t('qariah:onboarding.welcomeBody'),
      minVersion: '2.0',
    },
    {
      id: 'reciters',
      icon: 'people-outline',
      gradientColors: ['#EC4899', '#BE185D'],
      title: i18n.t('qariah:onboarding.catalogTitle'),
      description: i18n.t('qariah:onboarding.catalogBody'),
      minVersion: '2.0',
    },
    {
      id: 'mushaf',
      icon: 'book-outline',
      isCustomIcon: true,
      gradientColors: ['#3B82F6', '#1D4ED8'],
      title: i18n.t('content:onboarding.mushaf.title'),
      description: i18n.t('content:onboarding.mushaf.description'),
      minVersion: '2.0',
    },
    {
      id: 'highlighting',
      icon: 'locate-outline',
      gradientColors: ['#8B5CF6', '#6D28D9'],
      title: i18n.t('content:onboarding.highlighting.title'),
      description: i18n.t('qariah:onboarding.followAlongBody'),
      minVersion: '2.0',
    },
    {
      id: 'memorize',
      icon: 'repeat-outline',
      isCustomIcon: true,
      gradientColors: ['#6366F1', '#4338CA'],
      title: i18n.t('content:onboarding.memorize.title'),
      description: i18n.t('qariah:onboarding.memorizeBody'),
      minVersion: '2.0',
    },
    {
      id: 'translations',
      icon: 'language-outline',
      isCustomIcon: true,
      gradientColors: ['#A855F7', '#7C3AED'],
      title: i18n.t('content:onboarding.translations.title'),
      description: i18n.t('content:onboarding.translations.description'),
      minVersion: '2.0',
    },
    {
      id: 'themes',
      icon: 'color-palette-outline',
      isCustomIcon: true,
      gradientColors: ['#F43F5E', '#E11D48'],
      title: i18n.t('content:onboarding.themes.title'),
      description: i18n.t('content:onboarding.themes.description'),
      minVersion: '2.0',
    },
    {
      id: 'indopak',
      icon: 'globe-outline',
      gradientColors: ['#22D3EE', '#06B6D4'],
      title: i18n.t('content:onboarding.indopak.title'),
      description: i18n.t('content:onboarding.indopak.description'),
      minVersion: '2.0',
    },
    {
      id: 'downloads',
      icon: 'download-outline',
      isCustomIcon: true,
      gradientColors: ['#14B8A6', '#0D9488'],
      title: i18n.t('content:onboarding.downloads.title'),
      description: i18n.t('content:onboarding.downloads.description'),
      minVersion: '2.0',
    },
    {
      id: 'playlists',
      icon: 'list-outline',
      isCustomIcon: true,
      gradientColors: ['#F97316', '#EA580C'],
      title: i18n.t('content:onboarding.playlists.title'),
      description: i18n.t('content:onboarding.playlists.description'),
      minVersion: '2.0',
    },
    // @ai Qariah (Sprint 48, S48.8): the update pages of the next release
    // (updateOnly; data/qariahReleasePages.ts).
    ...getQariahReleasePages(),
  ];
}
// @ai-end
