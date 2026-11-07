// @ai-generated
// Qariah (Sprint 48, S48.6): the background catalog check and its boot hooks.
//
// - `defineQariahCatalogTask()`: `entry.ts` calls it at module scope. The OS
//   can start the app only to run the task (an Android headless start, an iOS
//   background launch), so the definition must exist before the app registers
//   its root component.
// - `registerQariahCatalogTask()`: registers the task with
//   `expo-background-task` (iOS BGTaskScheduler, Android WorkManager), at
//   least 12 hours between two runs, only when notifications are allowed and
//   the user is not in the holdout. It runs at each boot, so a permission that
//   the user takes back unregisters the task at the next boot.
// - `startQariahNotifications()`: `qariahAfterCatalogReady()` calls it. It
//   returns at once; the work runs later (see the function).
// - `onNotificationsHoldoutAssigned()`: the holdout enrollment calls it when
//   this start wrote the arm.
//
// This module is on the cold-start path (`entry.ts`, `services/qariahBoot.ts`),
// so its only native import is `expo-task-manager` (`defineTask` needs it).
// The task body (`catalogTask.ts`), `expo-background-task` and
// `expo-notifications` are required on first use.
import * as TaskManager from 'expo-task-manager';
import type * as ExpoBackgroundTask from 'expo-background-task';
import {RECITERS, type Reciter} from '@/data/reciterData';
import {
  isLiveCatalogInMemory,
  subscribeLiveCatalogLoaded,
} from '@/services/liveCatalogSignal';
import type {CatalogTaskResult, CatalogTaskSource} from './catalogTask';
import {createCatalogSnapshotStore} from './catalogDiff';
import {isNotificationsHoldout} from './holdout';
import type {NotificationCandidate} from './types';

/** The task name (`TaskManager`). The iOS BGTask identifier is the module's own. */
export const QARIAH_CATALOG_TASK = 'qariah-catalog-check';

/** At least 12 hours between two runs (minutes; the OS can wait longer). */
export const CATALOG_TASK_MINIMUM_INTERVAL_MINUTES = 12 * 60;

/** The registration and the notification handler wait this long after the boot step. */
export const NOTIFICATIONS_START_DELAY_MS = 5_000;

/**
 * The foreground check waits this long for a network catalog after the boot.
 * Without one in this time (offline), it does not run: the background task
 * checks later.
 */
export const FOREGROUND_CATALOG_WAIT_MS = 2 * 60_000;

type BackgroundTaskModule = typeof ExpoBackgroundTask;

function backgroundTaskModule(): BackgroundTaskModule {
  return require('expo-background-task') as BackgroundTaskModule;
}

function catalogTaskModule(): typeof import('./catalogTask') {
  return require('./catalogTask') as typeof import('./catalogTask');
}

function expoNotifierModule(): typeof import('./expoNotifier') {
  return require('./expoNotifier') as typeof import('./expoNotifier');
}

function devWarn(message: string, error: unknown): void {
  if (__DEV__) console.warn(`[notifications] ${message}`, error);
}

/** Runs the body for one source. Never throws. */
async function runCatalogTask(
  source: CatalogTaskSource,
  catalog?: readonly Reciter[],
  extraCandidates?: readonly NotificationCandidate[],
): Promise<CatalogTaskResult | null> {
  try {
    const {runQariahCatalogTask} = catalogTaskModule();
    return await runQariahCatalogTask(source, {
      ...(catalog ? {catalog} : {}),
      ...(extraCandidates && extraCandidates.length > 0
        ? {extraCandidates: () => extraCandidates}
        : {}),
    });
  } catch (error) {
    devWarn(`the ${source} catalog check failed`, error);
    return null;
  }
}

function announcementStoreModule(): typeof import('./announcementStore') {
  return require('./announcementStore') as typeof import('./announcementStore');
}

/**
 * The background run (S48.6 and S48.8): the `whats_new` notice of this
 * build's announcement goes to the check as one more candidate (only when
 * its switch is on, so a user who turned it off does not download the
 * catalog on each run for nothing); when the check posts it, the id is
 * recorded, so it posts once. The foreground check never gets it: a user who
 * opens the app sees the update pages. Never throws.
 */
async function runBackgroundCheck(): Promise<void> {
  let announcement: NotificationCandidate | null = null;
  try {
    const {getHydratedNotificationPrefs} =
      require('./prefsStore') as typeof import('./prefsStore');
    const prefs = await getHydratedNotificationPrefs();
    if (prefs?.whats_new === true) {
      announcement =
        await announcementStoreModule().backgroundAnnouncementCandidate();
    }
  } catch (error) {
    devWarn('the announcement candidate failed', error);
  }
  const result = await runCatalogTask(
    'background',
    undefined,
    announcement ? [announcement] : undefined,
  );
  if (!announcement) return;
  try {
    const recorded = announcementStoreModule().recordPostedAnnouncement(
      announcement,
      result?.check?.posted,
    );
    if (__DEV__ && recorded) {
      console.log(
        `[notifications] announcement posted: ${announcement.dedupeKey}`,
      );
    }
  } catch (error) {
    devWarn('the announcement record failed', error);
  }
}

