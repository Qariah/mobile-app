/**
 * Sprint 23 (S23.3) RFC-011 — single read path for the Continue-Reading
 * hero history size.
 *
 * `branding.continueReadingHistorySize` controls how many recent reading
 * positions the Surahs-tab hero shows: `1` (or omitted) keeps Bayaan's
 * single-card hero, values > 1 render a horizontal carousel of the last
 * N stopping points. Per RFC-011 the value is clamped to [1, 10] at read
 * time with a `console.warn` on out-of-range input.
 *
 * Replaces the Sprint-18 `qariahRecentPagesCarousel` boolean flag.
 */
import branding from '@/config/branding';

export const MIN_HISTORY_SIZE = 1;
export const MAX_HISTORY_SIZE = 10;

/**
 * Resolve the effective Continue-Reading history size — the branding
 * value clamped to [1, 10]. Undefined / non-finite input resolves to the
 * Bayaan default of `1` (single-card hero).
 */
export function resolveContinueReadingHistorySize(): number {
  const raw = branding.continueReadingHistorySize;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return MIN_HISTORY_SIZE;
  }
  const clamped = Math.min(
    MAX_HISTORY_SIZE,
    Math.max(MIN_HISTORY_SIZE, Math.floor(raw)),
  );
  if (clamped !== raw) {
    console.warn(
      `[continueReadingHistorySize] branding value ${raw} is out of ` +
        `range [${MIN_HISTORY_SIZE}, ${MAX_HISTORY_SIZE}] — clamped to ${clamped}.`,
    );
  }
  return clamped;
}
