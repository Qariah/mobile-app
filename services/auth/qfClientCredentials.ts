/**
 * Client-credentials access token for QF endpoints that reject user-OAuth
 * tokens.
 *
 * Why this exists: some QF endpoints (notably `/quran-reflect/v1/posts/feed`)
 * enforce a server-side rule that the `post.read` scope only authorizes the
 * call when the bearer token was issued via the `client_credentials` grant —
 * not when the same scope is present on a user-OAuth (`authorization_code`)
 * token. Sprint 27's first cut used the user token and shipped 403s in
 * production (TestFlight 3.1.7 (1245) on 2026-05-27); this helper unblocks
 * read-only endpoints by minting a separate cc token.
 *
 * Security posture: the `EXPO_PUBLIC_QF_CLIENT_SECRET` is already bundled
 * into the app for the confidential-client OAuth flow (Sprint 5 finding —
 * QF dev OAuth client `0750761d-...` is registered as confidential at Hydra
 * and refuses pure-PKCE-without-secret). Calling Hydra's `client_credentials`
 * grant from the device reuses the same secret; we are not exposing anything
 * new. If QF later issues a public client (TECH_DEBT #53), this helper
 * becomes redundant for endpoints that accept user tokens.
 *
 * Use cases (write requires user-OAuth so this is read-only):
 *   - GET /quran-reflect/v1/posts/feed (Sprint 27 inline reflections)
 *   - other QF public-read endpoints with the same authorization rule
 *
 * NOT used for:
 *   - any write (create / update / delete / like / save) — those need
 *     the calling user's identity, so they use the user-OAuth token via
 *     `services/auth/index.ts`'s `getValidAccessToken()`.
 *
 * Token caching: in-memory only. Reset on app launch (next cold start
 * mints fresh). cc tokens are short-lived (~1 hour). We refresh ~5 min
 * before expiry to avoid clock-skew edge cases.
 */

import {getQfOAuthConfig} from './config';

interface CcTokenEntry {
  token: string;
  /** ms epoch — refresh when Date.now() crosses this. */
  refreshAt: number;
}

let cached: CcTokenEntry | null = null;
let inflight: Promise<string> | null = null;

/** Seconds before expiry to proactively refresh. */
const REFRESH_BUFFER_S = 300;

/** Hard-coded fallback in case Hydra omits expires_in. */
const DEFAULT_LIFETIME_S = 3600;

interface HydraTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

async function mintToken(): Promise<string> {
  const cfg = getQfOAuthConfig();
  if (!cfg.clientSecret) {
    throw new Error(
      'qfClientCredentials: client_secret is required for client_credentials grant',
    );
  }
  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  // post.read is what /quran-reflect/v1/posts/feed authorizes against.
  // We include `content` too because it is the umbrella scope for read
  // operations across the QF API surface and is harmless to request.
  body.set('scope', 'content post.read');

  const basic =
    typeof globalThis.btoa === 'function'
      ? globalThis.btoa(`${cfg.clientId}:${cfg.clientSecret}`)
      : // RN provides btoa via the runtime; fall back to a Buffer shim if not.
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');

  const res = await fetch(cfg.endpoints.token, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `qfClientCredentials: token request failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as HydraTokenResponse;
  if (!json.access_token) {
    throw new Error('qfClientCredentials: token response missing access_token');
  }
  const lifetimeS = json.expires_in ?? DEFAULT_LIFETIME_S;
  cached = {
    token: json.access_token,
    refreshAt: Date.now() + (lifetimeS - REFRESH_BUFFER_S) * 1000,
  };
  return json.access_token;
}

/**
 * Returns a valid client_credentials access token, minting + caching if
 * needed. Concurrent callers share a single in-flight request.
 */
export async function getQfClientCredentialsToken(): Promise<string> {
  if (cached && Date.now() < cached.refreshAt) {
    return cached.token;
  }
  if (inflight) return inflight;
  inflight = mintToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Test/diagnostic helper — clears the in-memory cache. */
export function _resetQfClientCredentialsCache(): void {
  cached = null;
  inflight = null;
}
