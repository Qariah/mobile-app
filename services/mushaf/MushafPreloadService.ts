import {
  Skia,
  type SkTypefaceFontProvider,
  type SkTypeface,
} from '@shopify/react-native-skia';
import {Image} from 'react-native';
import * as Sentry from '@sentry/react-native'; // @ai
import {digitalKhattDataService} from './DigitalKhattDataService';
import {quranTextService} from './QuranTextService';
import {rewayahDiffService} from './RewayahDiffService';
import {
  useMushafSettingsStore,
  type RewayahId,
} from '@/store/mushafSettingsStore';
import {migratePersistedId} from '@/services/rewayah/RewayahIdentity';

// @ai-start
const FONT_ASSETS: Record<string, number> = {
  DigitalKhattV1: require('@/data/mushaf/legacy/DigitalKhattQuranicV1.otf'),
  DigitalKhattV2: require('@/data/mushaf/digitalkhatt/DigitalKhattFont.otf'),
  DigitalKhattIndoPak: require('@/data/mushaf/indopak/DigitalKhattIndoPak.otf'),
  QuranCommon: require('@/data/mushaf/quran-common.ttf'),
  SurahNameV4: require('@/data/mushaf/surah-name-v4.ttf'),
  SurahNameQCF: require('@/data/mushaf/surah-name-qcf.ttf'),
  ManropeSemiBold: require('@/assets/fonts/Manrope-SemiBold.ttf'),
  ManropeRegular: require('@/assets/fonts/Manrope-Regular.ttf'),
  PlexSansArabicSemiBold: require('@/assets/fonts/IBMPlexSansArabic-SemiBold.ttf'),
};
// Mushaf-critical families: at least one DK variant + QuranCommon must
// register or the Mushaf renders blank. Every other family is optional: the
// surah names are ornamental (surah header glyphs), and the others are UI text
// on share cards. Their absence is cosmetic, not catastrophic.
const CRITICAL_FAMILIES = new Set([
  'DigitalKhattV1',
  'DigitalKhattV2',
  'DigitalKhattIndoPak',
  'QuranCommon',
]);

// After a failed load the service tries again by itself, not at each mount: a
// reader can wait with nothing that would mount again, and in a lasting failure
// each page turn would read the font files again.
export const FONT_RETRY_MS = 3000;
export const FONT_MAX_RETRIES = 3;

/** One complete load: published together, or not at all. */
interface LoadedFonts {
  fontMgr: SkTypefaceFontProvider;
  quranCommonTypeface: SkTypeface | null;
  surahNameTypeface: SkTypeface | null;
  /** False when an optional family failed. */
  complete: boolean;
}
// @ai-end

function assetUri(asset: number): string {
  const source = Image.resolveAssetSource(asset);
  if (!source) {
    throw new Error(`Unresolvable font asset ${asset}`);
  }
  return source.uri;
}

/**
 * Preloads everything the Mushaf screen needs at app startup (AppInitializer
 * priority 5). By the time the user navigates to the Mushaf tab, fonts and
 * DK data are available synchronously; no loading spinners.
 *
 * - DigitalKhatt SQLite data (word + layout databases)
 * - Skia TypefaceFontProvider with DK + ornamental fonts (for SkiaPage rendering)
 */
/**
 * Lifecycle state for the preload pipeline. Surfaced to subscribers so
 * they can distinguish "still loading" (render nothing) from "failed"
 * (render via fallback / system fonts) without re-reading singletons.
 */
export type MushafPreloadState = 'idle' | 'loading' | 'ready' | 'failed';

class MushafPreloadService {
  private _fontMgr: SkTypefaceFontProvider | null = null;
  private _quranCommonTypeface: SkTypeface | null = null;
  private _surahNameTypeface: SkTypeface | null = null;
  private _state: MushafPreloadState = 'idle';
  private _initPromise: Promise<void> | null = null;
  // Registered once (a retried init must not stack listeners).
  private _rewayahSubscription: (() => void) | null = null;
  private _diffRewayah: RewayahId | null = null;
  // @ai-start
  private _fontRetries = 0;
  private _fontRetryTimer: ReturnType<typeof setTimeout> | null = null;
  // @ai-end
  // `useSyncExternalStore` subscribers so mushaf components can read
  // fontMgr synchronously without needing a useFonts fallback that races
  // at first-mount.
  private _listeners = new Set<() => void>();

  /** Subscribe to font-preload completion. Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private _notify(): void {
    for (const fn of this._listeners) fn();
  }

  /** `true` once `_doInit` ran to completion, regardless of success/failure. */
  get initialized(): boolean {
    return this._state === 'ready' || this._state === 'failed';
  }

