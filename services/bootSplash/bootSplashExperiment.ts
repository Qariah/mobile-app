// @ai Qariah (ANR hotfix v2) — boot-splash experiment logic, pure TypeScript.
//
// This file holds the rules for the `nonblocking_splash_v2` flag and the
// `boot_risk` enrolment. It does not import the native module or PostHog.
// The caller injects both, so jest needs no native mocks.
// Plan: planning/anr-hotfix-v2-plan.md, section 2.
//
// Rules (default ON since 2026-11, the ANR floor work):
// - The non-blocking splash is the default. It needs no flag response, so a
//   fresh install and an update use it at the first launch.
// - The flag is the remote off switch. A good flag response in THIS process
//   with the variant 'control' or the value false writes OFF for the next
//   launch. Any other good response ('treatment', a missing flag, another
//   value) writes ON.
// - A failed, partial or quota-limited request says nothing about the flag.
//   The app keeps the stored value and does not call the native module.
// - The app does not act on the cached flags that PostHog loads at start.
//   A good response that changes the stored value clears the native crash-guard
//   state.
// - No function in this file throws into the app.
// Why: with the old rule (only 'treatment' armed, and only the NEXT launch),
// 57% of the Android users of a week made one cold start, in the blocking
// splash. planning/android-anr-floor-rca-2026-11-11.md.

export const NONBLOCKING_SPLASH_FLAG_V2 = 'nonblocking_splash_v2';
export const BOOT_RISK_PROPERTY = 'boot_risk';

/** The PostHog quota-limit feature name for flags. */
const QUOTA_FEATURE_FLAGS = 'feature_flags';

/**
 * If no flag response arrives within this time, attach requests the flags once
 * more. Reason: the SDK requests /flags only after the remote-config request
 * succeeds. When that request fails, no flag response arrives. The extra
 * request gives the remote off switch a second chance in this process, and a
 * failure emits, so `boot_splash_flag_resolved` reports `error`.
 */
export const FLAG_RESPONSE_WATCHDOG_MS = 8000;

/** The default wait for the previous-process info, in milliseconds. */
const DEFAULT_PREVIOUS_PROCESS_TIMEOUT_MS = 2000;

export type ExitReason =
  | 'anr'
  | 'crash'
  | 'crash_native'
  | 'user'
  | 'low_memory'
  | 'other'
  | 'unknown';

/**
 * ApplicationExitInfo.REASON_* → label. 6 anr, 4 crash, 5 crash_native,
 * 10 and 11 user, 3 low_memory, 0 (REASON_UNKNOWN) and any negative code
 * (-1 no record, -2 API<30, -3 no previous process) unknown, every other code
 * other. Non-integer / NaN → unknown.
 */
export function mapExitReason(code: number): ExitReason {
  if (typeof code !== 'number' || !Number.isInteger(code)) return 'unknown';
  if (code <= 0) return 'unknown';
  switch (code) {
    case 3:
      return 'low_memory';
    case 4:
      return 'crash';
    case 5:
      return 'crash_native';
    case 6:
      return 'anr';
    case 10:
    case 11:
      return 'user';
    default:
      return 'other';
  }
}

export interface FlagResolution {
  /** getFeatureFlag(NONBLOCKING_SPLASH_FLAG_V2) after a response in this process. */
  value: string | boolean | undefined;
  /** The last flag request failed or was quota-limited. */
  requestFailed: boolean;
}

/** What a flag response does to the stored value for the NEXT launch. */
export type NextLaunchAction = 'on' | 'off' | 'keep';

/**
 * 'off'  — a good response with 'control' or false: the remote off switch.
 * 'on'   — any other good response: 'treatment', a missing flag, another value.
 * 'keep' — a failed, partial or quota-limited request: no change.
 */
export function nextLaunchAction(r: FlagResolution): NextLaunchAction {
  if (r.requestFailed) return 'keep';
  return r.value === 'control' || r.value === false ? 'off' : 'on';
}

