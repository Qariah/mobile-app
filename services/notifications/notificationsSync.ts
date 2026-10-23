// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): make the native notification state
// match the holdout arm, the permission and the toggles.
//
// `syncNotifications(reason)` runs at each moment when one of them can
// change:
// - `boot`: the boot step (`startQariahNotifications`, 5 s after the catalog);
// - `holdout_assigned`: this start wrote the arm (`holdoutEnrollment.ts`);
// - `foreground`: the app is active again (the user can change the permission
//   in the system settings, or answer the Android 13+ dialog of the first
//   launch, `ExpoAudioProvider`);
// - `permission_granted`: the iOS soft prompt or the Notifications page got a
//   grant.
// A toggle change syncs only its own type (`notificationScheduling.ts`).
//
// What a sync does:
// - The holdout (also an unknown arm): unregister the background task. When
//   this device ever ran the notify side (MMKV `notifications_were_active`:
//   the arm changed from `notify` to `holdout`, or a forced holdout in DEV),
//   also cancel each scheduled notification of the engine. Else nothing can be
//   scheduled, and `expo-notifications` is not loaded (review of Task 16, L1:
//   a holdout user never loads it from this engine).
// - Else: register the background task (it checks the permission itself),
//   install the foreground handler and the Android channels, keep exactly one
//   Friday Al-Kahf reminder while its toggle is on and the permission is
//   granted (else cancel it), and cancel a "continue listening" notice whose
//   toggle is off or that has no permission.
// - Each time the sync cancels "continue listening" (the holdout, the toggle
//   off, no permission), it also removes the stored play
//   (`continueListeningStore.ts`), so the boot step of a later process does
//   not schedule it again (TECH_DEBT #330). The boot step, not the sync,
//   schedules the stored play again (`notificationScheduling.ts`).
//
// The toggles come from `getHydratedNotificationPrefs()`: when they cannot be
// read, the sync changes no scheduled notice (the defaults are not the user's
// choice).
//
// One sync at a time: a call during a sync runs one more sync after it.
// Never throws.
import {notificationsStorage} from './catalogDiff';
import {clearContinuePlay} from './continueListeningStore';
import {isNotificationsHoldout} from './holdout';
import {getHydratedNotificationPrefs} from './prefsStore';
import {KAHF_FRIDAY_TRIGGER, kahfFridayCandidate} from './scheduler';
import {
  NOTIFICATION_TYPES,
  type KeyValueStorage,
  type NotificationPermissionStatus,
  type NotificationPrefsSnapshot,
  type Notifier,
} from './types';
import type {CatalogTaskRegistration} from './backgroundTask';

// Required on first use: `backgroundTask.ts` requires this module lazily too,
// and `expo-notifications` must stay off the cold-start path.
function backgroundTaskModule(): typeof import('./backgroundTask') {
  return require('./backgroundTask') as typeof import('./backgroundTask');
}
function expoNotifierModule(): typeof import('./expoNotifier') {
  return require('./expoNotifier') as typeof import('./expoNotifier');
}

/**
 * - `scheduled`: a new weekly reminder (none was pending).
 * - `rescheduled`: the pending reminder, replaced (same id, the text in the
 *   language of now).
 * - `cancelled`: a pending reminder was cancelled.
 * - `off`: no reminder is wanted, and none was pending.
 * - `unchanged`: the toggles could not be read; nothing changed.
 * - `failed`: a native call failed.
 */
export type KahfSyncResult =
  | 'scheduled'
  | 'rescheduled'
  | 'cancelled'
  | 'off'
  | 'unchanged'
  | 'failed';

export interface KahfSyncInput {
  notifier: Notifier;
  holdout: boolean;
  permission: NotificationPermissionStatus;
  /** `null`: the toggles could not be read; then nothing changes. */
  prefs: Pick<NotificationPrefsSnapshot, 'kahf_friday'> | null;
}

/**
 * Keeps exactly one Friday Al-Kahf reminder (`KAHF_FRIDAY_TRIGGER`, id
 * `kahf_friday`) while the toggle is on, the user is not in the holdout and
 * the permission is granted; else cancels it. Never throws.
 */
