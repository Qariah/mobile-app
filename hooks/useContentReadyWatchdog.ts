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

import {useEffect, useRef, type RefObject} from 'react';
import {Platform} from 'react-native';
import * as Sentry from '@sentry/react-native';
import type {Reciter} from '@/data/reciterData';
import {qariahAnalytics} from '@/services/analytics/qariahEvents';
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
      qariahAnalytics.trackScreenContentStalled(ctx);
    }, budgetMs);
    return () => clearTimeout(t);
  }, [ready, screen, awaiting, cold, budgetMs]);

  // SUCCESS — content rendered. Fire once (rate denominator) + mark the boot
  // first-content-ready milestone for the cold-start destination.
  useEffect(() => {
    if (!ready || renderedFiredRef.current) return;
    renderedFiredRef.current = true;
    qariahAnalytics.trackScreenContentRendered({
      screen,
      awaiting,
      elapsed_ms: Date.now() - mountedAtRef.current,
      cold,
      platform: Platform.OS,
    });
    if (cold) markFirstContentReady();
  }, [ready, screen, awaiting, cold]);
}

// ---------------------------------------------------------------------------
// Reciter-profile surah-list watchdog (the original, bespoke variant)
// ---------------------------------------------------------------------------
// @ai Qariah (TECH_DEBT #243) — moved out of
// components/reciter-profile/ReciterProfile.tsx (an upstream file) without a
// behaviour change. The event names, tags, props, budget and effect
// dependencies are the same as before the move, so the triage matchers
// (`reciter-profile-surahs-stalled` / `reciter_profile_surahs_stalled` in
// scripts/sentry-triage.mjs, scripts/posthog-triage.mjs and
// scripts/lib/incident-knowledge.mjs) need no change.

const RECITER_SURAHS_STALL_MS = 5000;

interface ReciterProfileSurahsWatchdogOptions {
  /** ReciterProfile's surah-list gate (`neighborsReady`). */
  neighborsReady: boolean;
  reciterId: string;
  /** The reciter object. A new object restarts the budget, as before. */
  reciter: Pick<Reciter, 'name'> | null;
  /** The selected rewayah id (ReciterProfile's `selectedRewayatId`). */
  rewayaId: string | undefined;
  tabsCount: number;
  /** Read when the watchdog fires, not when it arms. */
  pagerScrolledRef: RefObject<boolean>;
}

/**
 * @ai REPORT-ONLY render/skeleton watchdog
 * (planning/observability-gap-samsung-hang-2026-06-08.md §1). The reciter
 * profile's surah list is gated behind `neighborsReady`, lifted by either
 * handlePagerContentSizeChange (multi-tab) or the single-tab useEffect in
 * ReciterProfile. The 2026-06-04 hotfix bug was exactly that single-tab path
 * being dropped → on Android single-tab reciters the gate never lifted →
 * skeleton FOREVER (a silent hang: no throw, no crash, so both Sentry and
 * PostHog were blind). This watchdog observes the OUTCOME (gate still false
 * after the budget) regardless of WHICH lift path failed, and emits ONE
 * discrete fault signal per mount. It does NOT touch the gate or change how it
 * lifts (hard constraint) — purely making the hang queryable. It also fires
 * the companion SUCCESS event once when the gate DOES lift, so PostHog can
 * compute a stall RATE (stalled / (stalled + rendered)) per build.
 */
export function useReciterProfileSurahsWatchdog({
  neighborsReady,
  reciterId,
  reciter,
  rewayaId,
  tabsCount,
  pagerScrolledRef,
}: ReciterProfileSurahsWatchdogOptions): void {
  const stallFiredRef = useRef(false);
  useEffect(() => {
    if (neighborsReady) return; // already rendered — nothing to watch
    const t = setTimeout(() => {
      if (stallFiredRef.current) return;
      stallFiredRef.current = true;
      const ctx = {
        reciter_id: reciterId,
        reciter_name: reciter?.name ?? null,
        rewaya_id: rewayaId ?? null,
        tabs_count: tabsCount,
        neighbors_ready: neighborsReady, // expected false here
        pager_scrolled: pagerScrolledRef.current,
        platform: Platform.OS,
      };
      // Sentry — warning-level message (NOT an exception; nothing threw).
      // release/dist come from Sentry.init; device_tier from diagnostics context.
      Sentry.captureMessage('reciter-profile-surahs-stalled', {
        level: 'warning',
        tags: {
          scope: 'reciter-profile',
          tabs_count: String(tabsCount),
          rp_platform: Platform.OS,
        },
        extra: ctx,
      });
      // PostHog — discrete product-fault event (drives the per-build tripwire).
      qariahAnalytics.trackReciterProfileSurahsStalled(ctx);
    }, RECITER_SURAHS_STALL_MS);
    return () => clearTimeout(t);
    // pagerScrolledRef is a stable ref object: it is listed only for the lint
    // rule, and it never restarts the budget.
  }, [
    neighborsReady,
    reciterId,
    reciter,
    rewayaId,
    tabsCount,
    pagerScrolledRef,
  ]);

  // @ai REPORT-ONLY companion SUCCESS event — fire once when the gate DOES
  // lift (§1). Telemetry only.
  const renderedFiredRef = useRef(false);
  useEffect(() => {
    if (!neighborsReady || renderedFiredRef.current) return;
    renderedFiredRef.current = true;
    qariahAnalytics.trackReciterProfileSurahsRendered({
      reciter_id: reciterId,
      rewaya_id: rewayaId ?? null,
      tabs_count: tabsCount,
      platform: Platform.OS,
    });
  }, [neighborsReady, reciterId, rewayaId, tabsCount]);
}
