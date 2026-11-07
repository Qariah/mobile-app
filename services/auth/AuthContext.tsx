/**
 * AuthContext — single source of truth for sign-in state across the app.
 *
 * Wraps the imperative qfOAuth.ts functions in a React Context that exposes:
 *   - status: 'loading' | 'unauthenticated' | 'authenticated'
 *   - signIn(): triggers the QF OAuth flow, updates status on success
 *   - signOut(): clears stored tokens (local data stays; see M4 in signIn)
 *
 * On mount, hydrates from SecureStore so a returning user is logged in
 * silently (without re-entering credentials). After mount, it follows the
 * token-refresh events from qfOAuth.ts (M1, TECH_DEBT #244). // @ai
 *
 * Components consume via the useAuth() hook.
 */

import * as Sentry from '@sentry/react-native';
import {classifySignInFailure} from '@/services/analytics/signInFunnel';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as Auth from './qfOAuth';

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  /**
   * Last error from signIn(), cleared on next attempt. Null when no error.
   * Technical English for the sign-in telemetry (`signInFunnel.ts`); screens
   * show `qariah:auth.signInFailed` instead of this text. // @ai
   */
  lastError: string | null;
  /**
   * M1 (TECH_DEBT #244) — true when the last token refresh failed with a
   * server error, a 429 or a network error. The tokens are kept and `status`
   * stays 'authenticated'; the next QF call tries the refresh again. // @ai
   */
  tokenRefreshFailed: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [lastError, setLastError] = useState<string | null>(null);
  const [tokenRefreshFailed, setTokenRefreshFailed] = useState(false); // @ai

  // Hydrate on mount.
  useEffect(() => {
    let cancelled = false;
    Auth.isSignedIn().then(signed => {
      if (cancelled) return;
      setStatus(signed ? 'authenticated' : 'unauthenticated');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // @ai-start
  // M1 (TECH_DEBT #244) — follow the token refresh after mount. Before this,
  // a refresh that cleared the tokens left the status at 'authenticated'.
  useEffect(
    () =>
      Auth.subscribeAuthEvents(event => {
        if (event.type === 'session-expired') {
          setTokenRefreshFailed(false);
          // While a sign-in or the mount check runs ('loading'), that flow
          // sets the status.
          setStatus(prev => (prev === 'loading' ? prev : 'unauthenticated'));
        } else if (event.type === 'refresh-failed') {
          setTokenRefreshFailed(true);
        } else {
          setTokenRefreshFailed(false);
        }
      }),
    [],
  );
  // @ai-end

  const signIn = useCallback(async () => {
    if (__DEV__) console.log('[auth-trace] signIn:start');
    setLastError(null);
    setTokenRefreshFailed(false); // @ai
    setStatus('loading');
    // @ai-start
    // M4 (TECH_DEBT #244) — open the account check before the new tokens
    // exist. Until the check completes, no queue flush or restore uses the
    // stored account, which can be a different account's.
    const accountCleanup =
      await import('@/services/userState/accountCleanup').catch(() => null);
    await accountCleanup?.markAccountCheckPending();
    // @ai-end
    const result = await Auth.signIn();
    if (__DEV__)
      console.log('[auth-trace] signIn:result', {
        ok: result.ok,
        cancelled: result.cancelled,
        error: result.error,
      });
    if (result.ok) {
      // @ai-start
      // M4 — compare the new account with the stored one BEFORE the status
      // changes, so the previous account's data is gone before any pull,
      // restore or flush runs. A failed check stays open; the restores and
      // the flush run it again and wait for it.
      try {
        await accountCleanup?.ensureAccountVerified();
      } catch (e) {
        if (__DEV__) console.warn('[auth-trace] signIn:account-check', e);
      }
      // @ai-end
      setStatus('authenticated');
      if (__DEV__) console.log('[auth-trace] signIn:status=authenticated');
    } else {
      setStatus('unauthenticated');
      // Cancellation is not an error from the user's perspective.
      if (!result.cancelled && result.error) {
        setLastError(result.error);
        // @ai Qariah (Sprint 47 review): screens show a localized sentence, so
        // a later error report carries the failure class. Never the raw text:
        // it can hold a token-endpoint body (signInFunnel.ts).
        Sentry.addBreadcrumb({
          category: 'auth',
          level: 'warning',
          message: 'signIn failed',
          data: {reason: classifySignInFailure(result.error)},
        });
      }
      if (__DEV__) console.log('[auth-trace] signIn:status=unauthenticated');
    }
  }, []);

  const signOut = useCallback(async () => {
    await Auth.signOut();
    // Sprint 13 (TECH_DEBT #51) — drop the QF /userinfo cache so the next
    // sign-in re-fetches cleanly without leaking the previous user's email.
    const {clearQfUserInfoCache} =
      await import('@/services/userState/qfUserInfo');
    clearQfUserInfoCache();
    // M4 (TECH_DEBT #244) — sign-out keeps the notes, the queued writes and
    // the restore flags, so the same account loses nothing when it signs in
    // again. A different account triggers the cleanup at its sign-in
    // (`services/userState/accountCleanup.ts`). // @ai
    setTokenRefreshFailed(false); // @ai
    setStatus('unauthenticated');
    setLastError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({status, lastError, tokenRefreshFailed, signIn, signOut}),
    [status, lastError, tokenRefreshFailed, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}

/**
 * The sign-in status, or `'unauthenticated'` outside an `<AuthProvider>`.
 *
 * For the inherited verse sheets that add Qariah's QF note sync on top of
 * upstream screens. The app always mounts them inside the provider; upstream's
 * own tests render them without one, and there "signed out" is the correct
 * reading (the sheets then behave exactly as upstream's).
 */
export function useAuthStatus(): AuthStatus {
  return useContext(Ctx)?.status ?? 'unauthenticated';
}