export async function syncKahfReminder(
  input: KahfSyncInput,
): Promise<KahfSyncResult> {
  if (!input.prefs) return 'unchanged';
  const wanted =
    !input.holdout &&
    input.permission === 'granted' &&
    input.prefs.kahf_friday === true;
  try {
    const candidate = kahfFridayCandidate();
    const pending = input.notifier.listScheduled
      ? (await input.notifier.listScheduled()).filter(
          request => request.type === 'kahf_friday',
        )
      : null;
    if (!wanted) {
      if (pending && pending.length === 0) return 'off';
      await input.notifier.cancelByType('kahf_friday');
      return 'cancelled';
    }
    // Exactly one: another id of the type (none is expected) goes.
    for (const request of pending ?? []) {
      if (request.id !== candidate.dedupeKey) {
        await input.notifier.cancel(request.id);
      }
    }
    // The same id replaces a pending reminder.
    await input.notifier.schedule(candidate, KAHF_FRIDAY_TRIGGER);
    const hadOne =
      pending?.some(request => request.id === candidate.dedupeKey) ?? false;
    return hadOne ? 'rescheduled' : 'scheduled';
  } catch {
    return 'failed';
  }
}

/**
 * Cancels each scheduled notification of the engine (the `type` in its data
 * is one of the five types). Resolves the number cancelled, or `-1` when the
 * notifier cannot list them (then it cancels by type). Throws on a native
 * failure.
 */
export async function cancelAllScheduledNotifications(
  notifier: Notifier,
): Promise<number> {
  const ours = new Set<string>(NOTIFICATION_TYPES);
  if (!notifier.listScheduled) {
    for (const type of NOTIFICATION_TYPES) await notifier.cancelByType(type);
    return -1;
  }
  let cancelled = 0;
  for (const request of await notifier.listScheduled()) {
    if (request.type !== null && ours.has(request.type)) {
      await notifier.cancel(request.id);
      cancelled++;
    }
  }
  return cancelled;
}

export interface NotificationsSyncResult {
  reason: string;
  holdout: boolean;
  permission?: NotificationPermissionStatus;
  registration?: CatalogTaskRegistration | 'unregistered' | 'not_registered';
  kahf?: KahfSyncResult;
  /** "Continue listening" cancelled because its toggle is off or no permission. */
  continueCancelled?: boolean;
  /** The holdout: the number of notifications cancelled (`-1`: by type). */
  cancelled?: number;
  /** An unexpected error stopped the sync. */
  failed?: boolean;
}

/** The parts of a sync, injected in the tests. */
export interface NotificationsSyncDeps {
  notifier?: Notifier;
  isHoldout?: () => boolean;
  readPrefs?: () => Promise<NotificationPrefsSnapshot | null>;
  register?: () => Promise<CatalogTaskRegistration>;
  unregister?: () => Promise<boolean>;
  /** The foreground handler and the Android channels. */
  prepare?: () => Promise<void>;
  /** Default: `notificationsStorage` (MMKV `qariah-notifications`). */
  storage?: KeyValueStorage;
}

/** MMKV (`qariah-notifications`): `'1'` once a sync ran the notify side on this device. */
export const NOTIFICATIONS_WERE_ACTIVE_KEY = 'notifications_were_active';

function readWereActive(storage: KeyValueStorage): boolean {
  try {
    return storage.getString(NOTIFICATIONS_WERE_ACTIVE_KEY) === '1';
  } catch {
    // Not readable: cancel, to be safe (a notice of a holdout user is worse
    // than one native call).
    return true;
  }
}

function writeWereActive(storage: KeyValueStorage, active: boolean): void {
  try {
    if (active) storage.set(NOTIFICATIONS_WERE_ACTIVE_KEY, '1');
    else storage.remove(NOTIFICATIONS_WERE_ACTIVE_KEY);
  } catch {
    // Best effort.
  }
}

