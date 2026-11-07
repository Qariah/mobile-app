// @ai Qariah (TECH_DEBT #243) — the splash TTI watchdog and the #53
// force-reveal, moved out of `app/_layout.tsx` (an upstream file) without a
// behaviour change. RootLayout calls this hook once, at the place where the
// code used to be, so the effect order in RootLayout is the same as before.
// It must stay in RootLayout (not in a child component): RootLayout renders
// nothing until the boot finishes, and this watchdog must arm at its mount.

import {useCallback, useEffect, useRef, useState} from 'react';
import {Platform} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {qariahAnalytics} from '@/services/analytics/qariahEvents';
import {bootSplashModeProp, enrolBootRisk} from '@/services/bootSplash';

/** The splash-hide gate flags of RootLayout, read live by the watchdog. */
export interface SplashGateFlags {
  appIsReady: boolean;
  fontsLoaded: boolean;
  isPlayerReady: boolean;
  mushafRestoreHandled: boolean;
  hasShareIntent: boolean;
}

// @ai REPORT-ONLY TTI watchdog budget (§3). 12s is past the worst measured
// Pixel-3 release cold start (~4.2-5.8s, Sprint 30) with headroom, and looser
// than the inner bootApp() 8s watchdog so the two don't double-fire on the same
// slow-but-fine boot.
const SPLASH_TTI_BUDGET_MS = 12000;

/**
 * Arms the splash TTI watchdog on mount and returns the #53 force-reveal flag
 * plus the once-only `splash_hidden` recorder for the two splash-hide paths.
 * @ai
 */
export function useSplashRevealWatchdog({
  appIsReady,
  fontsLoaded,
  isPlayerReady,
  mushafRestoreHandled,
  hasShareIntent,
}: SplashGateFlags): {forceReveal: boolean; recordSplashHidden: () => void} {
  // Qariah (#53): set by the splash watchdog when the gate flags haven't all
  // flipped within budget — bypasses EVERY splash gate (including fontsLoaded,
  // which can't be flipped from here) so a stalled boot reveals a degraded
  // app instead of an infinite splash. Field data: real-user boots wedged at
  // 12s+ with app_is_ready/player_ready false (OnePlus 8 Pro ×3, build 1293).
  const [forceReveal, setForceReveal] = useState(false);

  // @ai REPORT-ONLY TTI / splash-hide watchdog
  // (planning/observability-gap-samsung-hang-2026-06-08.md §3). The existing
  // `slow-cold-start` watchdog only measures bootApp()'s duration; the splash is
  // hidden in a SEPARATE gate (onLayoutRootView, which also requires fontsLoaded
  // / isPlayerReady / !hasShareIntent / mushafRestoreHandled). If bootApp()
  // FINISHES but one of those other flags never flips, the user is stuck on the
  // splash and the existing watchdog has already cleared in its finally{} — that
  // hang is invisible today. This watchdog is anchored to "JS start -> splash
  // actually hidden", independent of bootApp(). It OBSERVES and REPORTS, then
  // force-reveals (#53, below).
  const jsStartRef = useRef(Date.now());
  const splashHiddenRef = useRef(false);
  const recordSplashHidden = useCallback(() => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    qariahAnalytics.trackSplashHidden({
      tti_ms: Date.now() - jsStartRef.current,
      platform: Platform.OS,
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
  // still false — then flush (a hang may get the app OS-killed), then
  // force-reveal (#53).
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
      const stalledMode = bootSplashModeProp();
      qariahAnalytics.trackSplashStalled({
        elapsed_ms: elapsed,
        platform: Platform.OS,
        ...(stalledMode ? {boot_splash_mode: stalledMode} : {}),
      });
      // @ai ANR hotfix v2 — JS was not ready within the budget: enrol.
      enrolBootRisk('splash_stalled');
      // Qariah (#53): after reporting, force-reveal. A degraded-but-usable
      // app beats an infinite splash — services that finish late still hydrate
      // their stores, and a wedged one costs its feature, not the whole app.
      // The event above still fires first, so observability is preserved.
      setForceReveal(true);
    }, SPLASH_TTI_BUDGET_MS);
    return () => clearTimeout(t);
  }, []);

  return {forceReveal, recordSplashHidden};
}
