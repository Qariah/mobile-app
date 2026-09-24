import AsyncStorage from '@react-native-async-storage/async-storage';
import {Surah, SURAHS} from '../data/surahData';
import {Reciter, Rewayat, RECITERS, SurahMetadata} from '../data/reciterData';
import {usePlayerStore} from './player/store/playerStore';
import {useReciterStore} from '../store/reciterStore';
import {useApiHealthStore} from '../store/apiHealthStore';
// @ai bundled fallback is now Qariah's catalog; path driven by branding.catalog.fallbackPath
import catalogFallback from '../assets/data/catalog.json';
import branding from '@/config/branding';
import {isFeatureEnabled} from '@/config/featureFlags';

const BAYAAN_API_URL = process.env.EXPO_PUBLIC_BAYAAN_API_URL;
const BAYAAN_API_KEY = process.env.EXPO_PUBLIC_BAYAAN_API_KEY;
// Non-empty → fetch a static catalog JSON array from this URL (Qariah path).
// Empty/absent → fall back to the Bayaan paginated API (BAYAAN_API_URL).
// Update this URL in config/branding.js once the audio CDN is finalised. // @ai
const CATALOG_LIVE_URL: string | undefined = branding.catalog.liveUrl;

// ── Killswitch ───────────────────────────────────────────────────────────────
// Only fetched when EXPO_PUBLIC_KILLSWITCH_URL is set. Forks that don't
// configure one skip the check entirely — no phone-home to the maintainer's
// CDN on launch. The maintainer sets this in their local .env.
const KILLSWITCH_URL = process.env.EXPO_PUBLIC_KILLSWITCH_URL;

async function isBackendEnabled(): Promise<boolean> {
  if (!KILLSWITCH_URL) return true;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(KILLSWITCH_URL, {signal: controller.signal});
    clearTimeout(timeout);
    if (!res.ok) return true; // Config fetch failed, assume backend is fine
    const config = await res.json();
    return config.useBackendApi !== false;
  } catch {
    return true; // CDN unreachable, proceed normally
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RECITERS_KEY = 'bayaan_reciters';
const RECITER_SERVERS_KEY = 'bayaan_reciter_servers';
const DATA_VERSION = '9'; // Sprint 28: bust cache for the Wasabi→R2 photo migration (4 reciters' image_url repointed off their old Wasabi origin onto the R2 asset host at reciters/{slug}/photo.jpg; catalog v12→v13)

// ── Storage helpers ───────────────────────────────────────────────────────────

interface StoredData<T> {
  version: string;
  data: T;
}

async function getStoredData<T>(
  key: string,
  opts: {allowStale?: boolean} = {},
): Promise<{data: T; isStale: boolean} | null> {
  const storedItem = await AsyncStorage.getItem(key);
  if (!storedItem) return null;
  const {version, data}: StoredData<T> = JSON.parse(storedItem);
  if (version === DATA_VERSION) return {data, isStale: false};
  if (opts.allowStale) return {data, isStale: true};
  return null;
}

async function setStoredData<T>(key: string, data: T): Promise<void> {
  const storedData: StoredData<T> = {version: DATA_VERSION, data};
  await AsyncStorage.setItem(key, JSON.stringify(storedData));
}

// ── In-place cache population ─────────────────────────────────────────────────
// RECITERS is a shared mutable array imported across 20+ files.
// We mutate it in-place so every importer automatically sees the data
// without needing import changes anywhere.

// ── Asset access gating (Sprint 28 S28.2) ─────────────────────────────────────
// When branding.audioStreamProxy.enabled, rewrite the legacy public storage
// host → the qariah-media-proxy Worker host on audio + photo URLs. Applied to
// the in-memory RECITERS view at populate time (AsyncStorage keeps the canonical
// legacy-host catalog, so the flag is a clean toggle) and idempotently on the
// audio URL builder. Default-off → no-op. See config/branding.js +
// docs/operations/asset-gating-cloudflare-runbook.md.
function rewriteAssetHost(url: string): string {
  const proxy = branding.audioStreamProxy;
  if (!proxy?.enabled || !proxy.host || !proxy.legacyHost) return url;
  const prefix = `https://${proxy.legacyHost}/`;
  return url.startsWith(prefix)
    ? `https://${proxy.host}/${url.slice(prefix.length)}`
    : url;
}

function applyAssetProxy(data: Reciter[]): Reciter[] {
  if (!branding.audioStreamProxy?.enabled) return data;
  return data.map(reciter => ({
    ...reciter,
    image_url: reciter.image_url
      ? rewriteAssetHost(reciter.image_url)
      : reciter.image_url,
    rewayat: reciter.rewayat.map(rw => ({
      ...rw,
      server: rewriteAssetHost(rw.server),
    })),
  }));
}

function populateReciters(data: Reciter[]): void {
  RECITERS.splice(0, RECITERS.length, ...applyAssetProxy(data));
  // Refresh the store's default reciter now that RECITERS is populated
  useReciterStore.getState().refreshDefaultReciter();
  useReciterStore.setState({isInitialized: true});
}

// ── API client ────────────────────────────────────────────────────────────────

const API_BASE = BAYAAN_API_URL;
const API_KEY = BAYAAN_API_KEY;

async function fetchAllRecitersFromApi(): Promise<Reciter[]> {
  const PAGE_SIZE = 200;
  let page = 1;
  let allReciters: Reciter[] = [];

  while (true) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

    const res = await fetch(
      `${API_BASE}/v1/reciters?page=${page}&limit=${PAGE_SIZE}`,
      {headers},
    );
    if (!res.ok) throw new Error(`Bayaan API error: ${res.status}`);
    const json = await res.json();

    const reciters: Reciter[] = (json.data ?? []).map((r: any) => ({
      ...r,
      rewayat: (r.rewayat ?? []).map((rw: any) => ({
        ...rw,
        surah_list: rw.surah_list ?? [],
      })),
    }));

    allReciters = allReciters.concat(reciters);

    const {total_pages} = json.meta ?? {};
    if (!total_pages || page >= total_pages) break;
    page++;
  }

  return allReciters;
}

