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
//      The payload is the no-rebuild control surface, applied once per process
//      (first call wins; a change applies at a later cold start):
//        { "sampleRate": 0.2, "heartbeatOverrunMs": 3000,
//          "heartbeat": true, "network": true, "nav": true }
//      The memory probe is opt-in on this path: it runs only when the payload
//      says `"memoryProbe": true`. A payload without the key leaves it OFF.
//      Toggle the flag / edit the payload / change its rollout % from the
//      PostHog dashboard to dial diagnostics across the beta population.
//
// Coverage, all global (no screen/nav call sites touched beyond one root hook):
//   - stuck-on-logo / cold-start hang -> boot watchdog in app/_layout.tsx
//   - JS-thread stall -> heartbeat -> `diagnostic-js-stall`
//   - native main-thread freeze -> Sentry Android ANR (already on), plus the
//     Qariah watchdog's stall buffer, which rides on other Sentry events
//     (recordMainThreadStall; it sends no event of its own)
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
import {AppState, Platform} from 'react-native';
import {isFeatureEnabled} from '@/config/featureFlags';
// S-PR2 — native main-thread (UI-thread) freeze watchdog (Android-only; iOS/web
// no-op). Catches the native main-thread block class the JS heartbeat is blind to.
import {
  setMainThreadWatchdogEnabled,
  addMainThreadStallListener,
} from '../../modules/qariah-anr-watchdog';
import {
  persistMainThreadStallCount,
  startMainThreadStallRecord,
} from './mainThreadStallCount';

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
  /** S35.2 memory-pressure field probe (the media3/Glide OOM). FAIL-CLOSED on the
   *  remote path: it runs only when the `diagnostics_mode` payload says
   *  `memoryProbe:true`. A payload without the key (a stale cached payload that
   *  predates the 2026-08-31 kill) leaves it OFF (#407). The one-off diagnostic
   *  APK turns it on by default (see DEFAULT_CONFIG). The build flag
   *  `memoryPressureProbe` is the hard local off; see isMemoryProbeEnabled. */
  memoryProbe: boolean;
  /** Max memory-pressure events emitted per source, per device, per UTC day.
   *  Remote-tunable because the original had NO cap at all and that exhausted
   *  the whole Sentry error quota for six days (see memoryWatch.ts).
   *  `memoryProbe:false` is the all-or-nothing off (on a later cold start); this is the dial between
   *  "full signal" and "off", so the next incident does not force that choice. */
  memoryProbeDailyCap: number;
  /** Native main-thread (UI-thread) freeze watchdog. Runs for the WHOLE enabled
   *  (diagnostics-cohort) session, NOT the heavy-probe sample — the freeze it
   *  catches is rare, so we want full-cohort coverage; its cost is one trivial
   *  main-Handler post + a daemon-thread sleep per interval. A stall sends no
   *  Sentry event of its own (recordMainThreadStall), so a payload with no key
   *  costs no quota. Remote off switch: `{"mainThreadWatchdog": false}` in the
   *  diagnostics_mode payload; like all of the config it applies at a later cold
   *  start, not live. */
  mainThreadWatchdog: boolean;
}

const DEFAULT_CONFIG: DiagnosticsConfig = {
  heartbeat: true,
  heartbeatOverrunMs: 3000,
  network: true,
  nav: true,
  sampleRate: 1,
  // @ai #407 — fail closed. A remote payload must say `memoryProbe:true` to run
  // the probe; a missing key must never turn it on. The one-off diagnostic APK is
  // a deliberate local build, so there the probe defaults ON. Keyed on the build
  // flag, not on "no payload", so a remote flag with an empty payload stays off.
  memoryProbe: DIAGNOSTIC_BUILD_FLAG,
  memoryProbeDailyCap: 2,
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
// diagnostics are enabled AND the build flag is on AND the config opts in
// (`memoryProbe:true` in the remote payload, or the diagnostic-APK default).
// Three tiers: build flag (hard local off) → remote payload (explicit opt-in; a
// missing key is off) → native inert-until-enabled (in memoryWatch).
let configListener: (() => void) | null = null;

/** memoryWatch registers a sync fn here; called when the diagnostics config is
 *  applied (once per process), so the probe activates as soon as the first
 *  remote config resolves. A later payload change is not applied. */
export function setDiagnosticsConfigListener(fn: (() => void) | null): void {
  configListener = fn;
}

/** Single source of truth for whether the S35.2 memory probe should run. */
export function isMemoryProbeEnabled(): boolean {
  return enabled && cfg.memoryProbe && isFeatureEnabled('memoryPressureProbe');
}

/** Per-source, per-UTC-day emit budget for the memory probe. Applied once per
 *  process, like the rest of the config. */
export function memoryProbeDailyCap(): number {
  return cfg.memoryProbeDailyCap;
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
    // Without this, every captureAndFlush message collapses into one issue by
    // call-site, so distinct signals could not be triaged or auto-filed apart.
    // (`main-thread-stall` used this path until #217; it now rides on other
    // events through recordMainThreadStall.)
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
  // S35.2 remote switch: `{"memoryProbe": true}` opts in; `false` keeps it off.
  // A missing key keeps the default (off on a normal build). No rebuild, but not
  // live: enableDiagnostics() is first-call-wins, so a change normally applies
  // at the next cold start whose flag request succeeds (see syncMemoryProbe).
  if (typeof r.memoryProbe === 'boolean') out.memoryProbe = r.memoryProbe;
  // Dial the per-day emit budget without a rebuild. A cap of 0 means "never
  // emit"; the upper bound keeps a fat-fingered payload from re-opening the
  // flood this cap exists to stop.
  if (
    typeof r.memoryProbeDailyCap === 'number' &&
    Number.isFinite(r.memoryProbeDailyCap) &&
    r.memoryProbeDailyCap >= 0 &&
    r.memoryProbeDailyCap <= 50
  ) {
    out.memoryProbeDailyCap = Math.floor(r.memoryProbeDailyCap);
  }
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
  // #217 — record that the watchdog ran in this process (0 stalls so far), so
  // the next cold start can report the rate's denominator. Android only: the
  // iOS module is a no-op stub, and an iOS record with 0 stalls would dilute
  // the rate (one build number ships to both stores). Never throws.
  if (Platform.OS === 'android') startMainThreadStallRecord();
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
    recordMainThreadStall(e);
  });
}

