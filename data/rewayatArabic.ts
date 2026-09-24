/**
 * Sprint 14 — Arabic-script names for the rewayat students/displayNames
 * used by `RewayatCard` to render large calligraphic glyphs in the
 * ScheherazadeNew font (already loaded for Quranic UI elsewhere).
 *
 * The names are standard Arabic spellings of historical Islamic figures
 * (qira'at students). Lookup keys mirror `RewayatEntry.student` and
 * `RewayatEntry.displayName` so callers can pass either.
 */

export const REWAYAT_ARABIC: Record<string, string> = {
  // Students
  Warsh: 'ورش',
  Qalun: 'قالون',
  'Al-Bazzi': 'البزي',
  Qunbul: 'قنبل',
  'Al-Duri': 'الدوري',
  'Al-Susi': 'السوسي',
  'Ibn Dhakwan': 'ابن ذكوان',
  Hisham: 'هشام',
  Hafs: 'حفص',
  "Shu'bah": 'شعبة',
  Khalaf: 'خلف',
  Khallad: 'خلاد',
  'Abu al-Harith': 'أبو الحارث',
  'Ibn Jammaz': 'ابن جماز',
  'Ibn Wardan': 'ابن وردان',
  Rawh: 'روح',
  Ruwais: 'رويس',
  // Display-name variants that differ from `student`
  'Al-Duri (Abu Amr)': 'الدوري',
  "Al-Duri (al-Kisa'i)": 'الدوري',
  'Khalaf (Hamzah)': 'خلف',
  'Ruwais & Rawh': 'رويس وروح',
  'Ruwais and Rawh': 'رويس وروح',
};

/**
 * Look up the Arabic glyph for a rewayat by its student or displayName.
 * Returns undefined when no mapping exists; callers fall back to
 * displaying the Latin transliteration.
 */
export function getRewayatArabic(
  studentOrDisplayName: string,
): string | undefined {
  return REWAYAT_ARABIC[studentOrDisplayName];
}
