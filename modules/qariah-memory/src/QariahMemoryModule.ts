import {NativeModule, requireNativeModule} from 'expo';

import type {HeapStats, QariahMemoryModuleEvents} from './QariahMemory.types';

declare class QariahMemoryModule extends NativeModule<QariahMemoryModuleEvents> {
  /** Activate/deactivate the probe. Inert (no events, no reads) until true. */
  setEnabled(enabled: boolean): void;
  /** On-demand heap snapshot. {} on iOS/web. */
  getHeapStats(): HeapStats;
}

export default requireNativeModule<QariahMemoryModule>('QariahMemory');
