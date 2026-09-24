// @ai
// Qariah-only (#53 boot-hang fix). Bounded-await helper for the cold-start
// path. Field data (Sentry QARIAHV2-G/-N/-S, 2026-06: OnePlus 8 Pro + Xiaomi
// 220733SI, builds 1277-1293) shows production boots wedging forever inside an
// unbounded `await` while the splash is held — every captured stall sat after
// `boot_step: catalog-ready`, i.e. inside AppInitializer's service loop. A
// degraded boot beats an infinite splash, so splash-blocking awaits get raced
// against a deadline and the boot CONTINUES on timeout (the underlying promise
// is not cancelled — if it settles later, its work still lands; a late
// rejection is swallowed so it can't become an unhandled-rejection crash).

export const INIT_TIMED_OUT = Symbol('init-timed-out');

/**
 * Race `promise` against a deadline. Resolves with the promise's value, or
 * with INIT_TIMED_OUT after `ms` — it NEVER rejects past the deadline; late
 * rejections from the still-running promise are swallowed.
 *
 * Rejections that occur BEFORE the deadline propagate normally, preserving
 * the caller's existing error semantics (e.g. AppInitializer's critical-
 * service failure path).
 */
export function raceInitTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof INIT_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout>;
  let timedOut = false;
  const deadline = new Promise<typeof INIT_TIMED_OUT>(resolve => {
    timer = setTimeout(() => {
      timedOut = true;
      // Detach from the loser: a post-timeout rejection must not surface as
      // an unhandled rejection after the boot has already moved on.
      promise.catch(() => {});
      resolve(INIT_TIMED_OUT);
    }, ms);
  });
  return Promise.race<T | typeof INIT_TIMED_OUT>([
    promise.finally(() => clearTimeout(timer)),
    deadline,
  ]).catch((err): T | typeof INIT_TIMED_OUT => {
    if (timedOut) return INIT_TIMED_OUT;
    throw err;
  });
}
