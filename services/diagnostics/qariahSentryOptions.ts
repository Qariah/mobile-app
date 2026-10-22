// @ai Qariah (TECH_DEBT #243) — Qariah's Sentry options and the Sentry scope
// setup that runs right after `Sentry.init`.
//
// This code used to sit inline in `app/_layout.tsx`, an upstream file that
// changes in every absorption. `app/_layout.tsx` now keeps upstream's
// `Sentry.init({...})` block as it is and spreads `...qariahSentryOptions()`
// as the LAST entry, so each option below wins over the upstream value. Then it
// calls `initQariahSentryScope()` once, inside the same `analyticsEnabled`
// block. Both run at module scope, before React mounts, in the same order as
// before the move.

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import {
  enableDiagnostics,
  DIAGNOSTIC_BUILD_FLAG,
  SENTRY_REPLAY_ENABLED,
} from '@/services/diagnostics/diagnostics';
import {startMemoryWatch} from '@/services/diagnostics/memoryWatch';
import {applyPerProcessEventBudget} from '@/services/diagnostics/sentryEventBudget';
import {
  getDebugId,
  DEBUG_ID_UNKNOWN,
  readVersionInfo,
} from '@/services/diagnostics/debugId';

type SentryOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

/**
 * The release name. Same value as upstream's (`<appId>@<version>+<build>`),
 * but `appId` keeps a hardcoded fallback, so the release name can never
 * stringify `undefined` and can never drop to Sentry's auto-detect when the
 * manifest has no bundle id. Do not change the format: a change to the release
 * name breaks the release-health matching (review 2026-10-12, "Skipped").
 * @ai
 */
function qariahSentryRelease(): string | undefined {
  const versionInfo = readVersionInfo();
  const appId =
    Constants.expoConfig?.ios?.bundleIdentifier ??
    Constants.expoConfig?.android?.package ??
    'com.qariah.app';
  return versionInfo != null
    ? `${appId}@${versionInfo.semanticVersion}+${versionInfo.buildNumber}`
    : undefined;
}

// Sprint 24 (TECH_DEBT #74) — the `SENTRY_IGNORED_ERROR_SUBSTRINGS` empty-
// array machinery was removed. It was the Sprint-8 stopgap for the
// SurahNameV4 typeface-load race in <SurahDivider>; the real fix shipped
// Sprint 17 (S17.11) — `useMushafFontMgr` replaces the dual-path useFonts
// fallback with a `useSyncExternalStore` subscription against the preloaded
// fontMgr. The empty filter list + iteration was Bayaan-distinct dead code
// that misled readers into thinking some Sentry noise was still being
// filtered. If future narrowly-scoped noise needs suppressing, add a
// `beforeSend` filter at that point with a comment naming the noise source.

/**
 * Qariah's overrides and additions to upstream's `Sentry.init` options.
 * Spread it LAST into the options object, so these values win.
 * @ai
 */
