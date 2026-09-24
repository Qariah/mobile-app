/**
 * Singleton `@quranjs/api/public` client + `TokenStorage` adapter over our
 * existing SecureStore-backed `tokenStore.ts`.
 *
 * Why this lives in `services/auth/` and not `services/userState/`: the SDK
 * unifies OAuth flow (oauth2.exchangeCode / refresh) with the user-data API
 * (auth.collections / preferences / readingSessions / bookmarks). Both halves
 * want to share one client instance. `services/auth/` already owns OAuth
 * config + token persistence, so the SDK factory is a natural neighbour.
 *
 * Important: the SDK's user-data path layout is `{authBaseUrl}/v1/{resource}`.
 * To hit QF's `/auth/v1/{resource}` endpoints we set `authBaseUrl` to
 * `{apiBase}/auth` — verified live against prelive (`apis-prelive.quran.foundation/auth/v1/collections`
 * returns "missing required headers" — i.e. the route exists; the bare `/collections`
 * and `/v1/collections` paths return 404). Sprint 17 (S17.2) finding —
 * Qariah's pre-S17.2 sync queue was calling `/collections` (no prefix) which
 * has always returned 404. The migration silently fixes that latent bug.
 *
 * Confidential-client constraint: the SDK's `/public` entrypoint throws
 * "This OAuth2 exchange requires a backend because your client is
 * confidential" when `oauth2.exchangeCode` or `oauth2.refresh` are called and
 * the underlying QF client is registered with `client_secret_basic` auth.
 * That is exactly Qariah's prelive client today. We therefore do NOT route the
 * token-exchange / refresh paths through the SDK — those stay in
 * `qfOAuth.ts`. The SDK is wired only for the user-data API surface, plus the
 * authorize-URL builder (which doesn't call the network so is unaffected).
 *
 * Once QF registers a public OAuth client for Qariah (TECH_DEBT #53), the
 * exchange + refresh paths can move into the SDK and `qfOAuth.ts` shrinks
 * substantially. Until then, the SDK reads the token snapshot we maintain via
 * `tokenStore.ts` for its user-data calls.
 *
 * Sprint 17 (S17.2).
 */

import {createPublicClient, type PublicClient} from '@quranjs/api/public';
import {getQfOAuthConfig, getQfApiBase} from './config';
import {
  loadTokens,
  saveTokens,
  clearTokens,
  type AuthTokens,
} from './tokenStore';

/**
 * Bridges Qariah's `AuthTokens` shape (used since Sprint 4) to the SDK's
 * `UserSession` shape. The two are nearly identical — the SDK expects
 * `accessToken` / `refreshToken` / `expiresAt` and tolerates extra fields.
 */
interface SdkUserSession {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
  tokenType?: string;
  expiresAt?: number;
}

function tokensToSession(t: AuthTokens | null): SdkUserSession | null {
  if (!t) return null;
  return {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken ?? undefined,
    idToken: t.idToken ?? undefined,
    expiresAt: t.expiresAt,
    tokenType: 'Bearer',
  };
}

function sessionToTokens(s: SdkUserSession | null): AuthTokens | null {
  if (!s) return null;
  // The SDK occasionally writes back with `expiresAt` absent (older response
  // shape) — fall back to a far-past time so getValidAccessToken triggers a
  // refresh on next read rather than serving a stale token forever.
  return {
    accessToken: s.accessToken,
    refreshToken: s.refreshToken ?? null,
    idToken: s.idToken ?? null,
    expiresAt: typeof s.expiresAt === 'number' ? s.expiresAt : 0,
  };
}

/**
 * SDK-compatible token storage backed by our existing SecureStore keys.
 *
 * The SDK calls `getSession` before every authenticated request and
 * `setSession` after `oauth2.exchangeCode` / `oauth2.refresh`. Since we keep
 * those two paths in `qfOAuth.ts` (confidential-client constraint), the
 * `setSession` hook is rarely if ever invoked by the SDK — but we wire it
 * anyway for symmetry, so a future SDK-managed-refresh world (post-public-
 * client) just works.
 *
 * Key names are NOT changed (`qariah.auth.v2.*`) — per
 * CONTRIBUTING-QARIAH.md release-checklist item #3, bumping the SecureStore
 * prefix forces every signed-in user to re-auth. That is a deliberate,
 * user-disruptive event and is out of scope for the SDK migration.
 */
const sdkTokenStorage = {
  async getSession(): Promise<SdkUserSession | null> {
    const t = await loadTokens();
    return tokensToSession(t);
  },
  async setSession(s: SdkUserSession | null): Promise<void> {
    const t = sessionToTokens(s);
    if (!t) {
      await clearTokens();
      return;
    }
    await saveTokens(t);
  },
  async clearSession(): Promise<void> {
    await clearTokens();
  },
};

let _client: PublicClient | null = null;

/**
 * Returns the lazily-constructed singleton SDK client. Constructed on first
 * call; subsequent calls reuse the same instance.
 *
 * The SDK is stateless w.r.t. tokens (it always reads through the storage
 * adapter), so a singleton is safe across sign-in / sign-out cycles.
 */
export function getQfSdk(): PublicClient {
  if (_client) return _client;
  const cfg = getQfOAuthConfig();
  const apiBase = getQfApiBase();
  _client = createPublicClient({
    clientId: cfg.clientId,
    clientType: 'public',
    storage: sdkTokenStorage,
    services: {
      // SDK composes URLs as `{authBaseUrl}/v1/{resource}`. To hit QF's
      // `/auth/v1/...` surface we suffix `/auth` here. Verified live against
      // prelive (Sprint 17 S17.2).
      authBaseUrl: `${apiBase}/auth`,
      // oauth2BaseUrl is unused today because qfOAuth.ts owns the token
      // endpoint (confidential-client constraint), but wiring it keeps the
      // authorize-URL builder pointing at the right Hydra host if a future
      // caller reaches for it.
      oauth2BaseUrl: cfg.endpoints.token.replace(/\/oauth2\/token\/?$/, ''),
    },
  });
  return _client;
}

/**
 * Test-only — reset the cached client. Useful when tests mock env vars after
 * the singleton has been constructed. Not exported from the public index.
 */
export function _resetSdkClientForTests(): void {
  _client = null;
}
