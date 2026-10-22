import {useEffect, useState} from 'react';
import {createMMKV} from 'react-native-mmkv';
import {RECITERS, Reciter} from '@/data/reciterData';
import branding from '@/config/branding';

/**
 * Sprint 8 — "Trending This Week" home row.
 *
 * Reads a pre-aggregated leaderboard JSON from R2, populated by
 * `scripts/publish-trending-reciters.mjs` which queries PostHog
 * server-side. The shape:
 *
 *   {
 *     windowDays: number,
 *     generatedAt: ISO8601,
 *     reciters: [{reciterId: string, plays: number}, ...]
 *   }
 *
 * MMKV cache keeps a snapshot for `CACHE_TTL_MS` so we don't fetch on
 * every screen open — the upstream R2 file is regenerated on a slow
 * cadence (hourly at most), so app-side staleness of a few hours is
 * fine and matches the upstream regen window.
 */

const CACHE_KEY = 'trending:top-reciters:v1';
const CACHE_TS_KEY = 'trending:top-reciters:v1:fetchedAt';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const mmkv = createMMKV({id: 'trending'});

interface TopRecitersPayload {
  windowDays: number;
  generatedAt: string;
  reciters: Array<{reciterId: string; plays: number}>;
}

interface UseTrendingRecitersOptions {
  limit?: number;
  /** Force a network fetch even if cache is fresh. */
  forceRefresh?: boolean;
}

interface UseTrendingRecitersResult {
  reciters: Reciter[];
  /** Total `plays` from the upstream payload, indexed by reciterId. */
  playsByReciterId: Map<string, number>;
  loading: boolean;
  /** Lower-cased error reason or null. Logged but not user-visible. */
  error: string | null;
}

function readCachedPayload(): TopRecitersPayload | null {
  try {
    const raw = mmkv.getString(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TopRecitersPayload;
  } catch {
    return null;
  }
}

function isCacheFresh(): boolean {
  const ts = mmkv.getNumber(CACHE_TS_KEY);
  if (!ts) return false;
  return Date.now() - ts < CACHE_TTL_MS;
}

function joinToReciters(
  payload: TopRecitersPayload | null,
  limit: number,
): {reciters: Reciter[]; plays: Map<string, number>} {
  if (!payload?.reciters?.length) {
    return {reciters: [], plays: new Map()};
  }
  const plays = new Map<string, number>();
  const reciters: Reciter[] = [];
  for (const entry of payload.reciters) {
    plays.set(entry.reciterId, entry.plays);
    const r = RECITERS.find(x => x.id === entry.reciterId);
    if (r) reciters.push(r);
    if (reciters.length >= limit) break;
  }
  return {reciters, plays};
}

export function useTrendingReciters(
  options: UseTrendingRecitersOptions = {},
): UseTrendingRecitersResult {
  const {limit = 10, forceRefresh = false} = options;
  const [payload, setPayload] = useState<TopRecitersPayload | null>(() =>
    readCachedPayload(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!forceRefresh && isCacheFresh()) return;

    const url = branding.stats?.topRecitersUrl;
    if (!url) {
      setError('no-stats-url');
      return;
    }

    setLoading(true);
    fetch(url, {
      // R2 serves Cache-Control: public, max-age=300; the runtime fetch
      // honors HTTP caching, so we get free edge dedup across users.
      headers: {Accept: 'application/json'},
    })
      .then(res => {
        if (!res.ok) throw new Error(`http-${res.status}`);
        return res.json();
      })
      .then((next: TopRecitersPayload) => {
        if (cancelled) return;
        // Defensive shape check — upstream is server-controlled but we
        // never want a malformed file to crash the home tab.
        if (!Array.isArray(next?.reciters)) throw new Error('bad-shape');
        mmkv.set(CACHE_KEY, JSON.stringify(next));
        mmkv.set(CACHE_TS_KEY, Date.now());
        setPayload(next);
        setError(null);
      })
      .catch(e => {
        if (cancelled) return;
        // Keep showing whatever we had cached — never block the home
        // tab on a stats fetch.
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [forceRefresh]);

  const {reciters, plays} = joinToReciters(payload, limit);
  return {reciters, playsByReciterId: plays, loading, error};
}
