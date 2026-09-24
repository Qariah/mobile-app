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
// remote `memoryProbe` opt-in + native inert-until-enabled) — see
// isMemoryProbeEnabled() and planning/s35.2-memory-probe-test-plan.md.
//
// Telemetry only. Errors are swallowed — memory probing must never affect the app.

import DeviceInfo from 'react-native-device-info';
import * as Sentry from '@sentry/react-native';
import {AppState, type AppStateStatus} from 'react-native';
import {createMMKV, type MMKV} from 'react-native-mmkv';
import {
  DIAGNOSTIC_BUILD_FLAG,
  isMemoryProbeEnabled,
  memoryProbeDailyCap,
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
// ---------------------------------------------------------------------------
// Per-device DAILY emit budget (2026-08-31).
//
// WHY THIS EXISTS: this probe exhausted the org's whole Sentry error quota.
// `QARIAHV2-17 onMemoryPressure` was 10,852 events from 130 users over 14d —
// ~83 events PER USER, and 87% of all project volume — which rate-limited every
// other error in the project to zero for six days (2026-08-26 onward). Crash-free
// numbers stayed green the whole time because sessions still ingest while errors
// do not, so the blackout was invisible in exactly the dashboard used to judge
// the 3.2.0 rollout.
//
// The hysteresis below (fire at HIGH_WATER, re-arm under RESET) bounds a single
// excursion but NOT a device that oscillates across the ceiling: at POLL_MS=5s it
// can legitimately re-fire every ~10s, all day. Nothing capped the total, and the
// probe reached 100% of users when the `diagnostics_mode` rollout was dialled up.
//
// DAILY, not per-session: an OOM KILLS the process, so the pathological device
// mints a fresh session on every restart — a per-session cap is exactly no cap on
// a crash-looping device, which is the device generating the flood. The budget is
// therefore persisted so it survives the kill it is built to observe; held only in
// memory it would degrade back to per-session precisely where it matters.
//
// SEPARATE BUDGETS PER SOURCE: 'trim' is the rare, high-value pre-OOM signal
// (fires seconds before a Java OOM); 'poll' is the frequent one that flooded. A
// single shared budget would let a morning of 'poll' noise swallow an evening
// 'trim' — losing the most valuable event to the least. They do not compete.
//
// Diagnostic value is unaffected: this probe answers "what is filling the heap on
// this device" (composition), not "how often" (frequency). The 2nd..83rd event of
// a day carries no information the 1st did not.
// Default lives in diagnostics.ts DEFAULT_CONFIG (2) and is remote-tunable via
// the `diagnostics_mode` payload key `memoryProbeDailyCap` — so the next time
// this misbehaves the choice is not just "full signal or nothing".
const BUDGET_KEY = 'memprobe:daily';

// Lazy + GUARDED handle on the existing 'analytics' store, matching
// bootSentinel.ts: MMKV native init throws on the iOS Simulator (no app-group
// container), and this module must never throw into a pressure callback. A null
// store means "cannot persist" — see consumeDailyBudget for why that FAILS CLOSED.
let _mmkv: MMKV | null | undefined; // undefined = not tried; null = failed
function store(): MMKV | null {
  if (_mmkv !== undefined) return _mmkv;
  try {
    _mmkv = createMMKV({id: 'analytics'});
  } catch {
    _mmkv = null;
    // A silent zero here is indistinguishable from "this device was healthy",
    // which is the wrong story to tell about a device whose storage just failed.
    // A TAG (not an event — this path must never add quota cost) leaves the
    // caveat attached to whatever crash the device does report.
    try {
      Sentry.setTag('memprobe_store_unavailable', 'true');
    } catch {
      // never throw from the probe
    }
  }
  return _mmkv;
}

// Negative-cache a failing WRITE the same way a failing init is cached. Without
// this, a storage-full device re-attempts read+write on every pressure event —
// extra I/O on exactly the device least able to afford it. Still fails closed.
let writesBroken = false;

interface DailyBudget {
  day: string; // UTC YYYY-MM-DD
  trim: number;
  poll: number;
}

/** UTC so the reset aligns with Sentry's own daily buckets and never shifts
 *  under a timezone change or DST. */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Claim one emit from today's budget for `source`. Returns the 1-based sequence
 * number for the event, or null when the budget is spent (caller must not emit).
 *
 * FAILS CLOSED when MMKV is unavailable: an unbounded probe is what caused the
 * outage this cap exists to prevent, so "cannot count" must mean "do not emit",
 * never "emit freely". The only environment where the store is unavailable is one
 * where this Android-only probe does not run anyway (iOS Simulator).
 */
function consumeDailyBudget(
  source: 'trim' | 'poll',
  now: number,
): number | null {
  const mmkv = store();
  if (!mmkv || writesBroken) return null; // fail closed
  const cap = memoryProbeDailyCap();
  if (cap <= 0) return null;
  const today = utcDay(now);
  let b: DailyBudget = {day: today, trim: 0, poll: 0};
  try {
    const raw = mmkv.getString(BUDGET_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DailyBudget>;
      // A stale day resets the budget; a corrupt record falls back to a fresh one.
      if (parsed && parsed.day === today) {
        b = {
          day: today,
          trim: typeof parsed.trim === 'number' ? parsed.trim : 0,
          poll: typeof parsed.poll === 'number' ? parsed.poll : 0,
        };
      }
    }
  } catch {
    // unreadable/corrupt — start today fresh rather than emit uncounted
  }
  const used = source === 'trim' ? b.trim : b.poll;
  if (used >= cap) return null;
  const seq = used + 1;
  if (source === 'trim') b.trim = seq;
  else b.poll = seq;
  try {
    mmkv.set(BUDGET_KEY, JSON.stringify(b));
  } catch {
    writesBroken = true; // could not record the spend — fail closed, and stay closed
    return null;
  }
  return seq;
}

/** Test seam — drops the memoised MMKV handle so a fresh mock is picked up. */
export function __resetMemoryBudgetForTests(): void {
  _mmkv = undefined;
  writesBroken = false;
}

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
    // Bounded per device per UTC day — see memoryProbeDailyCap(). Claimed BEFORE the
    // capture so a spent budget costs nothing but the lookup.
    const seq = consumeDailyBudget(source, Date.now());
    if (seq === null) return;
    Sentry.captureMessage('memory-pressure', {
      level: 'warning',
      tags: {
        scope: 'memory-probe',
        source,
        // Which emit of today's per-source budget this is. If these are always
        // at the cap the limit is binding and the device is still flapping; if
        // they are mostly 1 the excursions are genuinely isolated.
        daily_seq: String(seq),
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
 * diagnostics-config apply.
 * @ai #407 — a payload change is NOT live in a running process.
 * enableDiagnostics() is first-call-wins. The first call comes from PostHog's
 * `featureflags` event, which fires after the flag request returns and stores
 * the payload in memory. So a changed payload normally applies at the next
 * cold start. When the flag request fails, PostHog emits the cached payload
 * instead, and the old config applies again; an offline device can keep it for
 * many cold starts. A long-lived process (for example one that holds the audio
 * foreground service) never sees a change.
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
  // immediately) and when the remote diagnostics config is applied. That happens
  // once per process: a later payload change waits for a cold start.
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
