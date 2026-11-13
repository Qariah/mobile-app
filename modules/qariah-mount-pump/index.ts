// @ai Qariah (ANR floor work, class B) — the mount pump, JS surface.
//
// Android-only native module. While the app is in the background, it applies
// the UI changes that React Native queues, about once a second, so the return
// to the app never has a large queue to apply in one frame. Mechanism:
// android/.../QariahMountPumpModule.kt.
//
// On iOS, on web and in jest the native module is absent: the setter is a
// no-op and the state is 'unavailable'. No function ever throws into the app.

import {requireOptionalNativeModule} from 'expo';

export type MountPumpState = 'on' | 'off' | 'unavailable';

/** The first frame after a return to the app took 700 ms or more. */
export interface ReturnFrameEvent {
  /** From the host resume to the end of the first frame, in ms. */
  frameMs: number;
  /** How long the app was in the background, in seconds. */
  backgroundSeconds: number;
  /** The pump state at the resume. */
  pump: string;
}

interface NativeShape {
  setEnabled(enabled: boolean): void;
  getState(): string;
  getFlushCount?(): number;
  addListener?(
    event: 'onReturnFrame',
    cb: (event: ReturnFrameEvent) => void,
  ): {remove(): void};
}

const noop = (): void => undefined;

let native: NativeShape | null = null;
try {
  native = requireOptionalNativeModule<NativeShape>('QariahMountPump');
} catch {
  native = null;
}

/** Turn the pump on or off. It applies at once. */
export function setMountPumpEnabled(enabled: boolean): void {
  try {
    native?.setEnabled(enabled);
  } catch {
    /* the pump keeps its state */
  }
}

/**
 * 'on' or 'off' as the last setMountPumpEnabled call asked; 'unavailable' when
 * the native module is absent (iOS) or it could not find the React Native
 * mount dispatcher (after a React Native upgrade: the app behaves as before).
 */
export function getMountPumpState(): MountPumpState {
  try {
    const state = native?.getState();
    return state === 'on' || state === 'off' ? state : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** How many times the pump applied the queue in this process (lab use). */
export function getMountPumpFlushCount(): number {
  try {
    return native?.getFlushCount?.() ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Listen for a slow first frame after a return to the app (telemetry only).
 * Returns a function that removes the listener; a no-op where the native
 * module is absent.
 */
export function addReturnFrameListener(
  cb: (event: ReturnFrameEvent) => void,
): () => void {
  try {
    const sub = native?.addListener?.('onReturnFrame', cb);
    return () => {
      try {
        sub?.remove();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return noop;
  }
}
