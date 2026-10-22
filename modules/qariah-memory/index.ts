// Qariah S35.2 — qariah-memory probe public API.
//
// Safe wrappers around the native module: a failed/absent module (e.g. linking
// issue, iOS/web, or a native throw) degrades to no-op / {} and NEVER throws into
// the app. This is a report-only probe — it must be incapable of affecting the app.

import type {HeapStats} from './src/QariahMemory.types';

export type {HeapStats} from './src/QariahMemory.types';

interface NativeShape {
  setEnabled(enabled: boolean): void;
  getHeapStats(): HeapStats;
  addListener(
    event: 'onMemoryPressure',
    cb: (stats: HeapStats) => void,
  ): {remove(): void};
}

let native: NativeShape | null = null;
try {
  // Resolves to the platform module (native on device, web stub on web).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = (require('./src/QariahMemoryModule').default as NativeShape) ?? null;
} catch {
  native = null;
}

/** True when the native module linked (Android dev/release builds). */
export const isMemoryModuleAvailable = native !== null;

/** Activate/deactivate the probe natively. Gated by the caller (flag + remote). */
export function setMemoryProbeEnabled(enabled: boolean): void {
  try {
    native?.setEnabled(enabled);
  } catch {
    /* report-only */
  }
}

/** On-demand heap snapshot. Returns {} if unavailable. */
export function getHeapStats(): HeapStats {
  try {
    return native?.getHeapStats() ?? {};
  } catch {
    return {};
  }
}

/** Subscribe to the pre-OOM onTrimMemory pressure event. Returns a remover. */
export function addMemoryPressureListener(cb: (stats: HeapStats) => void): {
  remove(): void;
} {
  try {
    return native?.addListener('onMemoryPressure', cb) ?? {remove() {}};
  } catch {
    return {remove() {}};
  }
}
