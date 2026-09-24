/**
 * Qariah v2 — Branding type declarations.
 *
 * Extends upstream's `Branding` interface (RFC-007 onward) with Qariah-specific
 * fields. Upstream's shape is preserved verbatim so call-site changes drop in
 * cleanly on weekly sync. Everything else (urls.home, urls.github, theme,
 * assets, analytics, auth, storageKeyPrefix, associatedDomain)
 * is a Qariah-only extension.
 *
 * Values live in `branding.js` (CJS, runtime-loadable from app.config.ts).
 * This file gives TypeScript callers literal-narrow types.
 */

import type {ComponentType} from 'react';
import type {Track} from '@/types/audio';
import type {TranslationProvider} from '@/types/TranslationProvider';
import type {TafsirProvider} from '@/types/TafsirProvider';
import type {AyahReflection} from '@/services/userState/communityReflections';
import type {AyahTimestamp} from '@/types/timestamps';

/** Catalog source config (upstream RFC-007 shape, with Qariah `liveUrl` extension). */
export interface BrandingCatalogConfig {
  /** Where the active catalog comes from at runtime. */
  source: 'bundled' | 'remote';
  /** Path to bundled JSON catalog file; undefined = use data/reciters-fallback.json. */
  fallbackPath?: string;
  /** Qariah extension: live-update URL when source = 'remote'. */
  liveUrl?: string;
}

/**
 * Identifier for a Listen-tab home row.
 *
 * Each id corresponds to a section rendered by `components/RecitersView.tsx`.
 * Forks select which rows to show and in what order by listing ids in
 * `Branding.homeRowConfig`. Unknown ids are ignored (forward-compat for forks
 * that haven't been updated when a new row is added upstream).
 *
 * Qariah extends the upstream base set (12 ids, PR #260) with 8 fork-only ids
 * covering its curated catalog surfaces.
 */
export type HomeRowId =
  // Upstream base 12 (PR #260)
  | 'continue-listening'
  | 'new-to-quran'
  | 'favorites'
  | 'featured'
  | 'adhkar'
  | 'follow-along'
  | 'playlists'
  | 'exclusives'
  | 'tajweed'
  | 'memorization'
  | 'rewayat'
  | 'collection'
  // Qariah extensions — additive only; Qariah relabels 'rewayat' in the title
  // string rather than introducing a separate id.
  | 'country'
  | 'translations'
  | 'honored'
  | 'paradise'
  | 'newly-added'
  | 'full-recording'
  | 'trending'
  | 'most-played';

/** Per-row toggle for the Listen-tab home rows. */
export interface HomeRow {
  id: HomeRowId;
  /** Whether this row renders. Rows whose data is empty still self-hide. */
  enabled: boolean;
}

/**
 * Props passed to a fork's `listenTabTopComponent` (RFC-008).
 *
 * Reserved for future extension — the slot starts with no required props
 * so forks can ship a plain `() => JSX.Element`. Any future additions
 * (theming context, navigation hooks, …) must default to optional so
 * existing implementations keep compiling.
 */
export interface ListenTabTopComponentProps {}

/**
 * RFC-012 — identifier for a Search/Browse-tab filter dimension.
 *
 * Each id is a predicate the `BrowseReciters` filter pipeline can apply
 * to the reciter list. Forks declare an array in `branding.searchFilters`
 * to opt in to the user-editable chip framework; when undefined, the
 * Search tab keeps today's bespoke chip set (teacher/student) unchanged.
 *
 * v1 ships the exists-today subset only — every dimension here resolves
 * against fields that already exist on `Reciter` / `Reciter.rewayat[]`.
 * Future dimensions (`country`, `translation`) require the corresponding
 * fields to be added to the `Reciter` type and populated from the
 * catalog first; they're not part of this PR.
 */
