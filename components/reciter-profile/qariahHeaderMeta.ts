// @ai
// Qariah (TECH_DEBT #306): the Qariah parts of the reciter header. They show
// in upstream's meta row beside the photo, so the header shows each count once.
import type {Reciter} from '@/data/reciterData';
import {getCatalogRewayahLabel} from '@/i18n/qariahCatalog';

type Rewayah = Reciter['rewayat'][number];

/**
 * The recitation count for upstream's meta row, or null when the row must not
 * show it. Upstream's row already shows the surah count, and the catalog's
 * recitation count is equal to it for every reciter (68 of 68 on 2026-10-19).
 * So the row adds the recitation count only when the two counts differ.
 */
export function qariahRecitationsCount(
  recitationsCount: number | null | undefined,
  surahCount: number,
): number | null {
  if (recitationsCount == null || recitationsCount <= 0) return null;
  return recitationsCount === surahCount ? null : recitationsCount;
}

/**
 * The narration names under upstream's counts, or null for a reciter with one
 * narration (upstream's row already says "1 rewayah").
 */
export function qariahNarrationLine(
  rewayat: readonly Rewayah[],
  label: (rewayah: Rewayah) => string = r => getCatalogRewayahLabel(r),
): string | null {
  const labels = rewayat.filter(r => Boolean(r.name)).map(r => label(r));
  return labels.length > 1 ? labels.join(' · ') : null;
}
