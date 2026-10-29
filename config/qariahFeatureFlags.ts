/**
 * Qariah-only feature flags (build switches for Qariah code).
 *
 * Upstream's RFC-007 flags stay in `config/featureFlags.ts`, which keeps
 * upstream's file and differs only in the values of the upstream features that
 * Qariah hides. The flags here have no upstream counterpart: cold-start levers,
 * report-only probes, an experiment and one Browse filter. They moved out of
 * `config/featureFlags.ts` in the 2026-10-24 divergence batch C1, with the same
 * values. Read them with `isQariahFeatureEnabled`.
 *
 * Status legend: `// v2` — the shipping state; `// permanent` — not coming back.
 */
export const qariahFeatureFlags = {
  // ───────── Sprint 11 — Browse filter override ─────────

  /**
   * Browse → Filter modal: "Recitation Styles" section (Mojawwad / Molim /
   * Murattal chips). Bayaan uses this taxonomy; Qariah's female-reciter
   * catalog does not categorize reciters this way.
   * Hiding the section prevents user confusion without touching Bayaan's
   * filter data model — `FilterOptions.styles` field remains on the type
   * but is always treated as empty when this flag is off.
   */
  qariahRecitationStyleFilter: false, // permanent — Qariah does not use this taxonomy

  // ───────── Sprint 30 — cold-start performance ─────────

  /**
   * Defer the Mushaf preload (DigitalKhatt SQLite + Skia typefaces + the RN-side
   * DigitalKhatt OTFs) OFF the splash-blocking init set. When true, the preload
   * is fired non-awaited early in `bootApp()` (services/qariahBoot.ts) so the Listen
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
   * moment. Refresh the bundle before each release build with
   * `node scripts/sync-bundled-catalog.mjs --apply`; the archive scripts warn
   * when it differs from live (a Sprint 28 copy once missed a later reciter).
   * Warm launches are unaffected (already cache-first). Flip to false to
   * restore the blocking first-launch fetch. TECH_DEBT #116.
   * See planning/perf-audit-2026-06-04.md (B2).
   */
  bundleFirstCatalog: true, // v2 — Sprint 30 first-launch cold-start opt

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
  // review-by: 2027-01-15 (TECH_DEBT #234) — remove if nobody reads the `memory-pressure` Sentry message
  memoryPressureProbe: true, // v2 — S35.2 report-only field probe; remote opt-in (applies on a later cold start)

  // ───────── Sprint 35 — cold-start performance ─────────

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

  // ───────── Sprint 38 — cold-start performance ─────────

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

  // ───────── Native main-thread freeze watchdog (report-only) ─────────

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
  // review-by: 2027-01-15 (TECH_DEBT #234) — remove if nobody reads the `main_thread_stalls` context or `prev_process_main_thread_stalls` on `cold_start_began`
  mainThreadWatchdog: true, // v2 — report-only; gated further by the diagnostics cohort

  // ───────── Playback-health telemetry (report-only) ─────────

  /**
   * @ai REPORT-ONLY playback-health events (`playback_health_attempt`,
   * `playback_health_first_audio`, `playback_health_no_audio`) from
   * services/diagnostics/playbackHealth.ts. No UI, no player-state change.
   * Local hard-off: the runtime activation is ALSO gated by the PostHog
   * boolean flag `playback_health` (fails closed until it resolves to true).
   * Flip to false to hard-disable in the next build.
   */
  // review-by: 2027-01-15 (TECH_DEBT #234) — remove if nobody reads the `playback_health_attempt`, `playback_health_first_audio` or `playback_health_no_audio` events
  playbackHealthTelemetry: true, // v2 — report-only; gated further by `playback_health`

  /**
   * @ai Qariah (ANR investigation WS-C, hypothesis H1) — Android non-blocking
   * boot splash. When active, the app window draws at once and a native
   * overlay keeps the splash look until the app is ready, so a BACK/VOLUME key
   * during a long boot no longer ANRs with "No focused window". Local
   * hard-off: the runtime activation is ALSO gated by the PostHog multivariate
   * flag `nonblocking_splash_v2` (only variant `treatment` arms; fails closed;
   * applies at the NEXT cold start because MainActivity reads it before JS
   * runs; only enrolled `boot_risk` devices get a variant — see
   * services/bootSplash). iOS is unaffected. Flip to false to
   * hard-disable in the next build. See modules/qariah-boot-splash.
   */
  nonBlockingSplash: true, // v2 — experiment; gated further by `nonblocking_splash_v2`
} as const;

export type QariahFeatureFlag = keyof typeof qariahFeatureFlags;

/** Read a Qariah-only feature flag. */
export function isQariahFeatureEnabled(flag: QariahFeatureFlag): boolean {
  return qariahFeatureFlags[flag];
}
