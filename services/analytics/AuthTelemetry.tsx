/**
 * Sign-in funnel telemetry, derived by OBSERVATION.
 *
 * WHY THIS SHAPE
 * --------------
 * The v1→v2 restore events only fire after a successful QF sign-in, so a user
 * who never gets through sign-in was indistinguishable from one who had nothing
 * to restore — the migration's largest drop-off was structurally invisible.
 *
 * The obvious fix is to call analytics from inside `AuthContext.signIn()`. We
 * deliberately do NOT: `services/auth/` is the most fragile surface in the app
 * (the #207 iOS OAuth callback-scheme collision, ASWebAuthenticationSession,
 * token refresh), and a broken sign-in is far worse than a blind spot. So this
 * component only READS `AuthContext`'s already-public state and infers the
 * funnel from transitions. `AuthContext.tsx` and `qfOAuth.ts` keep a zero-line
 * diff.
 *
 * TRANSITION TABLE
 *   unauthenticated → loading          sign_in_started
 *   loading → authenticated            sign_in_succeeded
 *   loading → unauthenticated + error  sign_in_failed
 *   loading → unauthenticated, no err  sign_in_abandoned
 *
 * The last row works because AuthContext already distinguishes the two:
 *   `if (!result.cancelled && result.error) setLastError(result.error)`
 * — a user dismissing the OAuth browser leaves `lastError` null on purpose.
 *
 * `loading` is ALSO the initial mount state, so the first observed status is
 * recorded without emitting; otherwise every cold start would log a phantom
 * sign-in attempt.
 *
 * SAFETY PROPERTIES (structural, not promised)
 *   - renders null → cannot affect layout or UI
 *   - all work inside a try/catch'd effect → telemetry can never break auth
 *   - nothing is awaited → cannot add latency to the auth path
 *   - reads context only → cannot mutate auth state
 *   - analytics consent is already fail-closed upstream → no-op when off
 */
import {useEffect, useRef} from 'react';
import {Platform} from 'react-native';
import {useAuth} from '@/services/auth';
import {analyticsService} from './AnalyticsService';
import {deriveSignInEvent} from './signInFunnel';

export function AuthTelemetry(): null {
  const {status, lastError} = useAuth();
  // Previous observed status. `null` means "nothing observed yet" — the initial
  // mount, which must not be counted as an attempt.
  const prevStatus = useRef<string | null>(null);
  // Wall-clock start of the in-flight attempt, for the terminal event's
  // duration. A rising tail here is the signal behind "sign-in feels broken"
  // reports that never produce an error.
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    try {
      const prev = prevStatus.current;
      prevStatus.current = status;

      // `startedAt` is set only when a `started` was emitted, so it doubles
      // as the "an attempt is actually open" flag that suppresses cold-start
      // hydrate transitions.
      const event = deriveSignInEvent(
        prev,
        status,
        lastError,
        startedAt.current !== null,
      );
      if (!event) return;

      const platform = Platform.OS;
      const duration_ms =
        startedAt.current === null ? null : Date.now() - startedAt.current;

      switch (event.type) {
        case 'started':
          startedAt.current = Date.now();
          analyticsService.trackSignInStarted({platform});
          break;
        case 'succeeded':
          analyticsService.trackSignInSucceeded({platform, duration_ms});
          startedAt.current = null;
          break;
        case 'failed':
          analyticsService.trackSignInFailed({
            platform,
            duration_ms,
            reason: event.reason,
          });
          startedAt.current = null;
          break;
        case 'abandoned':
          analyticsService.trackSignInAbandoned({platform, duration_ms});
          startedAt.current = null;
          break;
      }
    } catch {
      // Telemetry must never break authentication. Swallow deliberately —
      // there is no recovery worth attempting and no safe surface to report on
      // (reporting is the thing that just failed).
    }
  }, [status, lastError]);

  return null;
}