export function qariahSentryOptions(): Partial<SentryOptions> {
  return {
    // Diagnostic/replay builds trace every session (1.0) so the Hermes profiler
    // below covers the whole session incl. the play→freeze window; prod stays 0.2.
    tracesSampleRate: SENTRY_REPLAY_ENABLED ? 1.0 : 0.2,
    // @ai diagnostic-only Hermes JS profiling. Samples the JS stack *during*
    // execution, so a real foreground freeze names the blocked function — the
    // heartbeat can't (it runs after the thread unblocks). Transaction-based:
    // profiles each sampled trace; with tracesSampleRate 1.0 (above) on
    // diagnostic builds every nav/interaction transaction — incl. the tap→play
    // window where the freeze starts — is profiled. Gated; 0 (off) in prod.
    profilesSampleRate: SENTRY_REPLAY_ENABLED ? 1.0 : 0,
    // Wider breadcrumb buffer so the high-value lead-in (nav + taps + playback
    // actions) survives the lower-frequency network/memory crumbs.
    maxBreadcrumbs: 150,
    // QARIAHV2-9 — fatal EXC_BAD_ACCESS inside RNSentry's `fetchNativeFrames`
    // (KERN_INVALID_ADDRESS) on a finished transaction: the native frames
    // holder is read after the iOS span is deallocated (a known race in the
    // RN SDK's slow/frozen-frames instrumentation). We only run a 0.2 perf
    // sample and don't consume native-frame metrics, so disabling the tracker
    // removes the crash surface at no observability cost. iPhone18,2 / iOS 26.5.
    enableNativeFramesTracking: false,
    // @ai REPORT-ONLY ANR / app-hang capture
    // (planning/observability-gap-samsung-hang-2026-06-08.md §4). The splash-hang
    // and Samsung activity-kill classes can manifest as a native main-thread
    // freeze the JS watchdogs can't see (JS is blocked). On iOS this surfaces a
    // stuck UI as an "App Hanging" event; 3s (default 2) trims false positives on
    // a slow cold start. Android ANR detection is on by default in
    // @sentry/react-native's native layer — it just needs the release/dist
    // tagging to be tie-able to a build (sentry-triage already has the ANR
    // rule). These ride the beforeSend below (drops environment==='development')
    // so sim noise stays out. Telemetry only — no app behavior change.
    appHangTimeoutInterval: 3,
    environment: __DEV__ ? 'development' : 'production',
    // The release with the hardcoded app-id fallback (see qariahSentryRelease).
    // `dist` needs no override: upstream's value is the same string.
    release: qariahSentryRelease(),
    // Session Replay (masked) — a Sentry.init-time setting, so it's gated at
    // PUBLISH time via EXPO_PUBLIC_SENTRY_REPLAY (or any diagnostic build), not
    // the live PostHog flag. `onError` records a buffer and persists it only
    // when an error/crash fires (cheap when nothing's wrong, high value when it
    // is). Session sampling is opt-in via EXPO_PUBLIC_SENTRY_REPLAY_SESSION_RATE
    // (default 0 → on-error only). All text/images/vectors masked for privacy.
    integrations: SENTRY_REPLAY_ENABLED
      ? [
          Sentry.mobileReplayIntegration({
            maskAllText: true,
            maskAllImages: true,
            maskAllVectors: true,
          }),
          // Hermes JS profiler — pairs with profileSessionSampleRate above.
          Sentry.hermesProfilingIntegration(),
        ]
      : [],
    replaysOnErrorSampleRate: SENTRY_REPLAY_ENABLED ? 1.0 : 0,
    replaysSessionSampleRate: SENTRY_REPLAY_ENABLED
      ? Number(process.env.EXPO_PUBLIC_SENTRY_REPLAY_SESSION_RATE) || 0
      : 0,
    // QARIAHV2-5 — sim/Debug builds report SIGABRT from RNS's
    // RNSTabBarAppearanceCoordinator unowned-ref (hard-rule #13 in CLAUDE.md).
    // Existing patches/react-native-screens+4.23.0.patch covers the known sites;
    // the optimizer elides this path in Release. Sim device IDs count as
    // distinct "users" in Sentry — 3 sim instances over 8 days for QARIAHV2-5
    // were dev environments, not prod users. Drop dev-build events entirely;
    // local logs already cover the dev loop and Sentry signal-to-noise on
    // dev/sim crashes is near zero.
    beforeSend(event) {
      if (event.environment === 'development') return null;
      // Drop ALL simulator/emulator events. A RELEASE build on the iOS Simulator
      // reports environment='production' (it's a Release config), so the dev-drop
      // above misses it — and such events polluted prod Sentry with sim-only
      // crashes that don't occur on real hardware (e.g. a boot-sentinel MMKV
      // app-group throw on the iOS Simulator that filed false FATALs on a build
      // that launches fine on real devices). Sentry sets contexts.device.simulator.
      if (event.contexts?.device?.simulator === true) return null;
      // Best-effort, non-fatal fetches surface transient network drops (iOS
      // -1005 "The network connection was lost", radio/Wi-Fi handoffs, timeouts,
      // 5xx) on which the UI degrades silently — so they shouldn't page as errors.
      // Two such sites: (1) QF user-state sync (posts/notes restore) — local-first,
      // once the loudest issue in the project (QARIAHV2-7, 100+ events); (2) inline
      // community reflections (QARIAHV2-1R) — an optional per-ayah enhancement that
      // just shows nothing on failure. Drop the transient variants from both;
      // collapse the remaining posts/notes-sync errors under one fingerprint so
      // they can't bury real signal. Capture sites tag scope:'posts-restore'/
      // 'notes-restore' (UserStateContext.tsx) or source:'communityReflectionsProvider'
      // /'CommunityReflectionsContent' (AyahCommunityReflections.tsx /
      // CommunityReflectionsContent.tsx). NB the regex now includes the iOS -1005
      // "network connection was lost" string, which the prior pattern missed.
      const scope =
        typeof event.tags?.scope === 'string' ? event.tags.scope : undefined;
      const source =
        typeof event.tags?.source === 'string' ? event.tags.source : undefined;
      const isBestEffortSync =
        scope === 'posts-restore' || scope === 'notes-restore';
      const isBestEffortReflections =
        source === 'communityReflectionsProvider' ||
        source === 'CommunityReflectionsContent';
      if (isBestEffortSync || isBestEffortReflections) {
        const msg = event.message ?? event.exception?.values?.[0]?.value ?? '';
        if (
          /network request failed|failed to fetch|network connection was lost|connection was lost|timed out|timeout|abort|50[234]\b/i.test(
            msg,
          )
        ) {
          return null;
        }
        if (isBestEffortSync) event.fingerprint = ['qf-best-effort-sync'];
      }
      // LAST. Everything above decides whether a class is worth reporting AT
      // ALL; this decides how many copies of an already-reported condition this
      // process may spend quota on. It runs last so an explicit fingerprint set
      // above is the key it budgets against, and so a class dropped outright
      // never consumes budget. `fatal` passes straight through — the six-day
      // error blackout this guards against (see the module header) is precisely
      // a loss of crash visibility, so crashes are never the thing limited.
      return applyPerProcessEventBudget(event);
    },
  };
}