// --- Main-thread stall buffer (#217) ----------------------------------------
// @ai A stall does NOT send a Sentry event of its own. Two things replace it,
// and neither adds an event:
//
// 1. EVIDENCE — a small in-memory buffer of the most recent stalls, set on the
//    Sentry scope, so it rides on whatever Sentry sends anyway:
//    - a JS error or warning in this process (the JS scope);
//    - a Java crash, or an ANR that kills the process, on Android: the RN SDK
//      syncs scope to the native scope, and sentry-android persists that scope
//      and attaches it to the ANR it reports at the next launch;
//    - an NDK (C/C++) crash gets the tag and the breadcrumb, but not the
//      contexts (the NDK scope observer does not sync contexts).
// 2. RATE — a record of the build and the stall count of each process that
//    ran the watchdog, persisted and sent once with the next
//    `cold_start_began` PostHog event (mainThreadStallCount.ts).
//
// Why: a standalone event per stall had no daily ceiling (TECH_DEBT #217, the
// shape that spent the whole quota for the memory probe in 2026-08), and the
// remote payload fails open for this probe.
//
// Limits: on API 30+ sentry-android reports only ANRs that killed the process
// (ApplicationExitInfo). A stall that recovers — the user taps "Wait", or no
// input was pending — produces no Sentry ANR. It is then visible only in the
// rate, and in the buffer if another Sentry event follows in the process.
// Number values in the next-launch ANR arrive as doubles (5200.0) through the
// native bridge.
const STALL_BUFFER_MAX = 5;
// Per entry. Sentry's server keeps 8192 bytes per custom context and cuts the
// rest; 5 entries at 1200 characters stay under that with room for the keys.
const STALL_STACK_MAX_CHARS = 1200;

interface BufferedStall {
  at: string;
  blockedMs: number;
  bucket: string;
  stack: string;
}

let stallBuffer: BufferedStall[] = [];
let stallsInProcess = 0;

/** Add one stall to the buffer and re-attach the buffer to the Sentry scope.
 *  Never throws. Sends no event. */
export function recordMainThreadStall(
  e: {blockedMs: number; thresholdMs: number; mainStack: string},
  now: number = Date.now(),
): void {
  try {
    stallsInProcess += 1;
    const stack =
      typeof e.mainStack === 'string'
        ? e.mainStack.slice(0, STALL_STACK_MAX_CHARS)
        : '';
    stallBuffer = [
      ...stallBuffer,
      {
        at: new Date(now).toISOString(),
        blockedMs: e.blockedMs,
        bucket: bucketMs(e.blockedMs),
        stack,
      },
    ].slice(-STALL_BUFFER_MAX);
    // The count lives in its own small context, so the server's 8 KB trim of
    // the stack context can never drop it.
    Sentry.setContext('main_thread_stall_count', {
      stalls_in_process: stallsInProcess,
      threshold_ms: e.thresholdMs,
    });
    persistMainThreadStallCount(stallsInProcess);
    // Flat keys, newest first: an array of objects is harder to read in Sentry
    // and costs more bytes of the context budget.
    const context: Record<string, string | number> = {};
    [...stallBuffer].reverse().forEach((s, i) => {
      const n = i + 1;
      context[`stall_${n}_at`] = s.at;
      context[`stall_${n}_blocked_ms`] = s.blockedMs;
      context[`stall_${n}_bucket`] = s.bucket;
      context[`stall_${n}_stack`] = s.stack;
    });
    Sentry.setContext('main_thread_stalls', context);
    // Searchable: `main_thread_stall_seen:true` finds every event that carries
    // the buffer.
    Sentry.setTag('main_thread_stall_seen', 'true');
    Sentry.addBreadcrumb({
      category: 'diag.main-thread-stall',
      level: 'warning',
      message: `main thread blocked ${e.blockedMs} ms`,
      data: {blocked_ms: e.blockedMs, stall_bucket: bucketMs(e.blockedMs)},
    });
  } catch {
    // report-only — must never throw into the watchdog listener
  }
}

/** Test seam — empties the stall buffer, standing in for a fresh process. */
export function __resetMainThreadStallsForTests(): void {
  stallBuffer = [];
  stallsInProcess = 0;
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

  // S35.2 — let memoryWatch (re)evaluate the probe now the config is applied.
  // This runs once per process (first call wins).
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