export type SearchFilterDimension =
  | 'rewaya' // Reciter.rewayat[].name — teacher/student (already bespoke; here for future migration)
  | 'has-surah' // surah picker → Reciter.rewayat[].surah_list includes (already bespoke; here for future migration)
  | 'has-photo' // Reciter.image_url present
  | 'recitation-style'; // Reciter.rewayat[].style — canonical slugs 'murattal'|'mojawwad'|'moalim' per data/rewayat-slugs.json (already bespoke; here for future migration)

/** App identity values that vary across forks. */
export interface Branding {
  appName: string;
  appSlug: string;
  urlScheme: string;
  bundleId: {ios: string; android: string};
  supportUrl: string;
  termsUrl: string;
  privacyUrl: string;
  shareBaseUrl: string;
  emailProductName: string;
  catalog: BrandingCatalogConfig;
  /**
   * Order + visibility of Listen-tab home rows.
   *
   * Optional — when undefined, RecitersView falls back to the built-in
   * default order (preserving today's Bayaan behavior verbatim). Forks
   * override by declaring their own array. Order in the array == render
   * order. Empty-data rows self-hide regardless of `enabled`.
   *
   * @example
   * homeRowConfig: [
   *   { id: 'continue-listening', enabled: true },
   *   { id: 'favorites', enabled: true },
   *   { id: 'featured', enabled: true },
   * ]
   */
  homeRowConfig?: HomeRow[];
  /**
   * RFC-010 — optional URL the app polls on cold-start (and on
   * `AppState 'active'`, debounced) to discover catalog updates. The
   * response is expected to be JSON of shape:
   *
   *   { version: number, updated_at?: string, url?: string }
   *
   * If `version` exceeds the locally-tracked last-seen version, the app
   * refetches the catalog. When `url` is present, it points at an
   * immutable per-version snapshot — preferred over the live catalog URL
   * because the URL itself is the CDN cache key.
   *
   * Undefined (default) → no polling. Bayaan ships undefined; forks with
   * dynamic catalog operations (e.g. Qariah's ops console) set it.
   *
   * Fail-open: any poll failure is swallowed. The bundled catalog is
   * always the source of truth on cold-start.
   */
  catalogVersionEndpoint?: string;
  /**
   * Sprint 28 — asset access gating. When `enabled`, audio + reciter-photo
   * URLs whose host is `legacyHost` are rewritten to `host` (a media-proxy
   * Worker fronting the private asset bucket) at catalog load time + on the
   * audio URL builder.
   *
   * Env-driven (no storage origins in source): real values in `.env.local`,
   * placeholders in `.env.example`. Undefined / `enabled: false` / missing
   * `host`/`legacyHost` (default) → URLs pass through unchanged (byte-identical
   * to pre-Sprint-28 behavior). Bayaan ships undefined.
   *
   * The live catalog's `server`/`image_url` fields are the primary migration
   * lever for already-installed builds; this seam covers new builds without a
   * catalog write and is the Tier-2 HMAC injection point.
   */
  audioStreamProxy?: {
    enabled: boolean;
    /** Proxy Worker host, e.g. `media.cdn.example.com`. Undefined → rewrite is a no-op. */
    host?: string;
    /** Legacy public storage host to rewrite from, e.g. `cdn.example.com`. Undefined → no-op. */
    legacyHost?: string;
  };
  /**
   * RFC-008 — optional component that replaces the Listen-tab top
   * region (the default `RecitersHero`). Forks return a React
   * component; `undefined` keeps Bayaan's `RecitersHero` verbatim.
   *
   * The component renders directly inside the Listen-tab ScrollView at
   * the top, above the rows controlled by `homeRowConfig`. It receives
   * no required props today; `ListenTabTopComponentProps` is a slot for
   * future extension.
   */
  listenTabTopComponent?: ComponentType<ListenTabTopComponentProps>;
  /**
   * RFC-012 — composable Search-tab filter dimensions. When set, the
   * Search tab renders a user-editable chip per id; tiles on the Home
   * tab can deeplink in with chips pre-applied via the matching URL
   * params on the `reciter/browse` route. RFC-012 chips render AFTER
   * Bayaan's existing bespoke chips (teacher/student) — trailing
   * position is intentional so users of a forked build see the
   * familiar chips first and the fork's additions after.
   *
   * Tri-state semantics:
   *   - `undefined` (default) — "not migrated"; Search tab keeps
   *     today's bespoke chip set unchanged. Bayaan ships this.
   *   - `[]` — "explicitly disable all RFC-012 chips". Observably the
   *     same as `undefined` today, but the intent is distinct for
   *     future v2 migration when bespoke chips themselves move under
   *     this seam.
   *   - non-empty array — opt in to the listed dimensions.
   *
   * v1 ships exists-today dimensions only — see `SearchFilterDimension`.
   *
   * @example
   * searchFilters: ['rewaya', 'has-surah', 'has-photo']
   */
  searchFilters?: SearchFilterDimension[];
  /**
   * RFC-013 — optional hook returning the verse_key (e.g. `"2:197"`) the
   * PlayerSheet ayah list (`QuranView`) should anchor on for the
   * currently-playing track. Called on cold-mount and on every
   * currentSurah change thereafter. Returning `undefined` (the default)
   * keeps the current scroll-to-top-of-surah behavior verbatim.
   *
   * Used by forks that ship range-restricted recitations (audio tracks
   * covering only a subset of a surah). The hook returns the start of
   * that subset; QuranView handles the rest (initial-scroll position +
   * deferred imperative scroll on subsequent surah changes).
   *
   * If the returned verse_key isn't found in the current surah's verses,
   * QuranView silently falls back to scrolling to the top.
   *
   * @example
   * // Fork with catalog metadata describing partial recitations:
   * initialPlayerVerseKey: (track) => {
   *   if (!track.surahId || !track.reciterId) return undefined;
   *   const surahNum = parseInt(track.surahId, 10);
   *   if (Number.isNaN(surahNum)) return undefined;
   *   const meta = getSurahMetadata(track.reciterId, track.rewayatId, surahNum);
   *   if (!meta || meta.is_full || !meta.range) return undefined;
   *   return `${track.surahId}:${meta.range.from}`;
   * }
   */
  initialPlayerVerseKey?: (track: Track) => string | undefined;
  /**
   * RFC-009 — optional translation source for Settings → Translations.
   * `undefined` keeps Bayaan's default (the alQuran.cloud-backed
   * `alQuranCloudTranslationProvider`).
   */
  translationProvider?: TranslationProvider;
  /**
   * RFC-009 — optional tafsir source for Settings → Tafsir. `undefined`
   * keeps Bayaan's default (the api.quran.com-backed
   * `quranComTafsirProvider`).
   */
  tafsirProvider?: TafsirProvider;
  /**
   * RFC-014 — strategy for wiring the player Mushaf FlashList's scroll
   * handling.
   *
   * `'gorhom'` — `useBottomSheetScrollableCreator()` is called and its
   *   result is passed as `renderScrollComponent` on FlashList. The
   *   swipe-down-to-dismiss gesture on the player sheet is active.
   *   Imperative `scrollToIndex` / `scrollToOffset` calls issued before
   *   the sheet's animation has settled into EXTENDED/FILL_PARENT are
   *   intercepted by the gorhom wrapper and silently no-op.
   *
   * `'native'` — gorhom wrapper skipped; imperative scroll calls reach
   *   the native scroll node immediately, regardless of the sheet's
   *   animation state. The sheet's swipe-down-to-dismiss gesture stops
   *   working at the Mushaf list level — forks opting in must provide
   *   an alternative dismiss affordance (e.g. an explicit close button
   *   in the player header). A `__DEV__`-only warning fires once per
   *   JS context to surface this responsibility.
   *
   * Field absent from `config/branding.js` → consumer applies
   * `?? 'gorhom'` at the call site, byte-equivalent to today's behavior.
   *
   * See docs/rfcs/014-player-scroll-strategy-seam.md.
   */
  playerMushafScrollBehavior?: 'gorhom' | 'native';
  /**
   * RFC-015 — base URL for ayah-timestamp JSONs served from a fork's
   * R2 bucket (or any CDN with the same `{base}/{rewayatId}/{NNN}.json`
   * layout `TimestampFetchService` constructs). Field absent → consumer
   * applies `?? 'https://cdn.thebayaan.com/timestamps'`. No trailing
   * slash; consumer composes `${timestampCdnBase}/${rewayatId}/${paddedSurah}.json`.
   *
   * See docs/rfcs/015-timestamp-cdn-seam.md.
   */
  timestampCdnBase?: string;
  /**
   * RFC-019 — optional provider for **bundled** ayah-timing data, for forks
   * that ship their own offline-authored timestamps for a reciter rather than
   * serving them from a CDN (see `timestampCdnBase`, RFC-015).
   *
   * Called by `TimestampFetchService.fetchAndCache` (the data path) before any
   * network fetch, and only for a `(rewayatId, surahNumber)` the companion
   * `timestampLocalSurahList` claims. Return the surah's timestamps (validated
   * with the same first-element shape guard the R2 path uses, then written to
   * the cache with source `'local'`), or `null` to fall through to the
   * existing R2/CDN path.
   *
   * Field absent → consumer applies `?? null` at the call site →
   * byte-equivalent to today's behavior (network-only resolution). Bayaan
   * ships this unset.
   *
   * Must be synchronous and side-effect-free. Read bundled data from a
   * module-level import, not I/O.
   *
   * See docs/rfcs/019-timestamp-local-provider.md.
   */
  timestampLocalProvider?: (
    rewayatId: string,
    surahNumber: number,
  ) => AyahTimestamp[] | null;
  /**
   * RFC-019 — optional **coverage signal** companion to
   * `timestampLocalProvider`: the list of surah numbers the bundle covers for
   * a rewayat, or `null` / `[]` for a rewayat with no local coverage.
   *
   * This is what `hasSource` / `hasSurah` consult to gate the follow-along UI —
   * NOT a presence probe against the data provider. Coverage is an **exact
   * allow-list**: a surah counts as locally covered only when this list
   * includes it. Unlike the R2 path, an empty list does NOT mean "all surahs";
   * it means "no local coverage". Keying coverage by rewayat (rather than
   * probing a fixed sentinel surah) is required for **partial-coverage**
   * reciters whose `surah_list` lacks surah 1 — a surah-1 probe would falsely
   * suppress the feature for them.
   *
   * Mirrors the catalog's existing `Rewayat.timestamps_surah_list?: number[]`
   * one-to-one, so the local path answers coverage the same way the R2 path
   * already does. A fork sets this alongside `timestampLocalProvider`; the two
   * must agree (every surah in the list must have data from the provider).
   *
   * Field absent → consumer applies `?? null` at the call site →
   * byte-equivalent to today's behavior. Bayaan ships this unset.
   *
   * Must be synchronous and side-effect-free.
   *
   * See docs/rfcs/019-timestamp-local-provider.md.
   */
  timestampLocalSurahList?: (rewayatId: string) => number[] | null;
}

