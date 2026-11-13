// @ai-generated
// Qariah (#847): which surahs of a rewayah have follow-along. The "Follow
// Along" chip on a surah row and the "Follow Along" Listen row read this
// module, so that the two places cannot disagree. Pure: the player's rule
// comes in as a `SurahCoverage` function (see `hooks/useFollowAlongCoverage.ts`).
import type {Rewayat} from '@/data/reciterData';

/** True when the player can follow along this surah of this rewayah. */
export type SurahCoverage = (rewayatId: string, surah: number) => boolean;

/**
 * The listed surahs (`surah_list`, integers only) of one rewayah that
 * `covers` accepts, in list order, each surah once. A surah that the rewayah
 * does not list has no recitation, so it never counts.
 */
export function listFollowAlongSurahs(
  rewayah: Pick<Rewayat, 'id' | 'surah_list'>,
  covers: SurahCoverage,
): number[] {
  if (!rewayah || typeof rewayah.id !== 'string') return [];
  const list = Array.isArray(rewayah.surah_list) ? rewayah.surah_list : [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const surah of list) {
    if (typeof surah !== 'number' || !Number.isInteger(surah)) continue;
    if (seen.has(surah)) continue;
    seen.add(surah);
    if (covers(rewayah.id, surah)) out.push(surah);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The test preview (lab builds only)

/** The surahs of each rewayah that a preview adds. */
export type FollowAlongPreview = ReadonlyMap<string, ReadonlySet<number>>;

/**
 * Reads `EXPO_PUBLIC_FOLLOW_ALONG_PREVIEW`: `<rewayahId>:<surah>,<surah>`
 * entries, joined by `;`. A bad entry or a bad surah number is left out.
 */
export function parseFollowAlongPreview(
  raw: string | undefined,
): FollowAlongPreview {
  const out = new Map<string, Set<number>>();
  if (!raw) return out;
  for (const entry of raw.split(';')) {
    const [id, surahs] = entry.split(':');
    const rewayatId = id?.trim();
    if (!rewayatId || !surahs) continue;
    const set = out.get(rewayatId) ?? new Set<number>();
    for (const part of surahs.split(',')) {
      const surah = Number(part.trim());
      if (Number.isInteger(surah) && surah >= 1 && surah <= 114) set.add(surah);
    }
    if (set.size > 0) out.set(rewayatId, set);
  }
  return out;
}

/**
 * The preview of a test build, or none. It works only when the build has no
 * telemetry keys: `scripts/android-archive.sh --lab` clears them, and that
 * script refuses `--lab` with `--bundle` or `--upload`. A store build always
 * has `EXPO_PUBLIC_SENTRY_DSN`, so it can never use a preview.
 */
export function resolveFollowAlongPreview(env: {
  preview?: string;
  sentryDsn?: string;
  posthogKey?: string;
}): FollowAlongPreview {
  if (!env.preview || env.sentryDsn || env.posthogKey) return new Map();
  return parseFollowAlongPreview(env.preview);
}

/** `covers`, plus the surahs that `preview` adds. */
export function withFollowAlongPreview(
  covers: SurahCoverage,
  preview: FollowAlongPreview,
): SurahCoverage {
  if (preview.size === 0) return covers;
  return (rewayatId, surah) =>
    preview.get(rewayatId)?.has(surah) === true || covers(rewayatId, surah);
}
