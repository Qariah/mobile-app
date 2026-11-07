// @ai-generated
// Qariah: Arabic labels for catalog rewayah names that upstream's registry
// (data/rewayat.ts) does not know (Sprint 47 Task 8; TECH_DEBT #304).
//
// A leaf module (no runtime import of services/rewayah/RewayahIdentity.ts),
// because RewayahIdentity's `getDisplayLabelFromName` calls it, and
// i18n/qariahCatalog.ts uses it too.
import i18n from 'i18next';
import type {RewayahId} from '@/services/rewayah/RewayahIdentity';
import {currentLanguage, type AppLanguage} from './language';
import {getLanguageConfig} from './languages';
import {resources} from './resources';

/** True when `language` shows Arabic content (upstream's rule). */
export function showsArabic(language: AppLanguage): boolean {
  return getLanguageConfig(language).bilingualContent === 'ar';
}

/**
 * The i18n key of a catalog rewayah name: "Al-Kisa'i" → "al-kisai",
 * "Hafs 'an 'Āṣim" → "hafs-an-asim". scripts/i18n-qariah-from-review.mjs has
 * the same function; the two must stay the same.
 */
export function rewayahSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’ʼ‘`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Catalog spellings of upstream rewayat that upstream's registry does not
 * list, keyed by `rewayahSlug`. The review pack (rewayat.csv section 2) gives
 * each one upstream's Arabic.
 */
export const CATALOG_REWAYAH_ALIASES: Readonly<Record<string, RewayahId>> = {
  'hafs-an-asim': 'hafs', // "Hafs 'an 'Asim", "Hafs 'an 'Āṣim"
  'al-doori-an-abi-amr': 'al-duri-abi-amr', // "Al-Doori A'n Abi Amr"
  'bazzi-an-ibn-kathir': 'al-bazzi', // "Bazzi A'n Ibn Kathir"
  'khalaf-an-hamza': 'khalaf-an-hamzah', // "Khalaf A'n Hamza"
};

const QARIAH_REWAYAT = resources.en.qariah.rewayat;
type QariahRewayahKey = keyof typeof QARIAH_REWAYAT;

/** True when the `qariah` namespace has a label for this rewayah slug. */
export function isQariahRewayahKey(key: string): key is QariahRewayahKey {
  return Object.prototype.hasOwnProperty.call(QARIAH_REWAYAT, key);
}

/**
 * The Arabic label of a catalog rewayah name that upstream's registry does
 * not resolve: the `qariah:rewayat.<slug>` key (Al-Kisa'i, the translation
 * rewayat), else upstream's `content:rewayah.<form>.<id>` label of an alias
 * spelling. Null in a language that does not show Arabic content (English
 * keeps the catalog name), and null for a name that it does not know.
 */
export function getQariahRewayahLabel(
  name: string,
  form: 'short' | 'long',
  language: AppLanguage = currentLanguage,
): string | null {
  if (!name || !showsArabic(language)) return null;
  const slug = rewayahSlug(name);
  if (isQariahRewayahKey(slug)) {
    return i18n.t(`qariah:rewayat.${slug}`, {lng: language});
  }
  const id = CATALOG_REWAYAH_ALIASES[slug];
  return id ? i18n.t(`content:rewayah.${form}.${id}`, {lng: language}) : null;
}
