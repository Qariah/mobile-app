import {registerWebModule, NativeModule} from 'expo';

class QariahAnrWatchdogModule extends NativeModule<{}> {}

export default registerWebModule(
  QariahAnrWatchdogModule,
  'QariahAnrWatchdogModule',
);
