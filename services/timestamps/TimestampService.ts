import {timestampDatabaseService} from './TimestampDatabaseService';
import {timestampFetchService} from './TimestampFetchService';
import type {AyahTimestamp} from '@/types/timestamps';
import {isWordTimesTestSurah} from '@/assets/data/timings/wordTimesTest'; // @ai Qariah (#847)

class TimestampService {
  // @ai Qariah (#846): each entry keeps the timing revision of its file.
  private cache = new Map<string, {rev: number; timestamps: AyahTimestamp[]}>();

  async initialize(): Promise<void> {
    await timestampDatabaseService.initialize();
  }

  /**
   * Check if a rewayat has timestamp support (static check, no network).
   */
  hasTimestampSource(rewayatId: string): boolean {
    return timestampFetchService.hasSource(rewayatId);
  }

  /**
   * Get timestamps for a surah. Checks:
   * 1. In-memory cache (instant)
   * 2. SQLite cache (fast, ~1ms)
   * 3. API fetch + cache (network, ~200ms)
   */
  async getTimestampsForSurah(
    rewayatId: string,
    surahNumber: number,
  ): Promise<AyahTimestamp[] | null> {
    const key = `${rewayatId}-${surahNumber}`;
    // @ai-start
    // Qariah (#846): a cached file is current when its revision is the
    // catalog's revision. With no catalog row (null), any revision is current.
    const wanted = timestampFetchService.revision(rewayatId, surahNumber);
    const isCurrent = (rev: number) => wanted === null || rev === wanted;
    // @ai-end

    // 1. In-memory cache
    const cached = this.cache.get(key);
    if (cached && isCurrent(cached.rev)) return cached.timestamps; // @ai

    try {
      // 2. SQLite cache
      // @ai-start
      const cachedRev = await timestampDatabaseService.getCachedRevision(
        rewayatId,
        surahNumber,
      );
      // Qariah (#847): an older build dropped the word times of the file it
      // cached. While the catalog covers the surah, fetch it once again (the
      // new row keeps them); with no network the cached file is shown below.
      // A test build always loads its test surah again (wordTimesTest.ts).
      const wordTimesDue =
        (cachedRev !== null &&
          !(await timestampDatabaseService.keepsWordTimes(
            rewayatId,
            surahNumber,
          )) &&
          timestampFetchService.hasSurah(rewayatId, surahNumber)) ||
        isWordTimesTestSurah(rewayatId, surahNumber);
      if (cachedRev !== null && isCurrent(cachedRev) && !wordTimesDue) {
        const dbTimestamps =
          await timestampDatabaseService.getTimestampsForSurah(
            rewayatId,
            surahNumber,
          );

        if (dbTimestamps.length > 0) {
          this.cache.set(key, {rev: cachedRev, timestamps: dbTimestamps});
          return dbTimestamps;
        }
      }
      // @ai-end

      // 3. Fetch from API and cache
      const fetched = await timestampFetchService.fetchAndCache(
        rewayatId,
        surahNumber,
      );

      if (fetched) {
        this.cache.set(key, {rev: wanted ?? 0, timestamps: fetched}); // @ai
        return fetched;
      }

      // @ai-start
      // Qariah (#846): the file of the new revision did not arrive (no
      // network, a server error). While the catalog still covers the surah,
      // the older file is better than none. It does not go into the memory
      // cache, so the next call tries the fetch again.
      if (
        cachedRev !== null &&
        timestampFetchService.hasSurah(rewayatId, surahNumber)
      ) {
        const older = await timestampDatabaseService.getTimestampsForSurah(
          rewayatId,
          surahNumber,
        );
        if (older.length > 0) return older;
      }
      // @ai-end

      return null;
    } catch {
      return null;
    }
  }
}

export const timestampService = new TimestampService();
