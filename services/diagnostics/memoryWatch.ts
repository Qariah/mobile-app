// @ai
// services/diagnostics/memoryWatch.ts
// -----------------------------------
// REPORT-ONLY app-memory instrumentation. Attaches the app process's used
// memory (PSS, via react-native-device-info) to Sentry as a refreshed
// `app_memory` context + a breadcrumb trail, so a native crash — especially a
// libc SIGABRT from a failed native allocation (GH #143), or the OOM cluster
// (#150–154 / #157 / #160) — carries "how much memory was the app holding right
// before it died", which classifies it OOM-adjacent vs a logic abort.
//
// device-info's getUsedMemory() is PSS (native + dalvik + graphics) — a coarse
// but real pressure signal, and the right one for a *native* abort (a failed
// malloc/new aborts at the native layer).
//
// S35.2 — for the media3/Glide *Java* OOM (vc1255 ~7.07%, which PSS alone can't
// attribute), this now ALSO drives the `qariah-memory` native module: the
// dalvik-heap ceiling (Runtime) + the Debug.getMemoryInfo() java-heap/graphics
// split (the bitmap-vs-other discriminator) + an onTrimMemory pre-OOM event. That
// probe is gated (build flag `memoryPressureProbe` + the diagnostics cohort +
// remote `memoryProbe` kill-switch + native inert-until-enabled) — see
// isMemoryProbeEnabled() and planning/s35.2-memory-probe-test-plan.md.
//
// Telemetry only. Errors are swallowed — memory probing must never affect the app.

import DeviceInfo from 'react-native-device-info';
import * as Sentry from '@sentry/react-native';
import {AppState, type AppStateStatus} from 'react-native';
import {
  DIAGNOSTIC_BUILD_FLAG,
  isMemoryProbeEnabled,
  setDiagnosticsConfigListener,
} from './diagnostics';
// S35.2 — Android heap-composition probe (inert until setMemoryProbeEnabled(true)).
import {
  addMemoryPressureListener,
  getHeapStats,
  setMemoryProbeEnabled,
  type HeapStats,
} from '../../modules/qariah-memory';

const MB = 1024 * 1024;
let started = false;
let lastUsedMB = 0;

/** Read app + device memory once and attach it to Sentry (context + breadcrumb). */
export async function captureMemorySnapshot(reason: string): Promise<void> {
  try {
    const [usedBytes, totalBytes] = await Promise.all([
      DeviceInfo.getUsedMemory(),
      DeviceInfo.getTotalMemory(),
    ]);
    if (!Number.isFinite(usedBytes) || usedBytes <= 0) return;
    const usedMB = Math.round(usedBytes / MB);
    const totalMB =
      Number.isFinite(totalBytes) && totalBytes > 0
        ? Math.round(totalBytes / MB)
        : null;
    const pctOfDevice = totalMB ? Math.round((usedMB / totalMB) * 100) : null;
    const data = {
      app_used_mb: usedMB,
      device_total_mb: totalMB,
      app_pct_of_device: pctOfDevice,
      delta_mb: usedMB - lastUsedMB,
      reason,
    };
    // S35.2 — when the probe is on, fold in the Android heap composition (Java-heap
    // ceiling + Debug.getMemoryInfo java-heap/graphics/native split) so ANY captured
    // crash carries "what was filling the heap" — the bitmap-vs-other discriminator.
    // Inert/empty ({}) on iOS/web or when disabled.
    const heap: HeapStats = isMemoryProbeEnabled() ? getHeapStats() : {};
    // Context = last-known snapshot; it rides along on the next crash/event.
    // Always refreshed (cheap, no breadcrumb spam).
    Sentry.setContext('app_memory', {...data, ...heap});
    // Breadcrumb ONLY on memory pressure (>=85%). Routine snapshots were
    // flooding the breadcrumb buffer and burying the freeze lead-in; the context
    // above already carries the latest value onto any captured event.
    if (pctOfDevice !== null && pctOfDevice >= 85) {
      Sentry.addBreadcrumb({
        category: 'memory',
        type: 'info',
        level: 'warning',
        message: `app_memory ${usedMB}MB${
          totalMB ? ` / ${totalMB}MB device` : ''
        } (${reason})`,
        data,
      });
    }
    lastUsedMB = usedMB;
  } catch {
    // report-only — never let memory probing throw into the boot path
  }
}

// S35.2 — the native onTrimMemory pressure listener subscription (null when off).
let pressureSub: {remove(): void} | null = null;

/**
 * Pre-OOM signal. onTrimMemory(RUNNING_LOW/CRITICAL/COMPLETE) fires on the affected
 * device seconds before a Java OOM; capture the heap composition + eagerly flush so
 * it survives the imminent kill. This is how the field tells us WHAT is filling the
 * heap (bitmap/Glide vs media3 vs leak) without us owning the device or a repro.
 */
function onMemoryPressure(
  stats: HeapStats,
  source: 'trim' | 'poll',
  trigger?: string,
): void {
  try {
    Sentry.captureMessage('memory-pressure', {
      level: 'warning',
      tags: {
        scope: 'memory-probe',
        source,
        // Which poll condition tripped: 'art-effective' (dalvik+graphics vs the
        // ART ceiling — the bitmap/Glide OOM the dalvik-only ratio misses) or
        // 'dalvik' (pure java-heap growth — the media3 allocator signature).
        trigger: trigger ?? '',
        trim_level: String(stats.trimLevel ?? ''),
        low_ram: String(stats.isLowRamDevice ?? ''),
      },
      extra: {...stats, last_pss_mb: lastUsedMB},
    });
    // Confined flush — the device may OOM right after this fires.
    void Sentry.flush().catch(() => {});
  } catch {
    // report-only — must never throw from a pressure callback
  }
}