/**
 * Defines the task. Call it at module scope in `entry.ts`, once. The body
 * never throws out of the task, and the task always reports success: a failed
 * check is a status of the body (logged in DEV, one breadcrumb), and the next
 * run checks again.
 */
export function defineQariahCatalogTask(): void {
  try {
    if (TaskManager.isTaskDefined(QARIAH_CATALOG_TASK)) return;
    TaskManager.defineTask(QARIAH_CATALOG_TASK, async () => {
      await runBackgroundCheck();
      try {
        return backgroundTaskModule().BackgroundTaskResult.Success;
      } catch {
        // `BackgroundTaskResult.Success` is 1.
        return 1;
      }
    });
  } catch (error) {
    devWarn('defineTask failed', error);
  }
}

export type CatalogTaskRegistration =
  | 'registered'
  | 'already_registered'
  | 'unregistered_holdout'
  | 'holdout'
  | 'unregistered_no_permission'
  | 'no_permission'
  | 'restricted'
  | 'failed';

/** Unregisters the task. Resolves `true` when it was registered. Never throws. */
export async function unregisterQariahCatalogTask(): Promise<boolean> {
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(QARIAH_CATALOG_TASK))) {
      return false;
    }
    await backgroundTaskModule().unregisterTaskAsync(QARIAH_CATALOG_TASK);
    return true;
  } catch (error) {
    devWarn('unregisterTaskAsync failed', error);
    return false;
  }
}

/**
 * Registers the task when the user is not in the holdout and notifications
 * are allowed. Otherwise it unregisters a task that an earlier start
 * registered (`unregistered_holdout`, `unregistered_no_permission`).
 * `restricted`: `getStatusAsync()` gave `Restricted`, which
 * `expo-background-task` 57 gives on the iOS Simulator only (a device gives
 * `Available`, also with "Background App Refresh" off; then iOS does not run
 * the task). A registered task is not registered again. On iOS that saves
 * nothing: at each cold launch `expo-task-manager` restores the task
 * (`_restoreTasks`), and `expo-background-task` submits its request again with
 * the earliest start now + 12 h. On Android a second registration keeps the
 * queued worker. Never throws.
 */
export async function registerQariahCatalogTask(): Promise<CatalogTaskRegistration> {
  try {
    if (isNotificationsHoldout()) {
      return (await unregisterQariahCatalogTask())
        ? 'unregistered_holdout'
        : 'holdout';
    }
    const permission = await expoNotifierModule()
      .createExpoNotifier()
      .getPermission();
    if (permission !== 'granted') {
      return (await unregisterQariahCatalogTask())
        ? 'unregistered_no_permission'
        : 'no_permission';
    }
    const BackgroundTask = backgroundTaskModule();
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
      return 'restricted';
    }
    if (await TaskManager.isTaskRegisteredAsync(QARIAH_CATALOG_TASK)) {
      return 'already_registered';
    }
    await BackgroundTask.registerTaskAsync(QARIAH_CATALOG_TASK, {
      minimumInterval: CATALOG_TASK_MINIMUM_INTERVAL_MINUTES,
    });
    return 'registered';
  } catch (error) {
    devWarn('registerTaskAsync failed', error);
    return 'failed';
  }
}

/**
 * The notification handler and the Android channels (not for a holdout user).
 * `notificationsSync.ts` calls it. Never throws.
 */
export async function prepareNotifications(): Promise<void> {
  if (isNotificationsHoldout()) return;
  try {
    const notifier = expoNotifierModule();
    notifier.installNotificationHandler();
    await notifier.ensureNotificationChannels();
  } catch (error) {
    devWarn('the notification setup failed', error);
  }
}

/** `true` when the snapshot store has a snapshot. Never throws. */
function hasStoredSnapshot(): boolean {
  try {
    return createCatalogSnapshotStore().load() !== null;
  } catch {
    return false;
  }
}

/**
 * Resolves `true` when the catalog in memory is a network catalog of this
 * process (`services/liveCatalogSignal.ts`), now or within `waitMs`.
 */
