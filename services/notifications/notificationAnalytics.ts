// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the analytics of the local
// notifications.
//
// The events (`services/analytics/qariahEvents.ts`):
// - `notification_permission_prompted` (`source`: `soft_prompt` | `settings`
//   | `intro_card`, the Android card that only lists the types);
// - `notification_permission_result` (`granted`, `status`, `answer`, `source`);
// - `notification_scheduled` (`type`, `trigger`, `source`, `announcement_id`):
//   a NEW notice in the schedule (the Al-Kahf reminder when none was pending,
//   "continue listening" when none was pending), or a notice that the
//   catalog check posted;
// - `notification_opened` (`type`, `cold_start`, `result`, `announcement_id`).
// `notification_background_run` is `backgroundRunReport.ts`.
//
// Each event goes through `qariahAnalytics` and `captureDiagnosticEvent()`,
// so the consent gate and the dev/simulator drop apply. An event waits up to
// `ANALYTICS_READY_WAIT_MS` for `isReadyToCapture()` (the stored consent is
// read, and PostHog is attached when consent is on): a cold-start tap comes
// before that. With consent off, the capture drops the event.
//
// A notice that the BACKGROUND task posted cannot send its event: an Android
// headless run has no PostHog client. It goes into a queue in MMKV
// (`pending_scheduled_events`, at most `MAX_QUEUED_EVENTS`; only with the
// stored consent ON), and the next start sends it
// (`flushQueuedScheduledEvents`, from the boot step).
import {Platform} from 'react-native';
import {notificationsStorage} from './catalogDiff';
import type {
  KeyValueStorage,
  NotificationCandidate,
  NotificationTrigger,
} from './types';
import type {NotificationTap, OpenTapResult} from './tapRouter';
import type {NotificationPermissionSnapshot} from './permissionAction';
import type {
  NotificationOpenedProps,
  NotificationPermissionPromptedProps,
  NotificationPermissionResultProps,
  NotificationPermissionSource,
  NotificationScheduledProps,
} from '@/services/analytics/qariahEvents';

/** An event waits this long for the consent and PostHog. */
export const ANALYTICS_READY_WAIT_MS = 60_000;

/** MMKV (`qariah-notifications`): the `notification_scheduled` props of background posts. */
export const QUEUED_SCHEDULED_EVENTS_KEY = 'pending_scheduled_events';
export const MAX_QUEUED_EVENTS = 20;

/** The part of `analyticsService` and `qariahAnalytics` that this module uses. */
export interface NotificationAnalyticsSink {
  isReadyToCapture(): boolean;
  onReadyToCapture(listener: () => void): () => void;
  trackNotificationPermissionPrompted(
    props: NotificationPermissionPromptedProps,
  ): void;
  trackNotificationPermissionResult(
    props: NotificationPermissionResultProps,
  ): void;
  trackNotificationScheduled(props: NotificationScheduledProps): void;
  trackNotificationOpened(props: NotificationOpenedProps): void;
}

function defaultSink(): NotificationAnalyticsSink {
  const {analyticsService} =
    require('@/services/analytics/AnalyticsService') as typeof import('@/services/analytics/AnalyticsService');
  const {qariahAnalytics} =
    require('@/services/analytics/qariahEvents') as typeof import('@/services/analytics/qariahEvents');
  return {
    isReadyToCapture: () => analyticsService.isReadyToCapture(),
    onReadyToCapture: listener => analyticsService.onReadyToCapture(listener),
    trackNotificationPermissionPrompted: props =>
      qariahAnalytics.trackNotificationPermissionPrompted(props),
    trackNotificationPermissionResult: props =>
      qariahAnalytics.trackNotificationPermissionResult(props),
    trackNotificationScheduled: props =>
      qariahAnalytics.trackNotificationScheduled(props),
    trackNotificationOpened: props =>
      qariahAnalytics.trackNotificationOpened(props),
  };
}

let sinkOverride: NotificationAnalyticsSink | null = null;

/** Tests only: the sink of every call. `null` restores the app's. */
export function __setNotificationAnalyticsSinkForTests(
  sink: NotificationAnalyticsSink | null,
): void {
  sinkOverride = sink;
}

function sink(): NotificationAnalyticsSink {
  return sinkOverride ?? defaultSink();
}

/**
 * Runs `send` once the analytics are ready, or drops it after `waitMs`
 * (the consent was never read). Never throws.
 */
