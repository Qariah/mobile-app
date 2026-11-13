// @ai-generated
/**
 * Qariah (#847, word highlight B): a TEST timing file with word times, for a
 * test build only. No published timing file has word times yet (the ops
 * console publish step is off), so a device check of the word mark needs
 * this file.
 *
 * The file: Zaynab Talha, Ya-Sin (surah 36), from the catalog run of the
 * timing pipeline (`recitation-timings/runs/catalog/ctc-quran-asr-tiny/
 * f543c610-837d-5fc5-825f-0b51752aa3a4-036.json`), in the published shape:
 * one ayah object for each ayah, its edges the first start and the last end
 * of its recited words (as `buildTimestampFile`), and `segments` = every
 * recitation of a word in time order, repeats included (36:10 goes back to
 * word 3 at 95.16 s).
 *
 * A store build cannot use it: the file loads only when the build sets
 * EXPO_PUBLIC_QARIAH_WORD_TIMES_TEST=1. Expo inlines the variable when it
 * bundles the JS, so in any other build the condition is false and the
 * bundler drops the `require` of the file (the PR checks the bundle for it).
 * A test build always loads the surah from this file (not from the SQLite
 * cache), and writes it with `word_times` 0 (see isWordTimesTestFile).
 *
 *   EXPO_PUBLIC_QARIAH_WORD_TIMES_TEST=1 scripts/android-archive.sh --lab
 */
import type {AyahTimestamp} from '@/types/timestamps';
import {toAyahTimestamp} from '@/services/timestamps/timestampRevision';

const ZAYNAB_TALHA_REWAYAT_ID = 'f543c610-837d-5fc5-825f-0b51752aa3a4';
const TEST_SURAH = 36;

let parsed: AyahTimestamp[] | null = null;

/** Marks the test file's array (a global symbol: one mark for every copy of this module). */
const TEST_FILE_MARK = Symbol.for('qariah.wordTimesTestFile');

/** True in a test build, for the surah that the test file replaces. */
export function isWordTimesTestSurah(
  rewayatId: string,
  surahNumber: number,
): boolean {
  return (
    process.env.EXPO_PUBLIC_QARIAH_WORD_TIMES_TEST === '1' &&
    rewayatId === ZAYNAB_TALHA_REWAYAT_ID &&
    surahNumber === TEST_SURAH
  );
}

/**
 * True for the timings of the test file. The SQLite cache writes them with
 * `word_times` 0, so a later store build of this version fetches the real
 * file once again and the test file does not stay on a lab phone.
 */
export function isWordTimesTestFile(
  timestamps: readonly AyahTimestamp[],
): boolean {
  return (timestamps as {[TEST_FILE_MARK]?: boolean})[TEST_FILE_MARK] === true;
}

/** The test file for (Zaynab Talha, Ya-Sin) in a test build, else null. */
export function wordTimesTestTimings(
  rewayatId: string,
  surahNumber: number,
): AyahTimestamp[] | null {
  if (process.env.EXPO_PUBLIC_QARIAH_WORD_TIMES_TEST === '1') {
    if (!isWordTimesTestSurah(rewayatId, surahNumber)) return null;
    if (!parsed) {
      const raw =
        require('./word-times-test/f543c610-837d-5fc5-825f-0b51752aa3a4-036.json') as AyahTimestamp[];
      parsed = raw.map(toAyahTimestamp);
      Object.defineProperty(parsed, TEST_FILE_MARK, {value: true});
    }
    return parsed;
  }
  return null;
}
