/**
 * Qariah v2 — Branding configuration.
 *
 * Single source of truth for every brand-specific string, URL, and asset path.
 * The branding-conformance CI workflow (.github/workflows/branding-conformance.yml)
 * fails the build if hardcoded "Bayaan" or "thebayaan.com" reappears anywhere
 * outside this file (or the explicit allowlist).
 *
 * Shape conforms to upstream's `Branding` interface from RFC-007 (merge ebf37ea):
 * upstream's flat fields (appName, appSlug, urlScheme, bundleId, supportUrl,
 * termsUrl, privacyUrl, shareBaseUrl, emailProductName, catalog) are present
 * verbatim so PR #237's call-site changes drop in cleanly once merged. Qariah
 * extension fields (urls.home, urls.github, theme, assets, analytics, auth,
 * storageKeyPrefix, associatedDomain) live alongside.
 *
 * **Why CommonJS, not TypeScript?** This file is loaded directly by Expo CLI
 * (`@expo/config` → `@expo/require-utils`) when evaluating `app.config.ts`.
 * Expo transpiles the entry config but does NOT recursively transpile imported
 * files, so this module has to resolve as plain JavaScript at runtime. The
 * sibling `branding.d.ts` file gives TypeScript code full literal-narrow types.
 *
 * **Export shape:** `module.exports = branding` (default) — matches upstream's
 * RFC-007 export pattern. Consumers `require('@/config/branding')` and use the
 * returned object directly, or `import branding from '@/config/branding'`.
 */

