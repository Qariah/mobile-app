/**
 * Qariah v2 — Feature flags.
 *
 * Hide upstream Bayaan features that Qariah v2 doesn't ship at launch.
 * **Never delete** the upstream code — deletions cause merge conflicts on
 * every weekly upstream sync. Hide behind a flag instead, and the flag flips
 * back on (or the feature un-hides) when Qariah is ready to launch it.
 *
 * Conforms to upstream's RFC-007 feature-flag layer (merge ebf37ea): same
 * `featureFlags as const` shape + `FeatureFlag` keyof type + `isFeatureEnabled`
 * reader. Qariah extends with extra fork-only keys (qfAuth, qfUserStateSync,
 * ayahFollowAlong) — these widen the `FeatureFlag` union automatically via
 * `keyof typeof`.
 *
 * Status legend on each flag:
 *   - `// v2`        — final state for v2 launch
 *   - `// v2.x`      — re-evaluate in a v2.x sprint
 *   - `// permanent` — Qariah will never ship this; not coming back
 */

export const featureFlags = {
  // ───────── Hidden in v2 (revisitable in v2.x) ─────────

  /** Adhkar / Tasbeeh module — no women-audio canon at launch. */
  adhkar: false, // v2.x

  /** Ambient audio overlay during reading sessions. Bayaan-specific UX polish — Qariah ships it OFF. */
  ambientAudioOverlay: false, // v2 — hidden (Qariah divergence)

  /** User uploads / custom MP3 imports. DRM ambiguity, malware risk. */
  userUploads: false, // v2.x

  /** Word-by-word transliteration overlay. Separate render path. */
  wordByWordTransliteration: false, // v2.x

  /** Push notifications (FCM). Defer until Qariah has a content cadence to push. */
  pushNotifications: false, // v2.x

  /** Colored highlights (5 colors) — keep simple binary bookmarks for v2. */
  coloredHighlights: false, // v2.x

  /** Per-verse text notes. Native QF resource fits when un-hidden. */
  verseNotes: true, // v2 — Sprint 18 launch (local-only baseline; QF sync ships in Slice B)

  // Sprint 23 (S23.3) — `qariahRecentPagesCarousel` removed. The
  // Recent-Reading carousel is now driven by the RFC-011 numeric config
  // `branding.continueReadingHistorySize` (5 = carousel, 1 = single hero)
  // instead of a boolean flag. See config/branding.{js,d.ts}.

  // ───────── Permanently dropped ─────────

  /** Background video overlay (legacy Flutter Qariah feature). Not in upstream; not coming back. */
  backgroundVideoOverlay: false, // permanent

  // ───────── Kept (great features upstream ships polished) ─────────

  /** Multi-translation overlay + reordering. */
  multiTranslation: true, // v2

  /** Tafsir overlay. */
  tafsir: true, // v2

  /** Sleep timer. Standard Quran-app feature. */
  sleepTimer: true, // v2

  // ───────── Qariah-only features ─────────

  /** QF OAuth sign-in flow. Upstream has no auth. */
  qfAuth: true, // v2

  /** Sync user state to QF user-data API. Restore-on-reinstall. */
  qfUserStateSync: true, // v2

  /** Ayah follow-along highlight. Works for reciters with timing data. */
  ayahFollowAlong: true, // v2 (degrades gracefully when timing data is missing)

  // ───────── Sprint 8 — feedback-driven home rows (Qariah-only) ─────────

  /**
   * Home-row: "Browse by Country/Region". Surfaces reciters grouped by
   * `Reciter.country`. Hidden until the catalog has country values populated
   * (planning/reciter-bios-template.csv is the source-of-truth; data ships
   * via the catalog regen pipeline).
   */
  qariahCountryRow: true, // v2.x — Sprint 14: catalog now has country for all 63 reciters

  /**
   * Home-row: "Browse by Translation". Surfaces translations available in
   * the app, keyed off the multi-translation feature. Hidden until
   * translation metadata is curated for the home surface.
   */
  qariahTranslationsRow: false, // v2.x — flip to true once translation metadata is curated

  // (Sprint 17 S17.7 — 11 dead qariah*Row flags removed after Sprint 15
  // S15.1's `branding.homeRowConfig.enabled` became the sole driver for
  // which home rows appear. Removed: qariahMostPlayedRow, qariahTrendingRow,
  // qariahFollowAlongRow, qariahExclusivesRow, qariahExploreBySurahRow,
  // qariahNewToQuranRow, qariahFeaturedRecitersRow, qariahYourPlaylistsRow,
  // qariahBestForTajweedRow, qariahBestForMemorizationRow,
  // qariahFromCollectionRow. Live row flags retained below.)

  // ───────── Sprint 11 — Browse filter overrides (Qariah-only) ─────────

  /**
   * Browse → Filter modal: "Recitation Styles" section (Mojawwad / Molim /
   * Murattal chips). Bayaan uses this taxonomy; Qariah's female-reciter
   * catalog does not categorize reciters this way.
   * Hiding the section prevents user confusion without touching Bayaan's
   * filter data model — `FilterOptions.styles` field remains on the type
   * but is always treated as empty when this flag is off.
   */
  qariahRecitationStyleFilter: false, // permanent — Qariah does not use this taxonomy

  // ───────── Sprint 13 — Listen tab redesign (Qariah-only) ─────────

  // Sprint 25 (S25.2) — `qariahListenTabTopGrid` retired. The Listen-tab
  // top region is now driven by `branding.listenTabTopComponent` (RFC-008
  // seam from upstream PR thebayaan/Bayaan#266). RecitersView.tsx consumes
  // the component slot; rollback by setting branding's getter to return
  // `undefined`.

  /**
   * Home-row: "Honored Reciters". Curated collection of reciters in
   * `HONORED_RECITER_NAMES` (data/reciterCollections.ts). Empty until
   * the Sprint 13 curation CSV is filled and applied. Auto-hides when
   * the resolved list is empty.
   */
  qariahHonoredRecitersRow: true, // v2 (auto-hides when empty)

  /**
   * Home-row: "Paradise Reciters". Curated collection — same pattern as
   * Honored. Empty until curation lands.
   */
  qariahParadiseRecitersRow: true, // v2 (auto-hides when empty)

  /**
   * Home-row: "Newly Added". Filters `RECITERS` by `Reciter.date` within
   * the last 30 days. Today's catalog has no reciters in that window;
   * the row auto-hides when empty and populates as new reciters land via
   * `scripts/generate-catalog.mjs`.
   */
  qariahNewlyAddedRow: true, // v2 (auto-hides when empty)

  /**
   * Home-row: "Full Recording". Reciters who have at least one rewayat
   * covering all 114 surahs. Today the catalog has 2 (Hajjah Maria Ulfah
   * and Zaynab Talha) — populates as catalog grows.
   */
  qariahFullRecordingRow: true, // v2 (auto-hides when empty)

  /**
   * `BrowseAllHero` background: when true, renders an animated mosaic of
   * reciter photos pulled from `catalog.json` `image_url`; when false,
   * falls back to the Sprint 0 colored-tile mosaic. Flag is the perf-
   * degradation safety valve — flip to false if ~280 `<Image>` tiles
   * drop frames on low-end devices.
   */
  qariahReciterFaceCollage: true, // v2 (fallback to colored tiles when false)

  // ───────── Sprint 30 — cold-start performance (Qariah-only) ─────────

  /**
   * Defer the Mushaf preload (DigitalKhatt SQLite + Skia typefaces + the RN-side
   * DigitalKhatt OTFs) OFF the splash-blocking init set. When true, the preload
   * is fired non-awaited early in `app/_layout.tsx` `prepare()` so the Listen
   * landing tab (which never touches the Mushaf font stack) is interactive
   * ~0.6s sooner on low-RAM devices (measured Pixel 3 A/B, flag on vs off; the
   * ceiling is set by the next-slowest non-critical init service, not Mushaf
   * alone — the DB-import services are the remaining cold-start lever). Mushaf
   * render surfaces subscribe via
   * `useMushafFontMgr` (Sprint 17 S17.11) and re-render when ready; the only
   * trade-off is a brief fallback-glyph flash if the Mushaf tab is opened within
   * ~2s of cold launch (no crash — `SkiaPage`/`ContinuousMushafView` guard a null
   * fontMgr; `mushafPreloadService.initialize()` is idempotent via `_initPromise`).
   * Flip to false to restore the legacy splash-blocking behavior (instant rollback).
   * Advances TECH_DEBT #110. See planning/perf-audit-2026-06-04.md (B1/B7).
   */
  deferMushafPreload: true, // v2 — Sprint 30 cold-start opt; false = legacy blocking preload

  /**
   * Bundle-first catalog on first launch. When true, `getAllReciters()` populates
   * from the bundled `assets/data/catalog.json` immediately on a cold cache and
   * upgrades to the live catalog in the background — instead of blocking the
   * splash on the live fetch (up to a 10s ceiling on a slow first launch). The
   * RFC-010 version poll + the background refresh converge to live data within a
   * moment; the bundled catalog is regenerated each build so it is current as of
   * the release. Warm launches are unaffected (already cache-first). Flip to
   * false to restore the blocking first-launch fetch. TECH_DEBT #116.
   * See planning/perf-audit-2026-06-04.md (B2).
   */
  bundleFirstCatalog: true, // v2 — Sprint 30 first-launch cold-start opt

  // ───────── Sprint 35 — onboarding activation (Qariah-only) ─────────

  /**
   * First-run discovery nudge (Sprint 35 S35.3). When true (Qariah default), the
   * onboarding `done` step lands first-run users on the reciter browse grid
   * (`/(tabs)/(a.home)/browse-all`) instead of the bare Listen home — directly
   * addressing the Growth finding that **49% of installers never tap a reciter**
   * (post-reciter activation is healthy ~41%). Reversible: flip to false to
   * restore the legacy land-on-Listen behavior. The onboarding funnel events
   * (S35.3) measure its effect. See planning/sprint-35-plan.md.
   */
  onboardingReciterNudge: false, // v2 — DISABLED 2026-06-20 (owner): first-run pushing Browse All on top of Listen read as a bug (lands on a back-navigable screen); land on the Listen home instead (it already has Browse-by-Reciter/Surah/Shuffle tiles). Flip true to restore the S35.3 discovery nudge.

  // ───────── Sprint 35 — memory-pressure field probe (S35.2, REPORT-ONLY) ─────────

  /**
   * Report-only memory-pressure field probe (S35.2 — the media3/Glide OOM, vc1255
   * 7.07%, which we can't reproduce on hand hardware). When true (Qariah default),
   * the app samples the Java-heap ceiling + `Debug.getMemoryInfo()` composition
   * split (via the `qariah-memory` native module) and fires a `memory-pressure`
   * Sentry event on `onTrimMemory(CRITICAL)` — capturing what's filling the heap on
   * the affected devices *before* they OOM. Pure telemetry; no behavioral change.
   *
   * Three gating tiers (defence-in-depth, per the "server-side controllable in case
   * it misbehaves" requirement):
   *   1. This build flag — the hard local on/off. Off → the probe never activates;
   *      the native module stays inert (it does nothing until JS calls setEnabled).
   *   2. Remote opt-in — the PostHog `diagnostics_mode` payload's `memoryProbe`
   *      field: only `true` turns it on; `false` or a missing key keeps it off
   *      (#407, fail closed). `true` cannot override this build flag. A change
   *      normally applies at the next cold start whose flag request succeeds,
   *      not live. Builds without #407 (the release line, and `qariah-main`
   *      builds before 1930) treat a missing key as ON. The one-off diagnostic
   *      APK defaults it on.
   *      See `services/diagnostics/diagnostics.ts`.
   *   3. Native inert-until-enabled — `qariah-memory` only reads stats / emits the
   *      trim event after JS (gated by 1+2) calls `setEnabled(true)`.
   * See planning/s35.2-memory-probe-test-plan.md.
   */
  memoryPressureProbe: true, // v2 — S35.2 report-only field probe; remote opt-in (applies on a later cold start)

  // ───────── Sprint 35 — cold-start performance (Qariah-only) ─────────

  /**
   * Lazy-OPEN the off-Listen-path feature DBs instead of opening them in the
   * splash-blocking `AppInitializer` non-critical batch. When true (Qariah
   * default), the Tafseer / Translation / QUL / WBW services are NOT registered
   * at boot; each opens its SQLite connection on first access to its
   * (off-Listen) surface via an idempotent lazy guard. The Listen landing tab
   * never touches any of them, so this removes their opens from the cold-start
   * critical path.
   *
   * Field-evidence-led (TECH_DEBT #144): the S34.1 `slow_init_service` Sentry
   * tag named **Tafseer DB** as the dominant stalling init service (67% of named,
   * `boot_step=catalog-ready`, recurring through builds 1313–1316). This is
   * DISTINCT from the Sprint-34-killed "defer the bundled IMPORT" lever — the
   * recurring cost is the SQLite `.open()` (`initialize()`), which runs on every
   * cold start, not the first-install-only `importBundledIbnKathir`.
   *
   * Safety: the per-service lazy guard (`ensureReady()` self-init / read-method
   * `await initialize()`) is unconditional and a no-op when the service is
   * already booted, so flipping this flag OFF restores the exact legacy
   * boot-time behavior (instant rollback). See planning/sprint-35-plan.md (S35.1).
   */
  lazyOpenFeatureDbs: true, // v2 — Sprint 35 cold-start opt; false = legacy boot-time open

  // ───────── Sprint 38 — cold-start performance (Qariah-only) ─────────

  /**
   * Defer the Uploads Service + Verse Annotations Service boot init to lazy-open
   * on first access, instead of running them in the splash-blocking
   * `AppInitializer` non-critical batch. When true (Qariah default), neither
   * service is registered at boot; each opens its SQLite connection idempotently
   * on first use (UploadsService already calls `await this.initialize()` at the
   * top of every public method; VerseAnnotationDatabaseService.ensureReady() now
   * self-initializes instead of throwing when the DB hasn't been opened yet).
   *
   * Field-evidence-led (S38.2): Sentry QARIAHV2-G `slow-cold-start` (48 events /
   * 44 users) + QARIAHV2-S `splash-hide-timeout` (27 events / 17 users) on
   * builds 1345/1353, concentrated on OnePlus 8 Pro / Android 11. The S34.1
   * `slow_init_service` tag named **Uploads Service** and **Verse Annotations**
   * as the services still in-flight when the non-critical batch timed out at
   * `boot_step: catalog-ready`. Removing them from the boot batch eliminates
   * their SQLite `.open()` cost from the cold-start critical path entirely.
   *
   * Safety notes:
   * - `userUploads: false` in Qariah v2 — the Uploads surface is fully hidden;
   *   no user path can trigger an upload read before the lazy-open lands.
   * - `warmBookmarkCache()` is removed from the boot path; BookmarkChips drives
   *   its own state from `verseAnnotationService.getAllBookmarks()` in a mount
   *   `useEffect` (BookmarkChips.tsx:30), which lazy-opens the DB. TRADEOFF: on
   *   the FIRST Mushaf-with-bookmarks render of a session the chips populate one
   *   paint late (post-effect) rather than pre-warmed — accepted because bookmarks
   *   are off the cold-start critical path (the app lands on Listen) and the chips
   *   self-correct within a frame.
   * - `verseAnnotationService` callers (sheets, hooks, collection screens) are
   *   all user-triggered and await the service's async methods, so the lazy-open
   *   is transparent.
   * Flip to false to restore the legacy boot-time open (instant rollback).
   * See planning/sprint-38-plan.md (S38.2).
   */
  deferNonCriticalBootServices: true, // v2 — Sprint 38 cold-start opt; false = legacy boot-time open

  // ───────── Native main-thread freeze watchdog (Qariah-only, report-only) ─────────

  /**
   * REPORT-ONLY native main-thread (UI-thread) freeze watchdog (Android-only;
   * iOS no-op). Local hard-off for the `qariah-anr-watchdog` probe — the actual
   * runtime activation is ALSO gated by the diagnostics cohort (`diagnostics_mode`
   * remote flag) + a remote kill-switch (`{"mainThreadWatchdog": false}` in the
   * diagnostics payload). Catches the native main-thread block class (e.g. an
   * expo-audio runBlocking deadlock during playback) that the JS-thread heartbeat
   * is structurally blind to. Since #217 a stall sends no Sentry event of its
   * own: the last 5 stalls ride on other Sentry events as the
   * `main_thread_stalls` context, and the count rides on the next
   * `cold_start_began` (see recordMainThreadStall). Flip to false to
   * hard-disable in the next build.
   */
  mainThreadWatchdog: true, // v2 — report-only; gated further by the diagnostics cohort

  // ───────── Playback-health telemetry (Qariah-only, report-only) ─────────

  /**
   * @ai REPORT-ONLY playback-health events (`playback_health_attempt`,
   * `playback_health_first_audio`, `playback_health_no_audio`) from
   * services/diagnostics/playbackHealth.ts. No UI, no player-state change.
   * Local hard-off: the runtime activation is ALSO gated by the PostHog
   * boolean flag `playback_health` (fails closed until it resolves to true).
   * Flip to false to hard-disable in the next build.
   */
  playbackHealthTelemetry: true, // v2 — report-only; gated further by `playback_health`

  /**
   * @ai Qariah (ANR investigation WS-C, hypothesis H1) — Android non-blocking
   * boot splash. When active, the app window draws at once and a native
   * overlay keeps the splash look until the app is ready, so a BACK/VOLUME key
   * during a long boot no longer ANRs with "No focused window". Local
   * hard-off: the runtime activation is ALSO gated by the PostHog boolean flag
   * `nonblocking_splash` (fails closed; applies at the NEXT cold start because
   * MainActivity reads it before JS runs). iOS is unaffected. Flip to false to
   * hard-disable in the next build. See modules/qariah-boot-splash.
   */
  nonBlockingSplash: true, // v2 — experiment; gated further by `nonblocking_splash`
} as const;

export type FeatureFlag = keyof typeof featureFlags;

/** Read a feature flag. Prefer this over direct object access. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
