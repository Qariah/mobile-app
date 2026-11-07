// @ai-generated
// Qariah (Sprint 47 Task 8): the RewayatCard glyph (data/rewayatArabic.ts)
// reads upstream's `content:rewayat.people.*` in Arabic now, in place of the
// Qariah map that the review pack's rewayat.csv section 1 lists. These tests
// show that the move changes no glyph.
import i18n from 'i18next';
import {getAllRewayatWithCounts} from '../rewayat';
import {getRewayatArabic} from '../rewayatArabic';
import {itWithReviewPack, readReviewSheet} from '@/test-utils/reviewPack';

describe('getRewayatArabic', () => {
  it('gives every registry rawi an Arabic glyph', () => {
    for (const entry of getAllRewayatWithCounts()) {
      const glyph = getRewayatArabic(entry.student);
      expect({
        student: entry.student,
        arabic: /\p{Script=Arabic}/u.test(glyph ?? ''),
      }).toEqual({
        student: entry.student,
        arabic: true,
      });
    }
  });

  it('is Arabic whatever the app language', () => {
    expect(i18n.language).toBe('en');
    expect(getRewayatArabic('Warsh')).toBe(
      i18n.t('content:rewayat.people.warsh', {lng: 'ar'}),
    );
  });

  it('returns undefined for a name upstream does not have', () => {
    expect(getRewayatArabic('Nobody')).toBeUndefined();
  });

  itWithReviewPack(
    'keeps every glyph of the old Qariah map (rewayat.csv section 1)',
    () => {
      const rows = readReviewSheet('rewayat.csv').filter(row =>
        row.section.startsWith('1.'),
      );
      expect(rows).toHaveLength(23);
      for (const row of rows) {
        // The card looks a glyph up by the registry `student`: "Al-Duri (Abu
        // Amr)" is the student "Al-Duri", "Ruwais & Rawh" is "Ruwais and
        // Rawh", and the row "Idris / Ishaq" holds two students.
        const students = row.english
          .replace(/ \(.*\)$/, '')
          .replace(' & ', ' and ')
          .split(' / ');
        const arabic = row.arabic.split(' / ');
        students.forEach((student, i) => {
          expect({row: row.number, glyph: getRewayatArabic(student)}).toEqual({
            row: row.number,
            glyph: arabic[i],
          });
        });
      }
    },
  );
});
