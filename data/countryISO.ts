/**
 * Sprint 14 — ISO 3166-1 alpha-2 codes for the countries currently
 * present in `assets/data/catalog.json` `Reciter.country`. Used by
 * `CountryCard` to render a stylized 2-letter monogram badge in place
 * of the previous globe emoji.
 *
 * Lookup is case-insensitive on the country slug (matches
 * `slugify(country)` from `data/countryCollections.ts`).
 *
 * Adding a new country: add a row here AND populate the `Reciter.country`
 * via the curation CSV. Catalog regeneration via
 * `scripts/apply-reciter-metadata.ts` does not touch this file.
 *
 * Long-term: TECH_DEBT row tracks proper SVG country silhouettes — the
 * 2-letter code is an interim that ships the user-feedback "no more
 * cheesy globe emoji" goal in one sprint.
 */

const SLUG_TO_ISO: Record<string, string> = {
  algeria: 'DZ',
  australia: 'AU',
  cameroon: 'CM',
  canada: 'CA',
  egypt: 'EG',
  finland: 'FI',
  guinea: 'GN',
  indonesia: 'ID',
  jordan: 'JO',
  kenya: 'KE',
  malaysia: 'MY',
  mauritania: 'MR',
  morocco: 'MA',
  nigeria: 'NG',
  pakistan: 'PK',
  palestine: 'PS',
  philippines: 'PH',
  russia: 'RU',
  singapore: 'SG',
  somalia: 'SO',
  spain: 'ES',
  tanzania: 'TZ',
  'the-gambia': 'GM',
  tunisia: 'TN',
  'united-states-of-america': 'US',
  yemen: 'YE',
  // Sprint 21 S21.U3 — synthetic 'XJ' code (NOT real ISO 3166-1; ISO has no
  // assignment for East Turkistan / Xinjiang). Per-user editorial choice: use
  // the Xinjiang region of China as the in-app silhouette. Lookup is local to
  // this file + assets/country-shapes/index.ts; no other consumer should treat
  // 'XJ' as an ISO code.
  'east-turkistan': 'XJ',
};

/**
 * Resolve a country slug (kebab-case lowercase) to its ISO 3166-1 alpha-2
 * code. Returns undefined when the slug isn't mapped — callers fall back
 * to a generic placeholder treatment.
 */
export function getCountryISO(slug: string): string | undefined {
  return SLUG_TO_ISO[slug.trim().toLowerCase()];
}