/**
 * Event label: 'treatment' | 'control' | 'false' | 'missing' (undefined) |
 * 'error' (requestFailed) | 'other' (any other value). requestFailed wins.
 */
export function resolutionLabel(
  r: FlagResolution,
): 'treatment' | 'control' | 'false' | 'missing' | 'error' | 'other' {
  if (r.requestFailed) return 'error';
  if (r.value === 'treatment') return 'treatment';
  if (r.value === 'control') return 'control';
  if (r.value === false) return 'false';
  if (r.value === undefined) return 'missing';
  return 'other';
}

/** Minimal structural client (a posthog-react-native PostHog satisfies it). */
export interface FlagClientLike {
  getFeatureFlag(key: string): string | boolean | undefined;
  onFeatureFlags(cb: (flags: unknown) => void): () => void;
  setPersonPropertiesForFlags(
    props: Record<string, string>,
    reloadFeatureFlags?: boolean,
  ): void;
  /** Request the flags again. A failure stores requestError and emits. */
  reloadFeatureFlags?(): void;
}

/**
 * The persisted flag details. `getStoredFlagDetails` is TS-private in
 * @posthog/core, so this file reads it through this narrow type.
 */
interface StoredFlagDetailsReader {
  getStoredFlagDetails?: () =>
    | {
        requestError?: unknown;
        quotaLimited?: unknown;
        errorsWhileComputingFlags?: unknown;
      }
    | null
    | undefined;
}

/**
 * Read the flag value and the state of the last flag request.
 * A request error, a partial response (errorsWhileComputingFlags: the SDK
 * merges the cached flags back in) or a flag quota limit is a failure.
 * Any throw → {value: undefined, requestFailed: true} (the stored value is kept).
 */
export function readFlagResolution(client: FlagClientLike): FlagResolution {
  try {
    const reader = client as unknown as StoredFlagDetailsReader;
    // Without this reader the app cannot tell a failed request
    // from a good one.
    if (typeof reader.getStoredFlagDetails !== 'function') {
      return {value: undefined, requestFailed: true};
    }
    const details = reader.getStoredFlagDetails();
    const quotaLimited = details?.quotaLimited;
    const requestFailed =
      (details?.requestError !== undefined && details?.requestError !== null) ||
      details?.errorsWhileComputingFlags === true ||
      (Array.isArray(quotaLimited) &&
        quotaLimited.includes(QUOTA_FEATURE_FLAGS));
    const value = client.getFeatureFlag(NONBLOCKING_SPLASH_FLAG_V2);
    return {value, requestFailed};
  } catch {
    return {value: undefined, requestFailed: true};
  }
}

export type BootRiskReason =
  | 'splash_stalled'
  | 'boot_not_completed'
  | 'prev_anr';

export interface PreviousProcessInfo {
  hasPrevious: boolean;
  exitReasonCode: number;
  prevMode: string | null;
  prevReachedReveal: boolean;
  bootRisk: boolean;
  /** The native side set the marker for this ANR. It was not set before. */
  newlyEnrolledByAnr: boolean;
}

export interface BootSplashNative {
  /** false writes the remote off switch; true deletes it (the default is ON). */
  setNonBlockingSplashForNextLaunch(enabled: boolean): void;
  /** 'unavailable' when the native module is absent (iOS). */
  getBootSplashMode(): string;
  setBootRisk(): void;
  getBootRisk(): boolean;
  getPreviousProcessInfo(): Promise<PreviousProcessInfo | null>;
}

export interface ColdStartBootProps {
  prev_exit_reason: ExitReason;
  /** 'unknown' when not known. */
  prev_process_boot_splash_mode: string;
  prev_reached_reveal: boolean;
  prev_process_known: boolean;
}

export interface ResolvedEvent {
  resolution: FlagResolution;
  label: string;
  /**
   * The next launch uses the non-blocking splash, as far as this process
   * knows: the last good response, else the mode this process booted in.
   */
  armsNextLaunch: boolean;
}

