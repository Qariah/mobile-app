// @ai-generated
// Qariah (Sprint 20): the per-surah metadata of a partial recitation
// (`surah_metadata`, Qariah's catalog schema). Upstream Bayaan's catalog has
// no partial recitations, so these helpers live outside services/dataService.ts.
import {RECITERS, Rewayat, SurahMetadata} from '@/data/reciterData';
import i18n from '@/i18n';

/**
 * The `surah_metadata` entry of one surah for a reciter and rewayah, or
 * `undefined`. A sync read of the in-memory RECITERS array (populated after
 * the first catalog load). With no `rewayatId`, it reads the first rewayah.
 */
export function getSurahMetadataSync(
  reciterId: string,
  rewayatId: string | undefined,
  surahId: number,
): SurahMetadata | undefined {
  const reciter = RECITERS.find(r => r.id === reciterId);
  if (!reciter) return undefined;
  const rewayat = rewayatId
    ? reciter.rewayat.find(rw => rw.id === rewayatId)
    : reciter.rewayat[0];
  return rewayat?.surah_metadata?.find(sm => sm.surah === surahId);
}

/**
 * The ayah range of a partial recitation ("ayah 5", "ayahs 1–7"), translated
 * when it is called, never at module load.
 */
export function formatAyahRange(metadata: SurahMetadata): string | undefined {
  if (metadata.is_full || !metadata.range) return undefined;
  const {from, to} = metadata.range;
  return from === to
    ? i18n.t('qariah:ayahRange.single', {from})
    : i18n.t('qariah:ayahRange.range', {from, to});
}

/**
 * True when a rewayah has only part of a surah (`is_full: false`). A missing
 * `surah_metadata` entry means the complete surah.
 */
export function isPartialRecitation(
  rewaya: Pick<Rewayat, 'surah_metadata'>,
  surahId: number,
): boolean {
  // Guard bad catalog data (a non-array, a null entry): this runs for every row.
  const meta = Array.isArray(rewaya.surah_metadata)
    ? rewaya.surah_metadata
    : undefined;
  return meta?.find(sm => sm?.surah === surahId)?.is_full === false;
}

/**
 * The recitation rows of one surah, the complete recitations first and then
 * the partial ones (#532). Each group keeps the order of `rows`.
 */
export function completeRecitationsFirst<
  T extends {rewaya: Pick<Rewayat, 'surah_metadata'>},
>(rows: readonly T[], surahId: number): T[] {
  const complete: T[] = [];
  const partial: T[] = [];
  for (const row of rows) {
    (isPartialRecitation(row.rewaya, surahId) ? partial : complete).push(row);
  }
  return [...complete, ...partial];
}
