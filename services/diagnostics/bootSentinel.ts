// @ai
// Boot-not-completed sentinel — REPORT-ONLY observability for the Samsung
// "stuck on the green logo" hard-hang class
// (planning/observability-gap-samsung-hang-2026-06-08.md, §2).
//
// THE PROBLEM IT SOLVES: a genuine cold-start hang can freeze the JS thread or
// get the app OEM-killed BEFORE any in-process watchdog can captureMessage +
// flush. The existing 8s `slow-cold-start` watchdog only fires if the JS event
// loop is still alive to run its timer — a hard native hang silences it. This
// sentinel is the ONLY mechanism that survives a fully-wedged launch: it needs
// nothing from the hung process except one synchronous MMKV write on the FIRST
// line of prepare() (pre-await). If launch N never cleared it, launch N+1
// reports that N hung.
//
// REPORT-ONLY: this module writes/reads an MMKV flag and surfaces a signal on
// the next boot. It does NOT alter boot flow, force any ready state, or change
// what the user sees.

import {createMMKV, type MMKV} from 'react-native-mmkv';

// Lazy + GUARDED handle on the existing 'analytics' MMKV store (the same store
// deviceId.ts opens successfully on real devices). This module runs at the very
// FIRST line of prepare() — the app's earliest MMKV touch — so a module-level
// `createMMKV(...)` const would crash boot if MMKV's native init throws there.
// It does on the iOS Simulator (no app-group container, unlike real iOS:
// `MMKVPlatformContext.getAppGroupDirectory(...)` throws), which previously
// failed module load → `markBootStarted` became undefined → fatal. The module's
// own contract is "MMKV must NEVER throw into the boot path", so the handle is
// created lazily inside try/catch and every caller no-ops when it's null.
let _mmkv: MMKV | null | undefined; // undefined = not yet tried; null = failed
function store(): MMKV | null {
  if (_mmkv !== undefined) return _mmkv;
  try {
    _mmkv = createMMKV({id: 'analytics'});
  } catch {
    _mmkv = null; // never retried; never throws into boot
  }
  return _mmkv;
}

const PENDING_KEY = 'boot:incomplete'; // JSON {startedAt, version, build}
const LAST_OK_KEY = 'boot:last_completed'; // timestamp string
const FURTHEST_KEY = 'boot:furthest'; // furthest milestone string of the live boot

interface PendingBoot {
  startedAt: number;
  version: string;
  build: string;
  /** Furthest boot milestone the (previous, incomplete) launch reached before it
   *  died — read from FURTHEST_KEY at the next markBootStarted. Names exactly
   *  where a hard wedge stopped. */
  furthestStep?: string;
}

// Process-once guard for the first-content-ready milestone (set by the
// useContentReadyWatchdog hook when the cold-start destination screen renders).
let firstContentMarked = false;

// Captured synchronously inside markBootStarted (which runs on the first line of
// prepare()). consumePreviousIncompleteBoot() reads + clears it once, after
// PostHog is connected, so the report has an analytics instance.
let pendingFromLastLaunch: PendingBoot | null = null;

/**
 * Call as the FIRST thing in prepare(), before any await. Writes the sentinel
 * for THIS launch, and — if a sentinel from a PREVIOUS launch is still present —
 * stashes it so the previous incomplete boot can be reported once boot is far
 * enough along to emit telemetry.
 */
export function markBootStarted(version: string, build: string): void {
  const mmkv = store();
  if (!mmkv) return;
  try {
    const prev = mmkv.getString(PENDING_KEY);
    if (prev) {
      try {
        const parsed = JSON.parse(prev) as PendingBoot;
        // Attach the furthest milestone the wedged launch reached (best-effort).
        parsed.furthestStep = mmkv.getString(FURTHEST_KEY) ?? undefined;
        pendingFromLastLaunch = parsed;
      } catch {
        // Corrupt record — ignore; never block boot on the sentinel.
      }
    }
    mmkv.set(
      PENDING_KEY,
      JSON.stringify({startedAt: Date.now(), version, build}),
    );
    mmkv.set(FURTHEST_KEY, 'start'); // reset the furthest tracker for this launch
  } catch {
    // MMKV must never throw into the boot path. Losing the sentinel just means
    // one missed signal, never a worse boot.
  }
}

/**
 * Record the furthest boot milestone reached. Called from markBoot() on each
 * step (start → expo-audio-ready → catalog-ready → … → ready) so that if THIS
 * launch wedges, the NEXT launch's boot-not-completed report names exactly where
 * it died. One cheap synchronous MMKV write per step; never throws into boot.
 */
export function markBootStep(step: string): void {
  const mmkv = store();
  if (!mmkv) return;
  try {
    mmkv.set(FURTHEST_KEY, step);
  } catch {
    // best-effort; a missed step just yields a coarser furthest_step next launch
  }
}

/**
 * Mark that the cold-start DESTINATION screen actually rendered its content (not
 * just that prepare() finished + the splash hid). Process-once. Advances the
 * furthest milestone past 'ready' so a wedge that dies on the restored screen's
 * spinner (the "won't open / spinner forever" class) is distinguishable from a
 * pre-'ready' wedge in the next-launch report. Does NOT clear the sentinel
 * (markBootCompleted at 'ready' still does that — keeping it false-positive-free
 * for landing paths that have no content watchdog).
 */
export function markFirstContentReady(): void {
  if (firstContentMarked) return;
  firstContentMarked = true;
  markBootStep('first-content-ready');
}

/** Read + clear the stashed previous-launch sentinel (returns it at most once). */
export function consumePreviousIncompleteBoot(): PendingBoot | null {
  const p = pendingFromLastLaunch;
  pendingFromLastLaunch = null;
  return p;
}

/**
 * Call when the app is fully interactive (right after markBoot('ready')). Clears
 * THIS launch's sentinel so it isn't reported as incomplete on the next boot.
 */
export function markBootCompleted(): void {
  const mmkv = store();
  if (!mmkv) return;
  try {
    mmkv.remove(PENDING_KEY); // react-native-mmkv v4: key delete is remove()
    mmkv.set(LAST_OK_KEY, String(Date.now()));
  } catch {
    // Best-effort; a failed clear at worst yields one false-positive signal next
    // launch, never a degraded boot.
  }
}
