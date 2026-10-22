// @ai
// Cold-start deep-link REPLAY — the actual fix for #105 (companion to the
// report-only deepLinkWatchdog.ts in this directory).
//
// THE BUG: under a slow cold boot (heavy CPU pressure / OEM contention, boot
// >6s) the app's RootLayout returns null until appIsReady, so the
// NavigationContainer mounts late. expo-router reads getInitialURL() once at
// store-init time, but the initial-URL navigation can be lost in that window —
// the app lands on the Listen tab and the deep-link target is silently dropped
// (repro'd 3/3 on a Samsung A35 under 10-spinner pressure; correct when boot is
// fast). The report-only watchdog makes the drop queryable; THIS closes it.
//
// THE FIX: capture the cold-start initial URL exactly once (at module load, so
// nothing downstream can clear it out from under us), then — once the root
// navigator reports ready — replay it via router.replace(<path>) IFF the router
// did not already land on the target. We replay the SAME path expo-router's own
// filesystem resolver would have used (e.g. "reciter/<slug>", "quran/2/255",
// "mushaf/50", "adhkar/<id>"), so route resolution is unchanged — the only
// difference is WHEN it runs (after a confirmed-ready navigator) and that it's
// idempotent against expo-router's own (possibly-successful) initial nav.
//
// SCOPE (hard guards):
//  (a) cold start only — captured from getInitialURL() at first module load;
//      warm `url` events are expo-router's job and are NOT touched here.
//  (b) single replay — a module-level latch + a per-mount ref; React 18 strict
//      double-mount and flag re-renders can't double-navigate.
//  (c) no double-nav — if the live pathname already reached the target's first
//      segment by the time the navigator is ready, expo-router handled it and
//      we no-op.

import {useEffect, useRef} from 'react';
import * as ExpoLinking from 'expo-linking';
import {useNavigationContainerRef, useRouter} from 'expo-router';
import * as Sentry from '@sentry/react-native';
import {
  deepLinkTargetPath,
  linkTargetReached,
} from '@/services/diagnostics/deepLinkWatchdog';

// Capture the launch URL ONCE, at module evaluation (before React renders), so
// the cold-start link is held in our own promise and survives anything else
// consuming the system initial-URL. Best-effort: a rejection resolves to null
// and the replay simply no-ops. This is a cold-start snapshot by construction —
// getInitialURL() reflects the URL the process was launched with.
const initialUrlPromise: Promise<string | null> = ExpoLinking.getInitialURL()
  .then(url => url ?? null)
  .catch(() => null);

// Module-level latch: the cold-start URL is replayed/handled at most once for
// the life of the process, independent of component remounts.
let coldStartHandled = false;

// Classification of the cold-start URL, once getInitialURL settles: true for
// a navigational deep link; false for no link or a non-navigational one (bare
// launch, OAuth or share redirect). The mushaf-restore redirect in
// app/_layout.tsx awaits it to yield to the link. (@ai Sprint 46: the old
// synchronous query had no caller after the Pass B merge and is removed.)
const coldStartClassified: Promise<boolean> = initialUrlPromise.then(
  url => typeof deepLinkTargetPath(url ?? '') === 'string',
);

/**
 * Resolves once getInitialURL() has settled and the launch URL is classified:
 * true for a navigational deep link (a share link, a widget tap). Never
 * rejects. The mushaf-restore redirect in app/_layout.tsx awaits it, so a
 * slow getInitialURL() cannot let the restore push land over the link target
 * (upstream fca03eed awaits the launch URL at the same point).
 */
export function whenColdStartDeepLinkKnown(): Promise<boolean> {
  return coldStartClassified;
}

// How long to wait for the navigator to become ready before giving up. A slow
// cold boot (the #105 case) can take >6s; 20s comfortably outlasts the splash
// force-reveal (12s, hooks/useSplashRevealWatchdog.ts) with headroom, and a
// 250ms poll is cheap.
const NAV_READY_POLL_MS = 250;
const NAV_READY_TIMEOUT_MS = 20000;

/**
 * Mount-once hook (lives in QariahRootEffects, inside the router context).
 * `pathname` is the live expo-router pathname; read at replay time to detect
 * whether expo-router already navigated to the cold-start target (no double-nav).
 */
export function useDeepLinkColdStartReplay(pathname: string): void {
  const navigationRef = useNavigationContainerRef();
  const router = useRouter();
  // Keep the latest pathname readable from the poll closure without re-arming.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // Mount-once by design: the cold-start URL is a fixed snapshot, so arming is
  // a one-time setup, not a per-render concern.
  useEffect(() => {
    if (coldStartHandled) return;

    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const startedAt = Date.now();

    const finish = (): void => {
      coldStartHandled = true;
      if (poll) clearInterval(poll);
    };

    const replayIfDropped = (targetPath: string): void => {
      // No double-nav: if expo-router already drove us to the target's first
      // segment, the initial-URL nav succeeded — leave it alone.
      // @ai Qariah (Sprint 46): a redirect route's landing counts too
      // (`qariah://player` lands on Home, `qariah://quran/…` on the Mushaf).
      if (linkTargetReached(pathnameRef.current, targetPath)) {
        finish();
        return;
      }

      // The race dropped it (navigator is ready but we're not at the target).
      // Replay the exact path expo-router's filesystem resolver would have used.
      finish();
      Sentry.addBreadcrumb({
        category: 'navigation',
        message: `deeplink:replayed ${targetPath}`,
        level: 'info',
        data: {landed_on: pathnameRef.current},
      });
      try {
        router.replace(`/${targetPath}`);
      } catch (e) {
        // Never throw into the boot path; a failed replay leaves the user on
        // the home screen (the pre-fix behavior), and the watchdog still
        // reports the drop.
        if (__DEV__) {
          console.warn('[deeplink-replay] router.replace failed', e);
        }
      }
    };

    (async () => {
      const url = await initialUrlPromise;
      if (cancelled || coldStartHandled) return;

      const targetPath = deepLinkTargetPath(url ?? '');
      // Not a navigational cold-start link (bare launch, OAuth/share redirect,
      // or unparseable) — nothing to replay. Latch so we don't re-check.
      if (!targetPath) {
        finish();
        return;
      }

      const navReady = (): boolean => {
        const ref = navigationRef.current;
        return Boolean(ref && ref.isReady());
      };

      // Fast path: navigator already ready (fast boot / link landed late).
      if (navReady()) {
        replayIfDropped(targetPath);
        return;
      }

      // Slow boot: poll until the NavigationContainer mounts and reports ready,
      // then act once. Calling router.replace before the root layout mounts
      // throws in expo-router, so the readiness gate is mandatory.
      poll = setInterval(() => {
        if (cancelled || coldStartHandled) {
          if (poll) clearInterval(poll);
          return;
        }
        if (navReady()) {
          replayIfDropped(targetPath);
          return;
        }
        if (Date.now() - startedAt > NAV_READY_TIMEOUT_MS) {
          // Gave up waiting; let the watchdog's drop report stand.
          finish();
        }
      }, NAV_READY_POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }, [navigationRef, router]);
}
