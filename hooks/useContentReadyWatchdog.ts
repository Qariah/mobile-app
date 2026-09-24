// @ai
// hooks/useContentReadyWatchdog.ts
// -------------------------------------------------------------------------
// REPORT-ONLY content-readiness watchdog for the POST-BOOT "spinner forever"
// hang class — a screen mounts (themed bg + nav back button render) but its
// content never resolves, so the user sees an infinite spinner and force-quits.
//
// THE GAP IT CLOSES: every BOOT-level instrument (slow-cold-start, splash-hide,
// the boot sentinel) reports SUCCESS before this happens — boot finished, the
// splash hid, then `restoreSession` pushed the destination screen (e.g. the
// Mushaf reader at the last-read page) and THAT screen's content load hung.
// Confirmed in the field: an iOS tester's "wouldn't open" was the restored
// Mushaf screen stuck on the DigitalKhatt-init spinner for ~7 min — zero crash,
// zero boot signal. This watchdog observes the OUTCOME (content not ready after
// a budget) and emits ONE discrete fault, plus a companion success for the rate
// denominator. Generalised from the reciter-profile surah-list watchdog (#114).
//
// Ungated / full-fleet (like the reciter-profile + boot-not-completed signals):
// it's a low-volume discrete fault, and we want EVERY user's stall, not the ~20%
// diagnostics cohort. It does NOT touch the screen's loading logic, force any
// ready state, or change what the user sees — pure telemetry.

import {useEffect, useRef} from 'react';
import {Platform} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import {markFirstContentReady} from '@/services/diagnostics/bootSentinel';

interface ContentReadyWatchdogOptions {
  /** Screen identifier for grouping, e.g. 'mushaf'. */
  screen: string;
  /** Flips true when the screen's content has actually rendered. */
  ready: boolean;
  /** The dependency being awaited (names the stall culprit), e.g.
   *  'digital-khatt-init', 'catalog', 'reciter-fetch'. */
  awaiting: string;
  /** True when this mount IS the cold-start restore destination (the most
   *  user-visible "won't open" variant). Drives the `cold` tag + marks the boot
   *  first-content-ready milestone. */
  cold?: boolean;
  /** How long to wait before declaring a stall. Default 8s. */
  budgetMs?: number;
}

/**
 * Fires `screen-content-stalled` (Sentry warning + PostHog) once per mount if
 * `ready` hasn't become true within `budgetMs`; fires `screen-content-rendered`
 * once when it does (rate denominator), and — on the cold-start destination —
 * marks the boot `first-content-ready` milestone. Idempotent per mount.
 */
export function useContentReadyWatchdog({
  screen,
  ready,
  awaiting,
  cold = false,
  budgetMs = 8000,
}: ContentReadyWatchdogOptions): void {
  const mountedAtRef = useRef(Date.now());
  const stallFiredRef = useRef(false);
  const renderedFiredRef = useRef(false);

  // FAULT — content still not ready after the budget. One discrete signal.
  useEffect(() => {
    if (ready) return; // already rendered — nothing to watch
    const t = setTimeout(() => {
      if (stallFiredRef.current || renderedFiredRef.current) return;
      stallFiredRef.current = true;
      const ctx = {
        screen,
        awaiting,
        elapsed_ms: Date.now() - mountedAtRef.current,
        cold,
        platform: Platform.OS,
      };
      // Sentry — warning message (nothing threw; it's a silent hang).
      Sentry.captureMessage('screen-content-stalled', {
        level: 'warning',
        tags: {
          scope: 'content-ready',
          screen,
          awaiting,
          cold: String(cold),
          sc_platform: Platform.OS,
        },
        extra: ctx,
      });
      // PostHog — discrete product-fault event (per-build/screen tripwire).
      analyticsService.trackScreenContentStalled(ctx);
    }, budgetMs);
    return () => clearTimeout(t);
  }, [ready, screen, awaiting, cold, budgetMs]);

  // SUCCESS — content rendered. Fire once (rate denominator) + mark the boot
  // first-content-ready milestone for the cold-start destination.
  useEffect(() => {
    if (!ready || renderedFiredRef.current) return;
    renderedFiredRef.current = true;
    analyticsService.trackScreenContentRendered({
      screen,
      awaiting,
      elapsed_ms: Date.now() - mountedAtRef.current,
      cold,
      platform: Platform.OS,
    });
    if (cold) markFirstContentReady();
  }, [ready, screen, awaiting, cold]);
}
