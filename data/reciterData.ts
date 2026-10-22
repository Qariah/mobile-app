// Reciter data is no longer bundled — it is fetched from the Bayaan API
// at runtime and stored in AsyncStorage. RECITERS starts as an empty array
// and is populated in-place by dataService.getAllReciters() on first load.
// All importers hold a reference to the same array object, so they see
// the data automatically once it is populated — no import changes needed.

export interface Reciter {
  id: string;
  name: string;
  slug?: string | null;
  date: string | null;
  image_url: string | null;
  rewayat: Rewayat[];
  /**
   * Sprint 6 — total post-filter recitations across all rewayat
   * (sum of `rewayat[].surah_total`). Optional + nullable for back-compat
   * with catalog snapshots predating Sprint 6 + Bayaan API responses
   * that don't carry it.
   */
  recitationsCount?: number | null;
  /**
   * Sprint 8 — country / region of the reciter (e.g. "Egypt", "Saudi
   * Arabia", "Morocco"). Optional + nullable for back-compat with catalog
   * snapshots predating Sprint 8. Source-of-truth lives in
   * `planning/reciter-bios-template.csv`; gets baked into `catalog.json`
   * via `scripts/generate-catalog.mjs`. Drives the "Browse by Country" home
   * row (the `country` entry in `branding.homeRowConfig`).
   */
  country?: string | null;
  /**
   * Sprint 14 — short English bio (2–3 sentences). Source-of-truth lives
   * in `planning/reciter-bios-template.csv` (combined with the country
   * + paradise/honored CSV in Sprint 14). Written into `catalog.json` by
   * `scripts/apply-reciter-metadata.ts`. Currently NOT rendered in the
   * `ReciterProfile` UI — that ships in Sprint 15+ once we settle the
   * placement and i18n model.
   */
  bio_en?: string | null;
  /**
   * Sprint 47 (Pass C) — the Arabic name. Upstream's field:
   * `getReciterDisplayName` (i18n/format.ts) shows it when the app language
   * shows Arabic names. Written into the catalog from the review pack by
   * `scripts/catalog-arabic-names.mjs`.
   */
  name_arabic?: string | null;
  /**
   * Sprint 47 (Pass C) — the Arabic bio, a Qariah field. The reciter header
   * shows it instead of `bio_en` in Arabic (`getReciterBio`,
   * i18n/qariahCatalog.ts). Written by `scripts/catalog-arabic-names.mjs`.
   */
  bio_ar?: string | null;
  /**
   * Sprint 14 — translation tag (e.g. "English", "French"). Empty for
   * the entire catalog as of Sprint 14 — the column is a placeholder
   * for a future curation pass. When populated, drives the
   * `getRecitersByTranslation` selector and a future Listen-tab row.
   */
  translation?: string | null;
}

export interface Rewayat {
  id: string;
  reciter_id: string;
  name: string; // e.g., "Hafs A'n Assem"
  style: string; // 'murattal', 'mojawwad', 'molim' (with optional number for duplicates)
  server: string;
  surah_total: number;
  surah_list: (number | null)[];
  source_type: string;
  created_at: string;
  mp3quran_read_id?: number;
  qdc_reciter_id?: number;
  /**
   * Sprint 19 — per-surah completeness metadata backfilled from v1 Qariah.
   * `is_full: true` means the audio file is the complete surah.
   * `is_full: false` means the file is a partial recording covering
   * `range.from..range.to` (inclusive). Optional + only present for surahs
   * that have v1 data; absent entries default to `is_full: true` for
   * back-compat with pre-Sprint-19 catalog snapshots.
   *
   * Storage path today is `{server}/{surah-padded}.mp3` for BOTH full and
   * partial recordings (legacy v1-migration convention — all 326 partial
   * rows live at the unsuffixed path, verified by
   * `scripts/audit-partial-audio-paths.mjs` 2026-05-18). A future
   * `audio_path?: 'suffixed'` flag on `SurahMetadata` will distinguish
   * recordings uploaded by the Sprint-19+ ops console at the suffixed
   * path `{server}/{surah-padded}-{from}-{to}.mp3`. See TECH_DEBT #70 for
   * the staged migration trigger.
   */
  surah_metadata?: SurahMetadata[];
  /**
   * Sprint 26 — upstream PR #278 (`feat(timestamps): switch follow-along to
   * R2 + mirror scripts + 2 new reciters`). Catalog-level signals that
   * timestamp data exists for this rewaya; the timestamp service
   * (`services/timestamps/TimestampFetchService.ts`) reads them when
   * deciding whether to attempt an R2 fetch.
   */
  has_timestamps?: boolean;
  timestamps_surah_list?: number[];
  /**
   * Qariah — the Arabic rewayah name that qariah-ops-console writes on the
   * rewayat it creates. `getCatalogRewayahLabel` (i18n/qariahCatalog.ts)
   * uses it in Arabic when neither the review pack nor upstream knows the
   * catalog name.
   */
  name_ar?: string | null;
}

export interface SurahMetadata {
  surah: number;
  is_full: boolean;
  range?: {from: number; to: number};
  // Qariah (Sprint 48): `YYYY-MM-DD` (UTC date) when this recitation first
  // appeared in the catalog. The ops console and the Sprint 48 backfill
  // (`scripts/catalog-added-at.mjs`) write it. Treat a missing value as "unknown".
  added_at?: string;
}

// Mutable array — populated in-place by dataService after API fetch.
// Do NOT reassign this variable; mutate it with splice() to preserve references.
export const RECITERS: Reciter[] = [];

// @ai-start
// Bumped whenever RECITERS is repopulated, so caches derived from it (the
// search index) rebuild even when a refresh keeps the same length and ids.
let recitersVersion = 0;

export function markRecitersUpdated(): void {
  recitersVersion += 1;
  notifyRecitersUpdated(); // Qariah (Sprint 48)
}

export function getRecitersVersion(): number {
  return recitersVersion;
}
// @ai-end

// @ai-start
// Qariah (Sprint 48): a subscriber list on the version above, so a component
// can re-render when `RECITERS` is filled again. `populateReciters` refills
// the array in place on each catalog load (cache, bundled seed, background
// refresh, version poll), and `isInitialized` changes only on the first one.
// Read it with `useRecitersVersion` (hooks/useRecitersVersion.ts).
const recitersListeners = new Set<() => void>();

export function subscribeRecitersUpdated(listener: () => void): () => void {
  recitersListeners.add(listener);
  return () => {
    recitersListeners.delete(listener);
  };
}

function notifyRecitersUpdated(): void {
  for (const listener of [...recitersListeners]) {
    listener();
  }
}
// @ai-end
