/**
 * Pure derivation for the sign-in funnel. NO React, NO react-native, NO imports
 * from `services/auth` — deliberately dependency-free so the whole decision is
 * unit-testable in isolation.
 *
 * This matters more than usual here: the success path cannot be exercised
 * locally without real QF credentials, so these functions' tests are the
 * primary evidence that the funnel is correct. Keeping them importable without
 * a React runtime means that evidence doesn't depend on the jest environment.
 *
 * Consumed by `AuthTelemetry.tsx`, which is a thin dispatcher over this.
 */
import type {SignInFailureReason} from './events';

/** What a single status transition means, or `null` for "emit nothing". */
export type SignInFunnelEvent =
  | {type: 'started'}
  | {type: 'succeeded'}
  | {type: 'failed'; reason: SignInFailureReason}
  | {type: 'abandoned'}
  | null;

/**
 * Map `AuthContext.lastError` onto the closed `SignInFailureReason` set.
 *
 * The raw string is built in `qfOAuth.ts` and can embed an OAuth
 * error_description or a caught exception message, so it must never be emitted
 * verbatim. Classifying here rather than at the construction site is the trade
 * that keeps `qfOAuth.ts` — the most fragile file in the app — at a zero-line
 * diff. The cost is that a reworded upstream message falls through to `other`
 * instead of mis-labelling; since only these fixed labels are ever emitted, a
 * mis-classification can never leak anything.
 */
export function classifySignInFailure(
  lastError: string | null,
): SignInFailureReason {
  if (!lastError) return 'other';
  const e = lastError.toLowerCase();
  if (e.includes('auth session ended')) return 'session-ended';
  if (e.includes('state mismatch')) return 'state-mismatch';
  if (e.includes('no code in callback')) return 'no-code';
  // qfOAuth builds `${qfError}: ${desc}` for a server-returned OAuth error;
  // those carry an oauth2 error code such as access_denied / invalid_grant.
  if (
    e.includes('_denied') ||
    e.includes('invalid_') ||
    e.includes('unauthorized')
  ) {
    return 'oauth-error';
  }
  return 'other';
}

/**
 * The entire funnel decision, as a pure function.
 *
 * TRANSITION TABLE
 *   unauthenticated → loading          started
 *   loading → authenticated            succeeded
 *   loading → unauthenticated + error  failed
 *   loading → unauthenticated, no err  abandoned
 *
 * The last row works because AuthContext already distinguishes the two:
 *   `if (!result.cancelled && result.error) setLastError(result.error)`
 * — a user dismissing the OAuth browser leaves `lastError` null on purpose.
 *
 * @param prev previously observed status, or `null` on first observation
 * @param next the status now
 */
export function deriveSignInEvent(
  prev: string | null,
  next: string,
  lastError: string | null,
  attemptInFlight: boolean,
): SignInFunnelEvent {
  if (prev === null) return null;
  if (prev === next) return null;

  // Only `unauthenticated -> loading` is user-initiated. The provider ALSO
  // boots in `loading` and leaves it when Auth.isSignedIn() resolves, and that
  // hydrate edge is byte-identical to a real attempt terminating.
  if (prev === 'unauthenticated' && next === 'loading')
    return {type: 'started'};

  // Hence `attemptInFlight`: a terminal event may only fire if we actually saw
  // the attempt OPEN. Skipping only the FIRST observation guards the wrong
  // edge — cold-start hydrate then emits a phantom `abandoned` (signed-out) or
  // `succeeded` (signed-in) on EVERY launch. Caught on-device 2026-08-08: 9
  // phantom abandonments from 1 real attempt, because the unit tests asserted
  // the buggy behaviour rather than the intended one.
  if (!attemptInFlight) return null;

  if (prev === 'loading' && next === 'authenticated')
    return {type: 'succeeded'};
  if (prev === 'loading' && next === 'unauthenticated') {
    return lastError
      ? {type: 'failed', reason: classifySignInFailure(lastError)}
      : {type: 'abandoned'};
  }
  // Everything else (notably sign-out: authenticated → unauthenticated) is not
  // part of this funnel and must not be counted as an abandoned attempt.
  return null;
}
