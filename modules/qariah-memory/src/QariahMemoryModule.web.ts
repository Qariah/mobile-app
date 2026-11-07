import {registerWebModule, NativeModule} from 'expo';

import type {HeapStats, QariahMemoryModuleEvents} from './QariahMemory.types';

// Web no-op — the probe targets the Android Java-heap OOM.
class QariahMemoryModule extends NativeModule<QariahMemoryModuleEvents> {
  setEnabled(_enabled: boolean): void {
    // The web build has no probe to switch on or off.
  }
  getHeapStats(): HeapStats {
    return {};
  }
}

export default registerWebModule(QariahMemoryModule, 'QariahMemoryModule');