// S35.2 — heap-proximity poller (the PRIMARY pre-OOM detector). onTrimMemory's
// RUNNING_* levels are deprecated/undelivered on Android 14+ (the affected
// Android-16 cohort), so we detect pressure ourselves: sample the heap while
// foregrounded and fire once when proximity to the OOM ceiling crosses the
// high-water mark. Hysteresis (re-arm only after dropping below RESET) prevents
// per-tick spam.
//
// CRITICAL (field-proven, build 1340 on Pixel 3): a dalvik-only `javaUsedMb /
// javaMaxMb` ratio MISSES the bitmap-driven OOM. On API 26+, Bitmap pixels are
// native allocations registered against ART's heap target via
// NativeAllocationRegistry — ART throws java.lang.OutOfMemoryError when
// (dalvik + native-registered) approaches the ceiling, but Runtime's used-heap
// is DALVIK-ONLY and never sees those bitmaps. The probe drive showed graphics
// 162MB while dalvik sat at ~30–53MB (ratio 0.06–0.10) — a dalvik-only trigger
// would never fire on the Glide/bitmap OOM (the inverse-RAM, Android-14+/16
// cohort we're chasing). So proximity = (dalvik + graphics) / ceiling, and we
// fire on whichever of {dalvik, art-effective} is closer to the ceiling.
const POLL_MS = 5000;
const HIGH_WATER = 0.85;
const RESET = 0.7;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let pressureArmed = true;

function pollHeap(): void {
  try {
    if (AppState.currentState !== 'active') return; // foreground-only
    const stats = getHeapStats();
    const max = stats.javaMaxMb ?? 0;
    if (max <= 0) return; // no native heap stats (iOS/web/unavailable)
    const dalvikUsed = stats.javaUsedMb ?? 0;
    // ART accounts native-registered bitmap bytes (graphics) against the SAME
    // heap target it throws OOM on; dalvikUsed misses them. Sum dalvik + graphics
    // for the honest distance-to-OOM. Degrades to dalvik when graphics is absent.
    const effectiveUsed =
      (stats.summaryJavaHeapMb ?? 0) + (stats.summaryGraphicsMb ?? 0);
    const dalvikRatio = dalvikUsed / max;
    const effRatio = (effectiveUsed > 0 ? effectiveUsed : dalvikUsed) / max;
    const ratio = Math.max(dalvikRatio, effRatio); // closest approach to the ceiling
    if (pressureArmed && ratio >= HIGH_WATER) {
      pressureArmed = false;
      onMemoryPressure(
        stats,
        'poll',
        effRatio >= dalvikRatio ? 'art-effective' : 'dalvik',
      );
    } else if (!pressureArmed && ratio < RESET) {
      pressureArmed = true; // re-arm for the next episode
    }
  } catch {
    // report-only
  }
}

/**
 * Activate/deactivate the probe per the resolved gate (build flag + remote
 * diagnostics `memoryProbe` payload). Idempotent — called at boot and on every
 * diagnostics-config apply (so it flips on the moment the remote flag resolves,
 * and off the moment the remote kill-switch lands).
 */
function syncMemoryProbe(): void {
  try {
    const on = isMemoryProbeEnabled();
    setMemoryProbeEnabled(on); // native stays fully inert while false
    if (on) {
      if (!pressureSub) {
        // Secondary signal (older devices / UI_HIDDEN); harmless where deprecated.
        pressureSub = addMemoryPressureListener(s =>
          onMemoryPressure(s, 'trim'),
        );
      }
      if (!pollTimer) {
        pressureArmed = true;
        pollTimer = setInterval(pollHeap, POLL_MS);
      }
    } else {
      if (pressureSub) {
        pressureSub.remove();
        pressureSub = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    }
  } catch {
    // report-only
  }
}

/**
 * Start report-only app-memory tracking. Idempotent; returns a cleanup fn.
 * Runs in ALL builds — cheap: one snapshot at boot + one on each foreground/
 * background transition. Adds 30s polling only in diagnostic builds (where the
 * extra resolution is wanted and overhead is acceptable).
 */
export function startMemoryWatch(): () => void {
  if (started) return () => {};
  started = true;
  void captureMemorySnapshot('boot');
  // S35.2 — (re)evaluate the memory probe at boot (diagnostic builds enable it
  // immediately) and whenever the remote diagnostics config resolves/changes.
  setDiagnosticsConfigListener(syncMemoryProbe);
  syncMemoryProbe();
  const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
    if (s === 'active' || s === 'background')
      void captureMemorySnapshot(`appstate:${s}`);
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  if (DIAGNOSTIC_BUILD_FLAG) {
    timer = setInterval(() => void captureMemorySnapshot('interval'), 30_000);
  }
  return () => {
    sub.remove();
    if (timer) clearInterval(timer);
    setDiagnosticsConfigListener(null);
    pressureSub?.remove();
    pressureSub = null;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    setMemoryProbeEnabled(false);
    started = false;
  };
}
