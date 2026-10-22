// @ai-generated
// Qariah (Sprint 48): the cards of the "Newly Added" Listen row.
import {
  getNewlyAddedRecitations,
  newlyAddedCutoff,
  type NewlyAddedRecitation,
} from '@/data/reciterCollections';
import type {Reciter} from '@/data/reciterData';

/** The row shows the recitations of the last 30 days… */
export const NEWLY_ADDED_WINDOW_DAYS = 30;

/** …but at least this many cards, with older recitations when needed… */
export const NEWLY_ADDED_MIN_CARDS = 10;

/** …and at most this many cards. */
export const NEWLY_ADDED_ROW_LIMIT = 20;

/**
 * The most cards for one reciter. One new reciter with many surahs must not
 * fill the row (tester feedback #555 asked for mixed reciters).
 */
export const NEWLY_ADDED_PER_RECITER = 3;

export interface NewlyAddedRowOptions {
  now?: Date;
  windowDays?: number;
  minCount?: number;
  limit?: number;
  perReciter?: number;
}

/**
 * Picks the cards from the FULL list of dated recitations, newest first (as
 * `getNewlyAddedRecitations` sorts them). It walks the list in order and
 * skips a recitation when its reciter already has `perReciter` cards, so an
 * older recitation of another reciter takes the place of each skipped one.
 * Of the kept recitations it takes those inside the window (the same UTC
 * cutoff as `getNewlyAddedRecitations`), at least `minCount` (the next older
 * ones fill up to it) and at most `limit`. The order does not change.
 */
export function selectNewlyAddedRow(
  recitations: readonly NewlyAddedRecitation[],
  {
    now = new Date(),
    windowDays = NEWLY_ADDED_WINDOW_DAYS,
    minCount = NEWLY_ADDED_MIN_CARDS,
    limit = NEWLY_ADDED_ROW_LIMIT,
    perReciter = NEWLY_ADDED_PER_RECITER,
  }: NewlyAddedRowOptions = {},
): NewlyAddedRecitation[] {
  const kept: NewlyAddedRecitation[] = [];
  const perReciterCount = new Map<string, number>();
  for (const recitation of recitations) {
    if (kept.length >= limit) break;
    const count = perReciterCount.get(recitation.reciter.id) ?? 0;
    if (count >= perReciter) continue;
    perReciterCount.set(recitation.reciter.id, count + 1);
    kept.push(recitation);
  }

  const cutoff = newlyAddedCutoff(now, windowDays);
  // `kept` is newest first, so the recitations inside the window are a prefix.
  const inWindow =
    cutoff === null ? 0 : kept.filter(r => r.addedAt >= cutoff).length;
  return kept.slice(0, Math.min(limit, Math.max(inWindow, minCount)));
}

/**
 * The cards of the row: every dated recitation of the catalog (no window and
 * no fill in `getNewlyAddedRecitations`), then `selectNewlyAddedRow`.
 * `reciters` defaults to `RECITERS`.
 */
export function getNewlyAddedRow(
  options: NewlyAddedRowOptions & {reciters?: Reciter[]} = {},
): NewlyAddedRecitation[] {
  const {reciters, ...rowOptions} = options;
  const all = getNewlyAddedRecitations({
    windowDays: 0,
    minCount: Number.MAX_SAFE_INTEGER,
    ...(rowOptions.now ? {now: rowOptions.now} : {}),
    ...(reciters ? {reciters} : {}),
  });
  return selectNewlyAddedRow(all, rowOptions);
}

/** A stable key for one recitation. */
export function newlyAddedRecitationKey(recitation: NewlyAddedRecitation) {
  return `${recitation.reciter.id}|${recitation.rewayah.id}|${recitation.surah}`;
}
