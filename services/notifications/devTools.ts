// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): DEV-only helpers for the device checks
// of the local notifications. `startQariahNotifications()` installs them only
// when `__DEV__` is true, as the global `__qariahNotificationsDev`. A release
// build never runs this module.
//
// Use them from the JS debugger, for example:
//   __qariahNotificationsDev.logScheduled()
//   __qariahNotificationsDev.forgetSnapshotKeys(['<key>'])  // then force the job
//   __qariahNotificationsDev.post('kahf_friday')            // a notice to tap
// or from adb with a DEV link (the not-found route leaves at once):
//   adb shell am start -a android.intent.action.VIEW \
//     -d 'qariah://dev-notifications?cmd=post&args=%5B%22kahf_friday%22%5D'
// (`args` is a URL-encoded JSON array). Each result goes to the log.
import {Linking} from 'react-native';
import {notificationsStorage, createCatalogSnapshotStore} from './catalogDiff';
import {
  LAST_CATALOG_VERSION_KEY,
  CATALOG_CHECK_PENDING_KEY,
} from './catalogTask';
import {LAST_ANNOUNCED_ID_KEY} from './announcementStore';
import {whatsNewCandidate} from './announcement';
import {QARIAH_ANNOUNCEMENT_ID} from '@/config/qariahAnnouncement';
import {useNotificationPrefsStore} from './prefsStore';
import {continueListeningCandidate, kahfFridayCandidate} from './scheduler';
import {readHoldoutAssignment} from './holdoutEnrollment';
import {
  NOTIFICATIONS_HOLDOUT_ARM_KEY,
  readNotificationsHoldoutArm,
} from './holdout';
import {NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY} from './holdoutEnrollment';
import type {NotificationCandidate} from './types';

function expoNotifications(): typeof import('expo-notifications') {
  return require('expo-notifications') as typeof import('expo-notifications');
}

/** Logs each scheduled notification: the id, the type and the trigger. */
export async function logScheduledNotifications(
  label = 'scheduled',
): Promise<{id: string; type: unknown; trigger: unknown}[]> {
  const scheduled =
    await expoNotifications().getAllScheduledNotificationsAsync();
  const rows = scheduled.map(request => ({
    id: request.identifier,
    type: request.content?.data?.type,
    title: request.content?.title,
    body: request.content?.body,
    trigger: request.trigger,
  }));
  console.log(`[notifications][dev] ${label}: ${JSON.stringify(rows)}`);
  return rows;
}

