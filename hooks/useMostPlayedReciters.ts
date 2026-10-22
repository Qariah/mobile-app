import {useEffect, useState} from 'react';
import {RECITERS, Reciter} from '@/data/reciterData';
import {localAggregationStore} from '@/services/analytics/LocalAggregationStore';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';

interface UseMostPlayedRecitersOptions {
  windowDays?: number;
  limit?: number;
}

/**
 * Aggregate of the user's own listening time per reciter, joined to the
 * Reciter records pulled from `RECITERS`. Reciters whose UUID isn't found
 * in the in-memory catalog are filtered out (e.g. catalog rotation, stale
 * MMKV keys). Recomputes when:
 *   - `RECITERS` is hydrated (we listen to recently-played store updates as
 *     a proxy — same lifecycle hooks call sites).
 *   - Recent-tracks changes (a meaningful signal that listening occurred).
 *
 * Sprint 8 (post-S7) — backs the "Most Played by You" home row.
 */
export function useMostPlayedReciters(
  options: UseMostPlayedRecitersOptions = {},
): Reciter[] {
  const {windowDays = 30, limit = 10} = options;
  const recentTracks = useRecentlyPlayedStore(s => s.recentTracks);
  const [reciters, setReciters] = useState<Reciter[]>([]);

  useEffect(() => {
    const aggregates = localAggregationStore.getMostPlayedReciters({
      windowDays,
      limit,
    });
    if (aggregates.length === 0) {
      setReciters(prev => (prev.length === 0 ? prev : []));
      return;
    }
    const matched = aggregates
      .map(a => RECITERS.find(r => r.id === a.reciterId))
      .filter((r): r is Reciter => r !== undefined);
    setReciters(matched);
    // recentTracks is a proxy for "user listened to something" + "RECITERS
    // has been hydrated by dataService" — both are signals to recompute.
  }, [recentTracks, windowDays, limit]);

  return reciters;
}
