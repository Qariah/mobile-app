import {RECITERS, type Reciter} from './reciterData';

export interface CountryInfo {
  /** Kebab-case slug for routing — e.g. "saudi-arabia". */
  id: string;
  /** Display name — e.g. "Saudi Arabia". */
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
 * Flip the `qariahCountryRow` feature flag once enough reciters have
 * country values (suggested: at least 5 distinct countries with ≥2
 * reciters each, so the row doesn't look thin).
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

function slugify(country: string): string {
  return country.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-');
}

/**
 * Aggregate `RECITERS` by `country`, returning one entry per distinct
 * country with the reciter count. Reciters with no `country` value are
 * dropped silently.
 */
export function getAllCountries(): CountryInfo[] {
  const counts = new Map<string, {name: string; count: number}>();
  for (const reciter of RECITERS) {
    if (!reciter.country) continue;
    const id = slugify(reciter.country);
    const existing = counts.get(id);
    if (existing) {
      existing.count += 1;
    } else {
      const curated = CURATED_COUNTRIES[id];
      counts.set(id, {name: curated?.name ?? reciter.country, count: 1});
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

/** Look up a country by slug; returns reciters whose `country` matches. */
export function getRecitersByCountry(countrySlug: string): Reciter[] {
  return RECITERS.filter(r => r.country && slugify(r.country) === countrySlug);
}
