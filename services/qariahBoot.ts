// @ai Qariah (Pass B, TECH_DEBT #240) — Qariah's hooks on upstream's boot.
//
// Upstream moved the boot out of `app/_layout.tsx` into `services/appBoot.ts`
// (`bootApp()`, once per JS runtime, shared with the headless Android Auto
// root). Qariah's boot steps and boot instrumentation used to sit inline in
// `_layout.tsx` `prepare()`. They now live here, and `appBoot.ts` calls them
// with one line each, so the upstream file stays close to upstream:
//
//   qariahBootStarted()          first thing, before any await
//   qariahBootStep(step)         in markBoot(), for every boot step
//   qariahSlowBootThresholdMs()  the slow-cold-start budget
//   qariahReportSlowColdStart()  the slow-cold-start watchdog body
//   qariahAfterAudioReady()      after expo-audio is ready
//   qariahAfterCatalogReady()    after the reciter catalog is ready (also
//                                starts the local notifications, Sprint 48)
//   qariahBootCompleted()        after the 'ready' step
//
// Each one keeps the behaviour that `_layout.tsx` had before Pass B. Each one
// is also report-only or best-effort, so a throw in a hook must never stop the
// boot: `guardHook()` catches it, reports it, and lets the boot go on.
// `services/__tests__/appBoot.qariah.characterization.test.ts` pins the hook
// order, the flag-gated services and this guard.

import * as Sentry from '@sentry/react-native';
import * as Font from 'expo-font';
import Constants from 'expo-constants';
import {appInitializer} from '@/services/AppInitializer';
import {mushafPreloadService} from '@/services/mushaf/MushafPreloadService';
import {isFeatureEnabled} from '@/config/featureFlags';
import {refetchCatalogToVersion} from '@/services/dataService';
import {initCatalogVersionPolling} from '@/services/catalogVersionPoll';
// Qariah (Sprint 48, S48.6): the boot hook of the local notifications.
import {startQariahNotifications} from '@/services/notifications/backgroundTask';
import {DIAGNOSTIC_BUILD_FLAG} from '@/services/diagnostics/diagnostics';
import {
  markBootStarted,
  markBootStep,
  markBootCompleted,
} from '@/services/diagnostics/bootSentinel';

/** Diagnostic builds report a wedged boot sooner. */
const DIAGNOSTIC_SLOW_BOOT_THRESHOLD_MS = 5000;

/**
 * Run a hook body. A throw is reported and swallowed, so the boot goes on.
 * Upstream's `runBoot()` calls the hooks with no try, and the slow-boot hook
 * runs in a timer, where a throw is an uncaught (fatal) error in a release
 * build.
 */
function guardHook(hook: string, body: () => void): void {
  try {
    body();
  } catch (error) {
    if (__DEV__) console.warn(`[qariahBoot] ${hook} failed:`, error);
    try {
      Sentry.captureException(error, {
        tags: {scope: 'cold-start', boot_hook: hook},
      });
    } catch {
      // The report must not throw into the boot either.
    }
  }
}

// Narrows the `any`-typed expoConfig.extra.version, as app/_layout.tsx does
// for the Sentry release: both fields, or 'unknown' for both.
function readBootVersion(): {version: string; build: string} {
  const raw: unknown = Constants.expoConfig?.extra?.version;
  if (raw != null && typeof raw === 'object') {
    const v = raw as Record<string, unknown>;
    if (
      typeof v.semanticVersion === 'string' &&
      (typeof v.buildNumber === 'string' || typeof v.buildNumber === 'number')
    ) {
      return {version: v.semanticVersion, build: String(v.buildNumber)};
    }
  }
  return {version: 'unknown', build: 'unknown'};
}

/**
 * REPORT-ONLY boot-not-completed sentinel (§2). Call it as the FIRST thing,
 * before any await: a synchronous MMKV write that survives even a hard native
 * freeze of everything after it. qariahBootCompleted() clears it. On the NEXT
 * launch, an uncleared sentinel means THIS launch hung. Observe only.
 */
export function qariahBootStarted(): void {
  guardHook('qariahBootStarted', () => {
    if (carRootBootsFirst) return;
    sentinelActive = true;
    const {version, build} = readBootVersion();
    markBootStarted(version, build);
  });
}

// @ai Qariah (Sprint 46, Pass B review): the boot-not-completed sentinel is
// for the phone boot only. The headless Android Auto root (CarRoot) can boot
// first, has no Sentry, and Android can stop a car service process during the
// boot: its sentinel would read as a phone hang on the next launch (#187).
let carRootBootsFirst = false;
let sentinelActive = false;

