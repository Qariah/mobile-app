// @ai
// Diagnostic instrumentation for the "app freezes / stuck on logo" class and
// broader pre-launch issue detection.
//
// TWO activation paths:
//   1. Build flag — EXPO_PUBLIC_DIAGNOSTIC_MODE=true bakes diagnostics ON for a
//      one-off diagnostic APK (available at Sentry.init time, before remote
//      flags load). The escape hatch that doesn't need a network round-trip.
//   2. Remote flag — a PostHog `diagnostics_mode` boolean (read in
//      AnalyticsConnector once flags load) calls enableDiagnostics(payload).
//      The payload is the live, no-rebuild control surface:
//        { "sampleRate": 0.2, "heartbeatOverrunMs": 3000,
//          "heartbeat": true, "network": true, "nav": true }
//      Toggle the flag / edit the payload / change its rollout % from the
//      PostHog dashboard to dial diagnostics across the beta population.
//
// Coverage, all global (no screen/nav call sites touched beyond one root hook):
//   - stuck-on-logo / cold-start hang -> boot watchdog in app/_layout.tsx
//   - JS-thread stall -> heartbeat -> `diagnostic-js-stall`
//   - native main-thread freeze -> Sentry Android ANR (already on)
//   - "responsive but spinning forever" (hung request) -> network breadcrumbs
//     (a `net:start` with no `net:end` names the stuck request)
//   - what-led-here -> nav breadcrumbs + (when EXPO_PUBLIC_SENTRY_REPLAY) a
//     masked Sentry session replay attached to the error.
//
// Cost discipline: the heavy probes (heartbeat, network wrap) run only for a
// per-session SAMPLE (sampleRate, remote-tunable); device context + tags are
// cheap and run for every enabled session; flush() is confined to diagnostic
// events + background. tracesSampleRate is untouched.

import * as Sentry from '@sentry/react-native';
import {AppState} from 'react-native';
import {isFeatureEnabled} from '@/config/featureFlags';
// S-PR2 — native main-thread (UI-thread) freeze watchdog (Android-only; iOS/web
// no-op). Catches the native main-thread block class the JS heartbeat is blind to.
import {
  setMainThreadWatchdogEnabled,
  addMainThreadStallListener,
} from '../../modules/qariah-anr-watchdog';

/** Build-time flag — available at Sentry.init, forces diagnostics on for a
 *  one-off diagnostic APK regardless of the remote flag. */
export const DIAGNOSTIC_BUILD_FLAG =
  process.env.EXPO_PUBLIC_DIAGNOSTIC_MODE === 'true';

/** Sentry session replay is a Sentry.init-time setting (can't wait for PostHog
 *  flags), so it's gated at PUBLISH time via env, or on in any diagnostic
 *  build. Sample rates are env-driven (see app/_layout.tsx). */
export const SENTRY_REPLAY_ENABLED =
  DIAGNOSTIC_BUILD_FLAG || process.env.EXPO_PUBLIC_SENTRY_REPLAY === 'true';

export interface DiagnosticsConfig {
  heartbeat: boolean;
  heartbeatOverrunMs: number;
  network: boolean;
  nav: boolean;
  /** Per-session gate [0..1] for the heavy probes (heartbeat + network). */
  sampleRate: number;
  /** S35.2 memory-pressure field probe (the media3/Glide OOM). When diagnostics
   *  are enabled, the probe also runs unless this is set false — the live remote
   *  kill-switch (payload `memoryProbe:false`) for "in case it misbehaves". The
   *  build flag `memoryPressureProbe` is the hard local off; see isMemoryProbeEnabled. */
  memoryProbe: boolean;
  /** Native main-thread (UI-thread) freeze watchdog. Runs for the WHOLE enabled
   *  (diagnostics-cohort) session, NOT the heavy-probe sample — the freeze it
   *  catches is rare, so we want full-cohort coverage; its cost is one trivial
   *  main-Handler post + a daemon-thread sleep per interval. Remote kill-switch:
   *  `{"mainThreadWatchdog": false}` in the diagnostics_mode payload. */
  mainThreadWatchdog: boolean;
}

const DEFAULT_CONFIG: DiagnosticsConfig = {
  heartbeat: true,
  heartbeatOverrunMs: 3000,
  network: true,
  nav: true,
  sampleRate: 1,
  memoryProbe: true,
  mainThreadWatchdog: true,
};

// ms — how often the watchdog pings the main thread, and how long the main
// thread must be unresponsive before it's reported as a freeze.
const MAIN_THREAD_PING_MS = 1000;
const MAIN_THREAD_STALL_MS = 4000;

