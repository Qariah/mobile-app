import React, {useEffect, useState, useRef, useCallback, useMemo} from 'react';
import {Stack, useRouter, usePathname} from 'expo-router';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import * as Font from 'expo-font';
// Qariah (ANR WS-C): same API as expo-splash-screen; hideAsync() also removes
// the Android non-blocking boot overlay. See utils/bootSplash.ts.
import * as SplashScreen from '@/utils/bootSplash';
import * as SystemUI from 'expo-system-ui';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {useDownloadStore} from '@/services/player/store/downloadStore';
import ErrorBoundary from '@/components/ErrorBoundary';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {
  AppState,
  View,
  Text,
  Platform,
  StatusBar as RNStatusBar,
  Appearance,
  InteractionManager,
  type AppStateStatus,
} from 'react-native';
import {useTheme} from '@/hooks/useTheme';
import {ThemeProvider} from 'expo-router';
import {PlayerSheet} from '@/components/player/v2/PlayerSheet';
import {
  WhatsNewModal,
  WhatsNewModalRef,
} from '@/components/modals/WhatsNewOnboarding';
import {DevMenu} from '@/components/DevMenu';
import {SheetProvider} from 'react-native-actions-sheet';
import '@/components/sheets/sheets'; // Register action sheets
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from 'react-native-reanimated';
import {preloadTajweedData} from '@/utils/tajweedLoader';
import {appInitializer} from '@/services/AppInitializer';
import {mushafPreloadService} from '@/services/mushaf/MushafPreloadService';
import {isFeatureEnabled} from '@/config/featureFlags';
import {NetworkStatusMonitor} from '@/components/NetworkStatusMonitor';
import {useNetworkMonitor} from '@/hooks/useNetworkMonitor';
import {
  PostHogProvider,
  usePostHog,
  useFeatureFlag,
  useFeatureFlagWithPayload,
} from 'posthog-react-native';
import {setPlaybackHealthEnabled} from '@/services/diagnostics/playbackHealth';
import {
  getBootSplashMode,
  setNonBlockingSplashForNextLaunch,
} from '@/modules/qariah-boot-splash';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import {AuthTelemetry} from '@/services/analytics/AuthTelemetry';
import {ExpoAudioProvider} from '@/services/audio';
import {expoAudioService} from '@/services/audio/ExpoAudioService';
import {restoreSession} from '@/services/player/utils/restoreSession';
import {getAllReciters, refetchCatalogToVersion} from '@/services/dataService';
import {initCatalogVersionPolling} from '@/services/catalogVersionPoll';
import {useShareIntent} from 'expo-share-intent';
import {useUploadsStore} from '@/store/uploadsStore';
import {SheetManager} from 'react-native-actions-sheet';
import {showToast} from '@/utils/toastUtils';
import {mushafSessionStore} from '@/services/mushaf/MushafSessionStore';
import {USE_GLASS} from '@/hooks/useGlassProps';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import {
  enableDiagnostics,
  DIAGNOSTIC_BUILD_FLAG,
  SENTRY_REPLAY_ENABLED,
  diagNav,
} from '@/services/diagnostics/diagnostics';
import {startMemoryWatch} from '@/services/diagnostics/memoryWatch';
import {applyPerProcessEventBudget} from '@/services/diagnostics/sentryEventBudget';
import {takePreviousProcessStallRecord} from '@/services/diagnostics/mainThreadStallCount';
import {getDebugId, DEBUG_ID_UNKNOWN} from '@/services/diagnostics/debugId';
import {
  markBootStarted,
  markBootStep,
  markBootCompleted,
  consumePreviousIncompleteBoot,
} from '@/services/diagnostics/bootSentinel';
import {consumeKilledPlayback} from '@/services/diagnostics/playbackSentinel';
import {useBackgroundPlaybackStore} from '@/store/backgroundPlaybackStore';
import {useDeepLinkWatchdog} from '@/services/diagnostics/deepLinkWatchdog';
import {
  useDeepLinkColdStartReplay,
  hasColdStartDeepLink,
} from '@/services/diagnostics/deepLinkColdStartReplay';
import {
  useBackgroundPlaybackPrompt,
  useNotificationsDeniedPrompt,
} from '@/hooks/useBackgroundPlaybackPrompt';
import * as ScreenOrientation from 'expo-screen-orientation';
import {AuthProvider} from '@/services/auth';
import {UserStateProvider} from '@/services/userState';
import {isOnboarded} from '@/services/onboarding/onboardingState';

// Configure Reanimated logger
configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

// Cache for expo-navigation-bar module (Android only)
let NavigationBarModule: any = null;

// Cold-start budget: if prepare() blows past this, fire a one-shot
// 'slow-cold-start' Sentry message naming the phase it stalled in. prepare()
// is gated by initializationRef, so this fires at most once per process.
const SLOW_BOOT_THRESHOLD_MS = 8000;

// Prevent the splash screen from auto-hiding
SplashScreen.preventAutoHideAsync().catch(() => {
  /* reloading the app might trigger some race conditions, ignore them */
});