export function sendWhenReady(
  send: (target: NotificationAnalyticsSink) => void,
  waitMs: number = ANALYTICS_READY_WAIT_MS,
): Promise<boolean> {
  return new Promise(resolve => {
    let target: NotificationAnalyticsSink;
    try {
      target = sink();
    } catch {
      resolve(false);
      return;
    }
    const run = (): void => {
      try {
        send(target);
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    try {
      if (target.isReadyToCapture()) {
        run();
        return;
      }
      let unsubscribe: () => void = () => undefined;
      const timer = setTimeout(() => {
        unsubscribe();
        if (target.isReadyToCapture()) run();
        else resolve(false);
      }, waitMs);
      unsubscribe = target.onReadyToCapture(() => {
        if (!target.isReadyToCapture()) return;
        clearTimeout(timer);
        unsubscribe();
        run();
      });
    } catch {
      resolve(false);
    }
  });
}

/** The announcement id in a `whats_new:<id>` notice id, else `null`. */
export function announcementIdOf(notificationId: string): string | null {
  return notificationId.startsWith('whats_new:')
    ? notificationId.slice('whats_new:'.length)
    : null;
}

export function trackPermissionPrompted(
  source: NotificationPermissionSource,
): Promise<boolean> {
  return sendWhenReady(target =>
    target.trackNotificationPermissionPrompted({
      source,
      platform: Platform.OS,
    }),
  );
}

export function trackPermissionResult(
  source: NotificationPermissionSource,
  answer: NotificationPermissionResultProps['answer'],
  permission: NotificationPermissionSnapshot | null,
): Promise<boolean> {
  const status = permission?.status ?? 'undetermined';
  return sendWhenReady(target =>
    target.trackNotificationPermissionResult({
      source,
      granted: permission?.granted === true || status === 'granted',
      status,
      answer,
      platform: Platform.OS,
    }),
  );
}

/** The props of a scheduled or posted notice. */
export function scheduledProps(
  candidate: Pick<NotificationCandidate, 'type' | 'dedupeKey'>,
  trigger: NotificationTrigger['kind'],
  source: NotificationScheduledProps['source'],
): NotificationScheduledProps {
  return {
    type: candidate.type,
    trigger,
    source,
    announcement_id: announcementIdOf(candidate.dedupeKey),
    platform: Platform.OS,
  };
}

export function trackNotificationScheduled(
  props: NotificationScheduledProps,
): Promise<boolean> {
  return sendWhenReady(target => target.trackNotificationScheduled(props));
}

export function trackNotificationOpened(
  tap: NotificationTap,
  coldStart: boolean,
  result: OpenTapResult,
): Promise<boolean> {
  return sendWhenReady(target =>
    target.trackNotificationOpened({
      type: tap.type,
      cold_start: coldStart,
      result,
      announcement_id: announcementIdOf(tap.id),
      platform: Platform.OS,
    }),
  );
}

function readQueue(storage: KeyValueStorage): NotificationScheduledProps[] {
  try {
    const raw = storage.getString(QUEUED_SCHEDULED_EVENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed.filter(
          item => item && typeof item === 'object' && 'type' in item,
        ) as NotificationScheduledProps[])
      : [];
  } catch {
    return [];
  }
}

/**
 * The stored analytics consent: `true` only when it is read and ON. A headless
 * run can start before the consent store is read; then nothing is queued.
 */
export function isAnalyticsConsentGranted(): boolean {
  try {
    const {useAnalyticsConsentStore} =
      require('@/store/analyticsConsentStore') as typeof import('@/store/analyticsConsentStore');
    return (
      useAnalyticsConsentStore.persist.hasHydrated() &&
      useAnalyticsConsentStore.getState().analyticsEnabled
    );
  } catch {
    return false;
  }
}

/**
 * Keeps the event of a background post for the next start, but only when the
 * stored consent is ON (review of Task 16, L5): a user who turned the
 * analytics off gets no event written on the device. Never throws.
 */
export function queueScheduledEvent(
  props: NotificationScheduledProps,
  storage: KeyValueStorage = notificationsStorage,
  consentGranted: () => boolean = isAnalyticsConsentGranted,
): void {
  try {
    if (!consentGranted()) return;
    const queue = [...readQueue(storage), props].slice(-MAX_QUEUED_EVENTS);
    storage.set(QUEUED_SCHEDULED_EVENTS_KEY, JSON.stringify(queue));
  } catch {
    // A lost event, not a lost notice.
  }
}

/**
 * Removes the sent items from the stored queue, one stored item for each sent
 * one. Items that a background run added during the wait stay.
 */
function removeSent(
  storage: KeyValueStorage,
  sent: readonly NotificationScheduledProps[],
): void {
  const toRemove = new Map<string, number>();
  for (const item of sent) {
    const key = JSON.stringify(item);
    toRemove.set(key, (toRemove.get(key) ?? 0) + 1);
  }
  const rest = readQueue(storage).filter(item => {
    const key = JSON.stringify(item);
    const left = toRemove.get(key) ?? 0;
    if (left === 0) return true;
    toRemove.set(key, left - 1);
    return false;
  });
  if (rest.length === 0) storage.remove(QUEUED_SCHEDULED_EVENTS_KEY);
  else storage.set(QUEUED_SCHEDULED_EVENTS_KEY, JSON.stringify(rest));
}

/**
 * Sends the queued events of background posts, once the analytics are
 * ready; then removes the sent ones from the queue (review L5: an event that a
 * background run queued during the wait stays for the next start). With
 * consent off, the capture drops them and they leave the queue too. Resolves
 * the number sent. Never throws.
 */
export async function flushQueuedScheduledEvents(
  storage: KeyValueStorage = notificationsStorage,
  waitMs: number = ANALYTICS_READY_WAIT_MS,
): Promise<number> {
  const queue = readQueue(storage);
  if (queue.length === 0) return 0;
  const sent = await sendWhenReady(target => {
    for (const props of queue) target.trackNotificationScheduled(props);
  }, waitMs);
  if (!sent) return 0;
  try {
    removeSent(storage, queue);
  } catch {
    // The next start sends them again: a duplicate, not a loss.
  }
  return queue.length;
}
