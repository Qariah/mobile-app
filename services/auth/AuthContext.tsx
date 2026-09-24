/**
 * AuthContext — single source of truth for sign-in state across the app.
 *
 * Wraps the imperative qfOAuth.ts functions in a React Context that exposes:
 *   - status: 'loading' | 'unauthenticated' | 'authenticated'
 *   - signIn(): triggers the QF OAuth flow, updates status on success
 *   - signOut(): clears stored tokens
 *
 * On mount, hydrates from SecureStore so a returning user is logged in
 * silently (without re-entering credentials).
 *
 * Components consume via the useAuth() hook.
 */

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
  /** Last error from signIn(), cleared on next attempt. Null when no error. */
  lastError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [lastError, setLastError] = useState<string | null>(null);

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

  const signIn = useCallback(async () => {
    if (__DEV__) console.log('[auth-trace] signIn:start');
    setLastError(null);
    setStatus('loading');
    const result = await Auth.signIn();
    if (__DEV__)
      console.log('[auth-trace] signIn:result', {
        ok: result.ok,
        cancelled: result.cancelled,
        error: result.error,
      });
    if (result.ok) {
      setStatus('authenticated');
      if (__DEV__) console.log('[auth-trace] signIn:status=authenticated');
    } else {
      setStatus('unauthenticated');
      // Cancellation is not an error from the user's perspective.
      if (!result.cancelled && result.error) setLastError(result.error);
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
    setStatus('unauthenticated');
    setLastError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({status, lastError, signIn, signOut}),
    [status, lastError, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}
