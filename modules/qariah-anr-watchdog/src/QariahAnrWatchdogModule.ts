import {NativeModule, requireNativeModule} from 'expo';

import type {QariahAnrWatchdogModuleEvents} from './QariahAnrWatchdog.types';

declare class QariahAnrWatchdogModule extends NativeModule<QariahAnrWatchdogModuleEvents> {
  setEnabled(enabled: boolean, intervalMs: number, thresholdMs: number): void;
}

export default requireNativeModule<QariahAnrWatchdogModule>(
  'QariahAnrWatchdog',
);
