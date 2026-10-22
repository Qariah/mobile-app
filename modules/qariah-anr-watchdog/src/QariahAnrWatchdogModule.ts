import {NativeModule, requireOptionalNativeModule} from 'expo';

import type {QariahAnrWatchdogModuleEvents} from './QariahAnrWatchdog.types';

declare class QariahAnrWatchdogModule extends NativeModule<QariahAnrWatchdogModuleEvents> {
  setEnabled(enabled: boolean, intervalMs: number, thresholdMs: number): void;
}

// @ai Qariah (TECH_DEBT #153): the module links on Android only
// (expo-module.config.json), so iOS gets null here, and index.ts no-ops.
export default requireOptionalNativeModule<QariahAnrWatchdogModule>(
  'QariahAnrWatchdog',
);
