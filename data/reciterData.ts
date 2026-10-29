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
  /** Sum of `rewayat[].surah_total`. Older catalogs and API responses do not carry it. */
  recitationsCount?: number | null;
  /** Country or region of the reciter. It drives the "Browse by Country" home row. */
  country?: string | null;
  /** Short English bio. qariah-ops-console writes it to the catalog. */
  bio_en?: string | null;
  /** Arabic name (upstream field), shown by `getReciterDisplayName` in Arabic. */
  name_arabic?: string | null;
  /** Arabic bio (Qariah field), shown instead of `bio_en` in Arabic (`getReciterBio`). */
  bio_ar?: string | null;
  /** Translation tag (for example "English"). */
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
  /** Per-surah completeness. A missing entry means `is_full: true`. Audio paths: `utils/recitationAudioUrl.ts`. */
  surah_metadata?: SurahMetadata[];
  has_timestamps?: boolean;
  timestamps_surah_list?: number[];
  /** Arabic rewayah name from qariah-ops-console; the last fallback of `getCatalogRewayahLabel`. */
  name_ar?: string | null;
}

export interface SurahMetadata {
  surah: number;
  is_full: boolean;
  range?: {from: number; to: number};
  // `YYYY-MM-DD` (UTC) when this recitation first appeared in the catalog. Missing means "unknown".
  added_at?: string;
  // 'suffixed': a partial at `{server}/{surah-padded}-{from}-{to}.mp3` (needs `is_full: false` and `range`).
  audio_path?: 'suffixed';
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
// Qariah: subscribers re-render on each in-place refill of `RECITERS` (`isInitialized` changes only once).
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
