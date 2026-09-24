// Qariah — native main-thread freeze watchdog: safe public API.
//
// Safe wrappers around the native module: an absent/failed module (iOS no-op,
// web, or a linking issue) degrades to no-op and NEVER throws into the app. This
// is a REPORT-ONLY probe — it must be incapable of affecting the app.

import type {MainThreadStallEvent} from './src/QariahAnrWatchdog.types';

export type {MainThreadStallEvent} from './src/QariahAnrWatchdog.types';

interface NativeShape {
  setEnabled(enabled: boolean, intervalMs: number, thresholdMs: number): void;
  addListener(
    event: 'onMainThreadStall',
    cb: (event: MainThreadStallEvent) => void,
  ): {remove(): void};
}

let native: NativeShape | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native =
    (require('./src/QariahAnrWatchdogModule').default as NativeShape) ?? null;
} catch {
  native = null;
}

/** True when the native module linked (Android dev/release builds). */
export const isAnrWatchdogAvailable = native !== null;

/**
 * Activate/deactivate the native main-thread watchdog. Gated by the caller
 * (diagnostics cohort + remote kill-switch + build flag). No-op on iOS/web.
 */
export function setMainThreadWatchdogEnabled(
  enabled: boolean,
  intervalMs = 1000,
  thresholdMs = 4000,
): void {
  try {
    native?.setEnabled(enabled, intervalMs, thresholdMs);
  } catch {
    /* report-only */
  }
}

/** Subscribe to main-thread stall events. Returns a remover. */
export function addMainThreadStallListener(
  cb: (event: MainThreadStallEvent) => void,
): {remove(): void} {
  try {
    return native?.addListener('onMainThreadStall', cb) ?? {remove() {}};
  } catch {
    return {remove() {}};
  }
}