// Set native root view background immediately (before any component renders)
// This prevents the white flash between splash screen and first frame.
// QARIAHV2-C — guard the rejection: on OEM-killed Activities (Samsung/OnePlus/
// Xiaomi) ExpoSystemUI.setBackgroundColorAsync rejects with "current activity
// is no longer available"; it's benign cosmetic cleanup, not a real failure.
void SystemUI.setBackgroundColorAsync(
  Appearance.getColorScheme() === 'dark' ? '#07121a' : '#f4f3ec',
).catch(() => {
  /* Activity may be gone (OEM-killed); benign cleanup, swallow it. */
});

const analyticsEnabled = process.env.EXPO_PUBLIC_ANALYTICS_ENABLED !== 'false';

// Sprint 24 (TECH_DEBT #74) — the `SENTRY_IGNORED_ERROR_SUBSTRINGS` empty-
// array machinery was removed. It was the Sprint-8 stopgap for the
// SurahNameV4 typeface-load race in <SurahDivider>; the real fix shipped
// Sprint 17 (S17.11) — `useMushafFontMgr` replaces the dual-path useFonts
// fallback with a `useSyncExternalStore` subscription against the preloaded
// fontMgr. The empty filter list + iteration was Bayaan-distinct dead code
// that misled readers into thinking some Sentry noise was still being
// filtered. If future narrowly-scoped noise needs suppressing, add a
// `beforeSend` filter at that point with a comment naming the noise source.

// Narrows the `any`-typed expoConfig.extra.version without an `as` cast — mirrors
// the upstream Bayaan #303 type guard so the two trees stay merge-aligned.
function isVersionInfo(
  value: unknown,
): value is {semanticVersion: string; buildNumber: string | number} {
  if (value == null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.semanticVersion === 'string' &&
    (typeof v.buildNumber === 'string' || typeof v.buildNumber === 'number')
  );
}

if (analyticsEnabled) {
  // Explicit release + dist tagging. Android events were landing with no
  // release (the QARIAHV2-F ANR showed `release: None`), so crashes couldn't
  // be tied to a build. Derive both from the build-time version injected into
  // expoConfig.extra.version by scripts/generate-version.js (the number
  // scripts/verify-version-sync.js enforces across native files) — reliable on
  // both platforms, unlike Sentry's native auto-detection. `undefined` is a
  // safe no-op (Sentry falls back to auto-detect), so a missing manifest can't
  // regress the current behavior.
  const rawVersion: unknown = Constants.expoConfig?.extra?.version;
  const versionInfo = isVersionInfo(rawVersion) ? rawVersion : undefined;
  // appId keeps its hardcoded fallback, so (unlike upstream Bayaan #303) the
  // release name can never stringify `undefined` here — the type guard above is
  // the code-quality half of the back-port, not a bug fix.
  const appId =
    Constants.expoConfig?.ios?.bundleIdentifier ??
    Constants.expoConfig?.android?.package ??
    'com.qariah.app';
  const sentryRelease =
    versionInfo != null
      ? `${appId}@${versionInfo.semanticVersion}+${versionInfo.buildNumber}`
      : undefined;
  const sentryDist =
    versionInfo != null ? String(versionInfo.buildNumber) : undefined;

  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
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
    enableAutoSessionTracking: true,
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
    // tagging below to be tie-able to a build (sentry-triage already has the ANR
    // rule). These ride the existing beforeSend (drops environment==='development')
    // so sim noise stays out. Telemetry only — no app behavior change.
    appHangTimeoutInterval: 3,
    environment: __DEV__ ? 'development' : 'production',
    release: sentryRelease,
    dist: sentryDist,
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
  });

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
  // (PostHog `diagnostics_mode`) is wired in AnalyticsConnector once flags load.
  if (DIAGNOSTIC_BUILD_FLAG) enableDiagnostics();

  // REPORT-ONLY app-memory tracking (all builds): attaches the app's used memory
  // to Sentry as a refreshed `app_memory` context + breadcrumb trail, so a native
  // SIGABRT (GH #143) or the OOM cluster carries the memory state right before the
  // crash — classifying it OOM-adjacent vs a logic abort. Telemetry only.
  startMemoryWatch();
}

