// @ai
// Anonymous debug ID — one string that finds a user's telemetry in BOTH
// Sentry and PostHog.
//
// WHY THIS EXISTS: a user who reports a bug cannot tell us which Sentry event
// or which PostHog session is theirs. This module surfaces the identifiers the
// app ALREADY has, so the user can hand us one string.
//
// IT CREATES NO NEW IDENTITY. The value is the anonymous device UUID from
// `services/analytics/deviceId.ts` (an `expo-crypto` random UUID kept in
// MMKV). PostHog already uses that UUID as the distinct id, and
// `app/_layout.tsx` sets it as a Sentry tag, so the same string addresses both
// tools.
//
// PRIVACY CONTRACT — do not weaken it:
//  - The debug ID is the anonymous device UUID and nothing else.
//  - Never add the QF OAuth subject (`sub`), an email, a `sha256(email)`, or
//    any value derived from one. A `sha256(email)` is the lookup key into a
//    PUBLIC R2 bucket, so it is treated as personal data in this project.
//  - Never log the debug ID outside `__DEV__`.

import {Platform} from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import {getOrCreateDeviceId} from '@/services/analytics/deviceId';

/**
 * Shown when a value is missing. Never blank, so a paste stays readable.
 * Callers compare against this to detect an unusable debug ID.
 */
export const DEBUG_ID_UNKNOWN = 'unknown';

/** The heading that separates the block from the user's own message. */
export const DEBUG_INFO_HEADING =
  '--- Diagnostic info (helps us investigate) ---';

type VersionInfo = {semanticVersion: string; buildNumber: string | number};

/**
 * Narrows the `any`-typed `expoConfig.extra.version` without an `as` cast.
 * `scripts/generate-version.js` writes that field at build time, and
 * `scripts/verify-version-sync.js` enforces it across the native files. It is
 * the same source `Sentry.init` reads for `release` / `dist`, so the version in
 * a support email always matches the version on the crash.
 */
export function isVersionInfo(value: unknown): value is VersionInfo {
  if (value == null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.semanticVersion === 'string' &&
    (typeof v.buildNumber === 'string' || typeof v.buildNumber === 'number')
  );
}

/** Reads the build-time version info, or `undefined` if the manifest lacks it. */
export function readVersionInfo(): VersionInfo | undefined {
  const raw: unknown = Constants.expoConfig?.extra?.version;
  return isVersionInfo(raw) ? raw : undefined;
}

/**
 * The debug ID a user copies and we search on.
 *
 * The value is the RAW device UUID. It carries no prefix and no decoration,
 * because support pastes it straight into the Sentry issue search
 * (`debug_id:<value>`) and into the PostHog person search, and both need an
 * exact match.
 *
 * Never throws. MMKV can fail on some hosts (a missing iOS App-Group
 * container), and a diagnostics helper must not break a settings screen or the
 * Sentry setup.
 */
export function getDebugId(): string {
  try {
    return getOrCreateDeviceId();
  } catch {
    return DEBUG_ID_UNKNOWN;
  }
}

/**
 * The multi-line block for an email body or the clipboard.
 *
 * It holds the debug ID plus the few fields that make a support ticket
 * actionable: app version, build number, platform and OS version. The user
 * always sees this text before they send it.
 */
export function getDebugIdBlock(): string {
  const version = readVersionInfo();
  const app =
    version != null
      ? `${version.semanticVersion} (${version.buildNumber})`
      : DEBUG_ID_UNKNOWN;
  const osName = Device.osName ?? Platform.OS;
  const osVersion = Device.osVersion ?? DEBUG_ID_UNKNOWN;
  // The device model carries no personal data and is the single most
  // actionable field in a support report. Every playback investigation in this
  // project turned on it: the Redmi Note 9 JS-thread freeze, the Pixel 3
  // reciter-profile hang, and the iPhone 12 memory kill were each identified by
  // model before any code was read.
  const model = Device.modelName ?? DEBUG_ID_UNKNOWN;
  return [
    DEBUG_INFO_HEADING,
    `Debug ID: ${getDebugId()}`,
    `App: ${app}`,
    `Platform: ${osName} ${osVersion}`,
    `Device: ${model}`,
  ].join('\n');
}
