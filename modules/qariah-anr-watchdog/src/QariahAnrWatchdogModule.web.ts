import {registerWebModule, NativeModule} from 'expo';

class QariahAnrWatchdogModule extends NativeModule<Record<never, never>> {}

export default registerWebModule(
  QariahAnrWatchdogModule,
  'QariahAnrWatchdogModule',
);
