import 'expo-router/entry';
import {AppRegistry} from 'react-native';
import {
  CAR_KEEP_ALIVE_TASK,
  CAR_ROOT_COMPONENT,
  CarRoot,
  carKeepAliveTask,
} from './services/car/CarRoot';
// Qariah (Sprint 48, S48.6): loads with the other imports; the call is below.
import {defineQariahCatalogTask} from './services/notifications/backgroundTask';

// Android Auto starts this headless root when the phone app is not open, and
// runs the keep-alive task while connected so JS timers keep running.
AppRegistry.registerComponent(CAR_ROOT_COMPONENT, () => CarRoot);
AppRegistry.registerHeadlessTask(CAR_KEEP_ALIVE_TASK, () => carKeepAliveTask);

// Qariah (Sprint 48, S48.6): the background catalog check of the local
// notifications. The OS can start the app only to run this task (an Android
// headless start, an iOS background launch), so the call below defines the
// task at module scope, before the app runs, and not in a component or the
// boot. services/qariahBoot.ts registers it after the boot.
defineQariahCatalogTask();