/**
 * The Qariah Sentry scope setup. Call it once, right after `Sentry.init`, at
 * module scope (it was inline there before the move).
 * @ai
 */
export function initQariahSentryScope(): void {
  // Anonymous debug ID — the one string a bug reporter hands us. PostHog
  // already uses this device UUID as its distinct id, but Sentry did not carry
  // it, so a report could not be matched across the two tools. This closes that
  // gap.
  //
  // It is a TAG, not a context, on purpose: Sentry indexes tags, so support can
  // search `debug_id:<value>` and filter issues by it. A context is only
  // visible after you open a single event, which does not answer "find this
  // user's events".
  //
  // The value is the anonymous device UUID and nothing else. Never set the QF
  // OAuth subject, an email, or any email-derived value here.
  const debugId = getDebugId();
  if (debugId !== DEBUG_ID_UNKNOWN) Sentry.setTag('debug_id', debugId);

  // Build-flag activation path (one-off diagnostic APK). The remote-flag path
  // (PostHog `diagnostics_mode`) is wired in QariahRootEffects once flags load.
  if (DIAGNOSTIC_BUILD_FLAG) enableDiagnostics();

  // REPORT-ONLY app-memory tracking (all builds): attaches the app's used memory
  // to Sentry as a refreshed `app_memory` context + breadcrumb trail, so a native
  // SIGABRT (GH #143) or the OOM cluster carries the memory state right before the
  // crash — classifying it OOM-adjacent vs a logic abort. Telemetry only.
  startMemoryWatch();
}
