// @ai-generated
// Qariah: Arabic reciter names for places that know only a reciter id
// (Sprint 47, Pass C, Tier-2 fix).
//
// Upstream's `getReciterDisplayName` (i18n/format.ts) finds an Arabic name in
// the reciter object (`name_arabic`), then in its bundled
// data/reciterNamesAr.json by id or by English name. A queued track carries
// only `reciterId` and `artist`, so `getTrackArtistDisplay` passes
// `{id, name}`. Qariah's reciters are not in the bundled file: their Arabic
// names are the catalog's `name_arabic` (assets/data/catalog.json and the live
// R2 copy), which lives in the in-memory `RECITERS` array. Without this
// lookup, the mini player, the full player and the lock screen showed the
// English name in Arabic.
import {RECITERS, getRecitersVersion} from '@/data/reciterData';

let cachedVersion = -1;
let cachedLength = -1;
let namesById = new Map<string, string>();
let reciterIdByRewayat = new Map<string, string>();

function refresh(): void {
  const version = getRecitersVersion();
  if (version === cachedVersion && RECITERS.length === cachedLength) return;
  namesById = new Map();
  reciterIdByRewayat = new Map();
  for (const reciter of RECITERS) {
    const arabic = reciter.name_arabic?.trim();
    if (arabic) {
      namesById.set(reciter.id, arabic);
    }
    for (const rewayah of reciter.rewayat ?? []) {
      reciterIdByRewayat.set(rewayah.id, reciter.id);
    }
  }
  cachedVersion = version;
  cachedLength = RECITERS.length;
}

/** The catalog's `name_arabic` for a reciter id, or null. */
export function getCatalogArabicReciterName(id: string): string | null {
  refresh();
  return namesById.get(id) ?? null;
}

/**
 * The reciter id of a catalog recitation (`rewayat[].id`), or null. The Mushaf
 * player keeps only the recitation id and the English name (TECH_DEBT #311).
 */
export function getReciterIdForRewayat(rewayatId: string): string | null {
  refresh();
  return reciterIdByRewayat.get(rewayatId) ?? null;
}
