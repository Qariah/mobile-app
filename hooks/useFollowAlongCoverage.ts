// @ai-generated
// Qariah (#847): the player's follow-along rule for the "Follow Along" chip
// and the "Follow Along" Listen row.
import {useMemo} from 'react';
import {RECITERS} from '@/data/reciterData';
import {useRecitersVersion} from '@/hooks/useRecitersVersion';
import {timestampFetchService} from '@/services/timestamps/TimestampFetchService';
import {useTimestampStore} from '@/store/timestampStore';
import {
  listFollowAlongSurahs,
  resolveFollowAlongPreview,
  withFollowAlongPreview,
  type SurahCoverage,
} from '@/utils/followAlongCoverage';

// Read once. A store build has no preview (see resolveFollowAlongPreview).
// Each `process.env.EXPO_PUBLIC_*` is a direct read, so Metro inlines it.
const PREVIEW = resolveFollowAlongPreview({
  preview: process.env.EXPO_PUBLIC_FOLLOW_ALONG_PREVIEW,
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  posthogKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
});

const NO_SURAHS: ReadonlySet<number> = new Set();

/**
 * The player's rule, as `SurahCoverage`. The player offers follow-along for
 * a rewayah in the registry (`useRewayatFollowAlong`, from
 * `timestampFetchService.hasSource`), and it shows the verses of a surah when
 * `timestampFetchService.hasSurah` is true: the bundled timings list the
 * surah, or the rewayah has `has_timestamps` and its `timestamps_surah_list`
 * names the surah or is empty. So a chip or a card never claims follow-along
 * that the player cannot show.
 */
export function playerSurahCoverage(
  supportedRewayatIds: ReadonlySet<string>,
): SurahCoverage {
  const covers: SurahCoverage = (rewayatId, surah) => {
    if (!supportedRewayatIds.has(rewayatId)) return false;
    try {
      return timestampFetchService.hasSurah(rewayatId, surah);
    } catch {
      return false;
    }
  };
  return withFollowAlongPreview(covers, PREVIEW);
}

/** `playerSurahCoverage` of the current registry; a new function when it loads. */
export function useFollowAlongCoverage(): SurahCoverage {
  const supported = useTimestampStore(s => s.supportedRewayatIds);
  return useMemo(() => playerSurahCoverage(supported), [supported]);
}

/**
 * The listed surahs of `rewayatId` with follow-along. It computes again when
 * the registry loads and when the catalog is filled again.
 */
export function useFollowAlongSurahs(
  rewayatId: string | undefined,
): ReadonlySet<number> {
  const covers = useFollowAlongCoverage();
  const recitersVersion = useRecitersVersion();
  return useMemo(
    () => {
      if (!rewayatId) return NO_SURAHS;
      for (const reciter of RECITERS) {
        const rewayah = reciter.rewayat?.find(rw => rw?.id === rewayatId);
        if (rewayah) return new Set(listFollowAlongSurahs(rewayah, covers));
      }
      return NO_SURAHS;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recitersVersion is the refill signal of RECITERS, which this reads
    [rewayatId, covers, recitersVersion],
  );
}
