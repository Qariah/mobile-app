// @ai Qariah (ANR floor work, class B) — the switch of the mount pump.
//
// The pump (modules/qariah-mount-pump, Android only) applies the UI changes
// that React Native queues while the app is in the background. Without it,
// the return to the app applies the whole queue in one frame, and a long
// listen in the background then freezes the return, up to an ANR.
// planning/android-anr-floor-rca-2026-11-11.md, section 3, class B.
//
// The pump is OFF by default (2026-11-12). The lab result is mixed: on a
// Galaxy A10s it removed the queue from the return frame after 25 minutes
// (1,330 ms to 669 ms), and after 60 minutes the two return frames were the
// same (1,771 ms and 1,815 ms). So the field must show its value first:
//   - the PostHog flag `background_mount_pump` turns it ON (true, 'on',
//     'treatment') or OFF (false, 'off', 'control') at once, in both
//     directions; a 50% flag is the experiment;
//   - the event `app_return_slow` carries `mount_pump`, so the two arms
//     compare;
//   - the build flag `backgroundMountPump` (config/qariahFeatureFlags.ts) is
//     the hard-off.
// A lab build can force it: `EXPO_PUBLIC_QARIAH_LAB_MOUNT_PUMP=on` (or `off`)
// in the environment of `scripts/android-archive.sh --lab`. A store build
// never sets it.

import * as Sentry from '@sentry/react-native';
import {
  addReturnFrameListener,
  getMountPumpState,
  setMountPumpEnabled,
  type MountPumpState,
  type ReturnFrameEvent,
} from '@/modules/qariah-mount-pump';
import {isQariahFeatureEnabled} from '@/config/qariahFeatureFlags';
import {qariahAnalytics} from '@/services/analytics/qariahEvents';

/** The PostHog flag of the pump (a boolean, or the variants below). */
export const MOUNT_PUMP_FLAG = 'background_mount_pump';

/**
 * What the pump does when the flag is missing or not loaded yet. OFF: see
 * the header for the lab result that decided it.
 */
export const MOUNT_PUMP_DEFAULT_ON = false;

/** The lab override from the build environment: true, false, or none. */
export function labMountPumpOverride(
  value: string | undefined = process.env.EXPO_PUBLIC_QARIAH_LAB_MOUNT_PUMP,
): boolean | undefined {
  if (value === 'on') return true;
  if (value === 'off') return false;
  return undefined;
}

/**
 * The build flag is the hard-off. Then the remote flag decides: true, 'on' or
 * 'treatment' is ON; false, 'off' or 'control' is OFF; any other value
 * (missing, not loaded yet) is the default.
 */
export function mountPumpWanted(
  buildFlagEnabled: boolean,
  remote: string | boolean | undefined,
  defaultOn: boolean = MOUNT_PUMP_DEFAULT_ON,
): boolean {
  if (!buildFlagEnabled) return false;
  if (remote === true || remote === 'on' || remote === 'treatment') return true;
  if (remote === false || remote === 'off' || remote === 'control') {
    return false;
  }
  return defaultOn;
}

/** Apply the switches to the native pump. Never throws. */
export function applyMountPump(remote: string | boolean | undefined): void {
  try {
    const buildFlag = isQariahFeatureEnabled('backgroundMountPump');
    const lab = labMountPumpOverride();
    setMountPumpEnabled(
      lab === undefined ? mountPumpWanted(buildFlag, remote) : buildFlag && lab,
    );
  } catch {
    /* the pump keeps its state */
  }
}

/** 'on' | 'off' | 'unavailable', for telemetry. Never throws. */
export function mountPumpState(): MountPumpState {
  return getMountPumpState();
}

/** A return frame of this length or more sends `app_return_slow`. */
export const RETURN_SLOW_MS = 1500;

/**
 * Report one return frame (the native side sends it from 700 ms). Every one
 * leaves a Sentry breadcrumb, so an ANR event shows the returns before it. A
 * frame of RETURN_SLOW_MS or more also sends the PostHog event
 * `app_return_slow`. Never throws.
 */
export function reportReturnFrame(e: ReturnFrameEvent): void {
  try {
    const frameMs = Math.round(Number(e.frameMs));
    const backgroundS = Math.round(Number(e.backgroundSeconds));
    if (!Number.isFinite(frameMs) || frameMs < 0) return;
    Sentry.addBreadcrumb({
      category: 'diag.return-frame',
      level: frameMs >= RETURN_SLOW_MS ? 'warning' : 'info',
      message: `first frame after return ${frameMs} ms`,
      data: {
        frame_ms: frameMs,
        background_s: Number.isFinite(backgroundS) ? backgroundS : -1,
        mount_pump: String(e.pump),
      },
    });
    if (frameMs < RETURN_SLOW_MS) return;
    qariahAnalytics.trackAppReturnSlow({
      frame_ms: frameMs,
      background_s: Number.isFinite(backgroundS) ? backgroundS : -1,
      mount_pump: String(e.pump),
    });
  } catch {
    /* telemetry only */
  }
}

/** Start the return-frame report. Returns the function that stops it. */
export function startReturnFrameReport(): () => void {
  return addReturnFrameListener(reportReturnFrame);
}
