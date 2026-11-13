// @ai-generated
/**
 * Qariah (#847, word highlight B): the word times in the SQLite timing cache
 * (`timestamps_v4.db`, TimestampDatabaseService).
 *
 * Two columns, added by ALTER TABLE when they are missing, so the rows of an
 * older build stay valid:
 *  - `ayah_timestamps.segments TEXT`: the ayah's `segments` as JSON, or NULL
 *    when it has none;
 *  - `cached_surahs.word_times INTEGER NOT NULL DEFAULT 0`: 1 when a build
 *    that keeps the word times wrote the row. A row of an older build has 0:
 *    that build dropped the word times of the file (PR #862 kept only the five
 *    ayah fields), so TimestampService fetches the file once again while the
 *    catalog covers the surah. A row with 1 is not fetched again for this
 *    reason, also when its file has no word times.
 * The revision column `rev` (#846) and the database name do not change.
 */
import type {SQLiteDatabase} from 'expo-sqlite';
import type {AyahTimestamp, AyahTimestampRow} from '@/types/timestamps';
import {mapAyahTimestampRow} from '@/types/timestamps';
import {parseWordSegments} from './wordSegments';

/** The calls of an expo-sqlite database this module makes. */
type SchemaDb = Pick<SQLiteDatabase, 'getAllAsync' | 'execAsync'>;

async function hasColumn(
  db: SchemaDb,
  table: string,
  column: string,
): Promise<boolean> {
  const columns = await db.getAllAsync<{name: string}>(
    `PRAGMA table_info(${table})`,
  );
  return columns.some(c => c.name === column);
}

/** Adds the two word-time columns when they are missing. */
export async function migrateWordTimesColumns(db: SchemaDb): Promise<void> {
  if (!(await hasColumn(db, 'ayah_timestamps', 'segments'))) {
    await db.execAsync('ALTER TABLE ayah_timestamps ADD COLUMN segments TEXT');
  }
  if (!(await hasColumn(db, 'cached_surahs', 'word_times'))) {
    await db.execAsync(
      'ALTER TABLE cached_surahs ADD COLUMN word_times INTEGER NOT NULL DEFAULT 0',
    );
  }
}

/** The `segments` column value of an ayah timing: JSON, or null for none. */
export function segmentsColumn(timestamp: AyahTimestamp): string | null {
  const segments = parseWordSegments(timestamp.segments);
  return segments ? JSON.stringify(segments) : null;
}

/** A row of `ayah_timestamps`, with the `segments` column. */
export type AyahTimestampRowWithSegments = AyahTimestampRow & {
  segments?: string | null;
};

/** An AyahTimestamp from a row; `segments` only when the row has valid ones. */
export function ayahTimestampFromRow(
  row: AyahTimestampRowWithSegments,
): AyahTimestamp {
  const timestamp = mapAyahTimestampRow(row);
  if (typeof row.segments === 'string' && row.segments.length > 0) {
    let raw: unknown;
    try {
      raw = JSON.parse(row.segments);
    } catch {
      raw = undefined;
    }
    const segments = parseWordSegments(raw);
    if (segments) timestamp.segments = segments;
  }
  return timestamp;
}