const HEARTBEAT_INTERVAL_MS = 2000;
const STALL_REPORT_DEBOUNCE_MS = 10000;

let enabled = false;
let sessionSampled = false;
let cfg: DiagnosticsConfig = DEFAULT_CONFIG;
let lastTick = 0;
let lastStallReportAt = 0;
let fetchWrapped = false;
// Foreground guard for the heartbeat. The OS suspends JS timers almost
// immediately on background, so a tick that fires after a background excursion
// would report the whole suspension gap as a "JS stall" (false positive — it
// dominated the data, incl. multi-minute "overruns" on idle/pocketed phones).
// Set on every background/inactive transition, checked + cleared each tick: any
// background excursion during an interval disqualifies that interval, leaving
// only genuine foreground JS-thread blocks.
let backgroundedSinceTick = false;

export function areDiagnosticsEnabled(): boolean {
  return enabled;
}

// S35.2 — memory-pressure probe gating. The probe rides the diagnostics framework
// (reuses the same remote-control surface), so it runs for sessions where
// diagnostics are enabled AND the build flag is on AND the remote payload hasn't
// killed it (`memoryProbe:false`). Three tiers: build flag (hard local off) →
// remote payload (live kill-switch) → native inert-until-enabled (in memoryWatch).
let configListener: (() => void) | null = null;

/** memoryWatch registers a sync fn here; called whenever the diagnostics config
 *  is (re)applied so the probe activates the moment the remote flag resolves. */
export function setDiagnosticsConfigListener(fn: (() => void) | null): void {
  configListener = fn;
}

/** Single source of truth for whether the S35.2 memory probe should run. */
export function isMemoryProbeEnabled(): boolean {
  return enabled && cfg.memoryProbe && isFeatureEnabled('memoryPressureProbe');
}

/** In-memory breadcrumb. No-op until diagnostics are enabled. */
export function diagBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!enabled) return;
  Sentry.addBreadcrumb({category: 'diag', message, level: 'info', data});
}

/** Navigation breadcrumb — fed by a root hook (useDiagnosticsNav). */
export function diagNav(path: string): void {
  if (!enabled || !cfg.nav) return;
  Sentry.addBreadcrumb({category: 'diag.nav', message: path, level: 'info'});
}

/** Capture a diagnostic event and eagerly flush so it survives an OS kill of a
 *  hung app. Flush is deliberately confined to this path. */
async function captureAndFlush(
  message: string,
  tags: Record<string, string>,
  extra?: Record<string, unknown>,
): Promise<void> {
  Sentry.captureMessage(message, {
    level: 'warning',
    tags: {scope: 'diagnostic', ...tags},
    extra,
    // Group by the message so distinct signals are distinct Sentry issues.
    // Without this, every captureAndFlush message (diagnostic-js-stall AND the
    // new main-thread-stall) collapses into one issue by call-site, burying the
    // native-freeze signal inside the js-stall bucket — they must be separately
    // triageable / auto-fileable.
    fingerprint: [message],
  });
  try {
    await Sentry.flush();
  } catch {
    // best-effort; a failed flush must never throw into the heartbeat
  }
}

function bucketMs(ms: number): string {
  if (ms < 5000) return '3-5s';
  if (ms < 10000) return '5-10s';
  if (ms < 20000) return '10-20s';
  return '20s+';
}

function startHeartbeat(): void {
  lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const overrun = now - lastTick - HEARTBEAT_INTERVAL_MS;
    lastTick = now;
    // Consume the background flag for THIS interval (the AppState listener sets
    // it; resuming also resets lastTick, so this is belt-and-suspenders).
    const backgrounded = backgroundedSinceTick;
    backgroundedSinceTick = false;
    if (overrun < cfg.heartbeatOverrunMs) return;
    if (now - lastStallReportAt < STALL_REPORT_DEBOUNCE_MS) return;
    // Foreground guard: an interval that straddled a background excursion is an
    // OS-suspension gap, not a JS-thread block — drop it. Only report a stall
    // whose entire interval was foreground.
    if (backgrounded || AppState.currentState !== 'active') return;
    lastStallReportAt = now;
    void captureAndFlush(
      'diagnostic-js-stall',
      {
        app_state: 'active',
        // Marks events from the foreground-guarded detector so a real
        // foreground freeze is filterable (`fg_guarded:true`) vs the old
        // background-suspension false positives.
        fg_guarded: 'true',
        stall_bucket: bucketMs(overrun),
      },
      {overrun_ms: overrun},
    );
  }, HEARTBEAT_INTERVAL_MS);
}

