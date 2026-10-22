/**
 * Translation home-row registry.
 *
 * Sprint 8 — original design used a hand-curated `CURATED_TRANSLATIONS`
 * list for a future tafseer-language browse. That design was never used.
 *
 * Sprint 14 — `Reciter.translation` field added; the catalog now carries
 * three translation reciters (Maryam from Elgo Academy / Spanish,
 * Ameera Al-Mutawakil / English, Elizaveta Skulskaia / Russian).
 *
 * Sprint 15 (S15.5) — repurposed to derive from `RECITERS` directly so
 * the Translations row reflects the actual catalog. Each unique
 * `Reciter.translation` language becomes a TranslationInfo entry; the
 * row auto-hides when zero translation reciters exist. Wires the card-
 * press destination to `(a.home)/reciter/browse?translation=<id>`,
 * where BrowseReciters filters by `Reciter.translation` slug.
 */

import {RECITERS, type Reciter} from '@/data/reciterData';

export interface TranslationInfo {
  /** Kebab-case slug — e.g. "english", "urdu". Matches the URL param. */
  id: string;
  /** Display name — e.g. "English", "Spanish". */
  name: string;
  /** ISO 639-1 / 639-2 language code — e.g. "en", "ur". Used by future i18n. */
  languageCode: string;
  /** Number of reciters tied to this translation language. */
  itemCount: number;
}

/**
 * Minimal language-code map for the translations Qariah's catalog
 * surfaces today. Falls back to lowercased name when a language isn't
 * mapped (good-enough for the URL slug + display).
 */
const LANGUAGE_CODE_MAP: Readonly<Record<string, string>> = {
  english: 'en',
  spanish: 'es',
  russian: 'ru',
  french: 'fr',
  urdu: 'ur',
  malay: 'ms',
  indonesian: 'id',
  turkish: 'tr',
  german: 'de',
  arabic: 'ar',
};

function slugifyLanguage(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * All translation languages present in the active catalog, with their
 * reciter counts. Empty when no reciter has `Reciter.translation` set.
 */
export function getAllTranslations(): TranslationInfo[] {
  const counts = new Map<string, {name: string; count: number}>();

  for (const reciter of RECITERS as Reciter[]) {
    const lang = reciter.translation?.trim();
    if (!lang) continue;
    const slug = slugifyLanguage(lang);
    const existing = counts.get(slug);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(slug, {name: lang, count: 1});
    }
  }

  return Array.from(counts.entries())
    .map(([slug, {name, count}]) => ({
      id: slug,
      name,
      languageCode: LANGUAGE_CODE_MAP[slug] ?? slug,
      itemCount: count,
    }))
    .sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name));
}
