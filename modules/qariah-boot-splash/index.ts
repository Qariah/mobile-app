// Qariah (ANR WS-C, hypothesis H1) — non-blocking boot splash, JS surface.
//
// Android-only native module. On iOS, on web and in jest the native module is
// absent, so every function is a no-op (dismiss, setEnabledForNextLaunch) or
// returns 'unavailable' (getBootSplashMode). No function ever throws into the
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

interface NativeShape {
  dismiss(): void;
  setEnabledForNextLaunch(enabled: boolean): void;
  getMode(): string;
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

/** The boot-splash mode this process uses, for telemetry. */
export function getBootSplashMode(): BootSplashMode {
  try {
    const mode = native?.getMode();
    return (mode as BootSplashMode | undefined) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}
