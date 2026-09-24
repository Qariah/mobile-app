/**
 * Public API for services/auth.
 *
 * App code should import from '@/services/auth' rather than reaching into
 * individual modules. The granular files (config, tokenStore, qfOAuth, etc.)
 * are implementation detail.
 */

export {
  AuthProvider,
  useAuth,
  type AuthContextValue,
  type AuthStatus,
} from './AuthContext';
export {
  getValidAccessToken,
  isSignedIn,
  refreshAccessToken,
  signIn,
  signOut,
} from './qfOAuth';
export type {SignInResult} from './qfOAuth';
export {
  getQfOAuthConfig,
  getQfApiBase,
  type QfEnv,
  type QfOAuthConfig,
} from './config';