/** Qariah-specific extensions on top of upstream's Branding interface. */
export interface QariahBranding extends Branding {
  appName: 'Qariah';
  appSlug: 'qariah';
  urlScheme: 'qariah';
  bundleId: {ios: 'com.qariah.app'; android: 'com.qariah.app'};

  /** Universal-link host. Set when DNS + apple-app-site-association are wired. */
  associatedDomain: string | undefined;

  /**
   * User-facing support contact email. Settings → Support / Feature
   * Request fire `mailto:<supportEmail>` intents pointed here.
   */
  supportEmail: string;

  /**
   * Apple App Store numeric ID for this app's listing (the `id######`
   * segment of the App Store URL). Drives the "Write a Review" deep link.
   * Qariah-only for now; multi-tenant XF candidate (companion to Bayaan
   * #271 which lifted PLAY_STORE_ID / RATED_KEY to branding.appSlug).
   */
  appStoreId: string;

  /** Extra URLs beyond upstream's flat support/terms/privacy/share fields. */
  urls: {
    readonly home: string;
    readonly github: string;
  };

  /** AsyncStorage key prefix for user-data keys. */
  storageKeyPrefix: string;

  theme: {
    readonly defaultPrimaryColor: string;
  };

  assets: {
    readonly appIcon: {
      readonly iosLegacy: string;
      readonly ios: {
        readonly dark: string;
        readonly light: string;
        readonly tinted: string;
      };
      readonly androidAdaptive: {
        readonly foregroundImage: string;
        readonly backgroundColor: string;
      };
      readonly androidNotification: string;
    };
    readonly splash: {
      readonly image: string;
      readonly imageDark: string;
      readonly backgroundColor: string;
      readonly backgroundColorDark: string;
    };
  };

