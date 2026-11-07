// @ai-generated
// Qariah: the reciter collections of the Qariah Listen rows (Sprint 13, 14,
// 48). They lived at the end of the inherited `data/reciterCollections.ts`;
// that file is now byte-identical to upstream Bayaan.
// Edit `HONORED_RECITER_NAMES` and `PARADISE_RECITER_NAMES` here by hand (the
// Sprint 14 CSV script that rewrote them is deleted; git history keeps it).
import {RECITERS, Reciter, Rewayat, SurahMetadata} from './reciterData';

/** Copy of the private helper in `data/reciterCollections.ts` (upstream). */
function normalizeReciterName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove special characters and spaces
    .trim();
}

/** Copy of the private helper in `data/reciterCollections.ts` (upstream). */
function findReciterByName(name: string): Reciter | undefined {
  const normalizedName = normalizeReciterName(name);
  return RECITERS.find(
    reciter => normalizeReciterName(reciter.name) === normalizedName,
  );
}

/**
 * Sprint 13 — Honored Reciters collection. Filled via the reciter metadata
 * CSV at `planning/reciter-metadata.csv` (column: `honored=true`).
 * Starts empty.
 */
const HONORED_RECITER_NAMES: string[] = [
  "Bara'a Mahfouz",
  'Ruwaida Shabaan Khamis',
  'Sondos Abu Jaish',
  'Iman Saeed',
  'Rawan Dwaik',
];

/**
 * Sprint 13 — Paradise Reciters collection. Same pattern as Honored.
 */
const PARADISE_RECITER_NAMES: string[] = [
  'Munira Abduh رحمها الله (~1920s)',
  'Sakina Hassan رحمها الله (~1920s)',
  'Layla Hasan رحمها الله (~1980s)',
  'Shaykha Mabrooka رحمها الله  (~1910s)',
  'Zahiyya Sharkas رحمها الله (~2010s)',
  'Wadouda Badr رحمها الله (~1920s)',
  'Anwar Mansour رحمها الله (~2010s)',
  'Wadouda AlManialawia رحمها الله (~1920s)',
];

/**
 * Gets reciters tagged as "Honored" via the Sprint 13 curation CSV.
 * Auto-empty until curation lands; the home-row gate auto-hides on empty.
 */
export function getHonoredReciters(count?: number): Reciter[] {
  const reciters = HONORED_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets reciters tagged as "Paradise" via the Sprint 13 curation CSV.
 */
export function getParadiseReciters(count?: number): Reciter[] {
  const reciters = PARADISE_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

// @ai-start
// Qariah (Sprint 48): the "Newly added" Listen row shows recitations (one
// surah of one rewayah of one reciter), not reciters. The catalog has no hidden or archived field
// on `Reciter` or `Rewayat`: the ops console removes an archived item from the
// catalog it publishes, so there is nothing to skip here.
export interface NewlyAddedRecitation {
  reciter: Reciter;
  rewayah: Rewayat;
  surah: number;
  /** Set for a partial recording (`is_full: false`); passed through from the catalog row. */
  range?: {from: number; to: number};
  /** `YYYY-MM-DD`, a UTC date. */
  addedAt: string;
}

const ADDED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The first UTC date (`YYYY-MM-DD`) inside a window of `windowDays` days
 * that ends at `now`: a recitation is inside when `addedAt >= cutoff`
 * (compared as strings; future dates count as inside). Returns null for an
 * empty window: an invalid `now`, or a `windowDays` so large that the cutoff
 * is outside the range of a `Date` (for example 1e12). `toISOString` throws
 * on an Invalid Date, so the `Date` is tested first.
 */
export function newlyAddedCutoff(now: Date, windowDays: number): string | null {
  const cutoffDate = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(cutoffDate.getTime())) return null;
  return cutoffDate.toISOString().slice(0, 10);
}

/**
 * The newest recitations, newest first (ties: reciter name A→Z, then rewayah
 * id, then surah number).
 *
 * Walks the LISTED surahs of each rewayah (`surah_list`) and looks up the
 * `surah_metadata` row of each one. The ops console can leave a dated row
 * behind for a surah that is no longer listed, so a row alone never makes a
 * recitation. A listed surah with no row, or a row with no valid `added_at`,
 * has no date and is skipped.
 *
 * Returns every recitation with `addedAt` within the last `windowDays` days
 * (UTC dates, compared as strings). When the window holds fewer than
 * `minCount`, the next newest recitations fill the list up to `minCount`.
 * Pure: it reads `RECITERS` only when `reciters` is not given.
 */
export function getNewlyAddedRecitations(
  options: {
    windowDays?: number;
    minCount?: number;
    now?: Date;
    reciters?: Reciter[];
  } = {},
): NewlyAddedRecitation[] {
  const {
    windowDays = 30,
    minCount = 10,
    now = new Date(),
    reciters = RECITERS,
  } = options;

  const found: NewlyAddedRecitation[] = [];
  const seen = new Set<string>();
  for (const reciter of reciters) {
    for (const rewayah of reciter.rewayat ?? []) {
      // The first dated row of each surah wins.
      const datedRows = new Map<number, SurahMetadata>();
      for (const row of rewayah.surah_metadata ?? []) {
        if (
          typeof row?.added_at === 'string' &&
          ADDED_AT_PATTERN.test(row.added_at) &&
          !datedRows.has(row.surah)
        ) {
          datedRows.set(row.surah, row);
        }
      }
      for (const surah of rewayah.surah_list ?? []) {
        if (typeof surah !== 'number' || !Number.isInteger(surah)) continue;
        const key = `${reciter.id}|${rewayah.id}|${surah}`;
        if (seen.has(key)) continue;
        const row = datedRows.get(surah);
        if (!row?.added_at) continue;
        seen.add(key);
        found.push({
          reciter,
          rewayah,
          surah,
          ...(row.range ? {range: row.range} : {}),
          addedAt: row.added_at,
        });
      }
    }
  }

  // Plain comparisons, not `localeCompare`: the order must not depend on the
  // ICU data of the JS engine.
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  found.sort(
    (a, b) =>
      compare(b.addedAt, a.addedAt) ||
      compare(a.reciter.name, b.reciter.name) ||
      compare(a.rewayah.id, b.rewayah.id) ||
      a.surah - b.surah,
  );

  const cutoff = newlyAddedCutoff(now, windowDays);
  const inWindow =
    cutoff === null ? 0 : found.filter(r => r.addedAt >= cutoff).length;
  // `found` is newest first, so the recitations in the window are a prefix.
  return found.slice(0, Math.max(inWindow, minCount));
}
// @ai-end

/**
 * Sprint 13 — "Full Recording" Listen-tab row.
 * Reciters with at least one rewayat that covers all 114 surahs
 * (counted as `surah_list.filter(s => s != null).length === 114`).
 * In today's catalog: Hajjah Maria Ulfah and Zaynab Talha.
 */
export function getFullRecordingReciters(count?: number): Reciter[] {
  const reciters = RECITERS.filter(r =>
    (r.rewayat || []).some(rw => {
      const surahs = (rw.surah_list || []).filter(s => s != null);
      return surahs.length === 114;
    }),
  );
  return count ? reciters.slice(0, count) : reciters;
}
