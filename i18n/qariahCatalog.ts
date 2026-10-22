// @ai-generated
// Qariah: catalog text in the UI language (Sprint 47 Task 8, Pass C).
//
// The catalog (assets/data/catalog.json and its live R2 copy) is English data
// with two Arabic fields, written from the review pack by
// scripts/catalog-arabic-names.mjs:
//   name_arabic  upstream's field; `getReciterDisplayName` (i18n/format.ts)
//                shows it.
//   bio_ar       a Qariah field; `getReciterBio` below shows it.
// Country and rewayah names have no Arabic field. Their Arabic is upstream's
// `content:rewayah.long.*` where upstream has the rewayah, else the `qariah`
// namespace (`countries.<ISO code>`, `rewayat.<slug>`), which
// scripts/i18n-qariah-from-review.mjs generates from the pack.
//
// The rule is upstream's rule for reciter and surah names: a language whose
// `bilingualContent` is 'ar' shows the Arabic, and every other language shows
// the catalog's own English, so English text stays exactly as it was.
//
// Bare i18next singleton (initialised by '@/i18n' at app start), as in
// data/rewayat.ts: data/countryCollections.ts imports this file.
import i18n from 'i18next';
import {getCountryISOForName} from '@/data/countryISO';
import {resolveRewayahFromName} from '@/services/rewayah/RewayahIdentity';
import {currentLanguage, type AppLanguage} from './language';
import {resources} from './resources';
import {
  getQariahRewayahLabel,
  isQariahRewayahKey,
  rewayahSlug,
  showsArabic,
} from './qariahRewayah';

// Kept for callers that import it from here.
export {rewayahSlug};

interface BioReciter {
  bio_en?: string | null;
  bio_ar?: string | null;
}

/**
 * The reciter's bio for display: `bio_ar` when the language shows Arabic and
 * the catalog has it, else `bio_en`. Null when there is neither.
 */
export function getReciterBio(
  reciter: BioReciter,
  language: AppLanguage = currentLanguage,
): string | null {
  const english = reciter.bio_en?.trim() || null;
  if (!showsArabic(language)) {
    return english;
  }
  return reciter.bio_ar?.trim() || english;
}

const COUNTRY_NAMES = resources.en.qariah.countries;
type CountryCode = keyof typeof COUNTRY_NAMES;

function isCountryCode(code: string | undefined): code is CountryCode {
  return (
    code !== undefined &&
    Object.prototype.hasOwnProperty.call(COUNTRY_NAMES, code)
  );
}

/**
 * A catalog `Reciter.country` value for display. In Arabic it is
 * `qariah:countries.<ISO code>`; a country without a code or a key keeps the
 * catalog value.
 */
export function getCountryDisplayName(
  country: string,
  language: AppLanguage = currentLanguage,
): string {
  if (!showsArabic(language)) {
    return country;
  }
  const code = getCountryISOForName(country);
  return isCountryCode(code)
    ? i18n.t(`qariah:countries.${code}`, {lng: language})
    : country;
}

const LANGUAGE_NAMES = resources.en.qariah.languages;
type LanguageNameKey = keyof typeof LANGUAGE_NAMES;

function isLanguageNameKey(key: string): key is LanguageNameKey {
  return Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, key);
}

/**
 * A catalog `Reciter.translation` value ("English") for display. In Arabic it
 * is `qariah:languages.<lowercase name>` ("الإنجليزية"); a language without a
 * key keeps the catalog value (TECH_DEBT #304).
 */
export function getTranslationLanguageName(
  value: string,
  language: AppLanguage = currentLanguage,
): string {
  if (!showsArabic(language)) {
    return value;
  }
  const key = value.trim().toLowerCase();
  return isLanguageNameKey(key)
    ? i18n.t(`qariah:languages.${key}`, {lng: language})
    : value;
}

interface CatalogRewayah {
  name: string;
  name_ar?: string | null;
}

/**
 * A catalog rewayah name for display ("Hafs A'n Assem" in English). In
 * Arabic, in this order: the `qariah:rewayat.<slug>` key (the review pack's
 * rows that upstream does not cover), upstream's long label
 * (`content:rewayah.long.<id>`, "حفص عن عاصم"), the ops console's `name_ar`,
 * and last the catalog name.
 */
export function getCatalogRewayahLabel(
  rewayah: CatalogRewayah,
  language: AppLanguage = currentLanguage,
): string {
  const {name} = rewayah;
  if (!showsArabic(language) || !name) {
    return name;
  }
  const slug = rewayahSlug(name);
  if (isQariahRewayahKey(slug)) {
    return i18n.t(`qariah:rewayat.${slug}`, {lng: language});
  }
  const id = resolveRewayahFromName(name);
  if (id) {
    return i18n.t(`content:rewayah.long.${id}`, {lng: language});
  }
  return (
    getQariahRewayahLabel(name, 'long', language) ??
    (rewayah.name_ar?.trim() || name)
  );
}
