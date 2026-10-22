// @ai-generated
// Qariah (Sprint 48, S48.6): the `Notifier` over `expo-notifications`.
//
// The engine (`catalogCheck.ts`, `scheduler.ts`) makes no native call. This
// module is its native side: it renders the i18n text of a candidate, creates
// the Android channels, and schedules or posts the notification.
//
// `expo-notifications` is required lazily (`notificationsModule()`), so this
// module adds nothing to the cold start until a notice posts. The callers
// (`backgroundTask.ts`, `catalogTask.ts`) also require this module lazily.
import {Platform} from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';
import branding from '@/config/branding';
import i18n from '@/i18n';
import type {
  NotificationCandidate,
  NotificationPermissionStatus,
  NotificationText,
  NotificationTrigger,
  NotificationType,
  Notifier,
} from './types';

type NotificationsModule = typeof ExpoNotifications;

/** The module, required on first use (see the note at the top of this file). */
function notificationsModule(): NotificationsModule {
  return require('expo-notifications') as NotificationsModule;
}

/**
 * One Android channel for each type, so the user can turn off one type in the
 * system settings. The name comes from `nameKeys`: the first key that exists
 * wins, then `defaultName` (English). The `qariah:notifications.channels.*`
 * keys (review pack rows 354–358) give the name; the toggle names of the
 * Notifications page (`qariah:settings.notifications.*`) stay as a fallback.
 */
export const NOTIFICATION_CHANNELS: Record<
  NotificationType,
  {id: string; nameKeys: readonly string[]; defaultName: string}
> = {
  followed_recitation: {
    id: 'qariah-followed-recitation',
    nameKeys: [
      'qariah:notifications.channels.followedRecitation',
      'qariah:settings.notifications.followedRecitation',
    ],
    defaultName: 'New from reciters you follow',
  },
  new_recitation: {
    id: 'qariah-new-recitation',
    nameKeys: [
      'qariah:notifications.channels.newRecitation',
      'qariah:settings.notifications.newRecitation',
    ],
    defaultName: 'New recitations',
  },
  kahf_friday: {
    id: 'qariah-kahf-friday',
    nameKeys: [
      'qariah:notifications.channels.kahfFriday',
      'qariah:settings.notifications.kahfFriday',
    ],
    defaultName: 'Friday Al-Kahf reminder',
  },
  continue_listening: {
    id: 'qariah-continue-listening',
    nameKeys: [
      'qariah:notifications.channels.continueListening',
      'qariah:settings.notifications.continueListening',
    ],
    defaultName: 'Continue listening',
  },
  whats_new: {
    id: 'qariah-whats-new',
    nameKeys: [
      'qariah:notifications.channels.whatsNew',
      'qariah:settings.notifications.whatsNew',
    ],
    defaultName: 'New features',
  },
};

// The keys of this module are built at run time (the announcement id, the
// type), so the typed `t()` of `types/i18next.d.ts` does not accept them. This
// loose signature is for the keys of this module only.
type LooseT = (
  key: string | readonly string[],
  options?: Record<string, unknown>,
) => string;
const t = i18n.t.bind(i18n) as unknown as LooseT;

/** A text key that is in no locale file. The post fails; the engine holds the keys back. */
export class NotificationTextMissingError extends Error {
  constructor(key: string) {
    super(`No text for "${key}"`);
    this.name = 'NotificationTextMissingError';
  }
}

/**
 * The text of a title or a body, in the app language of now. A key that no
 * locale file has throws `NotificationTextMissingError`: a notice must never
 * show a raw key. Every key gets `{{appName}}` (`branding.appName`; the
 * `qariahAppName` post-processor gives the Arabic name).
 */
export function renderNotificationText(text: NotificationText): string {
  if ('text' in text) return text.text;
  const options = {appName: branding.appName, ...text.params};
  // With the params: a plural key has only its `_one`/`_other` forms, and
  // `exists()` finds them only with the `count`.
  if (!i18n.exists(text.key, options)) {
    throw new NotificationTextMissingError(text.key);
  }
  return t(text.key, options);
}

/** The name of the channel of `type`, in the app language of now. */
export function notificationChannelName(type: NotificationType): string {
  const channel = NOTIFICATION_CHANNELS[type];
  return t(channel.nameKeys, {defaultValue: channel.defaultName});
}

/**
 * Creates (or renames) the Android channel of each type. The names follow the
 * app language, so the app calls this once in each process: a language change
 * restarts the app (`i18n/restart.ts`). Android keeps the importance that a
 * channel got at creation; a later call changes only its name. Nothing to do
 * on iOS. Resolves `false` when a channel could not be created.
 */