export interface BootSplashExperiment {
  /** True when the experiment can run: isAndroid && native mode !== 'unavailable'. */
  readonly active: boolean;
  /**
   * Call ONCE, right after the client is created, before any await.
   * - If active and the device is enrolled, send boot_risk with reload=false.
   * - Then subscribe to flag responses. A good response writes ON or OFF
   *   (nextLaunchAction; a change resets the crash guard). A failed response
   *   writes nothing. Then notify listeners.
   * - If the build flag is off, write false once here and do not subscribe.
   *   onResolved then never fires.
   * - Inactive (iOS): do nothing. A second call does nothing.
   * - Never throws.
   */
  attach(client: FlagClientLike): void;
  /**
   * Listen for flag resolutions in this process. If a resolution already
   * occurred, cb fires at once with the last one. Returns unsubscribe.
   */
  onResolved(cb: (e: ResolvedEvent) => void): () => void;
  /**
   * Enrol the device. Inactive → false. Always sets the native marker
   * (idempotent). Sends boot_risk (reload = default true) once per process
   * when a client is attached. Returns true only when the device was NOT
   * enrolled before this call. The caller sends `boot_risk_enrolled` only then.
   */
  enrol(reason: BootRiskReason): boolean;
  /** Enrolled now (persisted marker or enrolled in this process). Inactive → false. */
  isEnrolled(): boolean;
  /**
   * Inactive → null. Else read the previous-process info with a timeout
   * (default 2000 ms). Timeout, null or throw → all 'unknown' / false props.
   * If the mapped reason is 'anr', also enrol('prev_anr') (this sends the
   * person property). newlyEnrolledByAnr = the native value OR the enrol
   * result. Returns {props, newlyEnrolledByAnr}.
   */
  previousProcess(
    timeoutMs?: number,
  ): Promise<{props: ColdStartBootProps; newlyEnrolledByAnr: boolean} | null>;
}

const UNKNOWN_PREVIOUS_PROCESS: ColdStartBootProps = {
  prev_exit_reason: 'unknown',
  prev_process_boot_splash_mode: 'unknown',
  prev_reached_reveal: false,
  prev_process_known: false,
};

