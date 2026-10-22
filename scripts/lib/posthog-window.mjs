// @ai
//
// scripts/lib/posthog-window.mjs
// ------------------------------
// One retry with a halved lookback when a PostHog HogQL query hits the server's
// max execution time. On 2026-10-06 the 30-day rollout-engagement query
// answered `504 Query has hit the max execution time`; 14 days succeeded.
//
// The caller must print the window it actually used: a 15-day reading is not a
// 30-day reading. Unit tests: scripts/__tests__/posthog-window.test.mjs.

/**
 * True when the error is a query that ran out of time: an HTTP 504 from
 * PostHog, PostHog's "max execution time" text on any status, or the local
 * fetch timeout (`TimeoutError` from AbortSignal.timeout).
 * @param {unknown} err
 */
export function isQueryTimeout(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError') return true;
  const msg = String(err.message || err);
  return /\bPostHog 504\b/.test(msg) || /max execution time/i.test(msg);
}

/**
 * Run `query(days)`. When it times out, run it once more with half the days
 * (rounded up, at least 1). Any other error, or a second timeout, is thrown.
 * @template T
 * @param {number} days  the requested lookback
 * @param {(days:number) => Promise<T>} query
 * @returns {Promise<{result:T, days:number, requestedDays:number, retried:boolean}>}
 */
export async function withWindowFallback(days, query) {
  try {
    return {
      result: await query(days),
      days,
      requestedDays: days,
      retried: false,
    };
  } catch (err) {
    const half = Math.max(1, Math.ceil(days / 2));
    if (!isQueryTimeout(err) || half >= days) throw err;
    return {
      result: await query(half),
      days: half,
      requestedDays: days,
      retried: true,
    };
  }
}