// @ai fetches a static catalog JSON (Qariah's CDN) — simpler than the Bayaan
// paginated API; expects a top-level array matching the Reciter[] schema.
async function fetchCatalogFromLiveUrl(url: string): Promise<Reciter[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {signal: controller.signal});
    if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data))
      throw new Error('Catalog response is not an array');
    return data as Reciter[];
  } finally {
    clearTimeout(timeout);
  }
}

// ── Surah functions ───────────────────────────────────────────────────────────

export async function getAllSurahs(): Promise<Surah[]> {
  return SURAHS;
}

export function getSurahById(id: number): Surah | undefined {
  return SURAHS.find(surah => surah.id === id);
}

export function searchSurahs(query: string): Surah[] {
  return SURAHS.filter(
    surah =>
      surah.name.toLowerCase().includes(query.toLowerCase()) ||
      surah.name_arabic.includes(query) ||
      surah.translated_name_english
        .toLowerCase()
        .includes(query.toLowerCase()) ||
      surah.id.toString() === query,
  );
}

// ── Reciter functions ─────────────────────────────────────────────────────────

/**
 * Returns reciters from AsyncStorage cache immediately (fast, works offline),
 * then refreshes from the API in the background.
 *
 * Also populates the shared RECITERS array in-place so all sync importers
 * across the app see the live data after the first call.
 */
export async function getAllReciters(): Promise<Reciter[]> {
  const {setDisrupted, setRetryFn, clearDisruption} =
    useApiHealthStore.getState();

  // @ai prefer catalog JSON URL (Qariah) over Bayaan paginated API when configured
  const canFetchFromCatalogUrl = Boolean(CATALOG_LIVE_URL);
  const canFetchFromApi = Boolean(API_BASE && API_KEY);

  if (!canFetchFromCatalogUrl && !canFetchFromApi) {
    console.warn(
      '[dataService] Neither branding.catalog.liveUrl nor EXPO_PUBLIC_BAYAAN_API_URL is set.',
    );
  }

  const canFetch = canFetchFromCatalogUrl || canFetchFromApi;

  const retry = async () => {
    await getAllReciters();
  };
  setRetryFn(retry);

  // Killswitch check — if backend is disabled via CDN config, use bundled fallback
  if (canFetch) {
    const backendEnabled = await isBackendEnabled();
    if (!backendEnabled) {
      console.log(
        '[dataService] Killswitch active — using bundled fallback data',
      );
      const fallback = catalogFallback as Reciter[];
      populateReciters(fallback);
      return fallback;
    }
  }

  const cached = await getStoredData<Reciter[]>(RECITERS_KEY);

  if (cached && cached.data.length > 0) {
    populateReciters(cached.data);
    if (canFetch) {
      refreshRecitersInBackground().catch(() => {});
    }
    return cached.data;
  }

  // Sprint 30 (B2) — bundle-first on first launch. Instead of blocking the
  // splash on the live catalog fetch (up to a 10s ceiling on a cold cache),
  // populate from the bundled catalog immediately and upgrade live in the
  // background. The RFC-010 version poll + this background refresh converge to
  // the live catalog within a moment; the bundled catalog is regenerated each
  // build so it is current as of the release. Flip `bundleFirstCatalog` off to
  // restore the blocking first-launch fetch below.
  if (canFetch && isFeatureEnabled('bundleFirstCatalog')) {
    const seed = catalogFallback as Reciter[];
    if (seed.length > 0) {
      populateReciters(seed);
      // refreshRecitersInBackground swallows its own errors (internal try/catch).
      void refreshRecitersInBackground();
      return seed;
    }
  }

  // First launch — fetch live data (blocking)
  if (canFetch) {
    try {
      const liveReciters =
        canFetchFromCatalogUrl && CATALOG_LIVE_URL
          ? await fetchCatalogFromLiveUrl(CATALOG_LIVE_URL)
          : await fetchAllRecitersFromApi();
      if (liveReciters.length > 0) {
        await setStoredData(RECITERS_KEY, liveReciters);
        populateReciters(liveReciters);
        clearDisruption();
        return liveReciters;
      }
    } catch (err) {
      console.warn('[dataService] Live fetch failed on first load:', err);
      // Try stale cache before giving up
      const stale = await getStoredData<Reciter[]>(RECITERS_KEY, {
        allowStale: true,
      });
      if (stale && stale.data.length > 0) {
        populateReciters(stale.data);
        setDisrupted(true, {reason: 'unreachable', stale: true});
        return stale.data;
      }
      setDisrupted(true, {reason: 'unreachable', stale: false});
    }
  }

  // Last resort — bundled fallback data
  const fallback = catalogFallback as Reciter[];
  if (fallback.length > 0) {
    console.log('[dataService] Using bundled fallback data');
    populateReciters(fallback);
    return fallback;
  }

  return [];
}

