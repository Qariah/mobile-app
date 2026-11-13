// @ai-start
/**
 * Qariah (issue #846): the timing revision of a catalog rewayah row.
 *
 * A phone keeps each timing file in SQLite and never fetches it again, and the
 * CDN serves the file as `immutable`. So when the ops console corrects a
 * published file, the catalog row carries a revision, and the app fetches the
 * file again when the revision changes:
 *
 *   "timestamps_rev": 3                 one revision for each surah of the row
 *   "timestamps_rev": {"1": 2, "36": 1}  one revision for each surah; a surah
 *                                        that is not in the object has revision 0
 *
 * An object key is the surah number in decimal, with no leading zero. A
 * revision is an integer of 0 or more. A missing field, `null`, or a value of
 * a different type is revision 0. Revision 0 is the behavior before the field
 * existed: the URL keeps `?v=2`, and a cached file stays valid.
 */
import type {Rewayat} from '@/data/reciterData';
import type {AyahTimestamp} from '@/types/timestamps';
import {parseWordSegments} from './wordSegments'; // Qariah (#847)

/** The catalog field `timestamps_rev`: one revision, or one for each surah. */
export type TimestampRevision = number | Record<string, number>;

function asRevision(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

/**
 * The revision of the timing file of one surah. It is `null` when the catalog
 * has no row for the rewayah (for example, the catalog is not loaded yet). The
 * caller then accepts the cached file of any revision, as before.
 */
export function timestampRevisionFor(
  rewayat: Pick<Rewayat, 'timestamps_rev'> | undefined,
  surahNumber: number,
): number | null {
  if (!rewayat) return null;
  const rev: unknown = rewayat.timestamps_rev;
  if (typeof rev === 'number') return asRevision(rev);
  if (typeof rev === 'object' && rev !== null && !Array.isArray(rev)) {
    return asRevision((rev as Record<string, unknown>)[String(surahNumber)]);
  }
  return 0;
}

/**
 * The query of a timing file URL: `v=<data version>`, then `&r=<revision>`
 * when the revision is above 0. Revision 0 gives the URL of today.
 */
export function timestampFileQuery(
  dataVersion: number,
  revision: number,
): string {
  return revision > 0 ? `v=${dataVersion}&r=${revision}` : `v=${dataVersion}`;
}

/**
 * Keeps the five fields of an ayah timing and its word times (`segments`,
 * #847: validated and sorted by start, see wordSegments.ts), and drops all
 * other keys. A published file can carry more keys; the app ignores them,
 * and it does not keep them in memory.
 */
export function toAyahTimestamp(x: AyahTimestamp): AyahTimestamp {
  const timestamp: AyahTimestamp = {
    surahNumber: x.surahNumber,
    ayahNumber: x.ayahNumber,
    timestampFrom: x.timestampFrom,
    timestampTo: x.timestampTo,
    durationMs: x.durationMs,
  };
  const segments = parseWordSegments(x.segments);
  if (segments) timestamp.segments = segments;
  return timestamp;
}
// @ai-end
