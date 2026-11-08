import type {Reciter, Rewayat} from '@/data/reciterData';

/**
 * True when `rewayat` has a recording of `surahId`. A rewayah with no
 * `surah_list` counts as complete, as `getAvailableSurahs` reads it.
 */
export function rewayatHasSurah(
  rewayat: Pick<Rewayat, 'surah_list'>,
  surahId: number,
): boolean {
  const list = rewayat.surah_list as (number | null)[] | undefined;
  if (!list) return true;
  return list.includes(surahId);
}

/**
 * The rewayah of `reciter` that plays `surahId`.
 *
 * Takes the rewayah with `preferredId` when it has the surah, else the first
 * rewayah (in catalog order) that has it, else undefined. A deep link such as
 * `/reciter/<slug>/<surah>` names no rewayah, and a reciter's first rewayah
 * need not have every surah, so the caller must not fall back to
 * `reciter.rewayat[0]` on its own.
 */
export function findRewayatForSurah(
  reciter: Pick<Reciter, 'rewayat'>,
  surahId: number,
  preferredId?: string,
): Rewayat | undefined {
  const preferred = preferredId
    ? reciter.rewayat.find(r => r.id === preferredId)
    : undefined;
  if (preferred && rewayatHasSurah(preferred, surahId)) return preferred;
  return reciter.rewayat.find(r => rewayatHasSurah(r, surahId));
}
