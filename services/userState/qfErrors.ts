/**
 * Error classification + auth-retry wrapper for QF user-data calls routed
 * through `@quranjs/api/public`.
 *
 * The SDK throws a plain `Error("{status} {statusText}")` on non-2xx. To
 * preserve the sync-queue's existing retry policy (retryable: network +
 * 408/429/5xx; permanent: 4xx other than 401/408/429; auth-paused:
 * 401-after-refresh) we wrap each SDK call with `withQfCall` which:
 *
 *   1. Catches the SDK's generic Error.
 *   2. Parses the leading status code from `e.message`.
 *   3. On 401, forces a token refresh via `getValidAccessToken()` and
 *      retries once (the SDK's storage adapter will pick up the new token).
 *   4. Rethrows as typed `QfApiError` / `QfAuthRequiredError`.
 *
 * Note: response body is NOT preserved on the typed error (the SDK doesn't
 * expose it). Acceptable diagnostic regression vs pre-S17.2; if needed, we
 * can inject a custom fetch that captures bodies into a weak map.
 *
 * Sprint 17 (S17.2).
 */

export class QfApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string | null;
  constructor(
    message: string,
    status: number,
    path: string,
    body: string | null = null,
  ) {
    super(message);
    this.name = 'QfApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export class QfAuthRequiredError extends QfApiError {
  constructor(path: string) {
    super('QF auth required (no access token available)', 401, path, null);
    this.name = 'QfAuthRequiredError';
  }
}

/** 0 = network-error sentinel when the SDK error doesn't lead with digits. */
function parseStatus(e: unknown): number {
  if (!(e instanceof Error)) return 0;
  const m = /^(\d{3})\b/.exec(e.message);
  return m ? Number(m[1]) : 0;
}

/**
 * Wraps an SDK call with error-classification + one 401-retry-after-refresh.
 *
 * The retry exists to cover the race where the access token expires between
 * the storage adapter's read and the actual fetch — exactly the case the
 * pre-S17.2 hand-rolled client handled. `getValidAccessToken` will refresh
 * the token (or return null if the refresh token is dead); on null we throw
 * `QfAuthRequiredError` so the sync queue pauses rather than burns attempts.
 *
 * `getValidAccessToken` is lazy-imported to break the
 * services/auth ↔ services/userState import cycle.
 */
export async function withQfCall<T>(
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const status = parseStatus(e);
    if (status !== 401) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      throw new QfApiError(`QF ${path} failed: ${msg}`, status, path);
    }
    // 401 — try one refresh + retry.
    const {getValidAccessToken} = await import('@/services/auth');
    const next = await getValidAccessToken();
    if (!next) throw new QfAuthRequiredError(path);
    try {
      return await fn();
    } catch (e2) {
      const status2 = parseStatus(e2);
      const msg2 = e2 instanceof Error ? e2.message : 'unknown error';
      throw new QfApiError(
        `QF ${path} failed after retry: ${msg2}`,
        status2,
        path,
      );
    }
  }
}

/**
 * Classifies a thrown QfApiError as retryable (transient — re-enqueue) vs
 * permanent (give up). Used by the offline sync queue.
 *
 * Retryable: 0 (network), 408, 429, 500–599.
 * Auth-required (401 after refresh): retryable, but the queue pauses
 * draining until auth is restored.
 */
export function isQfErrorRetryable(err: unknown): boolean {
  if (err instanceof QfAuthRequiredError) return true;
  if (!(err instanceof QfApiError)) return false;
  const s = err.status;
  return s === 0 || s === 408 || s === 429 || (s >= 500 && s <= 599);
}
