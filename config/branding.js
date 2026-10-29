/**
 * Qariah app identity config.
 *
 * CJS (not ESM), so a fork's app.config.js can require() it before Expo CLI
 * transpiles (Bayaan's app.config.js does not). Config plugins must not load
 * it: forks may supply runtime values (components, providers) that Node
 * cannot run. Forks override by replacing this file; the shape is typed in
 * branding.d.ts.
 *
 * See docs/rfcs/007-app-layer-multi-tenancy.md for the design rationale.
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
  // qariah.org serves the share paths /reciter, /quran, /mushaf and /adhkar (TECH_DEBT #95).
  shareBaseUrl: 'https://qariah.org',
  emailProductName: 'Qariah',
  catalog: {
    source: 'remote',
    fallbackPath: './assets/data/catalog.json',
    // Qariah extension: the live catalog URL. Any non-200 falls back to fallbackPath.
    liveUrl: process.env.EXPO_PUBLIC_CATALOG_URL || undefined,
  },

  // RFC-010: the `{version, url?}` document that the app polls on cold start and on foreground.
  catalogVersionEndpoint:
    process.env.EXPO_PUBLIC_CATALOG_VERSION_URL || undefined,

  // Rewrites audio and photo URLs on legacyHost to the media-proxy host. Off by default.
  // Env-driven: no storage host may appear in source (scripts/check-url-leaks.sh).
  audioStreamProxy: {
    enabled: process.env.EXPO_PUBLIC_ASSET_PROXY_ENABLED === 'true',
    host: process.env.EXPO_PUBLIC_ASSET_PROXY_HOST || undefined,
    legacyHost: process.env.EXPO_PUBLIC_ASSET_LEGACY_HOST || undefined,
  },

  // ───────── Qariah extension fields ─────────

  /** App Links host (#516): qariah.org must serve both /.well-known files before a build ships. */
  associatedDomain: 'qariah.org',

  /** Support email for the Settings `mailto:` links. */
  supportEmail: 'info@qariah.org',

  /** App Store numeric id (the `id######` segment) for the "Write a Review" link. */
  appStoreId: '1594917787',

  /** Extra URLs beyond upstream's flat support/terms/privacy/share fields. */
  urls: {
    github: 'https://github.com/Qariah',
  },

  assets: {
    appIcon: {
      ios: {
        dark: './assets/branding/ios-dark.png',
        light: './assets/branding/ios-light.png',
        tinted: './assets/branding/ios-tinted.png',
      },
      androidAdaptive: {
        foregroundImage: './assets/branding/adaptive-icon.png',
        // Sage: matches the light splash and the iOS light icon background.
        backgroundColor: '#a4bba9',
      },
      androidNotification: './assets/branding/notification_icon.png',
    },
    splash: {
      image: './assets/branding/splash-icon.png',
      imageDark: './assets/branding/splash-icon-dark.png',
      // Match the iOS icon backgrounds, so the splash hands off to the first frame with no flash.
      backgroundColor: '#a4bba9',
      backgroundColorDark: '#2f5059',
    },
  },

  /** RFC-011: the number of Continue-Reading hero cards. Clamped to [1, 10] at read time. */
  continueReadingHistorySize: 5,

  /** #555: a tap on a surah of a curated playlist opens the reciter list of that surah (absent → 'play'). */
  systemPlaylistSurahPress: 'browse-reciters',

  /** GitHub #557: at the end of the queue, play the next surah by the same reciter (services/player/utils/queueNextSurah.ts). */
  continueToNextSurah: true,

  /** Listen-tab home-row order and visibility (upstream PR #260). The array order is the visual order. */
  homeRowConfig: [
    // ----- Visible rows -----
    {id: 'continue-listening', enabled: true}, // resume row — auto-hides until the first recitation plays
    {id: 'newly-added-recitations', enabled: true}, // Section title "Newly Added Recitations"; auto-hide while no recitation has an `added_at`
    {id: 'rewayat', enabled: true}, // Section title "Browse by Rewaya"
    {id: 'country', enabled: true}, // Section title "Browse by Country"
    {id: 'full-recording', enabled: true}, // Section title "Full Quran"
    {id: 'honored', enabled: true},
    {id: 'paradise', enabled: true},
    // ----- Hidden -----
    {id: 'favorites', enabled: false}, // user-state row hidden
    // ----- Upstream defaults, hidden (hard rule #2: never delete them) -----
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

  /** RFC-015: the base URL for ayah-timestamp JSONs. Unset falls back to the upstream CDN. */
  timestampCdnBase: process.env.EXPO_PUBLIC_TIMESTAMP_CDN_BASE || undefined,

  /**
   * RFC-019: the bundled Zaynab Talha timings (`assets/data/timings/`). The lazy `require` keeps
   * the app.config.js Node eval from loading the TS timings registry (plain Node cannot require `.ts`).
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
   * RFC-014: 'native' skips the gorhom scroll wrapper. On iOS Release that wrapper drops the
   * partial-ayah anchor scroll (initialPlayerVerseKey) while the sheet animates.
   */
  playerMushafScrollBehavior: 'native',

  /**
   * RFC-013: anchor the player ayah list at a partial recitation's first ayah (`"surah:ayah"`).
   * Lazy `require`: utils/surahMetadata imports React Native, which crashes the app.config.js eval.
   */
  initialPlayerVerseKey: track => {
    if (!track?.surahId || !track.reciterId) return undefined;
    const surahNum = parseInt(track.surahId, 10);
    if (Number.isNaN(surahNum)) return undefined;
    const {getSurahMetadataSync} = require('../utils/surahMetadata');
    const meta = getSurahMetadataSync(
      track.reciterId,
      track.rewayatId,
      surahNum,
    );
    if (!meta || meta.is_full || !meta.range) return undefined;
    return `${track.surahId}:${meta.range.from}`;
  },

  /**
   * RFC-018: maps the QuranReflect feed onto the CommunityReflection shape, one cached request per ayah.
   * Lazy `require`: the QF SDK chain must not load in the app.config.js eval.
   */
  communityReflectionsProvider: (surahNumber, ayahNumber, locale) => {
    const {
      qariahCommunityReflectionsProvider,
    } = require('../services/userState/communityReflectionsProvider');
    return qariahCommunityReflectionsProvider(surahNumber, ayahNumber, locale);
  },

  // Keep ONE `homeRowConfig`: a duplicate key from a merge silently wins (CI no-dupe-keys guards it).
};

/**
 * RFC-008: the Listen-tab top slot. A getter, because upstream reads the field as a value and the
 * `require()` must run on access, never in the app.config.js eval (React Native imports).
 */
Object.defineProperty(branding, 'listenTabTopComponent', {
  enumerable: true,
  configurable: true,
  get() {
    return require('../components/hero/ListenTabTopGrid').ListenTabTopGrid;
  },
});

/** RFC-018: the inline reflections card. A getter for the same reason as listenTabTopComponent. */
Object.defineProperty(branding, 'ayahCommunityReflectionsComponent', {
  enumerable: true,
  configurable: true,
  get() {
    return require('../components/mushaf/QuranReflectAyahReflections')
      .QuranReflectAyahReflections;
  },
});

/**
 * The tablet sidebar mark (TECH_DEBT #355): the Q of the splash images, teal on the light theme and
 * sage on the dark theme. A getter, because the app.config.js Node eval cannot `require()` a PNG.
 */
Object.defineProperty(branding, 'sidebarLogo', {
  enumerable: true,
  configurable: true,
  get() {
    return {
      light: require('../assets/branding/sidebar-logo.png'),
      dark: require('../assets/branding/sidebar-logo-dark.png'),
    };
  },
});

module.exports = branding;
