// @ai Qariah (TECH_DEBT #243) — the Qariah root effects, moved out of
// upstream's `AnalyticsConnector` in `app/_layout.tsx` without a behaviour
// change.
//
// Usage in app/_layout.tsx, inside PostHogProvider:
//
//   <QariahRootEffects>
//     <AnalyticsConnector />
//   </QariahRootEffects>
//
// Why a wrapper: React runs the mount effects of siblings in tree order, so
// the effects before the connect (boot-splash tags, flags, nav, prompts) run
// before upstream's AnalyticsConnector effects (setPostHogInstance +
// `app_opened`), and the next-launch reports (`cold_start_began`,
// `boot_not_completed`, `playback_killed_in_background`) run after them. That
// is the same order as when all of them were inline in AnalyticsConnector.

import React, {useEffect, useRef} from 'react';
import {Platform} from 'react-native';
import {usePathname} from 'expo-router';
import * as Sentry from '@sentry/react-native';
import {
  usePostHog,
  useFeatureFlag,
  useFeatureFlagWithPayload,
} from 'posthog-react-native';
import {isFeatureEnabled} from '@/config/featureFlags';
import {getBootSplashMode} from '@/modules/qariah-boot-splash';
import {
  bootSplashExperiment,
  enrolBootRisk,
  NONBLOCKING_SPLASH_FLAG_V2,
  UNKNOWN_COLD_START_BOOT_PROPS,
} from '@/services/bootSplash';
import {qariahAnalytics} from '@/services/analytics/qariahEvents';
import {setPlaybackHealthEnabled} from '@/services/diagnostics/playbackHealth';
import {enableDiagnostics, diagNav} from '@/services/diagnostics/diagnostics';
import {takePreviousProcessStallRecord} from '@/services/diagnostics/mainThreadStallCount';
import {consumePreviousIncompleteBoot} from '@/services/diagnostics/bootSentinel';
import {consumeKilledPlayback} from '@/services/diagnostics/playbackSentinel';
import {useDeepLinkWatchdog} from '@/services/diagnostics/deepLinkWatchdog';
import {useDeepLinkColdStartReplay} from '@/services/diagnostics/deepLinkColdStartReplay';
import {
  useBackgroundPlaybackPrompt,
  useNotificationsDeniedPrompt,
} from '@/hooks/useBackgroundPlaybackPrompt';
import {useBackgroundPlaybackStore} from '@/store/backgroundPlaybackStore';
import {useForegroundAnnouncementRecord} from '@/services/notifications/useForegroundAnnouncementRecord';
import {useQariahNotifications} from '@/services/notifications/useQariahNotifications';
import {NotificationSoftPrompt} from '@/components/notifications/NotificationSoftPrompt';

/**
 * The effects that ran BEFORE AnalyticsConnector's connect effect.
 * @ai
 */
