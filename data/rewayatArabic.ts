/**
 * Sprint 14 — the large Arabic calligraphic glyph that `RewayatCard` renders
 * in the ScheherazadeNew font: the Arabic name of the rawi (the qira'at
 * student), in every app language.
 *
 * Sprint 47 (Pass C): the names come from upstream's i18n now. Until then
 * this file held a Qariah map of 22 names. Upstream ships the same names as
 * `content:rewayat.people.*` (Bayaan #349), and `data/rewayat.ts` already
 * renders the registry `teacher` / `student` values through those keys
 * (`getRewayatPersonLabel`). The glyph reads them in Arabic whatever the app
 * language, so English shows the same glyph as before. It shows the rawi
 * alone ("الدوري"); upstream's short label adds the teacher in brackets
 * ("الدوري (أبو عمرو)"), which is too long for the glyph.
 * `data/__tests__/rewayatArabic.test.ts` checks every name against the
 * review pack (planning/pass-c/arabic-review/rewayat.csv, section 1).
 */
// @ai-start
// Bare i18next singleton (initialised by '@/i18n' at app start), as in
// data/rewayat.ts.
import i18n from 'i18next';
import {resources} from '@/i18n/resources';

const PEOPLE = resources.en.content.rewayat.people;
type PersonKey = keyof typeof PEOPLE;

/** Upstream's English person label ("Al-Duri") → its key ("duri"). */
const KEY_BY_ENGLISH = new Map<string, PersonKey>(
  (Object.keys(PEOPLE) as PersonKey[]).map(key => [PEOPLE[key], key]),
);

/**
 * The Arabic glyph for a rewayah, looked up by its registry `student` (for
 * example "Warsh" or "Ruwais and Rawh"). Returns undefined when upstream has
 * no label for the name; callers then show the Latin transliteration.
 */
export function getRewayatArabic(
  studentOrDisplayName: string,
): string | undefined {
  const key = KEY_BY_ENGLISH.get(studentOrDisplayName);
  return key ? i18n.t(`content:rewayat.people.${key}`, {lng: 'ar'}) : undefined;
}
// @ai-end
