// @ai-generated
// Qariah (#847, option C): the cards of the "Follow Along" Listen row. The
// row lists recitations (a surah of a qariah), not qariahs: the upstream
// `follow-along` row of qariahs stays registered, switched off.
import {RECITERS, type Reciter, type Rewayat} from '@/data/reciterData';
import {
  listFollowAlongSurahs,
  type SurahCoverage,
} from '@/utils/followAlongCoverage';

/** The row shows only when this many qariahs have follow-along. */
export const FOLLOW_ALONG_MIN_QARIAHS = 3;

/** One card for each qariah, and at most this many cards. */
export const FOLLOW_ALONG_ROW_LIMIT = 10;

/** One card of the row: the shape of a "Newly Added Recitations" card. */
export interface FollowAlongRecitation {
  reciter: Reciter;
  rewayah: Rewayat;
  surah: number;
  /** Set for a partial recording (`is_full: false`). */
  range?: {from: number; to: number};
}

export interface FollowAlongRowOptions {
  /** The session seed. With no seed, the row keeps the catalog order. */
  seed?: number;
  minQariahs?: number;
  limit?: number;
  /** Defaults to `RECITERS`. */
  reciters?: readonly Reciter[];
}

/**
 * The seeded shuffle of `components/RecitersView.tsx` (the same generator),
 * so that the row changes once for each session, as the other rows do.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let current = seed;
  const random = () => {
    current = (current * 9301 + 49297) % 233280;
    return current / 233280;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The recitations of one qariah with follow-along, in catalog order. */
function qariahRecitations(
  reciter: Reciter,
  covers: SurahCoverage,
): {complete: FollowAlongRecitation[]; partial: FollowAlongRecitation[]} {
  const complete: FollowAlongRecitation[] = [];
  const partial: FollowAlongRecitation[] = [];
  for (const rewayah of reciter.rewayat ?? []) {
    if (!rewayah || typeof rewayah.id !== 'string') continue;
    const meta = Array.isArray(rewayah.surah_metadata)
      ? rewayah.surah_metadata
      : [];
    for (const surah of listFollowAlongSurahs(rewayah, covers)) {
      const row = meta.find(sm => sm?.surah === surah);
      if (row?.is_full === false && row.range) {
        partial.push({reciter, rewayah, surah, range: row.range});
      } else {
        complete.push({reciter, rewayah, surah});
      }
    }
  }
  return {complete, partial};
}

/**
 * The cards of the row:
 *
 * - Each qariah with follow-along gives one card. The card is one of her
 *   complete recitations (a partial one only when she has no complete one):
 *   the first in catalog order with no seed, else a seeded pick.
 * - With fewer than `minQariahs` qariahs, the row has no card.
 * - The cards are in catalog order with no seed, else in the seeded order of
 *   the session. Then the first `limit` cards.
 */
export function selectFollowAlongRecitations(
  covers: SurahCoverage,
  {
    seed,
    minQariahs = FOLLOW_ALONG_MIN_QARIAHS,
    limit = FOLLOW_ALONG_ROW_LIMIT,
    reciters = RECITERS,
  }: FollowAlongRowOptions = {},
): FollowAlongRecitation[] {
  const picks: FollowAlongRecitation[] = [];
  const seen = new Set<string>();
  for (const reciter of reciters ?? []) {
    if (!reciter || typeof reciter.id !== 'string' || seen.has(reciter.id)) {
      continue;
    }
    const {complete, partial} = qariahRecitations(reciter, covers);
    const pool = complete.length > 0 ? complete : partial;
    if (pool.length === 0) continue;
    seen.add(reciter.id);
    const pick =
      seed === undefined
        ? pool[0]
        : seededShuffle(pool, seed + picks.length)[0];
    picks.push(pick);
  }
  if (picks.length < minQariahs) return [];
  const ordered = seed === undefined ? picks : seededShuffle(picks, seed);
  return ordered.slice(0, Math.max(0, limit));
}

/** A stable key for one card. */
export function followAlongRecitationKey(recitation: FollowAlongRecitation) {
  return `${recitation.reciter.id}|${recitation.rewayah.id}|${recitation.surah}`;
}