function QariahPreConnectEffects(): null {
  const posthog = usePostHog();
  // Once-per-process guard for the boot-splash flag-resolution event.
  const splashFlagReportedRef = useRef(false);

  // @ai Qariah (ANR WS-C, H1 + ANR hotfix v2) — non-blocking boot splash
  // (Android only).
  // 1. Tag every event with the mode THIS process booted in, so a field A/B can
  //    split splash_hidden / ANR data by arm. Runs before the effect that
  //    connects analyticsService (AnalyticsConnector), so the first events
  //    already carry it. Skipped where the native module is absent (iOS), so
  //    iOS is unchanged.
  // 2. The experiment controller (services/bootSplash) reads the flag
  //    `nonblocking_splash_v2` and writes the marker for the NEXT cold start.
  //    This component only reports what the flag RESOLVED to. The build flag
  //    `nonBlockingSplash` is the hard-off; the controller writes OFF for it.
  useEffect(() => {
    if (!posthog) return;
    const mode = getBootSplashMode();
    if (mode !== 'unavailable') posthog.register({boot_splash_mode: mode});
  }, [posthog]);
  useEffect(() => {
    // iOS (or no native module): the experiment is inactive. Emit nothing.
    if (!posthog || !bootSplashExperiment.active) return;
    if (!isFeatureEnabled('nonBlockingSplash')) {
      // `off` (not `false`) so the build hard-off is distinguishable from a
      // remote flag that resolved false. The controller does not notify
      // listeners in this case.
      posthog.register({boot_splash_flag: 'off'});
      return;
    }
    // The listener fires at once with the last resolution (if one occurred
    // before this effect ran), then at each flag response in this process.
    return bootSplashExperiment.onResolved(e => {
      // Tag later events in this session. The boot burst usually fires before
      // the flag resolves, so the EVENT below is the load-bearing instrument.
      posthog.register({boot_splash_flag: e.label});
      // Fire ONCE per process, at the first resolution. `mode` is this
      // launch's arm, so one event carries the flag value and what this launch
      // did.
      if (splashFlagReportedRef.current) return;
      splashFlagReportedRef.current = true;
      qariahAnalytics.trackBootSplashFlagResolved({
        value: e.label,
        mode: getBootSplashMode(),
        armsNextLaunch: e.armsNextLaunch,
        flag_key: NONBLOCKING_SPLASH_FLAG_V2,
        boot_risk: bootSplashExperiment.isEnrolled(),
      });
    });
  }, [posthog]);

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

  // @ai Sprint 48 (S48.8) — once for each process, when the app first becomes
  // active: record this build's announcement id, so the background task does
  // not also post the "new features" notice. It reads the last seen version
  // at mount, before the user can close the What's New onboarding.
  useForegroundAnnouncementRecord();

  // @ai Sprint 48 (S48.6) — the local notifications: the holdout arm (the
  // analytics consent, then the PostHog flag), written once.
  useQariahNotifications();

  return null;
}

/**
 * The next-launch reports that ran AFTER AnalyticsConnector's connect effect.
 * @ai
 */
function QariahPostConnectEffects(): null {
  const posthog = usePostHog();
  // Once-per-process guard for the cold_start_began funnel marker.
  const coldStartBeganRef = useRef(false);

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
      // Read it synchronously here, before any await, on both platforms.
      const prevStalls = takePreviousProcessStallRecord();
      const stallProps =
        prevStalls !== null
          ? {
              prev_process_watchdog_ran: true,
              prev_process_build: prevStalls.build,
              prev_process_main_thread_stalls: prevStalls.stalls,
            }
          : {};
      if (bootSplashExperiment.active) {
        // @ai ANR hotfix v2 (Android): add how the previous process ended.
        // The read waits for up to 2 s. The event fires once, also on error.
        let sent = false;
        const sendColdStartBegan = (
          props: Parameters<typeof qariahAnalytics.trackColdStartBegan>[0],
        ): void => {
          if (sent) return;
          sent = true;
          qariahAnalytics.trackColdStartBegan(props);
        };
        void bootSplashExperiment
          .previousProcess()
          .then(r => {
            const props = r?.props ?? UNKNOWN_COLD_START_BOOT_PROPS;
            if (r?.newlyEnrolledByAnr) {
              qariahAnalytics.trackBootRiskEnrolled({
                reason: 'prev_anr',
                boot_splash_mode: getBootSplashMode(),
              });
            }
            // boot_risk includes an enrolment that this start made meanwhile.
            sendColdStartBegan({
              platform: Platform.OS,
              ...stallProps,
              ...props,
              boot_risk: bootSplashExperiment.isEnrolled(),
            });
          })
          .catch(() => {
            sendColdStartBegan({platform: Platform.OS, ...stallProps});
          });
      } else {
        qariahAnalytics.trackColdStartBegan({
          platform: Platform.OS,
          ...stallProps,
        });
      }
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
    qariahAnalytics.trackBootNotCompleted({
      failed_version: prev.version,
      failed_build: prev.build,
      detected_at_ms: Date.now(),
      furthest_step: prev.furthestStep,
    });
    // @ai ANR hotfix v2 — the previous launch never reached ready: enrol.
    enrolBootRisk('boot_not_completed');
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
    qariahAnalytics.trackPlaybackKilledInBackground({
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

  return null;
}

/**
 * Wraps upstream's AnalyticsConnector so the Qariah root effects run in the
 * order they had when they were inline in it (see the file header).
 * @ai
 */
export function QariahRootEffects({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <QariahPreConnectEffects />
      {children}
      <QariahPostConnectEffects />
      {/* @ai Sprint 48 (S48.6): the notification card (a Modal), iOS and Android. */}
      <NotificationSoftPrompt />
    </>
  );
}