let channelsReady: Promise<boolean> | null = null;
export function ensureNotificationChannels(): Promise<boolean> {
  if (Platform.OS !== 'android') return Promise.resolve(true);
  if (channelsReady) return channelsReady;
  const ready = (async () => {
    const Notifications = notificationsModule();
    for (const type of Object.keys(
      NOTIFICATION_CHANNELS,
    ) as NotificationType[]) {
      await Notifications.setNotificationChannelAsync(
        NOTIFICATION_CHANNELS[type].id,
        {
          name: notificationChannelName(type),
          importance: Notifications.AndroidImportance.DEFAULT,
        },
      );
    }
    return true;
  })().catch(() => {
    // Try again on the next call.
    channelsReady = null;
    return false;
  });
  channelsReady = ready;
  return ready;
}

/**
 * Shows a notification of the app while the app is in the foreground: a
 * banner and a list entry, no sound, no badge. Without a handler,
 * `expo-notifications` shows nothing in the foreground. Once in each process.
 */
let handlerInstalled = false;
export function installNotificationHandler(): void {
  if (handlerInstalled) return;
  notificationsModule().setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  handlerInstalled = true;
}

/** The trigger input of `scheduleNotificationAsync`, with the Android channel. */
export function toTriggerInput(
  trigger: NotificationTrigger,
  channelId: string,
  Notifications: Pick<NotificationsModule, 'SchedulableTriggerInputTypes'>,
): ExpoNotifications.NotificationTriggerInput {
  switch (trigger.kind) {
    case 'immediate':
      // A channel-only trigger posts now. iOS has no channels: the library
      // reads it as `null` (now).
      return {channelId};
    case 'date':
      return {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: trigger.at,
        channelId,
      };
    case 'weekly':
      return {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: trigger.weekday,
        hour: trigger.hour,
        minute: trigger.minute,
        channelId,
      };
  }
}

/** `IosAuthorizationStatus` values that let a notice show. */
const IOS_DELIVERS = new Set([2, 3, 4]); // AUTHORIZED, PROVISIONAL, EPHEMERAL

/** The `type` in the `data` of a notification of this engine, or `null`. */
function typeOfRequest(
  request: ExpoNotifications.NotificationRequest,
): string | null {
  const type = request.content?.data?.type;
  return typeof type === 'string' ? type : null;
}

/**
 * The app's `Notifier`. The notification id is `candidate.dedupeKey`, so a
 * second post of the same notice replaces the first. The `data` of each
 * notification carries `type` and `target` (the tap routes of `tapRouter.ts` read
 * them).
 */
export function createExpoNotifier(): Notifier {
  return {
    async schedule(
      candidate: NotificationCandidate,
      trigger: NotificationTrigger,
    ): Promise<string> {
      // Render first: a missing text throws before anything is scheduled.
      const title = renderNotificationText(candidate.title);
      const body = candidate.body
        ? renderNotificationText(candidate.body)
        : undefined;
      const Notifications = notificationsModule();
      await ensureNotificationChannels();
      return Notifications.scheduleNotificationAsync({
        identifier: candidate.dedupeKey,
        content: {
          title,
          ...(body !== undefined ? {body} : {}),
          data: {type: candidate.type, target: candidate.target},
        },
        trigger: toTriggerInput(
          trigger,
          NOTIFICATION_CHANNELS[candidate.type].id,
          Notifications,
        ),
      });
    },

    async cancel(id: string): Promise<void> {
      await notificationsModule().cancelScheduledNotificationAsync(id);
    },

    async listScheduled(): Promise<{id: string; type: string | null}[]> {
      const scheduled =
        await notificationsModule().getAllScheduledNotificationsAsync();
      return scheduled.map(request => ({
        id: request.identifier,
        type: typeOfRequest(request),
      }));
    },

    async dismissDelivered(id: string): Promise<void> {
      await notificationsModule().dismissNotificationAsync(id);
    },

    async cancelByType(type: NotificationType): Promise<void> {
      const Notifications = notificationsModule();
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      for (const request of scheduled) {
        if (typeOfRequest(request) === type) {
          await Notifications.cancelScheduledNotificationAsync(
            request.identifier,
          );
        }
      }
    },

    async getPermission(): Promise<NotificationPermissionStatus> {
      const permission = await notificationsModule().getPermissionsAsync();
      if (permission.status === 'granted') return 'granted';
      if (
        typeof permission.ios?.status === 'number' &&
        IOS_DELIVERS.has(permission.ios.status)
      ) {
        return 'granted';
      }
      return permission.status === 'denied' ? 'denied' : 'undetermined';
    },
  };
}