/** Connects PostHog SDK to our analytics service and tracks app lifecycle. */
function AnalyticsConnector(): null {
  const posthog = usePostHog();
  // Once-per-process guard for the cold_start_began funnel marker.
  const coldStartBeganRef = useRef(false);

  // @ai Qariah (ANR WS-C, H1) — non-blocking boot splash (Android only).
  // 1. Tag every event with the mode THIS process booted in, so a field A/B can
  //    split splash_hidden / ANR data by arm. Declared before the effect that
  //    connects analyticsService, so the first events already carry it.
  //    Skipped where the native module is absent (iOS), so iOS is unchanged.
  // 2. Store the PostHog boolean flag `nonblocking_splash` for the NEXT cold
  //    start (MainActivity reads it before JS runs). Fails closed: `undefined`
  //    (flags not loaded) writes nothing; `false` or a missing flag writes
  //    false. The build flag `nonBlockingSplash` is the hard-off.
  useEffect(() => {
    if (!posthog) return;
    const mode = getBootSplashMode();
    if (mode !== 'unavailable') posthog.register({boot_splash_mode: mode});
  }, [posthog]);
  const nonBlockingSplashFlag = useFeatureFlag('nonblocking_splash');
  useEffect(() => {
    if (!isFeatureEnabled('nonBlockingSplash')) {
      setNonBlockingSplashForNextLaunch(false);
      return;
    }
    if (nonBlockingSplashFlag === undefined) return;
    setNonBlockingSplashForNextLaunch(nonBlockingSplashFlag === true);
  }, [nonBlockingSplashFlag]);

  // Remote-flag activation. Once PostHog flags resolve, a truthy
  // `diagnostics_mode` enables diagnostics with the flag's JSON payload as the
  // config (sampleRate / thresholds). enableDiagnostics is first-call-wins, so
  // once diagnostics are enabled, a re-render or a flag refresh is IGNORED: a
  // later payload change is not applied in this process; it applies at a later
  // cold start. The build flag (one-off
  // APK) has already enabled it at init; this is the no-rebuild population
  // control.
  const [diagFlag, diagPayload] = useFeatureFlagWithPayload('diagnostics_mode');
  useEffect(() => {
    if (diagFlag) enableDiagnostics(diagPayload);
  }, [diagFlag, diagPayload]);

  // @ai REPORT-ONLY playback-health telemetry (Qariah-only). PostHog boolean
  // flag, no payload. Fails closed: `undefined` (flags not loaded) and `false`
  // both mean off. Every change applies at once, in both directions — never
  // latch the first value (the #407 bug).
  const playbackHealthFlag = useFeatureFlag('playback_health');
  useEffect(() => {
    setPlaybackHealthEnabled(playbackHealthFlag === true);
  }, [playbackHealthFlag]);

  // Navigation breadcrumbs — any captured freeze/crash event then shows the
  // exact screen path that led there. No-op until diagnostics are enabled.
  const pathname = usePathname();
  useEffect(() => {
    diagNav(pathname);
  }, [pathname]);

  // @ai REPORT-ONLY deep-link receipt/completion watchdog (#105) — records
  // every navigational link and fires `deeplink-dropped` if the router never
  // reaches the target. Never navigates or retries.
  useDeepLinkWatchdog(pathname);

  // @ai THE FIX for #105 — replays the cold-start initial URL via
  // router.replace once the root navigator is ready, IFF the slow-boot race
  // dropped it (i.e. expo-router didn't already land on the target). Cold-start
  // only, single replay; the warm `url` path is untouched.
  useDeepLinkColdStartReplay(pathname);

  // @ai S33.2 — one-time "set Battery to Unrestricted" prompt, shown only after
  // the audio provider observes an involuntary OEM background-stop. Android-only.
  useBackgroundPlaybackPrompt();

  // @ai S39.2 (#104) — one-time "allow notifications" prompt, shown only when
  // the audio provider observes that POST_NOTIFICATIONS is denied. Android-only.
  useNotificationsDeniedPrompt();

  // Connect PostHog instance to analytics service
  useEffect(() => {
    if (posthog) {
      analyticsService.setPostHogInstance(posthog);
      analyticsService.trackAppOpened();
    }
  }, [posthog]);

  // @ai REPORT-ONLY boot-not-completed sentinel report
  // (planning/observability-gap-samsung-hang-2026-06-08.md §2). If a PREVIOUS
  // launch wrote the boot sentinel and never cleared it (a hard cold-start hang
  // — the only class that survives a fully-wedged launch), report it once now
  // that PostHog is connected. Observe + report only; no boot-flow change.
  useEffect(() => {
    if (!posthog) return;
    // Once-per-process cold-start marker — the correct boot-funnel denominator
    // (app_opened also fires on warm resume, inflating any hang ratio ~20x).
    if (!coldStartBeganRef.current) {
      coldStartBeganRef.current = true;
      // @ai #217 — the previous watchdog process's record rides on this event.
      const prevStalls = takePreviousProcessStallRecord();
      analyticsService.trackColdStartBegan({
        platform: Platform.OS,
        ...(prevStalls !== null
          ? {
              prev_process_watchdog_ran: true,
              prev_process_build: prevStalls.build,
              prev_process_main_thread_stalls: prevStalls.stalls,
            }
          : {}),
      });
    }
    const prev = consumePreviousIncompleteBoot();
    if (!prev) return;
    Sentry.captureMessage('boot-not-completed', {
      level: 'warning',
      tags: {
        scope: 'cold-start',
        incomplete_build: prev.build,
        // alias the PostHog prop name so the same query works in both tools
        // (the prior sweep found `failed_build` returned empty in Sentry).
        failed_build: prev.build,
        // names exactly where the wedge died (catalog-ready / session-restored /
        // 'ready' = booted-but-first-screen-content never rendered).
        furthest_step: prev.furthestStep ?? 'unknown',
      },
      extra: {...prev, detected_at_ms: Date.now()},
    });
    analyticsService.trackBootNotCompleted({
      failed_version: prev.version,
      failed_build: prev.build,
      detected_at_ms: Date.now(),
      furthest_step: prev.furthestStep,
    });
  }, [posthog]);

  // @ai REPORT-ONLY playback-kill sentinel report (#54's user symptom / #104).
  // If a PREVIOUS process died while audio was playing (the sentinel in
  // ExpoAudioProvider was never cleared — OEM task killer, swipe-away, or
  // crash mid-playback), report it once now that PostHog is connected. The
  // death itself emits nothing, so this next-launch report is the only signal.
  // Observe + report only; no playback or boot-flow change.
  useEffect(() => {
    if (!posthog) return;
    const killed = consumeKilledPlayback();
    if (!killed) return;
    Sentry.captureMessage('playback-killed-in-background', {
      level: 'warning',
      tags: {scope: 'audio'},
      extra: {...killed, detected_at_ms: Date.now()},
    });
    analyticsService.trackPlaybackKilledInBackground({
      surah_id: killed.surahId,
      reciter_id: killed.reciterId,
      reciter_name: killed.reciterName,
      position_sec: killed.positionSec,
      started_at_ms: killed.startedAt,
      detected_at_ms: Date.now(),
    });
    // @ai S33.2 — a prior-launch mid-playback PROCESS death (the reliably-caught
    // OEM-kill variant, device-verified on the A35) is strong evidence the device
    // is killing background audio. Record it for the bounded battery-unrestrict
    // prompt.
    if (Platform.OS === 'android') {
      useBackgroundPlaybackStore.getState().recordKill();
    }
  }, [posthog]);

  // Track app foreground/background transitions
  useEffect(() => {
    function handleAppStateChange(nextState: AppStateStatus): void {
      if (nextState === 'background' || nextState === 'inactive') {
        analyticsService.trackAppBackgrounded();
      } else if (nextState === 'active') {
        analyticsService.trackAppOpened();
      }
    }
    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );
    return () => subscription.remove();
  }, []);

  return null;
}