/** CarRoot calls this right before bootApp(). A no-op when the phone booted. */
export function markCarRootBoot(): void {
  if (!sentinelActive) carRootBootsFirst = true;
}

/**
 * Persist the furthest boot step synchronously, so a hard wedge at this step
 * is named in the NEXT launch's boot-not-completed report (a cheap MMKV set).
 */
export function qariahBootStep(step: string): void {
  guardHook('qariahBootStep', () => {
    if (sentinelActive) markBootStep(step);
  });
}

/** The slow-cold-start budget: diagnostic builds tighten it to 5 s. */
export function qariahSlowBootThresholdMs(defaultMs: number): number {
  return DIAGNOSTIC_BUILD_FLAG ? DIAGNOSTIC_SLOW_BOOT_THRESHOLD_MS : defaultMs;
}

/**
 * The 'slow-cold-start' event, with the slow init service.
 *
 * Sprint 34 (S34.1) — REPORT-ONLY. 95% of field slow-cold-start events stall
 * at boot_step='catalog-ready' = inside appInitializer.initialize(), but the
 * 10 s batch timeout only ever named 'non-critical-batch'. The per-service
 * snapshot names the slow service: `slow_init_service` (a queryable tag) = the
 * first still-in-flight service at the budget mark; the full completed and
 * in-flight lists ride in extra.
 */
export function qariahReportSlowColdStart(lastBootStep: string): void {
  guardHook('qariahReportSlowColdStart', () => {
    const initSnap = appInitializer.getInitSnapshot();
    Sentry.captureMessage('slow-cold-start', {
      level: 'warning',
      tags: {
        scope: 'cold-start',
        boot_step: lastBootStep,
        slow_init_service: initSnap.inFlight[0] ?? 'none',
      },
      extra: {
        init_in_flight: initSnap.inFlight,
        init_completed: initSnap.completed,
      },
    });
    // Diagnostic build: a stuck-on-logo hang may have the OS kill us before
    // the next natural flush, so push the event out immediately.
    if (DIAGNOSTIC_BUILD_FLAG) void Sentry.flush();
  });
}

/**
 * Sprint 30 (B1/B7) — defer the Mushaf font stack OFF the splash-blocking
 * path. Fire the Skia/SQLite preload AND the RN-side DigitalKhatt OTFs
 * non-awaited so the Listen landing tab (which never touches the Mushaf font
 * stack) is interactive ~2 s sooner. Mushaf surfaces subscribe via
 * useMushafFontMgr and re-render when ready; worst case is a brief
 * fallback-glyph flash if the Mushaf tab is opened within ~2 s of cold launch
 * (no crash — null fontMgr is guarded; initialize() is idempotent). When the
 * flag is off, the preload stays a blocking AppInitializer step and the OTFs
 * load in its 'Arabic Fonts' service (services/qariahInitConfig.ts).
 */
export function qariahAfterAudioReady(): void {
  guardHook('qariahAfterAudioReady', () => {
    if (!isFeatureEnabled('deferMushafPreload')) return;
    void (async () => {
      try {
        await Promise.all([
          mushafPreloadService.initialize(),
          Font.loadAsync({
            DigitalKhattV1: require('@/data/mushaf/legacy/DigitalKhattQuranicV1.otf'),
            DigitalKhattV2: require('@/data/mushaf/digitalkhatt/DigitalKhattFont.otf'),
          }),
        ]);
        if (__DEV__) console.log('[App] Deferred Mushaf preload complete');
      } catch (err) {
        if (__DEV__) console.warn('[App] Deferred Mushaf preload failed:', err);
      }
    })();
  });
}

/**
 * Sprint 17 (S17.6) — RFC-010 catalog-version polling. No-ops when
 * branding.catalogVersionEndpoint is unset.
 *
 * Sprint 48 (S48.6) — the local notifications: register the background
 * catalog check, and run one foreground check after the next catalog load.
 * `startQariahNotifications()` returns at once (timers and a catalog
 * subscription; services/notifications/backgroundTask.ts), so it never blocks
 * the boot. Its own guard: a throw in the poll must not skip it.
 */
export function qariahAfterCatalogReady(): void {
  guardHook('qariahAfterCatalogReady', () =>
    initCatalogVersionPolling(refetchCatalogToVersion),
  );
  guardHook('qariahAfterCatalogReady', () => startQariahNotifications());
}

/**
 * REPORT-ONLY — the boot reached 'ready'; clear the sentinel so it is not
 * reported as incomplete on the next launch (§2).
 */
export function qariahBootCompleted(): void {
  guardHook('qariahBootCompleted', () => {
    if (sentinelActive) markBootCompleted();
  });
}
