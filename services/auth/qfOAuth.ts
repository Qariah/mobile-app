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
 * contains. Parallel callers share one refresh request (H1, TECH_DEBT #244).
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
    beginNewSession(); // @ai — M4: a refresh from the old session must not write.
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
  beginNewSession(); // @ai — M4: a refresh in flight must not sign back in.
  await clearTokens();
}

// @ai-start
/**
 * M4 (TECH_DEBT #244) — the session number. Sign-in and sign-out change it.
 *
 * A refresh that started in an earlier session must not write its result.
 * After a sign-out, a late refresh saved new tokens and made the old session
 * live again. After a new sign-in, a late rejected refresh deleted the new
 * tokens.
 */
let sessionGeneration = 0;

function beginNewSession(): void {
  sessionGeneration += 1;
  // New callers must not join a refresh from the earlier session.
  refreshInFlight = null;
}
// @ai-end

// @ai-start
/**
 * M1 (TECH_DEBT #244) — events from the token refresh, for AuthContext.
 *
 * Before M1, AuthContext read the sign-in state only at mount. A refresh that
 * cleared the tokens left Settings at "Signed in".
 *   - `session-expired`: the token endpoint rejected the refresh token (400 or
 *     401), or no refresh token exists. The tokens are cleared.
 *   - `refresh-failed`: a 5xx, a 429, another status or a network error
 *     (`status: 0`). The tokens are kept. This is a transient state, not a
 *     sign-out.
 *   - `refreshed`: a refresh succeeded.
 */
export type AuthEvent =
  | {type: 'session-expired'}
  | {type: 'refresh-failed'; status: number}
  | {type: 'refreshed'};

type AuthEventListener = (event: AuthEvent) => void;

const authEventListeners = new Set<AuthEventListener>();

/** Adds a listener for refresh events. Returns the unsubscribe function. */
export function subscribeAuthEvents(listener: AuthEventListener): () => void {
  authEventListeners.add(listener);
  return () => {
    authEventListeners.delete(listener);
  };
}

function emitAuthEvent(event: AuthEvent): void {
  for (const listener of authEventListeners) {
    try {
      listener(event);
    } catch (e) {
      if (__DEV__) console.warn('[auth-trace] auth event listener threw', e);
    }
  }
}
// @ai-end

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
    emitAuthEvent({type: 'session-expired'}); // @ai
    return null;
  }
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  return refreshed?.accessToken ?? null;
}

// @ai-start
/**
 * H1 (TECH_DEBT #244) — the one token refresh that is in flight.
 *
 * QF rotates the refresh token on each refresh. Before this lock, parallel
 * 401s each started a refresh with the same refresh token. The first refresh
 * won. The other refreshes got a 4xx and deleted the new tokens, so the user
 * was signed out with no message. Now all parallel callers share one request.
 */
let refreshInFlight: Promise<AuthTokens | null> | null = null;

/**
 * Exchanges the refresh token for new tokens. Parallel callers share one
 * request to the token endpoint (single flight).
 */
export function refreshAccessToken(
  refreshToken: string,
): Promise<AuthTokens | null> {
  if (refreshInFlight) return refreshInFlight;
  const flight = runTokenRefresh(refreshToken).finally(() => {
    if (refreshInFlight === flight) refreshInFlight = null;
  });
  refreshInFlight = flight;
  return flight;
}

async function runTokenRefresh(
  callerRefreshToken: string,
): Promise<AuthTokens | null> {
  const generation = sessionGeneration; // @ai
  const sessionChanged = () => generation !== sessionGeneration; // @ai
  try {
    // A refresh that ended just before this call can have rotated the token
    // already. The caller then holds an old refresh token, and QF rejects it.
    // Read the stored tokens again and use them.
    const stored = await loadTokens();
    if (!stored) return null; // Signed out: do not make a new session.
    if (
      stored.refreshToken &&
      stored.refreshToken !== callerRefreshToken &&
      Date.now() < stored.expiresAt
    ) {
      return stored;
    }
    const refreshToken = stored.refreshToken ?? callerRefreshToken;
    // @ai-end
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
      const errorBody = await res.text().catch(() => '');
      if (sessionChanged()) return null; // @ai — M4
      // @ai-start
      // M1 (TECH_DEBT #244) — only 400 and 401 mean that the token endpoint
      // rejected the refresh token (OAuth `invalid_grant` / `invalid_client`).
      // Then the session is dead: clear the tokens and tell AuthContext.
      // A 5xx, a 429 or another status is a server problem, not a sign-out:
      // keep the tokens, so that the next call can refresh again.
      if (res.status === 400 || res.status === 401) {
        if (__DEV__)
          console.warn('[auth-trace] refreshAccessToken:rejected-clearing', {
            status: res.status,
            body: errorBody.slice(0, 200),
          });
        await clearTokens();
        emitAuthEvent({type: 'session-expired'});
        return null;
      }
      if (__DEV__)
        console.warn('[auth-trace] refreshAccessToken:transient-keeping', {
          status: res.status,
          body: errorBody.slice(0, 200),
        });
      emitAuthEvent({type: 'refresh-failed', status: res.status});
      return null;
      // @ai-end
    }
    const data = (await res.json()) as TokenResponse;
    if (sessionChanged()) return null; // @ai — M4
    const next = tokensFromResponse(data);
    // Hydra MAY rotate refresh_token. If the response omits it, keep the old.
    if (!data.refresh_token) next.refreshToken = refreshToken;
    await saveTokens(next);
    emitAuthEvent({type: 'refreshed'}); // @ai
    return next;
  } catch {
    // A network error or a bad response: keep the tokens (M1). // @ai
    if (!sessionChanged()) emitAuthEvent({type: 'refresh-failed', status: 0}); // @ai
    return null;
  }
}

// @ai-start
/**
 * M2 (TECH_DEBT #244) — the QF API rejected the access token with a 401.
 *
 * Refresh the token even when it has not expired by the local clock, for
 * example after a server-side revoke. Before M2, the 401 retry got the same
 * token again from getValidAccessToken(), got a second 401, and the sync queue
 * marked the write permanent. Parallel callers share one refresh (H1).
 *
 * Returns the new access token, or null when no session can be refreshed.
 */
export async function refreshAfterUnauthorized(): Promise<string | null> {
  if (refreshInFlight) {
    const shared = await refreshInFlight;
    return shared?.accessToken ?? null;
  }
  const tokens = await loadTokens();
  if (!tokens?.refreshToken) return null;
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  return refreshed?.accessToken ?? null;
}
// @ai-end

export async function isSignedIn(): Promise<boolean> {
  const tokens = await loadTokens();
  if (!tokens) return false;
  if (Date.now() < tokens.expiresAt) return true;
  return Boolean(tokens.refreshToken);
}
