// @ai Qariah (Lite mode, step 1) — one switch that simplifies the app on
// low-end phones and keeps the core: listening (with downloads) and reading.
// Design: planning/lite-mode-design.md.
//
// The mode is read ONCE per process and does not change until the next
// launch. Components switch on it during render (the indicator, the cards,
// the player), so a change in the middle of a session could change a
// component's hooks; a change in Settings therefore applies at the next launch.
//
// Auto (the default) turns Lite on for an Android phone with less than 3 GB
// of RAM (the `ram_tier: low` line of services/diagnostics/diagnostics.ts) or
// with no 64-bit ABI. The owner of the phone can force it on or off in
// Settings → Lite mode.
import {Platform} from 'react-native';
import * as Device from 'expo-device';
import {createMMKV, type MMKV} from 'react-native-mmkv';

export type LiteModeSetting = 'auto' | 'on' | 'off';

const SETTING_KEY = 'lite:setting';
const LOW_RAM_BYTES = 3 * 1024 * 1024 * 1024;

export interface DeviceTierInfo {
  os: string;
  /** Total RAM in bytes; null when the platform does not report it. */
  totalMemory: number | null;
  /** Supported ABIs, e.g. ['armeabi-v7a', 'armeabi']; null when unknown. */
  abis: readonly string[] | null;
}

/** True for the phones that Lite mode is for. Android only in step 1. */
export function isLowEndDevice(info: DeviceTierInfo): boolean {
  if (info.os !== 'android') return false;
  if (typeof info.totalMemory === 'number' && info.totalMemory > 0) {
    if (info.totalMemory < LOW_RAM_BYTES) return true;
  }
  if (info.abis && info.abis.length > 0) {
    if (!info.abis.some(abi => abi.includes('64'))) return true;
  }
  return false;
}

/** The device facts, read at most once. */
function readDeviceTier(): DeviceTierInfo {
  return {
    os: Platform.OS,
    totalMemory: Device.totalMemory ?? null,
    abis: Device.supportedCpuArchitectures ?? null,
  };
}

// MMKV opens lazily and never throws into the boot path (a module-level
// createMMKV once crashed boot on the iOS Simulator; services/diagnostics/
// bootSentinel.ts). Without a store the setting reads as 'auto'.
let store: MMKV | null | undefined;
function settingsStore(): MMKV | null {
  if (store !== undefined) return store;
  try {
    store = createMMKV({id: 'qariah-lite'});
  } catch {
    store = null;
  }
  return store;
}

function isSetting(value: unknown): value is LiteModeSetting {
  return value === 'auto' || value === 'on' || value === 'off';
}

/**
 * RAM in the whole GB a phone is sold with, or null when unknown. A phone
 * reports less than its nominal size (a 4 GB phone reports about 3.6 GiB), so
 * this rounds up. Field data uses it to size each RAM group.
 */
export function ramGbFromBytes(bytes: number | null): number | null {
  if (typeof bytes !== 'number' || bytes <= 0) return null;
  return Math.ceil(bytes / (1024 * 1024 * 1024));
}

/** This phone's RAM in GB; see ramGbFromBytes. */
export function deviceRamGb(): number | null {
  try {
    return ramGbFromBytes(readDeviceTier().totalMemory);
  } catch {
    return null;
  }
}

/** The saved choice (Settings → Lite mode); 'auto' when none is saved. */
export function getLiteModeSetting(): LiteModeSetting {
  try {
    const value = settingsStore()?.getString(SETTING_KEY);
    return isSetting(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

/** Saves the choice. It applies at the next launch. */
export function setLiteModeSetting(setting: LiteModeSetting): void {
  try {
    settingsStore()?.set(SETTING_KEY, setting);
  } catch {
    // A failed write keeps the old choice; Settings shows the saved value.
  }
}

/** The mode for a setting and a device. */
export function resolveLiteMode(
  setting: LiteModeSetting,
  device: DeviceTierInfo,
): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return isLowEndDevice(device);
}

let resolved: boolean | null = null;

/** True when this process runs in Lite mode. Fixed for the process. */
export function isLiteMode(): boolean {
  if (resolved === null) {
    try {
      resolved = resolveLiteMode(getLiteModeSetting(), readDeviceTier());
    } catch {
      resolved = false;
    }
  }
  return resolved;
}

/** True when this device turns Lite on by itself (for the Settings label). */
export function isLiteModeAutoOn(): boolean {
  try {
    return isLowEndDevice(readDeviceTier());
  } catch {
    return false;
  }
}

/**
 * The step 1c start-up option (planning/lite-mode-design.md, section 7b): in
 * Lite mode Listen draws its first rows before the splash hides. A lab build
 * can turn it off to measure it: EXPO_PUBLIC_LITE_LAB_OFF="firstScreen". The
 * other step 1c option, singlePassReveal, applies to every phone since
 * 2026-10-29 (app/_layout.tsx); the action sheets after the splash saved
 * 0.08 s and were dropped.
 */
export type LiteOption = 'firstScreen';

const LAB_OFF: ReadonlySet<string> = new Set(
  String(process.env.EXPO_PUBLIC_LITE_LAB_OFF ?? '')
    .split(',')
    .map((option: string) => option.trim())
    .filter(Boolean),
);

export function isLiteOption(option: LiteOption): boolean {
  return isLiteMode() && !LAB_OFF.has(option);
}

/** Tests only: forget the resolved mode. */
export function resetLiteModeForTests(): void {
  resolved = null;
  store = undefined;
}

/**
 * expo-image props for Lite mode: no cross-fade per image, and 16-bit colour
 * on Android (half the bitmap memory and GPU upload of each photo).
 */
export function liteImageProps(): {
  transition?: number;
  decodeFormat?: 'rgb';
} {
  return isLiteMode() ? {transition: 0, decodeFormat: 'rgb'} : {};
}

const SHADOW_KEYS = [
  'elevation',
  'shadowColor',
  'shadowOffset',
  'shadowOpacity',
  'shadowRadius',
] as const;

/** The style without its shadow in Lite mode; unchanged otherwise. */
export function withoutShadowInLite<T extends object>(style: T): T {
  if (!isLiteMode()) return style;
  const flat: Record<string, unknown> = {...(style as Record<string, unknown>)};
  for (const key of SHADOW_KEYS) delete flat[key];
  return flat as T;
}
