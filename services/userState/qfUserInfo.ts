/**
 * Thin wrapper over QF's OAuth `/userinfo` endpoint.
 *
 * Returns the user's email + display fields after a successful sign-in.
 * Required for Sprint 11's v1 migration restore: the migration extractor keyed
 * R2 JSONs by sha256(normalize(email)), and the email lives in QF's user record
 * (not in the local id_token because our scope set doesn't request `email`).
 *
 * Endpoint: GET {authBaseUrl}/userinfo with `Authorization: Bearer <qf-access-token>`.
 * Auth: Bearer (NOT the x-auth-token + x-client-id pattern used by the user-data
 * API at apis.quran.foundation — those are different surfaces).
 *
 * Sprint 11 (S11.3).
 */

import * as Sentry from '@sentry/react-native';

import {getQfOAuthConfig, getValidAccessToken} from '@/services/auth';

export interface QfUserInfo {
  email: string;
  first_name: string;
  last_name: string;
  /** Hydra subject identifier — stable across logins. */
  sub: string;
}

export class QfUserInfoError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'QfUserInfoError';
    this.status = status;
  }
}

/**
 * Sprint 13 (TECH_DEBT #51) — module-level cache keyed by access token.
 * Settings → Account focuses on every Settings tab navigation; without this
 * cache, each focus pinged QF /userinfo. The cache invalidates automatically
 * when the access token rotates (sign-out / refresh / re-auth) because the
 * key changes.
 */
let _cache: {token: string; info: QfUserInfo} | null = null;

/**
 * Clear the QF userinfo cache. Call on sign-out so the next sign-in re-fetches
 * cleanly without leaking the previous user's email.
 */
export function clearQfUserInfoCache(): void {
  _cache = null;
  // Detach the Sentry user on sign-out so later events aren't mis-attributed
  // to the previous account.
  Sentry.setUser(null);
}

/**
 * Fetch the user's QF profile from the OAuth /userinfo endpoint.
 *
 * Returns null if no access token is available (not signed in).
 * Throws QfUserInfoError on non-2xx response or network failure.
 *
 * Sprint 13 — cached per access token. Calls within the same token's lifetime
 * return the cached value without a network round-trip. Cache invalidates
 * automatically when the access token rotates; call `clearQfUserInfoCache()`
 * on sign-out for an explicit reset.
 */
export async function fetchQfUserInfo(): Promise<QfUserInfo | null> {
  const token = await getValidAccessToken();
  if (!token) {
    // Not signed in — make sure we don't keep a stale cached value.
    if (_cache) _cache = null;
    Sentry.setUser(null);
    return null;
  }
  if (_cache && _cache.token === token) {
    return _cache.info;
  }

  // QF's /userinfo lives on the auth server (Ory Hydra), not the API base.
  // The config's `endpoints.token` is the closest path we already construct;
  // we derive /userinfo by stripping `/oauth2/token` and appending `/userinfo`.
  const cfg = getQfOAuthConfig();
  const authBase = cfg.endpoints.token.replace(/\/oauth2\/token\/?$/, '');
  const url = `${authBase}/userinfo`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error';
    throw new QfUserInfoError(`QF /userinfo network error: ${msg}`, 0);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new QfUserInfoError(
      `QF /userinfo failed (${res.status}): ${body.slice(0, 200) || 'no body'}`,
      res.status,
    );
  }

  const data = (await res.json()) as Partial<QfUserInfo>;
  if (typeof data.email !== 'string' || !data.email) {
    throw new QfUserInfoError(`QF /userinfo returned no email`, res.status);
  }
  const info: QfUserInfo = {
    email: data.email,
    first_name: data.first_name ?? '',
    last_name: data.last_name ?? '',
    sub: data.sub ?? '',
  };
  // Sprint 13 (TECH_DEBT #51) — cache the success path. Failures + null
  // (signed-out) paths bypass the cache so transient errors don't get stuck.
  _cache = {token, info};
  // Tag Sentry events with the pseudonymous, stable Hydra subject id so a
  // named tester's report can be pivoted to their crashes and distinct-user
  // counts reflect real people. Email/PII is deliberately NOT attached.
  if (info.sub) Sentry.setUser({id: info.sub});
  return info;
}
