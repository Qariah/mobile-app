// @ai
// services/diagnostics/analyticsStore.ts
// --------------------------------------
// One lazy, guarded handle on the 'analytics' MMKV store for the diagnostics
// modules (divergence batch C3, SEM-S9, TECH_DEBT #247). Before, five modules
// (bootSentinel, playbackSentinel, deviceDailyBudget, mainThreadStallCount,
// memoryWatch) each had their own copy of this function.
//
// - Lazy: the first call opens the store, not the module load. MMKV native
//   init throws on the iOS Simulator (no app-group container), and these
//   modules run on the boot, audio and memory-pressure paths, which must
//   never throw.
// - A lazy `require`: many Jest suites import diagnostics modules, and
//   react-native-mmkv cannot load in Jest without a mock.
// - A failed open is cached: `null` means "cannot persist", and each caller
//   then fails closed (no-op, or no emit). It is not tried again in this
//   process.
// - Each caller keeps its own key prefix, so one module cannot change the
//   keys of another.

import type {MMKV} from 'react-native-mmkv';

let _mmkv: MMKV | null | undefined; // undefined = not tried; null = failed

export function analyticsStore(): MMKV | null {
  if (_mmkv !== undefined) return _mmkv;
  try {
    const {createMMKV} =
      require('react-native-mmkv') as typeof import('react-native-mmkv');
    _mmkv = createMMKV({id: 'analytics'});
  } catch {
    _mmkv = null; // never retried; never throws into the caller
  }
  return _mmkv;
}

/** Test seam — drops the memoised handle so a fresh mock is picked up. */
export function __resetAnalyticsStoreForTests(): void {
  _mmkv = undefined;
}