  analytics: {
    readonly posthogApiKeyEnvVar: string;
  };

  /** Sprint 8 — pre-aggregated stats served as static JSON from R2. */
  stats: {
    readonly topRecitersUrl: string;
  };

  /**
   * Sprint 16 RFC-010 (drafted upstream as a Branding field; lives on
   * QariahBranding while the upstream RFC is in review). Points at a small
   * JSON containing `{version: number, url?: string}` — version is a
   * monotonically incrementing counter (catalog mutations), url is an
   * immutable per-version snapshot. Polled on cold-start + AppState
   * 'active'; triggers a catalog refetch when server > last-seen.
   */
  catalogVersionEndpoint?: string;

  /**
   * Sprint 23 RFC-011 (drafted upstream as a `Branding` field via
   * doc-PR thebayaan/Bayaan#264; lives on QariahBranding while the
   * upstream code-PR is in review). Maximum number of recent reading
   * positions the Surahs-tab "Continue Reading" hero shows. `1` (or
   * omitted) preserves Bayaan's single-card behavior; values > 1 render
   * a horizontal carousel of the last N stopping points. Clamped to
   * [1, 10] at read time. Lifts to upstream `Branding` once the
   * RFC-011 code-PR merges, retiring this fork-only declaration.
   */
  continueReadingHistorySize?: number;

