import * as SQLite from 'expo-sqlite';
import type {AyahTimestamp, TimestampSource} from '@/types/timestamps';
// @ai-start
// Qariah (#847): the rows map through wordTimesCache (mapAyahTimestampRow and
// the word times).
import {
  ayahTimestampFromRow,
  migrateWordTimesColumns,
  segmentsColumn,
  type AyahTimestampRowWithSegments,
} from './wordTimesCache'; // Qariah (#847)
import {isWordTimesTestFile} from '@/assets/data/timings/wordTimesTest'; // Qariah (#847)
// @ai-end

// v4: the R2 timings for several reciters were regenerated (2026-10-27), and a
// cached surah is never re-fetched, so devices start from an empty cache.
const DB_NAME = 'timestamps_v4.db';
const LEGACY_DB_NAMES = ['timestamps_v3.db'];

class TimestampDatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync(DB_NAME);
        // Best effort: the old cache only holds superseded timings.
        for (const name of LEGACY_DB_NAMES) {
          SQLite.deleteDatabaseAsync(name).catch(() => undefined);
        }

        // Note on the cached_surahs.source column:
        // `source` is informational (no CHECK constraint at the SQLite
        // layer). The TimestampSource enum narrowed from
        // 'mp3quran' | 'qdc' | 'local' (pre-R2-mirror) to 'r2' | 'local'
        // (current), so devices upgrading across PR #278 may carry stale
        // 'mp3quran' / 'qdc' rows here until the next fetch overwrites
        // them via INSERT OR REPLACE in writeTimestamps. The stale
        // values are never read back as a TimestampSource — they live
        // only on this row for diagnostic purposes — so
        // overwrite-on-next-fetch is sufficient and no one-shot
        // migration is required.
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS ayah_timestamps (
            rewayat_id TEXT NOT NULL,
            surah_number INTEGER NOT NULL,
            ayah_number INTEGER NOT NULL,
            timestamp_from INTEGER NOT NULL,
            timestamp_to INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            PRIMARY KEY (rewayat_id, surah_number, ayah_number)
          );

          CREATE TABLE IF NOT EXISTS cached_surahs (
            rewayat_id TEXT NOT NULL,
            surah_number INTEGER NOT NULL,
            source TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            PRIMARY KEY (rewayat_id, surah_number)
          );
        `);
        // @ai-start
        // Qariah (#846): the timing revision of each cached surah. A row of an
        // older build gets revision 0, which is the revision of a catalog row
        // with no `timestamps_rev`, so its cache stays valid.
        const columns = await db.getAllAsync<{name: string}>(
          'PRAGMA table_info(cached_surahs)',
        );
        if (!columns.some(c => c.name === 'rev')) {
          await db.execAsync(
            'ALTER TABLE cached_surahs ADD COLUMN rev INTEGER NOT NULL DEFAULT 0',
          );
        }
        // Qariah (#847): the word times (`segments`, `word_times`).
        await migrateWordTimesColumns(db);
        // @ai-end

        this.db = db;
      } catch (error) {
        console.error('Failed to initialize timestamps database:', error);
        this.initPromise = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  async getTimestampsForSurah(
    rewayatId: string,
    surahNumber: number,
  ): Promise<AyahTimestamp[]> {
    if (!this.db) throw new Error('Timestamps database not initialized');

    // @ai-start
    // Qariah (#847): with the word times of each ayah.
    const rows = (await this.db.getAllAsync(
      `SELECT rewayat_id, surah_number, ayah_number, timestamp_from, timestamp_to, duration_ms, segments
       FROM ayah_timestamps
       WHERE rewayat_id = ? AND surah_number = ?
       ORDER BY ayah_number`,
      [rewayatId, surahNumber],
    )) as AyahTimestampRowWithSegments[];

    return rows.map(ayahTimestampFromRow);
    // @ai-end
  }

  async isSurahCached(
    rewayatId: string,
    surahNumber: number,
  ): Promise<boolean> {
    if (!this.db) throw new Error('Timestamps database not initialized');

    const result = await this.db.getFirstAsync(
      `SELECT 1 FROM cached_surahs WHERE rewayat_id = ? AND surah_number = ? LIMIT 1`,
      [rewayatId, surahNumber],
    );

    return result !== null;
  }

  // @ai-start
  /** Qariah (#846): the timing revision of a cached surah, or null when it is not cached. */
  async getCachedRevision(
    rewayatId: string,
    surahNumber: number,
  ): Promise<number | null> {
    if (!this.db) throw new Error('Timestamps database not initialized');

    const row = await this.db.getFirstAsync<{rev: number}>(
      `SELECT rev FROM cached_surahs WHERE rewayat_id = ? AND surah_number = ? LIMIT 1`,
      [rewayatId, surahNumber],
    );

    return row ? row.rev : null;
  }

  /**
   * Qariah (#847): true when a build that keeps the word times wrote the
   * cached surah (see wordTimesCache.ts); false for a row of an older build
   * and when the surah is not cached.
   */
  async keepsWordTimes(
    rewayatId: string,
    surahNumber: number,
  ): Promise<boolean> {
    if (!this.db) throw new Error('Timestamps database not initialized');

    const row = await this.db.getFirstAsync<{word_times: number}>(
      `SELECT word_times FROM cached_surahs WHERE rewayat_id = ? AND surah_number = ? LIMIT 1`,
      [rewayatId, surahNumber],
    );

    return row?.word_times === 1;
  }
  // @ai-end

  async writeTimestamps(
    rewayatId: string,
    surahNumber: number,
    timestamps: AyahTimestamp[],
    source: TimestampSource,
    rev = 0, // @ai Qariah (#846): the timing revision of this file
  ): Promise<void> {
    if (!this.db) throw new Error('Timestamps database not initialized');

    await this.db.withTransactionAsync(async () => {
      // Delete any existing data for this surah (in case of re-fetch)
      await this.db!.runAsync(
        `DELETE FROM ayah_timestamps WHERE rewayat_id = ? AND surah_number = ?`,
        [rewayatId, surahNumber],
      );

      // Insert all ayah timestamps
      for (const t of timestamps) {
        // @ai-start
        // Qariah (#847): with the word times of the ayah (NULL for none).
        await this.db!.runAsync(
          `INSERT INTO ayah_timestamps (rewayat_id, surah_number, ayah_number, timestamp_from, timestamp_to, duration_ms, segments)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            rewayatId,
            surahNumber,
            t.ayahNumber,
            t.timestampFrom,
            t.timestampTo,
            t.durationMs,
            segmentsColumn(t),
          ],
        );
        // @ai-end
      }

      // Mark surah as cached
      // @ai-start
      // Qariah (#847): word_times 1, this build keeps the word times (0 for
      // the test file of a test build: a later build fetches the real file).
      await this.db!.runAsync(
        `INSERT OR REPLACE INTO cached_surahs (rewayat_id, surah_number, source, fetched_at, rev, word_times)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          rewayatId,
          surahNumber,
          source,
          Date.now(),
          rev,
          isWordTimesTestFile(timestamps) ? 0 : 1,
        ],
      );
      // @ai-end
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
    }
  }
}

export const timestampDatabaseService = new TimestampDatabaseService();
