// @ai Qariah (Lite mode, step 1c) — boot timing marks for lab builds.
//
// A lab build sets EXPO_PUBLIC_BOOT_MARKS=1; in every other build each call
// returns at once. A mark is one logcat line "[BOOT] <name>", logged once per
// process; the logcat timestamp of the line is its time. The marks split the
// cold start into phases on a real phone (planning/lite-mode-design.md).
const ENABLED = process.env.EXPO_PUBLIC_BOOT_MARKS === '1';
const seen = new Set<string>();

export function bootMark(name: string): void {
  if (!ENABLED || seen.has(name)) return;
  seen.add(name);
  console.log(`[BOOT] ${name}`);
}

// This module is the first one that entry.ts loads.
bootMark('js-start');