async function syncOnce(
  reason: string,
  deps: NotificationsSyncDeps,
): Promise<NotificationsSyncResult> {
  const storage = deps.storage ?? notificationsStorage;
  const holdout = (deps.isHoldout ?? isNotificationsHoldout)();

  if (holdout) {
    // expo-task-manager only: no expo-notifications.
    const unregister =
      deps.unregister ?? backgroundTaskModule().unregisterQariahCatalogTask;
    const unregistered = await unregister();
    const registration = unregistered ? 'unregistered' : 'not_registered';
    // A holdout user gets no "continue listening" notice.
    clearContinuePlay(storage);
    if (!readWereActive(storage)) {
      return {reason, holdout: true, registration, cancelled: 0};
    }
    const notifier = deps.notifier ?? expoNotifierModule().createExpoNotifier();
    let cancelled = 0;
    try {
      cancelled = await cancelAllScheduledNotifications(notifier);
      writeWereActive(storage, false);
    } catch {
      cancelled = 0;
    }
    return {reason, holdout: true, registration, cancelled};
  }

  writeWereActive(storage, true);
  const notifier = deps.notifier ?? expoNotifierModule().createExpoNotifier();

  const register =
    deps.register ?? backgroundTaskModule().registerQariahCatalogTask;
  const registration = await register();
  const prepare = deps.prepare ?? backgroundTaskModule().prepareNotifications;
  await prepare();

  let permission: NotificationPermissionStatus;
  try {
    permission = await notifier.getPermission();
  } catch {
    return {reason, holdout: false, registration, failed: true};
  }
  const prefs = await (
    deps.readPrefs ?? (() => getHydratedNotificationPrefs())
  )();
  const kahf = await syncKahfReminder({
    notifier,
    holdout: false,
    permission,
    prefs,
  });

  let continueCancelled = false;
  if (
    prefs &&
    (permission !== 'granted' || prefs.continue_listening !== true)
  ) {
    // Also when the native cancel fails: the notice is not wanted.
    clearContinuePlay(storage);
    try {
      await notifier.cancelByType('continue_listening');
      continueCancelled = true;
    } catch {
      continueCancelled = false;
    }
  }
  return {
    reason,
    holdout: false,
    permission,
    registration,
    kahf,
    continueCancelled,
  };
}

async function runSync(
  reason: string,
  deps: NotificationsSyncDeps,
): Promise<NotificationsSyncResult> {
  let result: NotificationsSyncResult;
  try {
    result = await syncOnce(reason, deps);
  } catch {
    result = {reason, holdout: isNotificationsHoldout(), failed: true};
  }
  if (__DEV__) {
    console.log('[notifications] sync:', result);
    devLogScheduled();
  }
  if (result.kahf === 'scheduled') {
    try {
      const analytics =
        require('./notificationAnalytics') as typeof import('./notificationAnalytics');
      void analytics.trackNotificationScheduled(
        analytics.scheduledProps(kahfFridayCandidate(), 'weekly', 'sync'),
      );
    } catch {
      // Analytics must not break the sync.
    }
  }
  try {
    syncListeners.forEach(listener => listener(result));
  } catch {
    // A listener must not break the sync.
  }
  return result;
}

const syncListeners = new Set<(result: NotificationsSyncResult) => void>();

/** DEV: logs the scheduled notifications when the DEV tools are installed (`devTools.ts`). */
export function devLogScheduled(): void {
  const dev = (
    globalThis as {
      __qariahNotificationsDev?: {logScheduled(): Promise<unknown>};
    }
  ).__qariahNotificationsDev;
  if (!__DEV__ || !dev) return;
  void dev.logScheduled().catch(() => undefined);
}

/** Calls `listener` after each sync (analytics, the DEV log). Returns the unsubscribe. */
export function onNotificationsSynced(
  listener: (result: NotificationsSyncResult) => void,
): () => void {
  syncListeners.add(listener);
  return () => {
    syncListeners.delete(listener);
  };
}

let inFlight: Promise<NotificationsSyncResult> | null = null;
let queued: Promise<NotificationsSyncResult> | null = null;

/** One sync (see the file header). Never rejects. */
export function syncNotifications(
  reason: string,
  deps: NotificationsSyncDeps = {},
): Promise<NotificationsSyncResult> {
  if (!inFlight) {
    inFlight = runSync(reason, deps).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }
  // One more sync after the running one, for every call that comes meanwhile.
  if (!queued) {
    queued = inFlight.then(() => {
      queued = null;
      return syncNotifications(reason, deps);
    });
  }
  return queued;
}

/** Tests only. */
export function __resetNotificationsSyncForTests(): void {
  inFlight = null;
  queued = null;
  syncListeners.clear();
}
