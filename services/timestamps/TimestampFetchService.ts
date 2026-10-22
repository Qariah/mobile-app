import branding from '@/config/branding';
import {RECITERS, type Rewayat} from '@/data/reciterData';
import {timestampDatabaseService} from './TimestampDatabaseService';
import {getBundledTimings, hasBundledTimings} from '@/assets/data/timings';
import type {AyahTimestamp} from '@/types/timestamps';

// RFC-015 — fork-supplied timestamp CDN base. Absent from `branding.js`
// → fallback to Bayaan's production CDN (byte-equivalent to the
// pre-RFC-015 hardcoded value). Forks set `branding.timestampCdnBase`
// to their own mirror's base. The URL is composed below as
// `${R2_BASE}/${rewayatId}/${paddedSurah}.json`.
//
// The JSDoc on `branding.timestampCdnBase` documents "no trailing
// slash", but a fork typo (`'https://cdn.myfork.com/timestamps/'`)
// would compose `…/timestamps//rewayat-id/001.json` and silently 404
// every lookup against R2 / most CDNs that don't normalize doubled
// slashes. Strip a trailing slash defensively so the runtime matches
// the contract regardless of the fork-side value.
const R2_BASE = (
  branding.timestampCdnBase ?? 'https://cdn.thebayaan.com/timestamps'
).replace(/\/+$/, '');

// Minimal per-element shape check for the fetched JSON. The cast
// `as AyahTimestamp[]` existed pre-RFC, but this RFC widens the set
// of CDN operators to fork maintainers — a structurally wrong JSON
// (snake-cased fields from a raw mp3quran upload, an old shape
// without `durationMs`, etc.) would land `undefined` in the SQLite
// `duration_ms` column and corrupt the ayah-highlight offsets.
// Cheap first-element probe is enough to catch the obvious cases
// without pulling in a runtime validator.
function isAyahTimestampShape(x: unknown): x is AyahTimestamp {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.surahNumber === 'number' &&
    typeof o.ayahNumber === 'number' &&
    typeof o.timestampFrom === 'number' &&
    typeof o.timestampTo === 'number' &&
    typeof o.durationMs === 'number'
  );
}

class TimestampFetchService {
  /**
   * Returns true if a rewayat has any timestamp coverage from EITHER
   * R2 (`has_timestamps` flag set by the upstream mirror script) OR
   * bundled `'local'` timings (`assets/data/timings/index.ts` —
   * Sprint 8 S8.6, Qariah's pre-Bayaan-PR-#278 divergence).
   *
   * The local source was dropped by Sprint 26 S26.0's wholesale absorption
   * of upstream PR #278; restored here to keep TECH_DEBT #36 RESOLVED for
   * Zaynab Talha (and any other bundled-timing reciter we add later).
   */
  hasSource(rewayatId: string): boolean {
    if (hasBundledTimings(rewayatId)) return true;
    const rw = this.findRewayat(rewayatId);
    return Boolean(rw?.has_timestamps);
  }

  /**
   * Returns true if either bundled timings cover this surah, or R2 has
   * coverage. Bundled check wins (zero-network, instant).
   */
  hasSurah(rewayatId: string, surahNumber: number): boolean {
    const bundled = getBundledTimings(rewayatId, surahNumber);
    if (bundled && bundled.length > 0) return true;

    const rw = this.findRewayat(rewayatId);
    if (!rw?.has_timestamps) return false;
    if (!rw.timestamps_surah_list || rw.timestamps_surah_list.length === 0) {
      return true;
    }
    return rw.timestamps_surah_list.includes(surahNumber);
  }

  async fetchAndCache(
    rewayatId: string,
    surahNumber: number,
  ): Promise<AyahTimestamp[] | null> {
    // Prefer bundled `'local'` timings (Sprint 8 source — Qariah-only).
    // Pre-Sprint-26 contract: when local data exists, use it directly +
    // write into the SQLite cache as source `'local'` so subsequent
    // reads short-circuit at TimestampService's SQLite step. No network.
    const bundled = getBundledTimings(rewayatId, surahNumber);
    if (bundled && bundled.length > 0) {
      await timestampDatabaseService.writeTimestamps(
        rewayatId,
        surahNumber,
        bundled,
        'local',
      );
      return bundled;
    }

    if (!this.hasSurah(rewayatId, surahNumber)) return null;

    const padded = String(surahNumber).padStart(3, '0');
    const url = `${R2_BASE}/${rewayatId}/${padded}.json`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(
          `[TimestampFetch] R2 ${res.status} for ${rewayatId} surah ${surahNumber}`,
        );
        return null;
      }
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw) || raw.length === 0) return null;
      if (!isAyahTimestampShape(raw[0])) {
        console.warn(
          `[TimestampFetch] Unexpected JSON shape for ${rewayatId} surah ${surahNumber}; skipping`,
        );
        return null;
      }
      const data = raw as AyahTimestamp[];

      await timestampDatabaseService.writeTimestamps(
        rewayatId,
        surahNumber,
        data,
        'r2',
      );

      return data;
    } catch (error) {
      console.warn(
        `[TimestampFetch] Failed to fetch ${rewayatId} surah ${surahNumber}:`,
        error,
      );
      return null;
    }
  }

  private findRewayat(rewayatId: string): Rewayat | undefined {
    for (const reciter of RECITERS) {
      const rw = reciter.rewayat.find(r => r.id === rewayatId);
      if (rw) return rw;
    }
    return undefined;
  }
}

export const timestampFetchService = new TimestampFetchService();