  /**
   * `true` if any step of `_doInit` rejected or the fonts did not load. A
   * font retry clears it when the data loaded.
   */
  get loadError(): boolean {
    return this._state === 'failed';
  }

  get state(): MushafPreloadState {
    return this._state;
  }

  get fontMgr(): SkTypefaceFontProvider | null {
    return this._fontMgr;
  }

  get quranCommonTypeface(): SkTypeface | null {
    return this._quranCommonTypeface;
  }

  get surahNameTypeface(): SkTypeface | null {
    return this._surahNameTypeface;
  }

  async initialize(): Promise<void> {
    if (this._state === 'ready') return;
    // Allow a retry after a prior failure (Osman review LOW): the previous
    // implementation cached the rejected promise forever, so a later call
    // got the same rejection with no way to recover.
    // @ai Fonts publish only as a complete set, so a provider from the failed
    // run is good: readers keep drawing with it, and this run does not load it.
    if (this._state === 'failed') {
      this._initPromise = null;
      this._state = 'idle';
      this._fontRetries = 0;
      if (this._fontRetryTimer) clearTimeout(this._fontRetryTimer);
      this._fontRetryTimer = null;
    }
    if (this._initPromise) return this._initPromise;

    this._state = 'loading';
    this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    let failed = false;
    let fonts: Promise<LoadedFonts | null> | null = null; // @ai
    try {
      // Wait for Zustand persist hydration so DK service reads the user's
      // saved rewayah rather than the default (otherwise a reloaded app with
      // Shu'bah persisted would briefly init against Hafs and never catch up).
      await waitForSettingsHydration();

      // Defensive normalization at the earliest hydration-complete point.
      // If a stale pre-canonical slug ("qaloon", "shouba", etc.) slipped
      // past the v12→v13 migration (e.g. an intermediate build that bumped
      // the version without running the slug migrator), rewrite the store
      // to the canonical slug before any reader pulls it. Keeps every
      // downstream consumer; not just the DK service; on safe values.
      const store = useMushafSettingsStore.getState();
      const normalized = migratePersistedId(store.rewayah as unknown as string);
      if (normalized !== store.rewayah) {
        store.setRewayah(normalized);
      }

      // Keep line-text/layout caches and diff ranges in step with the DK
      // service. The listener runs synchronously inside each commit that
      // changes the active rewayah (after the maps are swapped, before cache
      // subscribers re-render), so SkiaPage never recomputes line text or
      // highlight offsets from the previous rewayah's caches. Registered
      // before initialize() so the first commit (when the persisted rewayah
      // is not Hafs, or a bookmark switch landed first) is covered too.
      if (!this._rewayahSubscription) {
        this._rewayahSubscription = digitalKhattDataService.onRewayahChange(
          rewayah => {
            quranTextService.clearCaches();
            this._loadDiffsFor(rewayah);
          },
        );
      }

      // @ai-start
      // Qariah (Lite mode plan, step 3): the fonts need no DK data, so they
      // load while the data loads (loadSkiaFonts handles its own errors).
      if (!this._fontMgr) fonts = this.loadSkiaFonts();
      // @ai-end
      // DK data must be ready first; page lines are needed for layout computation
      await digitalKhattDataService.initialize();

      // Hafs (the service's starting rewayah) commits without a change event.
      this._loadDiffsFor(digitalKhattDataService.rewayah);
    } catch (error) {
      // Any pre-font init step rejected (hydration, DK init, diff load). The
      // outer init must NOT swallow the rejection silently — surface it as
      // `failed` so subscribers render the fallback rather than a blank UI.
      failed = true;
      console.warn('[MushafPreload] Initialization failed:', error);
    }
    // @ai-start
    // This run's fonts publish before its final state, also after a failure:
    // a late font load cannot overwrite the provider of a retry. It never
    // rejects, so a mid-pipeline rejection cannot leave `_state` at 'loading'.
    if (fonts) this.publishFonts(await fonts);
    if (!this._fontMgr) failed = true;
    // @ai-end
    // Always transition to a terminal state and always notify.
    this._state = failed ? 'failed' : 'ready';
    this._notify();
    console.log(`[MushafPreload] Initialization ${this._state}`);
    if (!this._fontMgr) this.scheduleFontRetry(); // @ai
  }

  private _loadDiffsFor(rewayah: RewayahId): void {
    if (this._diffRewayah === rewayah) return;
    rewayahDiffService.loadForRewayah(rewayah);
    this._diffRewayah = rewayah;
  }

  // @ai-start
  private publishFonts(fonts: LoadedFonts | null): void {
    if (!fonts) return;
    this._fontMgr = fonts.fontMgr;
    this._quranCommonTypeface = fonts.quranCommonTypeface;
    this._surahNameTypeface = fonts.surahNameTypeface;
  }

