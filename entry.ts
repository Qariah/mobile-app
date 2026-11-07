import 'expo-router/entry';
import {AppRegistry} from 'react-native';
import {
  CAR_KEEP_ALIVE_TASK,
  CAR_ROOT_COMPONENT,
  CarRoot,
  carKeepAliveTask,
} from './services/car/CarRoot';
// Qariah: the call is below.
import {defineQariahCatalogTask} from './services/notifications/backgroundTask';

// Android Auto starts this headless root when the phone app is not open, and
// runs the keep-alive task while connected so JS timers keep running.
AppRegistry.registerComponent(CAR_ROOT_COMPONENT, () => CarRoot);
AppRegistry.registerHeadlessTask(CAR_KEEP_ALIVE_TASK, () => carKeepAliveTask);

// Qariah: define the notification catalog task at module scope; the OS can start the app only to run it.
defineQariahCatalogTask();
