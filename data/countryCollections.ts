import {RECITERS, type Reciter} from './reciterData';
import {countrySlug as slugify} from './countryISO';

export interface CountryInfo {
  /** Kebab-case slug for routing — e.g. "saudi-arabia". */
  id: string;
  /**
   * Display name in the UI language — e.g. "Saudi Arabia", "السعودية". The
   * card title and the Browse screen title use it.
   */
  name: string;
  /** Optional emoji flag (added when curated; falls back to a globe). */
  flag?: string;
  /** Reciters whose `country` field matches this entry, computed live. */
  reciterCount: number;
}

/**
 * Sprint 8 — display metadata for countries we curate. Keys are kebab-case
 * slugs derived from `Reciter.country` lowercase + spaces → hyphens. When
 * the user populates the bio CSV with country values, the slugs that
 * appear here will pick up flags + display names; uncurated slugs render
 * as the raw country string with no flag (still functional).
 *
 * The `country` entry in `branding.homeRowConfig` shows or hides the row.
 */
const CURATED_COUNTRIES: Record<string, {name: string; flag?: string}> = {
  // Populate as country values land in the catalog. Examples below — keep
  // the slug = country.toLowerCase().replace(/\s+/g, '-').
  // 'saudi-arabia': {name: 'Saudi Arabia', flag: '🇸🇦'},
  // 'egypt': {name: 'Egypt', flag: '🇪🇬'},
  // 'morocco': {name: 'Morocco', flag: '🇲🇦'},
  // 'malaysia': {name: 'Malaysia', flag: '🇲🇾'},
  // 'tunisia': {name: 'Tunisia', flag: '🇹🇳'},
  // 'syria': {name: 'Syria', flag: '🇸🇾'},
  // 'usa': {name: 'United States', flag: '🇺🇸'},
};

/**
 * Aggregate `RECITERS` by `country`, returning one entry per distinct
 * country with the reciter count. Reciters with no `country` value are
 * dropped silently.
 */
export function getAllCountries(): CountryInfo[] {
  // Qariah (TECH_DEBT #303): lazy, so an import of the country data does not open MMKV.
  // Qariah (Sprint 47, Pass C): country names in the UI language.
  const {getCountryDisplayName} =
    require('@/i18n/qariahCatalog') as typeof import('@/i18n/qariahCatalog');
  const counts = new Map<string, {name: string; count: number}>();
  for (const reciter of RECITERS) {
    if (!reciter.country) continue;
    const id = slugify(reciter.country);
    const existing = counts.get(id);
    if (existing) {
      existing.count += 1;
    } else {
      const curated = CURATED_COUNTRIES[id];
      counts.set(id, {
        name: curated?.name ?? getCountryDisplayName(reciter.country),
        count: 1,
      });
    }
  }

  return Array.from(counts.entries())
    .map(([id, {name, count}]) => ({
      id,
      name,
      flag: CURATED_COUNTRIES[id]?.flag,
      reciterCount: count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the reciter's `country` has this slug. The Browse filter uses it. */
export function reciterMatchesCountry(
  reciter: Reciter,
  countrySlug: string,
): boolean {
  return !!reciter.country && slugify(reciter.country) === countrySlug;
}
