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
}

/**
 * Onboarding pages factory. Brand strings (e.g. `branding.appName`)
 * resolve at call time, not module load — this lets a fork override
 * `branding` without having to fork this file. Originally a top-level
 * const, but top-level const arrays evaluate before any `branding`
 * resolution, baking the upstream brand name into the bundle.
 */
export function getOnboardingPages(): OnboardingPage[] {
  return [
    {
      id: 'welcome',
      icon: 'app-icon',
      title: `Welcome to ${branding.appName}`,
      subtitle: 'Hear the Qurʾan in her voice',
      description:
        'The first Qurʾan app celebrating contemporary and historical women reciters — bringing voices long unheard to a global audience.',
      minVersion: '2.0',
    },
    {
      id: 'reciters',
      icon: 'people-outline',
      gradientColors: ['#EC4899', '#BE185D'],
      title: 'A Curated Catalog',
      description:
        'Curated with over 60 women reciters across the world and across several narrations. And more on the way.',
      minVersion: '2.0',
    },
    {
      id: 'mushaf',
      icon: 'book-outline',
      isCustomIcon: true,
      gradientColors: ['#3B82F6', '#1D4ED8'],
      title: 'The Mushaf',
      description:
        'A dedicated reading screen with the full Uthmani script, beautiful tajweed coloring, and an immersive reading mode.',
      minVersion: '2.0',
    },
    {
      id: 'highlighting',
      icon: 'locate-outline',
      gradientColors: ['#8B5CF6', '#6D28D9'],
      title: 'Follow Along',
      description:
        'Each ayah highlights in sync with the recitation so you never lose your place. Available for Zaynab Talha, expanding soon insha Allah.',
      minVersion: '2.0',
    },
    {
      id: 'memorize',
      icon: 'repeat-outline',
      isCustomIcon: true,
      gradientColors: ['#6366F1', '#4338CA'],
      title: 'Listen to Memorize',
      description:
        'Repeat a single ayah, play a range of verses, or loop an entire page. Built for hifdh and review.',
      minVersion: '2.0',
    },
    {
      id: 'translations',
      icon: 'language-outline',
      isCustomIcon: true,
      gradientColors: ['#A855F7', '#7C3AED'],
      title: 'Translations & Tafseer',
      description:
        'Browse dozens of translations and scholarly commentaries in multiple languages, all downloadable for offline use.',
      minVersion: '2.0',
    },
    {
      id: 'themes',
      icon: 'color-palette-outline',
      isCustomIcon: true,
      gradientColors: ['#F43F5E', '#E11D48'],
      title: 'Thematic Highlighting',
      description:
        'Verses are color-coded by theme so you can see the structure and topics of each surah at a glance.',
      minVersion: '2.0',
    },
    {
      id: 'indopak',
      icon: 'globe-outline',
      gradientColors: ['#22D3EE', '#06B6D4'],
      title: 'IndoPak Script',
      description:
        'Switch to the IndoPak Nastaliq script in the mushaf for the style used across South Asia.',
      minVersion: '2.0',
    },
    {
      id: 'downloads',
      icon: 'download-outline',
      isCustomIcon: true,
      gradientColors: ['#14B8A6', '#0D9488'],
      title: 'Offline Downloads',
      description:
        'Download individual surahs or entire playlists so you can listen without an internet connection.',
      minVersion: '2.0',
    },
    {
      id: 'playlists',
      icon: 'list-outline',
      isCustomIcon: true,
      gradientColors: ['#F97316', '#EA580C'],
      title: 'Playlists',
      description:
        'Create custom playlists, reorder tracks, and build your own listening routines.',
      minVersion: '2.0',
    },
  ];
}
