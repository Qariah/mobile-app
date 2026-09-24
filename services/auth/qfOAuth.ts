/**
 * Direct PKCE OAuth2 flow against the QF IdP (Ory Hydra).
 *
 * Flow (RFC 6749 §4.1 + RFC 7636):
 *   1. Generate code_verifier + code_challenge + state + nonce.
 *   2. Open authorize URL in a WebBrowser auth session.
 *   3. User authenticates with QF; QF redirects to redirect_uri with `code` + `state`.
 *   4. Verify state; exchange code for tokens at /oauth2/token.
 *   5. Persist tokens via tokenStore.
 *
 * Token refresh: refreshAccessToken() exchanges the refresh_token for a new
 * access_token. Hydra rotates refresh tokens — we save whatever the response
 * contains.
 *
 * QF parses the redirect URL with Hydra's quirks; non-hierarchical schemes
 * (single colon-slash, reverse-DNS) require defensive query parsing — see
 * parseRedirectParams() copied from the archived quran-core sprint 10
 * implementation.
 */

import * as WebBrowser from 'expo-web-browser';
import {getQfOAuthConfig, type QfOAuthConfig} from './config';
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateRandomHex,
} from './pkce';
import {
  clearTokens,
  loadTokens,
  saveTokens,
  type AuthTokens,
} from './tokenStore';

WebBrowser.maybeCompleteAuthSession();

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number; // seconds
  token_type: string;
  scope?: string;
}

export interface SignInResult {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
}

function parseRedirectParams(redirectUrl: string): URLSearchParams {
  // RN's URL polyfill sometimes drops query params on non-hierarchical schemes
  // (e.g. `com.qariah.app:/quranoauth2redirect?code=xyz`). Try the URL ctor
  // first; fall back to substring-after-`?` parsing.
  try {
    const parsed = new URL(redirectUrl);
    if (parsed.searchParams.toString().length > 0) return parsed.searchParams;
  } catch {
    // URL ctor can throw on some RN polyfills for non-special schemes
  }
  const qIndex = redirectUrl.indexOf('?');
  if (qIndex === -1) return new URLSearchParams();
  const hashIndex = redirectUrl.indexOf('#', qIndex);
  const queryStr =
    hashIndex === -1
      ? redirectUrl.slice(qIndex + 1)
      : redirectUrl.slice(qIndex + 1, hashIndex);
  return new URLSearchParams(queryStr);
}

function buildAuthorizeUrl(
  config: QfOAuthConfig,
  codeChallenge: string,
  state: string,
  nonce: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: config.scopes.join(' '),
    state,
    nonce,
  });
  return `${config.endpoints.authorize}?${params.toString()}`;
}

/**
 * Build HTTP Basic Authorization header for confidential-client auth.
 * QF's `184475da-...` is registered with token_endpoint_auth_method =
 * `client_secret_basic` — the secret must go in the Authorization header,
 * not the request body. Verified during Sprint 5 S5.1 (the body-encoded
 * `client_secret_post` form returns 401 with an explicit error message).
 *
 * Per RFC 6749 §2.3.1, both forms percent-encode the credentials. Hydra is
 * strict about this — use encodeURIComponent on each half.
 */
function basicAuthHeader(clientId: string, clientSecret: string): string {
  const creds = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
  // RN's btoa is available via the global polyfill; fall back to Buffer if not.
  const encoded =
    typeof btoa === 'function'
      ? btoa(creds)
      : // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('buffer')
          .Buffer.from(creds, 'utf8')
          .toString('base64') as string);
  return `Basic ${encoded}`;
}

async function exchangeCodeForTokens(
  config: QfOAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
    code,
    code_verifier: codeVerifier,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  // Confidential-client auth: HTTP Basic header (token_endpoint_auth_method =
  // `client_secret_basic`). QF's dev client `184475da-...` rejects body-encoded
  // `client_secret_post` with explicit 401. Public clients (when prod creds
  // arrive in S5.4 if they register a public client) fall through to client_id
  // in the body via the else branch.
  if (config.clientSecret) {
    headers.Authorization = basicAuthHeader(
      config.clientId,
      config.clientSecret,
    );
  } else {
    body.set('client_id', config.clientId);
  }
  const res = await fetch(config.endpoints.token, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Token exchange failed (${res.status}): ${text || 'no body'}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

function tokensFromResponse(r: TokenResponse): AuthTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? null,
    idToken: r.id_token ?? null,
    // Subtract a 60s safety window so we refresh before actual expiry.
    expiresAt: Date.now() + Math.max(0, r.expires_in - 60) * 1000,
  };
}

