import {RECITERS, type Reciter} from './reciterData';
import {countrySlug as slugify} from './countryISO';
import type {AppLanguage} from '@/i18n/language';

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
 *
 * Qariah (TECH_DEBT #323): the names are in `language` (default: the app
 * language). The order does not depend on the language or on the platform.
 */
export function getAllCountries(language?: AppLanguage): CountryInfo[] {
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
        name: curated?.name ?? getCountryDisplayName(reciter.country, language),
        count: 1,
      });
    }
  }

  // Qariah (TECH_DEBT #323): sort by the id (the English catalog name in
  // lower case, `countrySlug`) without diacritics, with a plain comparison. A
  // `localeCompare` of the display names used the ICU data of the device: in
  // Arabic, iOS showed Spain first and Android showed Australia first. Now
  // each platform and each language shows the same order. For the catalog
  // countries, the English order is the same as before.
  return Array.from(counts.entries())
    .map(([id, {name, count}]) => ({
      id,
      name,
      flag: CURATED_COUNTRIES[id]?.flag,
      reciterCount: count,
    }))
    .sort(
      (a, b) =>
        compareText(countrySortKey(a.id), countrySortKey(b.id)) ||
        compareText(a.id, b.id),
    );
}

// Qariah (TECH_DEBT #323): a comparison of UTF-16 code units. It uses no
// locale data, so each platform gives the same result.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Qariah (TECH_DEBT #323): the sort key of a country id, without diacritics
// ("côte-d'ivoire" → "cote-d'ivoire", "türkiye" → "turkiye"). Without this
// step, a plain comparison puts an accented letter after "z". NFD and the
// Unicode mark class are Unicode data, not locale data.
function countrySortKey(id: string): string {
  return id.normalize('NFD').replace(/\p{M}/gu, '');
}

/** True when the reciter's `country` has this slug. The Browse filter uses it. */
export function reciterMatchesCountry(
  reciter: Reciter,
  countrySlug: string,
): boolean {
  return !!reciter.country && slugify(reciter.country) === countrySlug;
}