/** Run fn. Return the fallback when fn throws. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function createBootSplashExperiment(deps: {
  native: BootSplashNative;
  isAndroid: boolean;
  /** config/qariahFeatureFlags `nonBlockingSplash` build flag; false = hard-off. */
  buildFlagEnabled: boolean;
}): BootSplashExperiment {
  const {native, isAndroid, buildFlagEnabled} = deps;
  const active =
    isAndroid &&
    safe(() => native.getBootSplashMode(), 'unavailable') !== 'unavailable';

  // The stored value, as far as this process knows. Before a good response it
  // is the mode this process booted in: the native side read the same marker.
  const bootMode = safe(() => native.getBootSplashMode(), 'unavailable');
  let nextLaunchOn = bootMode === 'treatment' || bootMode === 'fallback';

  let client: FlagClientLike | null = null;
  let enrolledThisProcess = false;
  let personPropSent = false;
  let lastEvent: ResolvedEvent | null = null;
  const listeners = new Set<(e: ResolvedEvent) => void>();

  const markerSet = (): boolean => safe(() => native.getBootRisk(), false);

  const notify = (e: ResolvedEvent): void => {
    for (const cb of Array.from(listeners)) {
      try {
        cb(e);
      } catch {
        /* a bad listener must not stop the others */
      }
    }
  };

  const handleResponse = (c: FlagClientLike): void => {
    const resolution = readFlagResolution(c);
    const action = nextLaunchAction(resolution);
    // A failed request says nothing about the flag: keep the stored value.
    if (action !== 'keep') {
      try {
        native.setNonBlockingSplashForNextLaunch(action === 'on');
        nextLaunchOn = action === 'on';
      } catch {
        /* the stored value stays as it was */
      }
    }
    lastEvent = {
      resolution,
      label: resolutionLabel(resolution),
      armsNextLaunch: nextLaunchOn,
    };
    notify(lastEvent);
  };

  const attach = (c: FlagClientLike): void => {
    if (!active || client) return;
    client = c;
    try {
      // Send boot_risk before the first flag request. Reload is false: the
      // first request goes out later and carries the property.
      if (markerSet() || enrolledThisProcess) {
        try {
          c.setPersonPropertiesForFlags({[BOOT_RISK_PROPERTY]: 'true'}, false);
          // The first flag request carries the property. Do not send again.
          personPropSent = true;
        } catch {
          /* the next start tries again */
        }
      }
      // The build flag is the hard-off. Write OFF once and do not listen.
      // (The first launch of such a build can still use the non-blocking
      // splash: the native side reads the marker before JS runs.)
      if (!buildFlagEnabled) {
        try {
          native.setNonBlockingSplashForNextLaunch(false);
          nextLaunchOn = false;
        } catch {
          /* the stored value stays as it was */
        }
        return;
      }
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      c.onFeatureFlags(() => {
        if (watchdog !== undefined) {
          clearTimeout(watchdog);
          watchdog = undefined;
        }
        try {
          handleResponse(c);
        } catch {
          /* never throw into the PostHog event emitter */
        }
      });
      // One extra flag request when no response arrives in time (offline).
      watchdog = setTimeout(() => {
        watchdog = undefined;
        if (lastEvent) return;
        try {
          c.reloadFeatureFlags?.();
        } catch {
          /* the marker keeps its value; the next start tries again */
        }
      }, FLAG_RESPONSE_WATCHDOG_MS);
    } catch {
      /* never throw into the app */
    }
  };

  const onResolved = (cb: (e: ResolvedEvent) => void): (() => void) => {
    listeners.add(cb);
    if (lastEvent) {
      try {
        cb(lastEvent);
      } catch {
        /* ignore */
      }
    }
    return () => {
      listeners.delete(cb);
    };
  };

  const enrol = (_reason: BootRiskReason): boolean => {
    if (!active) return false;
    const wasEnrolled = enrolledThisProcess || markerSet();
    try {
      native.setBootRisk();
    } catch {
      /* the in-process state still counts */
    }
    enrolledThisProcess = true;
    if (client && !personPropSent) {
      try {
        client.setPersonPropertiesForFlags({[BOOT_RISK_PROPERTY]: 'true'});
        personPropSent = true;
      } catch {
        /* the next start sends it again from the marker */
      }
    }
    return !wasEnrolled;
  };

  const isEnrolled = (): boolean => {
    if (!active) return false;
    return enrolledThisProcess || markerSet();
  };

  const previousProcess = async (
    timeoutMs: number = DEFAULT_PREVIOUS_PROCESS_TIMEOUT_MS,
  ): Promise<{
    props: ColdStartBootProps;
    newlyEnrolledByAnr: boolean;
  } | null> => {
    if (!active) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let info: PreviousProcessInfo | null = null;
    try {
      const timeout = new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      });
      info = await Promise.race([native.getPreviousProcessInfo(), timeout]);
    } catch {
      info = null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (!info) {
      return {props: {...UNKNOWN_PREVIOUS_PROCESS}, newlyEnrolledByAnr: false};
    }
    const props: ColdStartBootProps = {
      prev_exit_reason: mapExitReason(info.exitReasonCode),
      prev_process_boot_splash_mode: info.prevMode ?? 'unknown',
      prev_reached_reveal: info.prevReachedReveal === true,
      prev_process_known: info.hasPrevious === true,
    };
    let newlyEnrolledByAnr = false;
    if (props.prev_exit_reason === 'anr') {
      // Call enrol first, so that the person property is always sent.
      const enrolledNow = enrol('prev_anr');
      newlyEnrolledByAnr = info.newlyEnrolledByAnr === true || enrolledNow;
    }
    return {props, newlyEnrolledByAnr};
  };

  return {
    active,
    attach,
    onResolved,
    enrol,
    isEnrolled,
    previousProcess,
  };
}