function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [mushafRestoreHandled, setMushafRestoreHandled] = useState(false);
  // Qariah (#53): set by the splash watchdog when the gate flags haven't all
  // flipped within budget — bypasses EVERY splash gate (including fontsLoaded,
  // which can't be flipped from here) so a stalled boot reveals a degraded
  // app instead of an infinite splash. Field data: real-user boots wedged at
  // 12s+ with app_is_ready/player_ready false (OnePlus 8 Pro ×3, build 1293).
  const [forceReveal, setForceReveal] = useState(false);
  const [setupError, setSetupError] = useState<Error | null>(null);
  const router = useRouter();
  const initializationRef = useRef(false);
  const whatsNewModalRef = useRef<WhatsNewModalRef>(null);
  const {theme, isDarkMode} = useTheme();
  useNetworkMonitor();

  // @ai REPORT-ONLY TTI / splash-hide watchdog
  // (planning/observability-gap-samsung-hang-2026-06-08.md §3). The existing
  // `slow-cold-start` watchdog only measures prepare()'s duration; the splash is
  // hidden in a SEPARATE gate (onLayoutRootView, which also requires fontsLoaded
  // / isPlayerReady / !hasShareIntent / mushafRestoreHandled). If prepare()
  // FINISHES but one of those other flags never flips, the user is stuck on the
  // splash and the existing watchdog has already cleared in its finally{} — that
  // hang is invisible today. This watchdog is anchored to "JS start -> splash
  // actually hidden", independent of prepare(). It OBSERVES and REPORTS ONLY: it
  // does NOT force the splash to hide or flip any boot flag (hard constraint).
  const jsStartRef = useRef(Date.now());
  const splashHiddenRef = useRef(false);
  const recordSplashHidden = useCallback(() => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    analyticsService.trackSplashHidden({
      tti_ms: Date.now() - jsStartRef.current,
      platform: Platform.OS,
    });
  }, []);

  // Build React Navigation theme so card/background colors match during transitions
  const navigationTheme = useMemo(
    () => ({
      dark: isDarkMode,
      colors: {
        primary: theme.colors.text,
        background: theme.colors.background,
        card: theme.colors.background,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.error,
      },
      fonts: {
        regular: {fontFamily: 'Manrope-Regular', fontWeight: '400' as const},
        medium: {fontFamily: 'Manrope-Medium', fontWeight: '500' as const},
        bold: {fontFamily: 'Manrope-Bold', fontWeight: '700' as const},
        heavy: {fontFamily: 'Manrope-ExtraBold', fontWeight: '800' as const},
      },
    }),
    [isDarkMode, theme.colors],
  );

  // Critical fonts — block splash screen on these only
  const [fontsLoaded, fontError] = Font.useFonts({
    'Manrope-Regular': require('@/assets/fonts/Manrope-Regular.ttf'),
    'Manrope-Bold': require('@/assets/fonts/Manrope-Bold.ttf'),
    'Manrope-Medium': require('@/assets/fonts/Manrope-Medium.ttf'),
    'Manrope-SemiBold': require('@/assets/fonts/Manrope-SemiBold.ttf'),
    'Manrope-Light': require('@/assets/fonts/Manrope-Light.ttf'),
    'Manrope-ExtraLight': require('@/assets/fonts/Manrope-ExtraLight.ttf'),
    'Manrope-ExtraBold': require('@/assets/fonts/Manrope-ExtraBold.ttf'),
    SurahNames: require('@/assets/fonts/surah_names.ttf'),
    SurahNames2: require('@/assets/fonts/surah_names_2.ttf'),
  });

  // Handle share intents from other apps
  const {hasShareIntent, shareIntent, resetShareIntent} = useShareIntent({
    debug: __DEV__,
    resetOnBackground: true,
  });

  // Lock to portrait by default; mushaf.tsx unlocks when that screen is active.
  // QARIAHV2-C (#54) — guard the rejection: when the OEM kills the Activity
  // (Samsung/OnePlus/Xiaomi during playback), in-flight ExpoScreenOrientation
  // calls reject with "current activity is no longer available". Same benign
  // class as the existing SystemUI/KeepAwake guards; orientation is
  // meaningless on a dead Activity.
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {
      /* Activity may be gone (OEM-killed); benign, swallow it. */
    });
  }, []);

  // Tajweed data — defer until after first frame + interactions complete
  useEffect(() => {
    InteractionManager.runAfterInteractions(() => {
      if (__DEV__) console.log('[App] Preloading tajweed data...');
      preloadTajweedData();
    });
  }, []);

  // @ai REPORT-ONLY — mirror the splash-hide gate booleans into refs so the
  // watchdog timer closure (armed once, below) can read their LIVE values
  // without re-arming. Telemetry plumbing only; these refs are not read by any
  // boot decision.
  const appIsReadyRef = useRef(appIsReady);
  const fontsLoadedRef = useRef(fontsLoaded);
  const isPlayerReadyRef = useRef(isPlayerReady);
  const mushafRestoreHandledRef = useRef(mushafRestoreHandled);
  const hasShareIntentRef = useRef(hasShareIntent);
  useEffect(() => {
    appIsReadyRef.current = appIsReady;
    fontsLoadedRef.current = fontsLoaded;
    isPlayerReadyRef.current = isPlayerReady;
    mushafRestoreHandledRef.current = mushafRestoreHandled;
    hasShareIntentRef.current = hasShareIntent;
  }, [
    appIsReady,
    fontsLoaded,
    isPlayerReady,
    mushafRestoreHandled,
    hasShareIntent,
  ]);

  // @ai REPORT-ONLY TTI watchdog timer (§3). Arm once on mount. If the splash
  // hasn't actually hidden within the 12s budget, fire ONE Sentry warning
  // (`splash-hide-timeout`) + PostHog `splash_stalled` naming which gate flag was
  // still false — then flush (a hang may get the app OS-killed). 12s is past the
  // worst measured Pixel-3 release cold start (~4.2-5.8s, Sprint 30) with
  // headroom, and looser than the inner prepare() 8s watchdog so the two don't
  // double-fire on the same slow-but-fine boot. CRITICAL: this does NOT
  // force-reveal the app or flip any flag — it only observes and reports.
  const SPLASH_TTI_BUDGET_MS = 12000;
  useEffect(() => {
    const t = setTimeout(() => {
      if (splashHiddenRef.current) return; // splash hid in time — no-op
      const elapsed = Date.now() - jsStartRef.current;
      Sentry.captureMessage('splash-hide-timeout', {
        level: 'warning',
        tags: {scope: 'cold-start', boot_step: 'splash-gate'},
        extra: {
          elapsed_ms: elapsed,
          app_is_ready: appIsReadyRef.current,
          fonts_loaded: fontsLoadedRef.current,
          player_ready: isPlayerReadyRef.current,
          mushaf_restore_handled: mushafRestoreHandledRef.current,
          has_share_intent: hasShareIntentRef.current,
          platform: Platform.OS,
        },
      });
      void Sentry.flush();
      analyticsService.trackSplashStalled({
        elapsed_ms: elapsed,
        platform: Platform.OS,
      });
      // Qariah (#53): after reporting, force-reveal. A degraded-but-usable
      // app beats an infinite splash — services that finish late still hydrate
      // their stores, and a wedged one costs its feature, not the whole app.
      // The event above still fires first, so observability is preserved.
      setForceReveal(true);
    }, SPLASH_TTI_BUDGET_MS);
    return () => clearTimeout(t);
  }, []);

  const onLayoutRootView = useCallback(async () => {
    try {
      if (
        (appIsReady &&
          fontsLoaded &&
          isPlayerReady &&
          !hasShareIntent &&
          mushafRestoreHandled) ||
        forceReveal
      ) {
        await SplashScreen.hideAsync();
        // @ai REPORT-ONLY — splash actually hidden; record TTI success (§3).
        recordSplashHidden();
      }
    } catch (e) {
      if (__DEV__) console.warn('Error hiding splash screen:', e);
    }
  }, [
    appIsReady,
    fontsLoaded,
    isPlayerReady,
    hasShareIntent,
    mushafRestoreHandled,
    forceReveal,
    recordSplashHidden,
  ]);

  // Initialize app with expo-audio
  useEffect(() => {
    if (initializationRef.current) {
      return;
    }

    async function prepare() {
      // @ai REPORT-ONLY boot-not-completed sentinel (§2). Write the sentinel as
      // the FIRST thing, before any await — a synchronous MMKV write that
      // survives even a hard native freeze of everything after it. Cleared once
      // boot reaches 'ready' (markBootCompleted, below). On the NEXT launch, an
      // uncleared sentinel means THIS launch hung. Observe only — no boot change.
      const rawBootVersion: unknown = Constants.expoConfig?.extra?.version;
      const bootVersion = isVersionInfo(rawBootVersion)
        ? rawBootVersion
        : undefined;
      const bootVer = bootVersion?.semanticVersion;
      const bootBuild = bootVersion?.buildNumber;
      markBootStarted(bootVer ?? 'unknown', String(bootBuild ?? 'unknown'));

      // Cold-start observability. Breadcrumb each boot phase so any later
      // crash/ANR carries the boot trail (e.g. the QARIAHV2-F "stuck on logo"
      // ANR), and fire a one-shot 'slow-cold-start' Sentry message if we blow
      // past the budget — turning the otherwise-invisible boot hang into a
      // queryable signal that names the phase it stalled in.
      let lastBootStep = 'start';
      const markBoot = (step: string): void => {
        lastBootStep = step;
        // Persist the furthest milestone synchronously so a hard wedge HERE is
        // named in the NEXT launch's boot-not-completed report (cheap MMKV set).
        markBootStep(step);
        Sentry.addBreadcrumb({category: 'boot', message: step, level: 'info'});
      };
      const slowBootWatchdog = setTimeout(
        () => {
          // Sprint 34 (S34.1) — REPORT-ONLY. 95% of field slow-cold-start
          // events stall at boot_step='catalog-ready' = inside
          // appInitializer.initialize(), but the 10s batch timeout only ever
          // named 'non-critical-batch'. Read the per-service snapshot here so
          // the event names the slow service: `slow_init_service` (a queryable
          // tag) = the first still-in-flight service at the 8s mark; the full
          // completed/in-flight lists ride in extra. Lets a future sprint build
          // the right cold-start lever with data instead of guessing.
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
          // Diagnostic build: a stuck-on-logo hang may have the OS kill us
          // before the next natural flush, so push the event out immediately.
          if (DIAGNOSTIC_BUILD_FLAG) void Sentry.flush();
        },
        // Upstream (#303 review) names the default budget SLOW_BOOT_THRESHOLD_MS;
        // diagnostic builds tighten it to 5s so a wedged boot reports sooner.
        DIAGNOSTIC_BUILD_FLAG ? 5000 : SLOW_BOOT_THRESHOLD_MS,
      );
      try {
        markBoot('start');
        if (__DEV__)
          console.log('[App] Starting initialization with expo-audio...');

        // Initialize expo-audio service
        await expoAudioService.initialize();
        markBoot('expo-audio-ready');
        if (__DEV__) console.log('[App] expo-audio service initialized');

        // Sprint 30 (B1/B7) — defer the Mushaf font stack OFF the splash-blocking
        // path. Fire the Skia/SQLite preload AND the RN-side DigitalKhatt OTFs
        // non-awaited so the Listen landing tab (which never touches the Mushaf
        // font stack) is interactive ~2s sooner. Mushaf surfaces subscribe via
        // useMushafFontMgr and re-render when ready; worst case is a brief
        // fallback-glyph flash if the Mushaf tab is opened within ~2s of cold
        // launch (no crash — null fontMgr is guarded; initialize() is idempotent).
        // When the flag is off, the preload stays a blocking AppInitializer step
        // and the OTFs load in its 'Arabic Fonts' service (legacy behavior).
        if (isFeatureEnabled('deferMushafPreload')) {
          void (async () => {
            try {
              await Promise.all([
                mushafPreloadService.initialize(),
                Font.loadAsync({
                  DigitalKhattV1: require('@/data/mushaf/legacy/DigitalKhattQuranicV1.otf'),
                  DigitalKhattV2: require('@/data/mushaf/digitalkhatt/DigitalKhattFont.otf'),
                }),
              ]);
              if (__DEV__)
                console.log('[App] Deferred Mushaf preload complete');
            } catch (err) {
              if (__DEV__)
                console.warn('[App] Deferred Mushaf preload failed:', err);
            }
          })();
        }

        // Fetch reciter data from backend API (or fallback if killswitch active)
        markBoot('catalog-fetch-start');
        await getAllReciters();
        markBoot('catalog-ready');
        if (__DEV__) console.log('[App] Reciter data loaded');

        // Sprint 17 (S17.6) — RFC-010 catalog-version polling. No-ops when
        // branding.catalogVersionEndpoint is unset (e.g. on Bayaan upstream).
        initCatalogVersionPolling(refetchCatalogToVersion);

        // Initialize all SQLite services, adhkar, playlists, mushaf, fonts, stores, etc.
        // This blocks splash screen so everything is ready when the user sees the app
        await appInitializer.initialize();
        markBoot('app-initializer-ready');
        if (__DEV__) console.log('[App] AppInitializer complete');

        // PRE-WARM: Initialize stores BEFORE first play to prevent cold start lag
        try {
          useDownloadStore.getState();
          if (__DEV__) console.log('[App] Download store pre-warmed');

          usePlayerStore.getState();
          if (__DEV__) console.log('[App] Player store pre-warmed');
        } catch (error) {
          console.debug('[App] Failed to pre-warm stores:', error);
        }

        // Restore last session so floating player + lock screen show last track
        try {
          await restoreSession();
          markBoot('session-restored');
          if (__DEV__) console.log('[App] Session restored');
        } catch (error) {
          console.debug('[App] Failed to restore session:', error);
        }

        // Mark app as ready
        setIsPlayerReady(true);
        setAppIsReady(true);
        initializationRef.current = true;
        markBoot('ready');
        // @ai REPORT-ONLY — boot reached interactive-ready; clear the sentinel so
        // it isn't reported as incomplete on the next launch (§2).
        markBootCompleted();
        if (__DEV__) console.log('[App] Initialization complete');
      } catch (error) {
        console.error('[App] Preparation error:', error);

        setSetupError(
          error instanceof Error ? error : new Error('Setup failed'),
        );
        usePlayerStore
          .getState()
          .setError(
            'system',
            error instanceof Error ? error : new Error('Setup failed'),
          );

        setIsPlayerReady(false);
        setAppIsReady(false);
        initializationRef.current = false;
      } finally {
        clearTimeout(slowBootWatchdog);
      }
    }

    prepare();
  }, []);

  // Set native root view background + configure Android navigation bar to match theme
  useEffect(() => {
    // QARIAHV2-C — guard against the "current activity is no longer available"
    // rejection when the OS has killed the Activity (see module-scope call above).
    void SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {
      /* Activity may be gone (OEM-killed); benign cleanup, swallow it. */
    });

    async function setupNavigationBar() {
      if (Platform.OS === 'android') {
        try {
          if (!NavigationBarModule) {
            NavigationBarModule = await import('expo-navigation-bar').then(
              module => module.default,
            );
            RNStatusBar.setTranslucent(true);
          }

          if (NavigationBarModule) {
            await NavigationBarModule.setBackgroundColorAsync(
              theme.colors.background,
            );
            await NavigationBarModule.setButtonStyleAsync(
              isDarkMode ? 'light' : 'dark',
            );
          }
        } catch (error) {
          if (__DEV__)
            console.warn(
              '[NavBar Debug] Failed to configure navigation bar:',
              error,
            );
        }
      }
    }

    setupNavigationBar();
  }, [theme.colors.background, isDarkMode]);

  // Handle share intent (uploads from other apps)
  useEffect(() => {
    if (!hasShareIntent || !appIsReady || !isPlayerReady) return;

    const handleShareIntent = async () => {
      try {
        const files = shareIntent.files;
        if (!files || files.length === 0) {
          resetShareIntent();
          await SplashScreen.hideAsync();
          return;
        }

        const audioFiles = files.filter(f => f.mimeType?.startsWith('audio/'));

        if (audioFiles.length === 0) {
          resetShareIntent();
          await SplashScreen.hideAsync();
          return;
        }

        const {importFile, importFiles} = useUploadsStore.getState();

        if (audioFiles.length === 1) {
          const file = audioFiles[0];
          const recitation = await importFile(
            file.path,
            file.fileName || 'Shared Audio',
          );
          resetShareIntent();
          await SplashScreen.hideAsync();
          showToast('File imported');
          SheetManager.show('organize-recitation', {
            payload: {recitation},
          });
        } else {
          const mapped = audioFiles.map(f => ({
            uri: f.path,
            name: f.fileName || 'Shared Audio',
          }));
          await importFiles(mapped);
          resetShareIntent();
          await SplashScreen.hideAsync();
          showToast(`${audioFiles.length} files imported`);
          router.push('/collection/uploads');
        }
      } catch (error) {
        console.error('[ShareIntent] Import failed:', error);
        resetShareIntent();
        await SplashScreen.hideAsync();
      }
    };

    handleShareIntent();
  }, [
    hasShareIntent,
    appIsReady,
    isPlayerReady,
    shareIntent,
    resetShareIntent,
  ]);

  // First-launch onboarding redirect, OR mushaf-screen restore if last open.
  // Onboarding wins over mushaf restore: a fresh-install user shouldn't be
  // dropped into a restored mushaf state. AsyncStorage read is async; gate
  // mushafRestoreHandled until both checks complete.
  // Qariah-only: upstream has no first-launch flow.
  useEffect(() => {
    if (!appIsReady || !isPlayerReady || hasShareIntent) return;

    let cancelled = false;
    // Qariah (#53/#71): this flag gates the splash, so flipping it must NEVER
    // depend solely on unbounded steps. Two such steps live in this effect:
    // the AsyncStorage `isOnboarded()` read, and the
    // `InteractionManager.runAfterInteractions` defer — the latter is starved
    // for as long as any interaction handle is held (nav transitions,
    // JS-driven animations), which a Sentry `splash-hide-timeout` event from a
    // Samsung A35 caught doing exactly that (gate still false at 17s with
    // every other gate true). The deadline bounds the WHOLE effect: the
    // redirect logic still completes whenever its async steps land, but the
    // splash gate flips by the deadline no matter what.
    const gateDeadline = setTimeout(() => {
      if (!cancelled) setMushafRestoreHandled(true);
    }, 4000);
    (async () => {
      const onboarded = await isOnboarded();
      if (cancelled) return;
      if (!onboarded) {
        router.replace('/onboarding');
        InteractionManager.runAfterInteractions(() => {
          if (!cancelled) setMushafRestoreHandled(true);
        });
        return;
      }

      const lastScreenWasMushaf = mushafSessionStore.getLastScreenWasMushaf();
      const lastReadPage = mushafSessionStore.getLastReadPage();

      // #105: a cold-start deep link wins over last-session mushaf restore. If
      // the app was launched from a share link, the user wants the link target,
      // not their previous mushaf page — pushing /mushaf here would land on top
      // of the replayed route and eject them from it. Skip the restore push and
      // let the deep-link replay own navigation; still settle the splash gate.
      if (lastScreenWasMushaf && !hasColdStartDeepLink()) {
        router.push({
          pathname: '/mushaf',
          // restored:'1' marks this as the cold-start restore destination so the
          // content-stall watchdog tags a hang here as the "won't open" variant.
          params: lastReadPage
            ? {page: String(lastReadPage), restored: '1'}
            : {restored: '1'},
        });
        InteractionManager.runAfterInteractions(() => {
          if (!cancelled) setMushafRestoreHandled(true);
        });
      } else {
        setMushafRestoreHandled(true);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(gateDeadline);
    };
  }, [appIsReady, isPlayerReady, hasShareIntent]);

  // Hide splash once mushaf restore (if any) has settled.
  // onLayout only fires once, so this effect covers the case where
  // mushafRestoreHandled flips after the initial layout.
  useEffect(() => {
    if (
      (appIsReady &&
        fontsLoaded &&
        isPlayerReady &&
        !hasShareIntent &&
        mushafRestoreHandled) ||
      forceReveal
    ) {
      SplashScreen.hideAsync().catch(() => {});
      // @ai REPORT-ONLY — splash hidden via the late-settle path; record TTI
      // success once (guarded by splashHiddenRef) so the watchdog's denominator
      // is correct regardless of which gate completed last (§3).
      recordSplashHidden();
    }
  }, [
    appIsReady,
    fontsLoaded,
    isPlayerReady,
    hasShareIntent,
    mushafRestoreHandled,
    forceReveal,
    recordSplashHidden,
  ]);

  if (fontError) {
    SplashScreen.hideAsync();
    return (
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
        <Text>Error loading fonts</Text>
      </View>
    );
  }

  if (setupError) {
    SplashScreen.hideAsync();
    return (
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
        <Text>Error initializing player: {setupError.message}</Text>
      </View>
    );
  }

  // Qariah (#53): forceReveal must bypass this guard too — hiding the splash
  // while still returning null would swap an infinite splash for an infinite
  // blank window (caught in PR review). Revealing with these flags false is
  // the intended degraded state: system fonts fall back, screens render empty
  // states, and services that finish late still hydrate their stores (SQLite
  // calls against an uninitialized service throw catchable JS errors, not
  // native crashes — the accepted #53 tradeoff).
  if (!forceReveal && (!fontsLoaded || !isPlayerReady || !appIsReady)) {
    return null;
  }

  return (
    <ErrorBoundary>
      <PostHogProvider
        apiKey={
          process.env.EXPO_PUBLIC_POSTHOG_API_KEY || 'phc_disabled_placeholder'
        }
        options={{
          host: 'https://us.i.posthog.com',
          flushAt: 20,
          flushInterval: 30000,
          disabled: !process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
        }}
        autocapture={{
          captureScreens: true,
        }}>
        <AnalyticsConnector />
        <AuthProvider>
          {/* Observes AuthContext state to emit the sign-in funnel. Renders
              null and swallows its own errors — see AuthTelemetry's header for
              why this is an observer rather than a call inside signIn(). */}
          <AuthTelemetry />
          <ThemeProvider value={navigationTheme}>
            <SafeAreaProvider>
              <ExpoAudioProvider>
                <GestureHandlerRootView
                  style={{flex: 1, backgroundColor: theme.colors.background}}
                  // @ts-ignore - RN supports this on iOS to override system theme for native UI (keyboard, menus, alerts)
                  overrideUserInterfaceStyle={isDarkMode ? 'dark' : 'light'}
                  onLayout={onLayoutRootView}>
                  {/* UserStateProvider must live inside GestureHandlerRootView */}
                  {/* because the V1RestoreModal it renders post-sign-in uses */}
                  {/* gorhom BottomSheet's GestureDetector internally. Pre-S17 */}
                  {/* this provider was a sibling of GHR; the bug only surfaced */}
                  {/* when a fresh QF sign-in produced a v1 candidate match.    */}
                  <UserStateProvider>
                    <NetworkStatusMonitor />
                    <SheetProvider>
                      <Stack
                        screenOptions={{
                          headerShown: false,
                          contentStyle: {
                            paddingTop: 0,
                            backgroundColor: theme.colors.background,
                          },
                          animation: 'fade',
                        }}>
                        <Stack.Screen
                          name="(tabs)"
                          options={{headerShown: false}}
                        />
                        <Stack.Screen
                          name="onboarding"
                          options={{headerShown: false, animation: 'fade'}}
                        />
                        <Stack.Screen
                          name="mushaf"
                          options={{
                            headerShown: USE_GLASS,
                            headerTransparent: true,
                            headerStyle: {backgroundColor: 'transparent'},
                            headerShadowVisible: false,
                            headerTitle: '',
                            headerTitleAlign: 'center',
                            headerBackButtonDisplayMode: 'minimal',
                            animation: 'slide_from_right',
                            fullScreenGestureEnabled: false,
                          }}
                        />
                      </Stack>
                      <PlayerSheet />
                      <WhatsNewModal ref={whatsNewModalRef} />
                      <DevMenu whatsNewModalRef={whatsNewModalRef} />
                    </SheetProvider>
                  </UserStateProvider>
                </GestureHandlerRootView>
              </ExpoAudioProvider>
            </SafeAreaProvider>
          </ThemeProvider>
        </AuthProvider>
      </PostHogProvider>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