export async function signIn(): Promise<SignInResult> {
  try {
    const config = getQfOAuthConfig();
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateRandomHex();
    const nonce = generateRandomHex();
    const url = buildAuthorizeUrl(config, challenge, state, nonce);

    if (__DEV__)
      console.log('[auth-trace] openAuthSessionAsync:enter', {
        redirectUri: config.redirectUri,
        authUrl: url.slice(0, 200),
      });
    const result = await WebBrowser.openAuthSessionAsync(
      url,
      config.redirectUri,
      {
        // Ephemeral session = no Safari/Chrome shared cookies; cleaner for OAuth.
        preferEphemeralSession: true,
      },
    );
    if (__DEV__)
      console.log('[auth-trace] openAuthSessionAsync:result', {
        type: result.type,
        url: 'url' in result ? result.url?.slice(0, 200) : undefined,
      });

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return {ok: false, cancelled: true};
    }
    if (result.type !== 'success' || !result.url) {
      return {
        ok: false,
        error: `Auth session ended without success (type=${result.type})`,
      };
    }

    const params = parseRedirectParams(result.url);
    const qfError = params.get('error');
    if (qfError) {
      const desc = params.get('error_description');
      return {ok: false, error: desc ? `${qfError}: ${desc}` : qfError};
    }
    if (params.get('state') !== state) {
      return {ok: false, error: 'State mismatch (possible CSRF)'};
    }
    const code = params.get('code');
    if (!code) {
      return {ok: false, error: 'No code in callback'};
    }

    if (__DEV__) console.log('[auth-trace] exchangeCodeForTokens:enter');
    const tokens = await exchangeCodeForTokens(config, code, verifier);
    if (__DEV__)
      console.log('[auth-trace] exchangeCodeForTokens:result', {
        hasAccess: !!tokens.access_token,
        hasRefresh: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
      });
    await saveTokens(tokensFromResponse(tokens));
    if (__DEV__) console.log('[auth-trace] saveTokens:done');
    return {ok: true};
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (__DEV__) console.warn('[auth-trace] signIn:catch', msg);
    return {ok: false, error: msg};
  }
}

export async function signOut(): Promise<void> {
  await clearTokens();
}

/**
 * Get a valid access token, refreshing if expired. Returns null when the user
 * isn't signed in or the refresh failed.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) {
    if (__DEV__) console.log('[auth-trace] getValidAccessToken:no-tokens');
    return null;
  }
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;
  if (__DEV__)
    console.log('[auth-trace] getValidAccessToken:expired', {
      expiresAt: tokens.expiresAt,
      now: Date.now(),
      hasRefresh: !!tokens.refreshToken,
    });
  if (!tokens.refreshToken) {
    if (__DEV__)
      console.warn('[auth-trace] getValidAccessToken:clearTokens:no-refresh');
    await clearTokens();
    return null;
  }
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  return refreshed?.accessToken ?? null;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<AuthTokens | null> {
  try {
    const config = getQfOAuthConfig();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    // Same client_secret_basic vs public-client branching as exchangeCodeForTokens.
    if (config.clientSecret) {
      headers.Authorization = basicAuthHeader(
        config.clientId,
        config.clientSecret,
      );
    } else {
      body.set('client_id', config.clientId);
    }
    const res = await fetch(config.endpoints.token, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (__DEV__)
        console.warn('[auth-trace] refreshAccessToken:non-ok-clearing', {
          status: res.status,
          body: body.slice(0, 200),
        });
      // Refresh failed (probably expired/revoked) — wipe and force re-login.
      await clearTokens();
      return null;
    }
    const data = (await res.json()) as TokenResponse;
    const next = tokensFromResponse(data);
    // Hydra MAY rotate refresh_token. If the response omits it, keep the old.
    if (!data.refresh_token) next.refreshToken = refreshToken;
    await saveTokens(next);
    return next;
  } catch {
    return null;
  }
}

export async function isSignedIn(): Promise<boolean> {
  const tokens = await loadTokens();
  if (!tokens) return false;
  if (Date.now() < tokens.expiresAt) return true;
  return Boolean(tokens.refreshToken);
}