function waitForLiveCatalog(waitMs: number): Promise<boolean> {
  if (isLiveCatalogInMemory()) return Promise.resolve(true);
  return new Promise(resolve => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(isLiveCatalogInMemory());
    }, waitMs);
    unsubscribe = subscribeLiveCatalogLoaded(() => {
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

/**
 * The foreground check, after `NOTIFICATIONS_START_DELAY_MS`. It checks the
 * catalog in memory (no fetch) only when that catalog came from the network in
 * this process (`services/liveCatalogSignal.ts`): it waits up to
 * `FOREGROUND_CATALOG_WAIT_MS` for one (the first-launch fetch, the background
 * refresh or the RFC-010 version poll). The catalog in memory can also be the
 * bundled seed or an old cache (the first start after a `DATA_VERSION` change
 * empties the cache), and a first snapshot of it would make the next check
 * announce old recitations; so a seed or cache is never checked.
 * When no network catalog comes in time:
 * - with no stored snapshot, a check that fetches the catalog itself, as the
 *   background task does (so the first snapshot still comes soon);
 * - with a snapshot (offline), no check: it resolves `null`, and the
 *   background task checks later.
 * Waiting first avoids a second download of the same catalog: the app's own
 * boot fetches it a few seconds after the start.
 */
async function runForegroundCheck(): Promise<CatalogTaskResult | null> {
  const hadSnapshot = hasStoredSnapshot();
  if (await waitForLiveCatalog(FOREGROUND_CATALOG_WAIT_MS)) {
    // A copy: a later catalog load refills `RECITERS` in place.
    return runCatalogTask('foreground', [...RECITERS]);
  }
  if (!hadSnapshot) return runCatalogTask('foreground');
  if (__DEV__) {
    console.log(
      '[notifications] catalog check (foreground): no network catalog, not run',
    );
  }
  return null;
}

/** Sends the field report of the background runs (`backgroundRunReport.ts`). Never throws. */
async function reportBackgroundRuns(): Promise<void> {
  try {
    const {reportBackgroundRun} =
      require('./backgroundRunReport') as typeof import('./backgroundRunReport');
    const {notificationsStorage} =
      require('./catalogDiff') as typeof import('./catalogDiff');
    const status = await reportBackgroundRun({storage: notificationsStorage});
    if (__DEV__ && status !== 'nothing') {
      console.log(`[notifications] background run report: ${status}`);
    }
    // The `notification_scheduled` events of the background posts.
    const {flushQueuedScheduledEvents} =
      require('./notificationAnalytics') as typeof import('./notificationAnalytics');
    await flushQueuedScheduledEvents(notificationsStorage);
  } catch (error) {
    devWarn('the background run report failed', error);
  }
}

function notificationsSyncModule(): typeof import('./notificationsSync') {
  return require('./notificationsSync') as typeof import('./notificationsSync');
}

function notificationSchedulingModule(): typeof import('./notificationScheduling') {
  return require('./notificationScheduling') as typeof import('./notificationScheduling');
}

/** Runs one sync (`notificationsSync.ts`). Never throws. */
async function syncNotificationsSafely(reason: string): Promise<void> {
  try {
    await notificationsSyncModule().syncNotifications(reason);
  } catch (error) {
    devWarn(`the notification sync (${reason}) failed`, error);
  }
}

let started = false;
let bootStepRan = false;

/**
 * The boot hook of the notifications (`qariahAfterCatalogReady()`). Returns
 * at once, and starts nothing twice in a process (the Android Auto root boots
 * through the same hook). After `NOTIFICATIONS_START_DELAY_MS`:
 * - syncs the native state (`notificationsSync.ts`): registers (or
 *   unregisters) the background task, installs the foreground notification
 *   handler and the Android channels, keeps the Friday Al-Kahf reminder (not
 *   for a holdout user; a holdout user loses each scheduled notice);
 * - then lets the subscriptions of `notificationScheduling.ts` act (the
 *   player, the switches, the app state; they start at once);
 * - sends the field report of the background runs since the last report;
 * - runs the foreground check (see `runForegroundCheck`).
 */
export function startQariahNotifications(): void {
  if (started) return;
  started = true;
  // DEV only: the device-check helpers (`devTools.ts`); never under Jest.
  if (__DEV__ && !process.env.JEST_WORKER_ID) {
    try {
      (
        require('./devTools') as typeof import('./devTools')
      ).installNotificationsDevTools();
    } catch (error) {
      devWarn('the DEV tools did not install', error);
    }
  }
  // The subscriptions start now (no native call), so a play in the first
  // seconds still moves "continue listening" once the boot step ran.
  try {
    notificationSchedulingModule().startNotificationScheduling();
  } catch (error) {
    devWarn('the notification scheduling did not start', error);
  }
  setTimeout(() => {
    bootStepRan = true;
    void (async () => {
      await syncNotificationsSafely('boot');
      try {
        notificationSchedulingModule().setNotificationSchedulingReady();
      } catch (error) {
        devWarn('the notification scheduling did not start', error);
      }
      await reportBackgroundRuns();
    })();
    void runForegroundCheck();
  }, NOTIFICATIONS_START_DELAY_MS);
}

/**
 * This start wrote the holdout arm (`holdoutEnrollment.ts`). Before the boot
 * step, nothing to do: the boot step reads the arm. After it, sync again,
 * and for a `notify` arm run the foreground check, which takes the first
 * snapshot (the boot step's check stopped on the unknown arm). Never throws.
 */
export function onNotificationsHoldoutAssigned(
  arm: 'holdout' | 'notify',
): void {
  if (!bootStepRan) return;
  void (async () => {
    await syncNotificationsSafely('holdout_assigned');
    if (arm === 'notify') await runForegroundCheck();
  })();
}

/** Tests only: forget that `startQariahNotifications()` ran. */
export function __resetQariahNotificationsStartForTests(): void {
  started = false;
  bootStepRan = false;
}
