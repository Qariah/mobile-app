// @ai-generated
// Qariah (Sprint 48, S48.6 and S48.7): the notification preferences.
//
// A persisted zustand store on `guardedJSONStorage`, like the other 17
// persisted stores (see `services/storage/hydrationGuardedStorage.ts`, GitHub
// #329, #457 and Sentry QARIAHV2-20). The guard keeps a failed read from
// writing the defaults over the stored toggles.
//
// The guard does not stop a READER from seeing the defaults. After a failed
// read the store keeps its defaults: every type ON and `lastNotifiedDay` null.
// The background task can run before the first unlock after a reboot, when the
// iOS container is not readable, so it must not decide from those defaults: it
// would post a type that the user turned off, or post a second notice on the
// same day. Use `getHydratedNotificationPrefs()` there; it gives `null` unless
// a read succeeded. After a failed read it reads once more before it gives up
// (the first unlock can come after the start of the process).
//
// A stored value that is not valid JSON counts as a failed read: the check
// posts nothing, and Sentry gets one `notification-prefs-unreadable` event in
// each process. The engine writes nothing after a failed read
// (`markNotifiedToday()` refuses). The first toggle change that the user makes
// on the Notifications page replaces the unreadable value: that is the
// self-repair of `guardedJSONStorage` (a parse failure above the guard leaves
// writes open), and the user's own choice is the best value there is.
//
// The state is flat (one top-level key for each type), not a map: zustand's
// default shallow merge then gives a type that a later version adds its default
// value, and the guard's deferred-write merge works key by key.
import * as Sentry from '@sentry/react-native';
import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {guardedJSONStorage} from '@/services/storage/hydrationGuardedStorage';
import {localDay} from './localDay';
import type {
  NotificationPrefsSource,
  NotificationType,
  NotificationTypePrefs,
} from './types';

export const NOTIFICATION_PREFS_STORAGE_KEY = 'qariah-notification-prefs';
export const NOTIFICATION_PREFS_VERSION = 1;

/** Each type is ON after the user allows notifications (GATE 1). */
export const DEFAULT_NOTIFICATION_TYPE_PREFS: NotificationTypePrefs = {
  followed_recitation: true,
  new_recitation: true,
  kahf_friday: true,
  continue_listening: true,
  whats_new: true,
};

export interface NotificationPrefsState extends NotificationTypePrefs {
  /** The iOS soft prompt got an answer ("Allow" or "Not now"); do not ask again by itself. */
  softPromptAnswered: boolean;
  /** The local day (`YYYY-MM-DD`) of the last notification that the app posted; the daily limit. */
  lastNotifiedDay: string | null;
  setTypeEnabled: (type: NotificationType, enabled: boolean) => void;
  setSoftPromptAnswered: (answered: boolean) => void;
  /**
   * Internal: the engine uses `markNotifiedToday()`, which refuses to write
   * after a failed read. Do not call this directly: after a stored value that
   * is not JSON, the storage guard leaves writes open, so a direct call would
   * write the defaults of the other fields over it.
   */
  setLastNotifiedDay: (day: string | null) => void;
}

// The result of the last hydrating read. It is set from `onRehydrateStorage`,
// which zustand calls with an error when the read (or the JSON parse) fails.
// Declared before the store: `persist` starts the read inside `create()`.
let hydrationResult: 'pending' | 'ok' | 'failed' = 'pending';
const hydrationWaiters = new Set<(ok: boolean) => void>();

let reportedUnreadable = false;

/** One Sentry event in each process for a stored value that is not valid JSON. */
function reportUnreadableOnce(error: unknown): void {
  if (reportedUnreadable) return;
  reportedUnreadable = true;
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  Sentry.captureMessage('notification-prefs-unreadable', {
    level: 'warning',
    tags: {scope: 'notifications', store: NOTIFICATION_PREFS_STORAGE_KEY},
    extra: {error: message},
    fingerprint: ['notification-prefs-unreadable'],
  });
  if (__DEV__) {
    console.warn(
      `[notifications] "${NOTIFICATION_PREFS_STORAGE_KEY}" is not valid JSON; ` +
        'no notification until it can be read.',
    );
  }
}