  // RFC-014 (playerMushafScrollBehavior) + RFC-015 (timestampCdnBase) lifted
  // to upstream `Branding` via PRs #285 / #286 (absorbed Sprint 27). Both
  // declarations retired here; values still set in `branding.js`.

  /**
   * Sprint 27 — fork-supplied community-reflections fetcher used by the
   * Mushaf-tab inline "Community Reflections" toggle
   * (`store/mushafSettingsStore.showCommunityReflections`). Called per
   * verse render when the toggle is on AND the user is authenticated;
   * `undefined` keeps the toggle off entirely (Bayaan upstream has no
   * community surface to plug in here).
   *
   * Resolves to an array (possibly empty) of verified, popular reflections
   * for the given (chapterId, verseNumber). Caller is responsible for
   * caching — the seam expects to be called freely. Throws/rejects on
   * network or scope errors; the consuming subcomponent renders an
   * empty/error state silently.
   *
   * `locale` should match the user's translation preference (`en`, `ar`,
   * `id`, …) — the impl combines `${locale},en` to surface English
   * fallbacks when the local-language pool is sparse. `undefined` defaults
   * to `'en'`.
   *
   * Lives on `QariahBranding` (not base `Branding`) because Bayaan has no
   * QF/QuranReflect integration today. If/when Bayaan opts in, this lifts
   * to upstream as an RFC the same way RFC-009 lifted translation/tafsir
   * providers.
   */
  communityReflectionsProvider?: (
    chapterId: number,
    verseNumber: number,
    locale?: string,
  ) => Promise<AyahReflection[]>;

  auth: {
    readonly enabled: boolean;
    readonly provider: 'qf';
    readonly qfOAuthBaseUrl: string;
    readonly qfApiBaseUrl: string;
    readonly qfClientIdEnvVar: string;
    readonly qfClientSecretEnvVar: string;
    readonly scopes: readonly string[];
  };
}

declare const branding: QariahBranding;
export default branding;
