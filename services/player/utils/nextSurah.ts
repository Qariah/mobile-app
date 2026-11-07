// @ai-generated
// Qariah (GitHub #557): the surah that plays when the queue ends. A pure
// function with no store import, so Jest can test it without expo-audio. The
// store binding is `queueNextSurah.ts`.

/**
 * The next surah after `currentSurah` that the rewayah has and that the queue
 * does not hold yet, or null after the rewayah's last surah.
 *
 * - A surah that is not in `available` (the rewayah's `surah_list`) is skipped.
 * - A surah in `queued` is skipped: the queue already played it. Without this,
 *   a queue that wraps (the reciter profile queues surah 78 to 114, then 1 to
 *   77) would play 78 to 114 again after 77.
 * - The order of `available` does not matter; null and non-integer entries
 *   are ignored.
 */
export function nextSurahId(
  currentSurah: number,
  available: readonly (number | null)[],
  queued: ReadonlySet<number> = new Set(),
): number | null {
  let next: number | null = null;
  for (const id of available) {
    if (typeof id !== 'number' || !Number.isInteger(id)) continue;
    if (id <= currentSurah || queued.has(id)) continue;
    if (next === null || id < next) next = id;
  }
  return next;
}

/**
 * True when the queue's surahs, in queue order, are a run of the rewayah's
 * surahs: each one is the next surah that the rewayah has after the one before
 * it, or the rewayah's first surah after its last one (the reciter profile
 * queues surah 78 to 114, then 1 to 77). A single surah is a run. A playlist of
 * one reciter (36, 55, 56, 67), a sorted or a filtered list is not.
 */
export function isSurahRun(
  queueSurahs: readonly number[],
  available: readonly (number | null)[],
): boolean {
  const first = nextSurahId(0, available);
  for (let i = 1; i < queueSurahs.length; i++) {
    const expected = nextSurahId(queueSurahs[i - 1], available) ?? first;
    if (queueSurahs[i] !== expected) return false;
  }
  return true;
}