function settleHydration(ok: boolean): void {
  hydrationResult = ok ? 'ok' : 'failed';
  const waiters = [...hydrationWaiters];
  hydrationWaiters.clear();
  waiters.forEach(waiter => waiter(ok));
}

export const useNotificationPrefsStore = create<NotificationPrefsState>()(
  persist(
    set => ({
      ...DEFAULT_NOTIFICATION_TYPE_PREFS,
      softPromptAnswered: false,
      lastNotifiedDay: null,
      setTypeEnabled: (type, enabled) =>
        set(() => {
          const next: Partial<NotificationTypePrefs> = {};
          next[type] = enabled;
          return next;
        }),
      setSoftPromptAnswered: answered => set({softPromptAnswered: answered}),
      setLastNotifiedDay: day => set({lastNotifiedDay: day}),
    }),
    {
      name: NOTIFICATION_PREFS_STORAGE_KEY,
      storage: guardedJSONStorage(NOTIFICATION_PREFS_STORAGE_KEY),
      version: NOTIFICATION_PREFS_VERSION,
      // zustand calls this when a read starts (also for `persist.rehydrate()`),
      // and the function that it returns with `(state, undefined)` on success
      // or `(undefined, error)` on failure.
      onRehydrateStorage: () => {
        hydrationResult = 'pending';
        return (state, error) => {
          // A read that the storage refuses rejects with its own error (and
          // the storage guard reports it); a value that is not JSON rejects
          // with the SyntaxError of `JSON.parse`.
          if ((error as {name?: unknown} | undefined)?.name === 'SyntaxError') {
            reportUnreadableOnce(error);
          }
          settleHydration(state !== undefined && error === undefined);
        };
      },
    },
  ),
);

/** The extra read after a failed read, shared by the callers that wait for it. */
let retryRead: Promise<boolean> | null = null;

function waitForHydration(timeoutMs: number): Promise<boolean> {
  if (hydrationResult !== 'pending') {
    return Promise.resolve(hydrationResult === 'ok');
  }
  return new Promise(resolve => {
    const waiter = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      hydrationWaiters.delete(waiter);
      resolve(false);
    }, timeoutMs);
    hydrationWaiters.add(waiter);
  });
}

/**
 * Resolves `true` when a hydrating read succeeded. A fresh install is a success
 * (the read resolves with no value). After a failed read it calls
 * `persist.rehydrate()` once and waits for that read. Resolves `false` when
 * that read fails too, or when a read does not finish within `timeoutMs`.
 */
export async function whenNotificationPrefsHydrated(
  timeoutMs = 5000,
): Promise<boolean> {
  if (await waitForHydration(timeoutMs)) return true;
  // Another caller's extra read is in flight: share it.
  if (retryRead) return retryRead;
  // The read did not finish in time: no second read while it is in flight.
  if (hydrationResult !== 'failed') return false;
  // `rehydrate()` sets the result back to 'pending' at once (through
  // `onRehydrateStorage`), and its promise never rejects. Not awaited: the
  // wait below has the time limit.
  useNotificationPrefsStore.persist.rehydrate();
  const read = waitForHydration(timeoutMs).finally(() => {
    if (retryRead === read) retryRead = null;
  });
  retryRead = read;
  return read;
}

/**
 * The preferences, or `null` when the stored values could not be read. With
 * `null`, the caller posts nothing (see the note at the top of this file).
 */
export async function getHydratedNotificationPrefs(
  timeoutMs?: number,
): Promise<NotificationPrefsState | null> {
  const ok = await whenNotificationPrefsHydrated(timeoutMs);
  return ok ? useNotificationPrefsStore.getState() : null;
}

/**
 * Records the local day of `now` as the day of the last notice (the daily
 * limit). Gives `false`, and writes nothing, when the stored values could not
 * be read. `true` means the store has the day and the write went to the
 * storage; a write that the disk refuses is reported by the storage guard.
 */
export async function markNotifiedToday(
  now: Date = new Date(),
): Promise<boolean> {
  if (!(await whenNotificationPrefsHydrated())) return false;
  useNotificationPrefsStore.getState().setLastNotifiedDay(localDay(now));
  return true;
}

/** The app's preferences for `runCatalogCheck`. */
export const notificationPrefsSource: NotificationPrefsSource = {
  read: () => getHydratedNotificationPrefs(),
  markNotifiedToday: now => markNotifiedToday(now),
};