async function refreshRecitersInBackground(): Promise<void> {
  const {setDisrupted, clearDisruption} = useApiHealthStore.getState();
  try {
    // @ai prefer catalog URL (Qariah) over Bayaan paginated API when configured
    const freshReciters = CATALOG_LIVE_URL
      ? await fetchCatalogFromLiveUrl(CATALOG_LIVE_URL)
      : await fetchAllRecitersFromApi();
    if (freshReciters.length > 0) {
      await setStoredData(RECITERS_KEY, freshReciters);
      populateReciters(freshReciters);
      clearDisruption();
    }
  } catch {
    setDisrupted(true, {reason: 'unreachable', stale: true});
  }
}

// Sprint 17 (S17.6) — RFC-010 callback. The version-poll module hands us
// the new server version + (optionally) the immutable per-version URL.
// We prefer the versioned URL when present (CDN-cacheable forever);
// otherwise fall back to the mutable liveUrl. Catalog version is informational
// here — the AsyncStorage cache is keyed on DATA_VERSION (schema), and the
// last-seen catalog version is tracked separately by the poll module.
export async function refetchCatalogToVersion(
  _newVersion: number,
  versionedUrl?: string,
): Promise<void> {
  const url = versionedUrl ?? CATALOG_LIVE_URL;
  if (!url) return;
  try {
    const fresh = await fetchCatalogFromLiveUrl(url);
    if (fresh.length > 0) {
      await setStoredData(RECITERS_KEY, fresh);
      populateReciters(fresh);
    }
  } catch (err) {
    if (__DEV__)
      console.warn('[dataService] refetchCatalogToVersion failed:', err);
  }
}

export async function getReciterById(id: string): Promise<Reciter | undefined> {
  const reciters = await getAllReciters();
  return reciters.find(reciter => reciter.id === id);
}

// Sync version reads from the in-memory RECITERS array (populated after first load)
export function getSurahMetadataSync(
  reciterId: string,
  rewayatId: string | undefined,
  surahId: number,
): SurahMetadata | undefined {
  const reciter = RECITERS.find(r => r.id === reciterId);
  if (!reciter) return undefined;
  const rewayat = rewayatId
    ? reciter.rewayat.find(rw => rw.id === rewayatId)
    : reciter.rewayat[0];
  return rewayat?.surah_metadata?.find(sm => sm.surah === surahId);
}

export function formatAyahRange(metadata: SurahMetadata): string | undefined {
  if (metadata.is_full || !metadata.range) return undefined;
  const {from, to} = metadata.range;
  return from === to ? `ayah ${from}` : `ayahs ${from}–${to}`;
}

export function getReciterByIdSync(id: string): Reciter | undefined {
  return RECITERS.find(reciter => reciter.id === id);
}

export function getReciterBySlug(slug: string): Reciter | undefined {
  return RECITERS.find(r => r.slug === slug);
}

export function getReciterName(reciterId: string): string | null {
  const reciter = RECITERS.find(r => r.id === reciterId);
  return reciter ? reciter.name : null;
}

// ── Rewayat functions ─────────────────────────────────────────────────────────

