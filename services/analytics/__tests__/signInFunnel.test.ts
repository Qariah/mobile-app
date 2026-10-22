/**
 * The sign-in funnel is derived from AuthContext state transitions rather than
 * from calls inside `signIn()` (see AuthTelemetry's header for why). That makes
 * the derivation the only place a bug can hide, so it is tested exhaustively
 * here as a pure function — no rendering, no mocks, no jest-env dependence.
 *
 * The success path cannot be exercised on a local device without real QF
 * credentials, so these cases ARE the primary evidence that it is correct.
 */
import {deriveSignInEvent, classifySignInFailure} from '../signInFunnel';

describe('deriveSignInEvent', () => {
  it('emits nothing on first observation — the provider boots in `loading`', () => {
    // Regression guard: without this, every cold start logs a phantom attempt
    // and the funnel's denominator is silently inflated.
    expect(deriveSignInEvent(null, 'loading', null, false)).toBeNull();
    expect(deriveSignInEvent(null, 'authenticated', null, false)).toBeNull();
    expect(deriveSignInEvent(null, 'unauthenticated', null, false)).toBeNull();
  });

  it('emits nothing when the status has not actually changed', () => {
    // The effect also re-runs when `lastError` changes alone.
    expect(deriveSignInEvent('loading', 'loading', null, true)).toBeNull();
    expect(
      deriveSignInEvent('unauthenticated', 'unauthenticated', 'boom', false),
    ).toBeNull();
  });

  it('counts unauthenticated → loading as a started attempt', () => {
    expect(
      deriveSignInEvent('unauthenticated', 'loading', null, false),
    ).toEqual({
      type: 'started',
    });
  });

  it('counts loading → authenticated as success', () => {
    expect(deriveSignInEvent('loading', 'authenticated', null, true)).toEqual({
      type: 'succeeded',
    });
  });

  it('counts loading → unauthenticated WITH an error as a failure', () => {
    expect(
      deriveSignInEvent(
        'loading',
        'unauthenticated',
        'State mismatch (possible CSRF)',
        true,
      ),
    ).toEqual({type: 'failed', reason: 'state-mismatch'});
  });

  it('counts loading → unauthenticated WITHOUT an error as abandonment', () => {
    // AuthContext deliberately leaves lastError null when the user dismisses
    // the OAuth browser: `if (!result.cancelled && result.error) setLastError`.
    // This is the migration's most important drop-off.
    expect(deriveSignInEvent('loading', 'unauthenticated', null, true)).toEqual(
      {
        type: 'abandoned',
      },
    );
  });

  describe('cold start must be silent — the bug found on-device 2026-08-08', () => {
    // The provider boots in `loading`, then leaves it when Auth.isSignedIn()
    // resolves. With no attempt open, BOTH outcomes of that hydrate are
    // indistinguishable from a real attempt terminating — and an earlier
    // version emitted 9 phantom abandonments from 1 real attempt.
    it('signed-out hydrate (loading → unauthenticated) emits nothing', () => {
      expect(
        deriveSignInEvent('loading', 'unauthenticated', null, false),
      ).toBeNull();
    });

    it('signed-in hydrate (loading → authenticated) emits nothing', () => {
      expect(
        deriveSignInEvent('loading', 'authenticated', null, false),
      ).toBeNull();
    });

    it('a hydrate carrying a stale error still emits nothing', () => {
      expect(
        deriveSignInEvent('loading', 'unauthenticated', 'boom', false),
      ).toBeNull();
    });

    it('but the SAME transitions do emit once an attempt is open', () => {
      expect(
        deriveSignInEvent('loading', 'unauthenticated', null, true),
      ).toEqual({
        type: 'abandoned',
      });
      expect(deriveSignInEvent('loading', 'authenticated', null, true)).toEqual(
        {
          type: 'succeeded',
        },
      );
    });
  });

  it('ignores sign-out (authenticated → unauthenticated)', () => {
    // Would otherwise be miscounted as an abandoned sign-in.
    expect(
      deriveSignInEvent('authenticated', 'unauthenticated', null, true),
    ).toBeNull();
  });

  it('ignores a silent re-hydrate to authenticated', () => {
    expect(
      deriveSignInEvent('unauthenticated', 'authenticated', null, true),
    ).toBeNull();
  });
});

describe('classifySignInFailure', () => {
  it.each([
    ['Auth session ended without success (type=dismiss)', 'session-ended'],
    ['State mismatch (possible CSRF)', 'state-mismatch'],
    ['No code in callback', 'no-code'],
    ['access_denied: The user denied the request', 'oauth-error'],
    ['invalid_grant: bad code', 'oauth-error'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(classifySignInFailure(input)).toBe(expected);
  });

  it('falls through to `other` rather than leaking an unrecognised message', () => {
    // The whole point of the closed set: qfOAuth's line 209 path surfaces an
    // arbitrary caught exception message, which may embed a URL. It must never
    // reach analytics verbatim.
    expect(
      classifySignInFailure(
        'Network request failed: https://example/x?e=a@b.com',
      ),
    ).toBe('other');
    expect(classifySignInFailure(null)).toBe('other');
  });

  it('only ever returns members of the closed set', () => {
    const allowed = [
      'session-ended',
      'oauth-error',
      'state-mismatch',
      'no-code',
      'other',
    ];
    const samples = [
      null,
      '',
      'anything at all',
      'ACCESS_DENIED',
      'no code in callback',
      '{"weird":"json"}',
    ];
    for (const s of samples) {
      expect(allowed).toContain(classifySignInFailure(s));
    }
  });
});
