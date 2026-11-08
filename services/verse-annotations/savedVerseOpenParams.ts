// @ai-generated
// Qariah (RFC-023 step 1). Upstream candidate: the RFC's step-1 code PR
// makes a saved verse open the reader at once in Bayaan too.
import type {RewayahId} from '@/services/rewayah/RewayahIdentity';
import {
  savedVerseRouteParams,
  type SavedVerseRouteParams,
} from '@/services/verse-annotations/unitAnnotations';

/**
 * Route params of /mushaf (app/mushaf.tsx) that open a saved verse before
 * its page is known: the verse, its anchor, and the rewayah it was saved in.
 */
export type SavedVerseOpenParams = Omit<SavedVerseRouteParams, 'page'> & {
  /** The rewayah the row was saved in; absent for a legacy row. */
  rewayah?: RewayahId;
};

/**
 * Params that open a saved row with no page lookup, so that a tap does not
 * need the Mushaf data. The reader restores `rewayah` and opens the page of
 * the verse when the data is ready. `surah`, `ayah` and `anchor` follow
 * savedVerseRouteParams().
 */
export function savedVerseOpenParams(row: {
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  rewayahId?: RewayahId | null;
}): SavedVerseOpenParams {
  const {surah, ayah, anchor} = savedVerseRouteParams(row, 1);
  const params: SavedVerseOpenParams = {surah, ayah};
  if (anchor) params.anchor = anchor;
  if (row.rewayahId) params.rewayah = row.rewayahId;
  return params;
}