const branding = {
  // ───────── Upstream Branding interface (RFC-007) ─────────
  appName: 'Qariah',
  appSlug: 'qariah',
  urlScheme: 'qariah',
  bundleId: {
    ios: 'com.qariah.app',
    android: 'com.qariah.app',
  },
  supportUrl: 'https://qariah.org/support',
  termsUrl: 'https://qariah.org/terms',
  privacyUrl: 'https://qariah.org/privacy',
  // NOTE: shareBaseUrl is intentionally still on qariah.app while the rest of
  // the URL surface moved to qariah.org (2026-05-27). It's the universal-link
  // host for share-card deep links, which only resolves cleanly back into the
  // app when the corresponding apple-app-site-association +
  // Android assetlinks.json are served from this host. Flipping the host
  // without serving those first would break deep-linking on every newly-
  // shared card (graceful browser fallback, but still a regression for
  // shared-card UX). Migration to app.qariah.org is tracked as TECH_DEBT
  // entry — see TECH_DEBT.md "shareBaseUrl host migration qariah.app →
  // qariah.org".
  shareBaseUrl: 'https://app.qariah.app',
  emailProductName: 'Qariah',
  catalog: {
    // RFC-007 fields:
    source: 'remote',
    fallbackPath: './assets/data/catalog.json',
    // Qariah extension: live-update URL when source = 'remote'.
    // Uploaded by scripts/upload-catalog.mjs to R2 bucket the configured audio bucket at
    // `catalog/catalog-v1.json`. Sprint 5 S5.2 swap from the original
    // `qariahaudio.s3.wasabisys.com` Wasabi-hosted JSON (Wasabi access removed
    // during Sprint 2 R2 migration → 403 since). App falls back to
    // `fallbackPath` on any non-200; bundled is the source of truth for
    // shipped builds.
    liveUrl: process.env.EXPO_PUBLIC_CATALOG_URL || undefined,
  },

  // Sprint 17 (S17.6) — RFC-010 catalog-version polling endpoint.
  // Lightweight `{version, url?}` doc served from the same R2 bucket;
  // published atomically by the ops console after each catalog write.
  // Mobile clients poll on cold-start + foreground and trigger a refetch
  // when server-version > last-seen-version. Versioned `url` (when present)
  // is CDN-cacheable forever — preferred over the live mutable `liveUrl`.
  catalogVersionEndpoint:
    process.env.EXPO_PUBLIC_CATALOG_VERSION_URL || undefined,

  // Sprint 28 (S28.2) — asset access gating. When `enabled`, audio + reciter-
  // photo URLs on `legacyHost` are rewritten to `host` (the media-proxy Worker
  // fronting the private asset bucket). Default-off → URLs pass through
  // unchanged. Env-driven (no storage origins in source — see
  // scripts/check-url-leaks.sh): real values in gitignored .env.local,
  // placeholders in .env.example. Flip on only AFTER the Worker is live at
  // `host` (runbook: planning/asset-gating-cloudflare-runbook.md). The
  // live-catalog rewrite (scripts/rewrite-catalog-to-proxy.mjs) covers
  // already-installed builds; this client-side seam covers new builds + is the
  // rollback lever.
  audioStreamProxy: {
    enabled: process.env.EXPO_PUBLIC_ASSET_PROXY_ENABLED === 'true',
    host: process.env.EXPO_PUBLIC_ASSET_PROXY_HOST || undefined,
    legacyHost: process.env.EXPO_PUBLIC_ASSET_LEGACY_HOST || undefined,
  },

  // ───────── Qariah extension fields ─────────

  /** Universal-link host. Set when DNS + apple-app-site-association are wired up. */
  associatedDomain: undefined,

  /**
   * User-facing support contact email. Used by Settings → Support /
   * Feature Request menu items to fire a `mailto:` intent (opens the
   * user's default mail app pre-addressed). Preferred over opening
   * supportUrl in a browser because most users have a mail app and
   * fewer have an account on the support website.
   */
  supportEmail: 'info@qariah.org',

  /**
   * Apple App Store numeric ID for Qariah's listing (the `id######` segment
   * of the App Store URL). Drives the "Write a Review" deep link in
   * utils/reviewUtils.ts. Verified 2026-06-07 via iTunes lookup:
   * id 1594917787 → "Qariah" / com.qariah.app / Maryam Amirebrahimi.
   * (Replaces the inherited Bayaan id 6648769980 → "Bayaan" / com.bayaan.app.)
   * Android uses bundleId.android directly. Qariah-only for now; multi-tenant
   * XF candidate (companion to Bayaan #271 which lifted PLAY_STORE_ID).
   */
  appStoreId: '1594917787',

  /** Extra URLs beyond upstream's flat support/terms/privacy/share fields. */
  urls: {
    home: 'https://qariah.org',
    github: 'https://github.com/Qariah',
  },

  /** AsyncStorage key prefix for user-data keys. */
  storageKeyPrefix: '@qariah',

  theme: {
    defaultPrimaryColor: 'Indigo',
  },

  assets: {
    appIcon: {
      iosLegacy: './assets/branding/icon.png',
      ios: {
        dark: './assets/branding/ios-dark.png',
        light: './assets/branding/ios-light.png',
        tinted: './assets/branding/ios-tinted.png',
      },
      androidAdaptive: {
        foregroundImage: './assets/branding/adaptive-icon.png',
        // Sage — matches splash light + iOS light icon background. Picked
        // during Sprint-10 brand-artwork rollout. Was inherited Bayaan teal
        // (`#8dc9d6`) when this file was authored.
        backgroundColor: '#a4bba9',
      },
      androidNotification: './assets/branding/notification_icon.png',
    },
    splash: {
      image: './assets/branding/splash-icon.png',
      imageDark: './assets/branding/splash-icon-dark.png',
      // Splash bg colors match the iOS icon backgrounds so the launch
      // transition (splash → first app frame) is seamless. Light splash on
      // Sage hands off to the cream-app theme; dark splash on Teal hands
      // off to the night-app theme. Picked during Sprint-10 brand-artwork
      // rollout. Were `#ffffff` / `#000000` (placeholders) before.
      backgroundColor: '#a4bba9',
      backgroundColorDark: '#2f5059',
    },
  },

  analytics: {
    posthogApiKeyEnvVar: 'EXPO_PUBLIC_POSTHOG_API_KEY',
  },

  /**
   * Sprint 8 — Qariah-side aggregated stats published as static JSON to R2.
   * The publisher (`scripts/publish-trending-reciters.mjs`) queries PostHog
   * with a server-side Personal API Token and writes pre-aggregated results
   * to these URLs; the client `fetch()`es with no auth. See ledger note
   * "PostHog → R2 static-aggregate pipeline" for the full pattern.
   */
  stats: {
    /** Top reciters by `playback_started` count over a rolling window. */
    topRecitersUrl: process.env.EXPO_PUBLIC_TOP_RECITERS_URL || undefined,
  },

  /**
   * Sprint 23 (S23.3) RFC-011 — Continue-Reading hero history size.
   * Replaces the Sprint-18 `qariahRecentPagesCarousel` boolean flag with
   * the RFC-011 numeric config (doc-PR thebayaan/Bayaan#264). `5` renders
   * a horizontal carousel of the last 5 stopping points; `1` would
   * restore Bayaan's single-card hero. Clamped to [1, 10] at read time.
   */
  continueReadingHistorySize: 5,

  /**
   * Listen-tab home-row order + visibility (XF-NNN RFC, upstream PR #260).
   *
   * Single source of truth for which rows render and in what order. The
   * legacy `qariah*Row` feature flags are SUPERSEDED by this array as of
   * Sprint 15: each row's `enabled: true|false` reproduces the prior flag
   * value verbatim. The flags themselves remain in `config/featureFlags.ts`
   * as deprecation telegraphs for one observation sprint, then removed.
   *
   * Order matches the Sprint 13 product call (Continue → Rewaya → Country
   * → Translations → Honored → Paradise → Newly Added → Full Recording →
   * Favorites → Trending), with hidden rows appended at the end.
   */
  homeRowConfig: [
    // ----- Visible rows -----
    // Sprint 26 trimmed to 7 discovery-focused rows (per user direction
    // 2026-05-24). 2026-06-28: restored the "Continue Listening" resume row at
    // the TOP (matches Bayaan's canonical order + standard resume UX). Order is
    // the visual order on the Listen tab; auto-hide-on-empty applies —
    // continue-listening stays hidden until the user has play history, so a
    // brand-new user still lands on the discovery rows; trending hides until
    // its R2 JSON is populated.
    {id: 'continue-listening', enabled: true}, // resume row — auto-hides until the first recitation plays
    {id: 'rewayat', enabled: true}, // Section title "Browse by Rewaya"
    {id: 'country', enabled: true}, // Section title "Browse by Country"
    {id: 'full-recording', enabled: true}, // Section title "Full Quran" (Sprint 26 rename from "Full Recording")
    {id: 'trending', enabled: true}, // auto-hides on empty R2 JSON
    {id: 'newly-added', enabled: true},
    {id: 'honored', enabled: true},
    {id: 'paradise', enabled: true},
    // ----- Hidden per user direction (Sprint 26 — translations + favorites) -----
    {id: 'translations', enabled: false}, // Sprint 15 visible; Sprint 26 hidden — discovery-focus
    {id: 'favorites', enabled: false}, // user-state row hidden
    // ----- Flag-hidden Bayaan defaults (preserved per fork-discipline rule #2) -----
    {id: 'most-played', enabled: false}, // Sprint 13 hid (was Sprint 8 default-on)
    {id: 'new-to-quran', enabled: false},
    {id: 'featured', enabled: false},
    {id: 'adhkar', enabled: false}, // Qariah doesn't ship adhkar at launch
    {id: 'playlists', enabled: false},
    {id: 'exclusives', enabled: false},
    {id: 'tajweed', enabled: false},
    {id: 'memorization', enabled: false},
    {id: 'follow-along', enabled: false},
    {id: 'collection', enabled: false},
  ],

  /**
   * RFC-015 — base URL for ayah-timestamp JSONs. Points at Qariah's own
   * R2 bucket (`cdn.example.com/timestamps/...`) so when Qariah
   * starts mirroring timestamps for non-Zaynab reciters (TECH_DEBT #36
   * trigger), the fetch path resolves against the right CDN. Field
   * absent from Bayaan's branding.js → consumer applies the
   * `cdn.thebayaan.com/timestamps` fallback. See upstream RFC-015
   * (thebayaan/Bayaan combined doc+code PR) and TECH_DEBT #88 (closed
   * by this adoption).
   */
  timestampCdnBase: process.env.EXPO_PUBLIC_TIMESTAMP_CDN_BASE || undefined,

  /**
   * RFC-019 — bundled ayah-timing provider pair (upstream Bayaan #305,
   * absorbed 2026-07 / Sprint 41). Routes Qariah's bundled Zaynab Talha
   * timings (`assets/data/timings/`, Sprint 8) through the upstream seam:
   * `TimestampFetchService.hasSource`/`hasSurah` gate the follow-along UI on
   * the coverage list (exact allow-list — empty/null means NO local
   * coverage), and `fetchAndCache` reads the data provider before any
   * network fetch, writing the result to the SQLite cache as source
   * `'local'`. Retires the hand-patched `'local'` source branch the service
   * carried since Sprint 8 (silently dropped by Sprint 26's wholesale
   * absorption, re-preserved via 93821ea — a Sprint-24-rule-#4 recurrence
   * site this seam now closes structurally).
   *
   * The lazy `require` keeps `app.config.ts`'s config-time `require` of this
   * file from evaluating the ~44k-line TS timings registry at Node
   * config-time (plain Node can't require `.ts`; Metro/jest transform it at
   * runtime — pattern matches `initialPlayerVerseKey` below, Sprint 24
   * standing rule #2). RFC-019 contracts both functions synchronous +
   * side-effect-free: `require()` is synchronous and module-cached, so the
   * contract holds.
   */
  timestampLocalProvider: (rewayatId, surahNumber) => {
    const {getBundledTimings} = require('../assets/data/timings');
    return getBundledTimings(rewayatId, surahNumber);
  },
  timestampLocalSurahList: rewayatId => {
    const {getBundledSurahList} = require('../assets/data/timings');
    return getBundledSurahList(rewayatId);
  },

  /**
   * RFC-014 — opt out of the gorhom bottom-sheet scrollable wrapper on the
   * player's Mushaf FlashList. Qariah's catalog includes partial-ayah
   * recitations (e.g. Bouchra Ferhat's Al-Baqarah 79–86); RFC-013's
   * `initialPlayerVerseKey` mechanism issues a 2-rAF deferred
   * `scrollToIndex` to anchor those tracks. The gorhom wrapper intercepts
   * imperative scrolls while the sheet animation is in transition (any
   * state other than EXTENDED/FILL_PARENT), which on iOS Release builds
   * silently no-ops our anchor call → track plays from ayah 79 but list
   * lands at ayah 1. Switching to 'native' bypasses the wrapper; the
   * sheet stays dismissable via the (×) button in the player header.
   * See Sprint 23 fix + Sprint 24 regression diagnosis (retro) and
   * upstream RFC-014 (thebayaan/Bayaan#279 doc / #285 code).
   */
  playerMushafScrollBehavior: 'native',

  /**
   * RFC-013 — anchor the PlayerSheet ayah list on the start of a partial
   * recitation's ayah range, when one exists. Called on cold-mount and on
   * every currentSurah change thereafter. Returns `"surah:ayah"` (e.g.
   * `"2:197"`) or `undefined` to keep the default scroll-to-top behavior.
   *
   * The lazy `require` keeps `app.config.ts`'s config-time `require` of
   * this file from pulling in React-Native modules — `services/dataService`
   * transitively imports RN code which would crash at Expo CLI eval time.
   * Runtime callers (`QuranView`) hit the field after the bundler has
   * loaded the full RN module graph, so the require resolves cleanly.
   *
   * Replaces the inline `getSurahMetadataSync` branch Qariah carried in
   * `components/player/v2/PlayerContent/QuranView/index.tsx` from Sprint 23
   * post-close addendum until upstream merged RFC-013 (#269) on 2026-05-23.
   */
  initialPlayerVerseKey: track => {
    if (!track?.surahId || !track.reciterId) return undefined;
    const surahNum = parseInt(track.surahId, 10);
    if (Number.isNaN(surahNum)) return undefined;
    // Lazy require — only evaluated at runtime, never by app.config.ts.

    const {getSurahMetadataSync} = require('../services/dataService');
    const meta = getSurahMetadataSync(
      track.reciterId,
      track.rewayatId,
      surahNum,
    );
    if (!meta || meta.is_full || !meta.range) return undefined;
    return `${track.surahId}:${meta.range.from}`;
  },

  /**
   * Sprint 27 (S27.1) — Mushaf-tab inline "Community Reflections" fetcher.
   *
   * Lazy `require` keeps `app.config.ts`'s config-time `require` of this
   * file from pulling in `services/userState/communityReflections`'s SDK
   * dependency chain (which transitively imports RN-only modules and
   * would crash Expo CLI at Node config-time). Pattern matches
   * `initialPlayerVerseKey` above and `listenTabTopComponent` below
   * (Sprint 24 standing rule #2). Runtime callers
   * (`<AyahCommunityReflections />`) hit the field after the bundler
   * has loaded the full RN module graph, so the require resolves cleanly.
   *
   * See `services/userState/communityReflections.ts` for the bracket-array
   * filter shape the underlying call uses.
   */
  communityReflectionsProvider: (chapterId, verseNumber, locale) => {
    const {
      listCommunityReflectionsByAyah,
    } = require('../services/userState/communityReflections');
    return listCommunityReflectionsByAyah(chapterId, verseNumber, locale);
  },

  auth: {
    enabled: true,
    provider: 'qf',
    qfOAuthBaseUrl: 'https://oauth2.quran.foundation',
    qfApiBaseUrl: 'https://apis.quran.foundation',
    qfClientIdEnvVar: 'EXPO_PUBLIC_QF_CLIENT_ID',
    qfClientSecretEnvVar: 'QF_CLIENT_SECRET',
    scopes: [
      'openid',
      'offline_access',
      'user',
      'collection',
      'content',
      'post.read',
      'comment.read',
    ],
  },
  // NOTE: A second `homeRowConfig` literal previously sat here (Bayaan's
  // hardcoded 12-row default, carried in from an upstream merge). JavaScript
  // object-literal duplicate-key semantics meant THIS later block silently
  // shadowed Qariah's curated array above — RecitersView.tsx then rendered
  // Bayaan's order with "Exclusives" visible, even though the source code at
  // line ~153 declared a 7-row Qariah lineup. Removed 2026-05-25, re-removed
  // 2026-05-26 after upstream/develop merge. If a future upstream sync
  // re-introduces this block, delete it again and keep only the single
  // Qariah `homeRowConfig` near the top of this file.
};

/**
 * Sprint 25 (S25.2) RFC-008 — Listen-tab top region slot.
 * Replaces the Sprint-19 `qariahListenTabTopGrid` feature flag (now
 * retired) with the upstream `branding.listenTabTopComponent` seam
 * (upstream PR thebayaan/Bayaan#266). RecitersView.tsx consumes the
 * component as `<ListenTabTopComponent />` when defined, else falls
 * back to upstream's `RecitersHero`.
 *
 * Installed via `Object.defineProperty` getter so the `require()` only
 * fires on field access at runtime, NOT at `app.config.ts` config-time
 * load. ListenTabTopGrid transitively imports React-Native modules that
 * crash Expo CLI if evaluated at Node config-time. Same lazy-deferral
 * pattern as `initialPlayerVerseKey` above, expressed as a getter
 * because the upstream consumer reads the field as a value (not a
 * factory function) per RFC-008's `ComponentType<...>` typing.
 * `app.config.ts` never accesses this field; the getter never fires
 * during Expo CLI evaluation.
 */
Object.defineProperty(branding, 'listenTabTopComponent', {
  enumerable: true,
  configurable: true,
  get() {
    return require('../components/hero/ListenTabTopGrid').ListenTabTopGrid;
  },
});

module.exports = branding;
