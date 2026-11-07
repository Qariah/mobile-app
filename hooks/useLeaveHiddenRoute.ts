// @ai-generated
// Qariah (Sprint 47 Task 10). Upstream candidate: the same flag gate fits
// Bayaan's `adhkar` flag (RFC-007).
import {useEffect, useRef} from 'react';
import {useNavigation} from 'expo-router';

/**
 * For a route of a feature that Qariah hides (a flag in
 * config/featureFlags.ts) that a link can still open: step off the route
 * once and show the screen underneath. When there is nothing underneath,
 * replace the route with `fallbackRouteName`, a screen of the same navigator.
 *
 * Waits one frame, as hooks/useLeaveLinkRoute.ts does: on a cold launch the
 * navigator applies the link's initial state after this screen's first
 * effect, and drops a navigation dispatched before that.
 */
export function useLeaveHiddenRoute(fallbackRouteName: string): void {
  const navigation = useNavigation();
  const left = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (left.current) return;
      left.current = true;
      if (navigation.canGoBack()) navigation.goBack();
      else
        navigation.dispatch({
          type: 'REPLACE',
          payload: {name: fallbackRouteName},
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, fallbackRouteName]);
}