/** Strip the query string (tokens/PII) from a fetch target. */
function sanitizeUrl(input: Parameters<typeof fetch>[0]): string {
  try {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const q = raw.indexOf('?');
    return q >= 0 ? raw.slice(0, q) : raw;
  } catch {
    return 'unknown';
  }
}

/** Breadcrumb every request's lifecycle. A `net:start` with no matching
 *  `net:end` in a captured event names the request the app hung on. */
function installFetchBreadcrumbs(): void {
  if (fetchWrapped || typeof globalThis.fetch !== 'function') return;
  fetchWrapped = true;
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function diagFetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> {
    const url = sanitizeUrl(input);
    const start = Date.now();
    return orig(input, init).then(
      res => {
        // Only breadcrumb SLOW or FAILED requests. A `net:start`/`net:end` pair
        // per request flooded the buffer and buried the lead-in (the reason the
        // freeze's preceding screen/tap was invisible). Fast successful requests
        // add no breadcrumb; a slow/erroring one — the diagnostically useful
        // case — still does.
        const ms = Date.now() - start;
        if (ms > 1500 || res.status >= 400) {
          diagBreadcrumb('net:slow', {url, status: res.status, ms});
        }
        return res;
      },
      (err: unknown) => {
        diagBreadcrumb('net:error', {
          url,
          ms: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      },
    );
  } as typeof fetch;
}

/** Device-tier context — the dominant "stuck on logo" hypothesis is a low-RAM
 *  device + heavy build, so total RAM is the single most useful field. */
async function setDeviceContext(): Promise<void> {
  try {
    const Device = await import('expo-device');
    const totalMem = Device.totalMemory; // bytes (Android); null on some iOS
    const isLowRam =
      typeof totalMem === 'number' ? totalMem < 3 * 1024 * 1024 * 1024 : null;

    let freeStorageMb: number | null = null;
    try {
      const fs = await import('expo-file-system');
      const getFree = (fs as {getFreeDiskStorageAsync?: () => Promise<number>})
        .getFreeDiskStorageAsync;
      if (typeof getFree === 'function') {
        freeStorageMb = Math.round((await getFree()) / (1024 * 1024));
      }
    } catch {
      // free-storage API moved across expo-file-system majors; non-critical
    }

    Sentry.setContext('device_tier', {
      model: Device.modelName ?? null,
      brand: Device.brand ?? null,
      os: `${Device.osName ?? ''} ${Device.osVersion ?? ''}`.trim() || null,
      total_ram_mb:
        typeof totalMem === 'number'
          ? Math.round(totalMem / (1024 * 1024))
          : null,
      free_storage_mb: freeStorageMb,
      is_low_ram: isLowRam,
      cpu_abis: Device.supportedCpuArchitectures ?? null,
      year_class: Device.deviceYearClass ?? null,
    });
    if (isLowRam !== null) {
      Sentry.setTag('ram_tier', isLowRam ? 'low' : 'normal');
    }
  } catch {
    // expo-device optional; never block on context-gathering
  }
}

/** Coerce a PostHog flag payload (untrusted JSON) into a partial config. */
function coerceConfig(raw: unknown): Partial<DiagnosticsConfig> {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<DiagnosticsConfig> = {};
  if (typeof r.heartbeat === 'boolean') out.heartbeat = r.heartbeat;
  if (typeof r.network === 'boolean') out.network = r.network;
  if (typeof r.nav === 'boolean') out.nav = r.nav;
  // Remote kill-switch for the native main-thread watchdog.
  if (typeof r.mainThreadWatchdog === 'boolean') {
    out.mainThreadWatchdog = r.mainThreadWatchdog;
  }
  if (typeof r.heartbeatOverrunMs === 'number' && r.heartbeatOverrunMs >= 500) {
    out.heartbeatOverrunMs = r.heartbeatOverrunMs;
  }
  if (
    typeof r.sampleRate === 'number' &&
    r.sampleRate >= 0 &&
    r.sampleRate <= 1
  ) {
    out.sampleRate = r.sampleRate;
  }
  // S35.2 remote kill-switch: `{"memoryProbe": false}` disables the memory probe
  // live (no rebuild) for every session running diagnostics.
  if (typeof r.memoryProbe === 'boolean') out.memoryProbe = r.memoryProbe;
  return out;
}

// --- Native main-thread freeze watchdog (Android-only) ------------------------
let watchdogStarted = false;
let watchdogSub: {remove(): void} | null = null;

/** Single source of truth for whether the native main-thread watchdog runs:
 *  diagnostics enabled (cohort/build) AND the remote kill-switch is on AND the
 *  local build flag is on. */
export function isMainThreadWatchdogEnabled(): boolean {
  return (
    enabled && cfg.mainThreadWatchdog && isFeatureEnabled('mainThreadWatchdog')
  );
}

/** Start the native watchdog and route its stall event to a flushed Sentry
 *  report (the JS thread is alive during a pure UI-thread block, so this gets
 *  out). Idempotent. Report-only — no behavioral effect. */
function startMainThreadWatchdog(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;
  setMainThreadWatchdogEnabled(true, MAIN_THREAD_PING_MS, MAIN_THREAD_STALL_MS);
  watchdogSub = addMainThreadStallListener(e => {
    // Foreground gate (mirrors the heartbeat guard). While the app is
    // backgrounded/dozing the OS throttles the main Looper, so the native
    // watchdog's ping isn't serviced for many seconds and it reports a "stall"
    // even though the main thread is simply parked in nativePollOnce. Every
    // QARIAHV2-1C event was exactly this: in_foreground:false + an idle
    // Looper.loop→nativePollOnce stack, on idle high-end devices. Drop those —
    // a backgrounded firing is never the real freeze (a true foreground UI/JS
    // lock can't even dispatch this JS listener until it releases).
    if (AppState.currentState !== 'active') return;
    // A true foreground UI/JS lock is OS-ANR-killed at ~5s, so any stall over
    // 30s that still reached this listener is definitionally a doze / Looper-
    // suspend artifact snapshotted at resume — the `in_foreground` tag is stale
    // at flush time, so the AppState gate above can miss these. Drop them: these
    // multi-minute "stalls" were the bulk of the QARIAHV2-1C noise (S38.6).
    if (e.blockedMs > 30_000) return;
    void captureAndFlush(
      'main-thread-stall',
      {scope: 'anr', stall_bucket: bucketMs(e.blockedMs)},
      {
        blocked_ms: e.blockedMs,
        threshold_ms: e.thresholdMs,
        main_stack: e.mainStack,
      },
    );
  });
}

/**
 * Enable diagnostics. Idempotent. Called either at init (build flag) or once
 * the PostHog `diagnostics_mode` flag resolves (with its payload as `rawConfig`).
 * The heavy probes run only if this session falls inside `sampleRate`.
 */
export function enableDiagnostics(rawConfig?: unknown): void {
  if (enabled) return;
  enabled = true;
  cfg = {...DEFAULT_CONFIG, ...coerceConfig(rawConfig)};
  sessionSampled = Math.random() < cfg.sampleRate;

  Sentry.setTag('diagnostic_build', String(DIAGNOSTIC_BUILD_FLAG));
  Sentry.setTag('diagnostics_enabled', 'true');
  Sentry.setTag('diagnostics_sampled', String(sessionSampled));
  void setDeviceContext();

  if (sessionSampled) {
    if (cfg.heartbeat) startHeartbeat();
    if (cfg.network) installFetchBreadcrumbs();
  }
  // The native main-thread watchdog runs for the WHOLE enabled cohort (not just
  // the heavy-probe sample) — the native freeze it catches is rare, so we want
  // full-cohort coverage. Cheap + remote-kill-switchable + Android-only.
  if (isMainThreadWatchdogEnabled()) startMainThreadWatchdog();
  void watchdogSub; // retained for the lifetime of the process (report-only)
  diagBreadcrumb('diagnostics-enabled', {
    sampled: sessionSampled,
    sample_rate: cfg.sampleRate,
  });

  // S35.2 — let memoryWatch (re)evaluate the probe now the remote config is live.
  try {
    configListener?.();
  } catch {
    // report-only — the memory probe must never throw into diagnostics enable
  }

  // Flush queued events when the app backgrounds — if the user force-quits a
  // hung app right after, the trail still makes it out.
  AppState.addEventListener('change', state => {
    diagBreadcrumb('app-state', {state});
    if (state === 'active') {
      // Reset the heartbeat baseline on resume so the first post-resume tick
      // measures from now, not across the OS-suspended background window.
      lastTick = Date.now();
    }
    if (state === 'background' || state === 'inactive') {
      // Disqualify the in-progress heartbeat interval — JS timers are about to
      // be suspended; whatever gap the next tick sees is suspension, not a stall.
      backgroundedSinceTick = true;
      void Sentry.flush();
    }
  });
}