const tools = {
  /** The written arm and the MMKV values. */
  arm: () => {
    const value = {
      assignment: readHoldoutAssignment(),
      raw: readNotificationsHoldoutArm(),
    };
    console.log(`[notifications][dev] arm: ${JSON.stringify(value)}`);
    return value;
  },
  /** Writes an arm by hand (a DEV test of the holdout). */
  setArm: (arm: 'holdout' | 'notify') => {
    notificationsStorage.set(NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY, 'flag');
    notificationsStorage.set(NOTIFICATIONS_HOLDOUT_ARM_KEY, arm);
    return tools.arm();
  },
  /** Removes the arm, so the next start enrolls again. */
  clearArm: () => {
    notificationsStorage.remove(NOTIFICATIONS_HOLDOUT_ARM_KEY);
    notificationsStorage.remove(NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY);
    return tools.arm();
  },
  logScheduled: () => logScheduledNotifications(),
  /** The keys of the stored snapshot (the first `limit`). */
  snapshotKeys: (limit = 20) => {
    const keys = [...(createCatalogSnapshotStore().load() ?? [])];
    console.log(
      `[notifications][dev] snapshot (${keys.length}): ${JSON.stringify(keys.slice(0, limit))}`,
    );
    return keys.slice(0, limit);
  },
  /**
   * Removes keys from the stored snapshot and the record of the last checked
   * version, so the next check finds those recitations "new". Also clears the
   * daily limit.
   */
  forgetSnapshotKeys: (keys: string[]) => {
    const store = createCatalogSnapshotStore();
    const snapshot = store.load();
    if (!snapshot) {
      console.log('[notifications][dev] no snapshot');
      return false;
    }
    keys.forEach(key => snapshot.delete(key));
    const saved = store.save(snapshot);
    notificationsStorage.remove(LAST_CATALOG_VERSION_KEY);
    notificationsStorage.remove(CATALOG_CHECK_PENDING_KEY);
    useNotificationPrefsStore.getState().setLastNotifiedDay(null);
    console.log(
      `[notifications][dev] forgot ${keys.length} key(s), saved: ${saved}`,
    );
    return saved;
  },
  /** The favorite reciter ids ("follow" = favorite). */
  favorites: () => {
    const {useFavoriteRecitersStore} =
      require('@/services/player/store/favoriteRecitersStore') as typeof import('@/services/player/store/favoriteRecitersStore');
    return useFavoriteRecitersStore.getState().favoriteReciterIds;
  },
  /** Adds a favorite reciter by id (a "followed" test). */
  addFavorite: (reciterId: string) => {
    const {useFavoriteRecitersStore} =
      require('@/services/player/store/favoriteRecitersStore') as typeof import('@/services/player/store/favoriteRecitersStore');
    const {getReciterByIdSync} =
      require('@/services/dataService') as typeof import('@/services/dataService');
    const reciter = getReciterByIdSync(reciterId);
    if (!reciter) return false;
    useFavoriteRecitersStore.getState().addFavoriteReciter(reciter);
    return useFavoriteRecitersStore.getState().favoriteReciterIds;
  },
  /** Sets the analytics consent (Settings → Privacy), for the holdout rule. */
  setConsent: (enabled: boolean) => {
    const {useAnalyticsConsentStore} =
      require('@/store/analyticsConsentStore') as typeof import('@/store/analyticsConsentStore');
    useAnalyticsConsentStore.getState().setAnalyticsEnabled(enabled);
    return useAnalyticsConsentStore.getState().analyticsEnabled;
  },
  /** Clears the daily limit (one notice each day). */
  clearDailyLimit: () => {
    useNotificationPrefsStore.getState().setLastNotifiedDay(null);
    return true;
  },
  /** Removes the last announced id, so a background run can post `whats_new`. */
  forgetAnnouncement: () => {
    notificationsStorage.remove(LAST_ANNOUNCED_ID_KEY);
    useNotificationPrefsStore.getState().setLastNotifiedDay(null);
    return true;
  },
  /** Posts a notice of a scheduled type NOW, with its real content and data (a tap test). */
  post: async (type: 'kahf_friday' | 'continue_listening' | 'whats_new') => {
    const {createExpoNotifier} =
      require('./expoNotifier') as typeof import('./expoNotifier');
    let candidate: NotificationCandidate;
    if (type === 'kahf_friday') {
      candidate = {...kahfFridayCandidate(), dedupeKey: 'dev:kahf_friday'};
    } else if (type === 'continue_listening') {
      candidate = {
        ...continueListeningCandidate({
          surahName: 'Al-Kahf',
          reciterName: 'DEV',
        }),
        dedupeKey: 'dev:continue_listening',
      };
    } else {
      candidate = whatsNewCandidate(
        QARIAH_ANNOUNCEMENT_ID ?? '2026-10-sprint48',
      );
    }
    const id = await createExpoNotifier().schedule(candidate, {
      kind: 'immediate',
    });
    console.log(`[notifications][dev] posted ${id}`);
    return id;
  },
};

const DEV_LINK = /^qariah:\/\/dev-notifications\/?\?(.*)$/;

/** Runs the command of a DEV link (see the file header). */
function handleDevLink(url: string): void {
  const match = DEV_LINK.exec(url);
  if (!match) return;
  const params = new URLSearchParams(match[1]);
  const cmd = params.get('cmd') as keyof typeof tools | null;
  let args: unknown[] = [];
  try {
    args = JSON.parse(params.get('args') ?? '[]') as unknown[];
  } catch {
    args = [];
  }
  const fn = cmd ? (tools[cmd] as (...a: unknown[]) => unknown) : undefined;
  if (!fn) {
    console.log(`[notifications][dev] unknown command: ${String(cmd)}`);
    return;
  }
  Promise.resolve()
    .then(() => fn(...args))
    .then(result =>
      console.log(
        `[notifications][dev] ${cmd} → ${JSON.stringify(result ?? null)}`,
      ),
    )
    .catch(error => console.log(`[notifications][dev] ${cmd} failed`, error));
}

let installed = false;

/** Installs the global and the DEV link listener (DEV only). */
export function installNotificationsDevTools(): void {
  if (!__DEV__ || installed) return;
  installed = true;
  (
    globalThis as {__qariahNotificationsDev?: typeof tools}
  ).__qariahNotificationsDev = tools;
  Linking.addEventListener('url', ({url}) => handleDevLink(url));
}
