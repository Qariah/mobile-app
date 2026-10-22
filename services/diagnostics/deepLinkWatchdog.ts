// @ai
// Deep-link receipt/completion watchdog — REPORT-ONLY observability for the
// "deep link silently dropped" class (#105: under heavy cold-start load the
// initial URL is consumed but navigation never happens — the app lands on the
// Listen tab and the link target is lost, with zero signal today).
//
// WHAT IT DOES: records a `deeplink:received` breadcrumb for every navigational
// link (cold-start initial URL + warm `url` events), then watches the router
// pathname. If the pathname reaches the link's target a `deeplink:navigated`
// breadcrumb confirms success; if the budget elapses first, ONE warning event
// (`deeplink-dropped`) fires with the URL, the target path, and where the app
// actually ended up. REPORT-ONLY: it never navigates, retries, or alters the
// link handling — it only makes the drop queryable.

import {useEffect, useRef} from 'react';
import * as ExpoLinking from 'expo-linking';
import * as Sentry from '@sentry/react-native';
import {analyticsService} from '@/services/analytics/AnalyticsService';

// Generous vs a slow-but-working cold start (#53's force-reveal fires at 12s);
// only fires when navigation truly never happened.
const DEEPLINK_NAV_BUDGET_MS = 15000;

interface PendingLink {
  url: string;
  targetPath: string;
  receivedAt: number;
  cold: boolean;
  timer: ReturnType<typeof setTimeout>;
}

function normalizePath(p: string | null | undefined): string {
  return (p ?? '').replace(/^\/+|\/+$/g, '').toLowerCase();
}

// First path segment of an already-normalized path ("reciter/x" -> "reciter").
function firstSegment(normalized: string): string {
  return normalized.split('/')[0];
}

/**
 * Extract a navigational target path from an incoming URL, or null when the
 * link is not a navigation (bare app open, OAuth callback, dev-client URL).
 */
export function deepLinkTargetPath(url: string): string | null {
  try {
    const parsed = ExpoLinking.parse(url);
    // expo-linking folds the first segment of `scheme://segment/...` into
    // `hostname` for custom schemes; recombine so `qariah://reciter/x` and
    // `https://host/reciter/x` both yield "reciter/x".
    const host = parsed.hostname ?? '';
    const path = normalizePath(parsed.path);
    const combined = normalizePath(
      host && !host.includes('.') ? `${host}/${path}` : path,
    );
    if (!combined) return null; // bare launch — nothing to watch
    // Non-navigational link classes this app receives:
    if (combined.startsWith('expo-development-client')) return null;
    // QF OAuth callback (`com.qariah.app:/quranoauth2redirect`) — handled by
    // the auth session, never a route navigation.
    if (combined.includes('oauth2redirect')) return null;
    // expo-share-intent's iOS redirect (`<scheme>://dataUrl=...`) — handled by
    // the share-intent hook, not the router.
    if (combined.includes('dataurl')) return null;
    return combined;
  } catch {
    return null; // unparseable — never throw into the launch path
  }
}

/**
 * Mount-once hook (lives in AnalyticsConnector, inside the router context).
 * `pathname` must be the live expo-router pathname.
 */
export function useDeepLinkWatchdog(pathname: string): void {
  const pendingRef = useRef<PendingLink | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // Disarm on success: the live pathname's FIRST segment matching the link
  // target's first segment counts as "navigation happened" (resolved routes
  // render as e.g. /reciter/<slug> for qariah://reciter/<slug>). Exact
  // first-segment equality, NOT a substring `includes`, so a route like
  // /(d.settings)/reciter-choice can't false-disarm a dropped reciter link.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const now = normalizePath(pathname);
    if (now && firstSegment(now) === firstSegment(pending.targetPath)) {
      clearTimeout(pending.timer);
      pendingRef.current = null;
      Sentry.addBreadcrumb({
        category: 'navigation',
        message: `deeplink:navigated ${pending.targetPath}`,
        level: 'info',
        data: {elapsed_ms: Date.now() - pending.receivedAt},
      });
    }
  }, [pathname]);

  useEffect(() => {
    let unmounted = false;

    const matchesTarget = (targetPath: string): boolean => {
      const now = normalizePath(pathnameRef.current);
      return Boolean(now) && firstSegment(now) === firstSegment(targetPath);
    };

    const watch = (url: string, cold: boolean): void => {
      const targetPath = deepLinkTargetPath(url);
      if (!targetPath || unmounted) return;
      Sentry.addBreadcrumb({
        category: 'navigation',
        message: `deeplink:received ${targetPath}`,
        level: 'info',
        data: {cold},
      });
      // Navigation may have completed before this hook armed (normal fast
      // cold start: expo-router consumes the initial URL before the providers
      // tree mounts). Already there → success, nothing to watch.
      if (matchesTarget(targetPath)) {
        Sentry.addBreadcrumb({
          category: 'navigation',
          message: `deeplink:navigated ${targetPath}`,
          level: 'info',
          data: {pre_armed: true},
        });
        return;
      }
      // One watchdog at a time — a newer link supersedes the previous one.
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      const receivedAt = Date.now();
      const timer = setTimeout(() => {
        const stillPending = pendingRef.current;
        if (!stillPending || stillPending.url !== url) return;
        pendingRef.current = null;
        // Final check — covers a pathname transition the disarm effect missed
        // (e.g. navigation landing between renders). Match = not a drop.
        if (matchesTarget(targetPath)) {
          Sentry.addBreadcrumb({
            category: 'navigation',
            message: `deeplink:navigated ${targetPath}`,
            level: 'info',
            data: {late_check: true},
          });
          return;
        }
        const landedOn = pathnameRef.current;
        Sentry.captureMessage('deeplink-dropped', {
          level: 'warning',
          tags: {scope: 'navigation', link_cold: String(cold)},
          extra: {
            url,
            target_path: targetPath,
            pathname_at_check: landedOn,
            elapsed_ms: Date.now() - receivedAt,
          },
        });
        analyticsService.trackDeepLinkDropped({
          target_path: targetPath,
          pathname_at_check: landedOn,
          cold,
          elapsed_ms: Date.now() - receivedAt,
        });
      }, DEEPLINK_NAV_BUDGET_MS);
      pendingRef.current = {url, targetPath, receivedAt, cold, timer};
    };

    // Cold-start link: the URL the app was launched with (the #105 class).
    ExpoLinking.getInitialURL()
      .then(url => {
        if (url) watch(url, true);
      })
      .catch(() => {
        // Best-effort — never throw into the launch path.
      });

    // Warm links while the app is already running.
    const sub = ExpoLinking.addEventListener('url', ({url}) => {
      watch(url, false);
    });

    return () => {
      unmounted = true;
      sub.remove();
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    };
    // Mount-once by design: arming is driven by link events, not re-renders.
  }, []);
}
