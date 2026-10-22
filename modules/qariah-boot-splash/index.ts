// Qariah (ANR WS-C, hypothesis H1) — non-blocking boot splash, JS surface.
//
// Android-only native module. On iOS, on web and in jest the native module is
// absent, so every function is a no-op (dismiss, setEnabledForNextLaunch,
// setBootRisk) or returns 'unavailable' (getBootSplashMode), false
// (getBootRisk) or null (getPreviousProcessInfo). No function ever throws into the
// app. Mechanism and flag: android/.../QariahBootSplash.kt.

import {requireOptionalNativeModule} from 'expo';

export type BootSplashMode =
  | 'control'
  | 'treatment'
  | 'fallback'
  | 'lab-control'
  | 'lab-treatment'
  | 'lab-treatment-c1b'
  | 'unavailable';

export interface PreviousProcessInfo {
  /** A previous main-activity process was recorded. */
  hasPrevious: boolean;
  /** ApplicationExitInfo.REASON_* of that process; -1 no exit record, -2 API < 30, -3 no previous process. */
  exitReasonCode: number;
  /** Boot-splash mode that process booted with. */
  prevMode: string | null;
  /** That process hid the splash (dismiss ran). */
  prevReachedReveal: boolean;
  /** This start enrolled the device because that process ended with an ANR. */
  newlyEnrolledByAnr: boolean;
  /** The boot-risk marker is set now. */
  bootRisk: boolean;
}

interface NativeShape {
  dismiss(): void;
  setEnabledForNextLaunch(enabled: boolean): void;
  getMode(): string;
  setOffForNextLaunchKeepGuard?(): void;
  setBootRisk?(): void;
  getBootRisk?(): boolean;
  getPreviousProcessInfo?(): Promise<PreviousProcessInfo | null>;
}

let native: NativeShape | null = null;
try {
  native = requireOptionalNativeModule<NativeShape>('QariahBootSplash');
} catch {
  native = null;
}

/** Remove the native boot overlay. Call it wherever the splash hides. */
export function dismissBootOverlay(): void {
  try {
    native?.dismiss();
  } catch {
    /* never throw into the boot path */
  }
}

/** Store the remote flag value. It applies at the NEXT cold start. */
export function setNonBlockingSplashForNextLaunch(enabled: boolean): void {
  try {
    native?.setEnabledForNextLaunch(enabled);
  } catch {
    /* fail closed: the stored value stays as it was */
  }
}

/**
 * A transient OFF for the NEXT launch (a failed or quota-limited flag request).
 * It deletes only the flag marker; the crash-guard count and the fallback stay.
 */
export function setNonBlockingSplashOffKeepGuard(): void {
  try {
    native?.setOffForNextLaunchKeepGuard?.();
  } catch {
    /* fail closed: the stored value stays as it was */
  }
}

/** The boot-splash mode this process uses, for telemetry. */
export function getBootSplashMode(): BootSplashMode {
  try {
    const mode = native?.getMode();
    return (mode as BootSplashMode | undefined) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// @ai Boot-risk enrolment and previous-process telemetry (ANR hotfix v2).

/** Mark this device as a boot risk. The marker is permanent for the install. */
export function setBootRisk(): void {
  try {
    native?.setBootRisk?.();
  } catch {
    /* never throw into the boot path */
  }
}

/** True when the boot-risk marker is set. False when the module is absent. */
export function getBootRisk(): boolean {
  try {
    return native?.getBootRisk?.() === true;
  } catch {
    return false;
  }
}

/**
 * The record of the previous main-activity process. Null when the native module
 * is absent, on error, or when this process never created MainActivity.
 */
export function getPreviousProcessInfo(): Promise<PreviousProcessInfo | null> {
  try {
    const fn = native?.getPreviousProcessInfo;
    if (!native || !fn) return Promise.resolve(null);
    return Promise.resolve(fn.call(native))
      .then(info => info ?? null)
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}