export async function getReciterRewayat(reciterId: string): Promise<Rewayat[]> {
  const reciter = await getReciterById(reciterId);
  return reciter ? reciter.rewayat : [];
}

export async function getReciterStyles(reciterId: string): Promise<string[]> {
  const rewayat = await getReciterRewayat(reciterId);
  return [...new Set(rewayat.map(r => r.style))];
}

export async function getRecitersForSurah(
  surahId: number,
  style?: string,
): Promise<Reciter[]> {
  const reciters = await getAllReciters();
  return reciters.filter(reciter =>
    reciter.rewayat.some(
      r =>
        (!style || r.style === style) &&
        (!r.surah_list ||
          r.surah_list
            .filter((id): id is number => id !== null)
            .includes(surahId)),
    ),
  );
}

export async function getAvailableSurahsForRewayat(
  rewayatId: string,
): Promise<number[]> {
  const reciters = await getAllReciters();
  for (const reciter of reciters) {
    const rewayat = reciter.rewayat.find(r => r.id === rewayatId);
    if (rewayat?.surah_list) {
      return rewayat.surah_list.filter((id): id is number => id !== null);
    }
  }
  return [];
}

export async function filterReciters(options: {
  style?: string;
  hasSurah?: number;
  query?: string;
}): Promise<Reciter[]> {
  const reciters = await getAllReciters();
  const normalizedQuery = options.query?.toLowerCase() ?? '';

  return reciters.filter(reciter => {
    if (options.style) {
      const hasStyle = reciter.rewayat.some(r => r.style === options.style);
      if (!hasStyle) return false;
    }

    if (options.hasSurah !== undefined) {
      const hasSurah = reciter.rewayat.some(
        r =>
          !r.surah_list ||
          r.surah_list
            .filter((id): id is number => id !== null)
            .includes(options.hasSurah ?? 0),
      );
      if (!hasSurah) return false;
    }

    if (normalizedQuery) {
      const matchesQuery =
        reciter.name.toLowerCase().includes(normalizedQuery) ||
        reciter.rewayat.some(
          r =>
            r.name.toLowerCase().includes(normalizedQuery) ||
            r.style.toLowerCase().includes(normalizedQuery),
        );
      if (!matchesQuery) return false;
    }

    return true;
  });
}

// ── Audio URL ─────────────────────────────────────────────────────────────────

export async function fetchAudioUrl(
  surahId: number,
  reciterId: string,
  rewayatId?: string,
): Promise<string> {
  console.log('fetchAudioUrl called with:', {surahId, reciterId, rewayatId});

  const reciter = await getReciterById(reciterId);

  console.log('Reciter found in fetchAudioUrl:', !!reciter);
  if (!reciter) throw new Error('Reciter not found');

  const rewayat = rewayatId
    ? reciter.rewayat.find(r => r.id === rewayatId)
    : reciter.rewayat[0];

  if (!rewayat) throw new Error('Rewayat not found');

  if (rewayat.surah_list) {
    const validSurahs = rewayat.surah_list.filter(
      (id): id is number => id !== null,
    );
    if (!validSurahs.includes(surahId)) {
      throw new Error(
        `Surah ${surahId} is not available for ${reciter.name} in ${rewayat.name} style. ` +
          `Available surahs: ${validSurahs.join(', ')}`,
      );
    }
  }

  const surahStr = surahId.toString().padStart(3, '0');

  // NOTE: All 326 of today's partial recordings are stored at the unsuffixed
  // path `{server}/{surah}.mp3` (legacy v1-migration convention — the v1 audio
  // migration to R2 didn't preserve the range distinction in the key). The
  // Sprint-19 ops console added a single-upload mode that *writes* partial
  // uploads to the new suffixed path `{server}/{surah}-{from}-{to}.mp3`, but
  // no production rows reference that path yet. When the first ops-console-
  // uploaded partial lands in the live catalog, add an `audio_path?:
  // 'suffixed'` flag on `SurahMetadata` and branch here on it — see
  // TECH_DEBT #70 for the staged migration plan.
  return rewriteAssetHost(`${rewayat.server}/${surahStr}.mp3`);
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchReciters(query: string): Promise<Reciter[]> {
  const reciters = await getAllReciters();
  const normalizedQuery = query.toLowerCase();
  return reciters.filter(reciter =>
    reciter.name.toLowerCase().includes(normalizedQuery),
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

export async function clearStoredData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      RECITERS_KEY,
      RECITER_SERVERS_KEY,
      '@bayaan/last_track',
      '@bayaan/last_position',
    ]);
    await usePlayerStore.getState().cleanup();
  } catch (error) {
    console.error('Error clearing stored data:', error);
    throw error;
  }
}

export async function refreshData(): Promise<void> {
  await clearStoredData();
  await getAllReciters();
}
