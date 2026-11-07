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
    // @ai Qariah keeps its own page set (no upstream release pages); its own copy uses the qariah namespace.
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
    // @ai Qariah: the update pages of the next release (updateOnly).
    ...getQariahReleasePages(),
  ];
}
// @ai-end