  /** A pass with a failed font runs once more, at once. Never rejects. */
  private async loadSkiaFonts(): Promise<LoadedFonts | null> {
    const first = await this.readFonts();
    if (first?.complete) return first;
    console.warn(
      '[MushafPreload] Partial typeface failure on primary load; retrying',
    );
    return (await this.readFonts()) ?? first;
  }

  /**
   * One load of every font, one file at a time: "Couldn't create typeface for
   * SurahNameV4" came from parallel registration. Null when a critical family
   * failed: a zero-typeface provider is a non-null empty object that would pass
   * `_doInit`'s null-guard, and every Mushaf surface would render blank with no
   * recovery. Never rejects.
   */
  private async readFonts(): Promise<LoadedFonts | null> {
    try {
      const fontMgr = Skia.TypefaceFontProvider.Make();
      let quranCommonTypeface: SkTypeface | null = null;
      let surahNameTypeface: SkTypeface | null = null;
      let complete = true;
      let criticalFailed = false;
      for (const [family, asset] of Object.entries(FONT_ASSETS)) {
        try {
          const uri = assetUri(asset);
          const data = await Skia.Data.fromURI(uri);
          const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(data);
          if (!typeface) throw new Error('no typeface');
          if (family === 'QuranCommon') quranCommonTypeface = typeface;
          if (family === 'SurahNameV4') surahNameTypeface = typeface;
          fontMgr.registerFont(typeface, family);
        } catch (error) {
          console.warn(`[MushafPreload] Failed to load ${family}:`, error);
          complete = false;
          if (CRITICAL_FAMILIES.has(family)) criticalFailed = true;
        }
      }
      if (criticalFailed) return null;
      return {fontMgr, quranCommonTypeface, surahNameTypeface, complete};
    } catch (error) {
      console.warn('[MushafPreload] Failed to load Skia fonts:', error);
      return null;
    }
  }

  private scheduleFontRetry(): void {
    if (this._fontRetryTimer || this._fontRetries >= FONT_MAX_RETRIES) return;
    this._fontRetries += 1;
    this._fontRetryTimer = setTimeout(() => {
      this._fontRetryTimer = null;
      this.retryFonts();
    }, FONT_RETRY_MS);
  }

  // A later try for the fonts alone. It publishes here, so every reader of the
  // service gets it (SkiaPage's typeface, QCF, the share cards), not only the
  // callers of useMushafFontMgr.
  private async retryFonts(): Promise<void> {
    if (this._state !== 'failed' || this._fontMgr) return;
    const fonts = await this.readFonts();
    // A retry of the whole load started meanwhile: its run publishes.
    if (this._state !== 'failed') return;
    if (!fonts) {
      this.scheduleFontRetry();
      return;
    }
    this.publishFonts(fonts);
    if (digitalKhattDataService.initialized) this._state = 'ready';
    this._notify();
  }
  // @ai-end
}

export const mushafPreloadService = new MushafPreloadService();

// @ai-start
// A failed settings read (QARIAHV2-20) never hydrates: after this long, render with the in-memory values.
// No write follows: the hydration-guarded storage refuses every write after a failed read.
export const SETTINGS_HYDRATION_TIMEOUT_MS = 5000;
let reportedHydrationTimeout = false;

function waitForSettingsHydration(): Promise<void> {
  const persist = useMushafSettingsStore.persist;
  if (persist.hasHydrated()) return Promise.resolve();
  return new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      unsub();
      reportHydrationTimeout();
      // A slow read can still finish: then follow the saved rewayah.
      const unsubLate = persist.onFinishHydration(state => {
        unsubLate();
        if (digitalKhattDataService.rewayah === state.rewayah) return;
        digitalKhattDataService.switchRewayah(state.rewayah).catch(error => {
          if (__DEV__) {
            console.warn('[MushafPreload] Late rewayah resync failed:', error);
          }
        });
      });
      resolve();
    }, SETTINGS_HYDRATION_TIMEOUT_MS);
    const unsub = persist.onFinishHydration(() => {
      unsub();
      clearTimeout(timer);
      resolve();
    });
  });
}

function reportHydrationTimeout(): void {
  if (__DEV__) {
    console.warn(
      '[MushafPreload] Settings did not hydrate; rendering with defaults',
    );
  }
  if (reportedHydrationTimeout) return;
  reportedHydrationTimeout = true;
  Sentry.captureMessage('mushaf-settings-hydration-timeout', {
    level: 'warning',
    tags: {scope: 'mushaf-preload'},
    extra: {timeoutMs: SETTINGS_HYDRATION_TIMEOUT_MS},
    fingerprint: ['mushaf-settings-hydration-timeout'],
  });
}
// @ai-end
