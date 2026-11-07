// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the notification events wait for the
// consent, carry their props, and a background post waits in a queue for the
// next start.
import {Platform} from 'react-native';
import {
  MAX_QUEUED_EVENTS,
  QUEUED_SCHEDULED_EVENTS_KEY,
  __setNotificationAnalyticsSinkForTests,
  announcementIdOf,
  flushQueuedScheduledEvents,
  queueScheduledEvent,
  scheduledProps,
  sendWhenReady,
  trackNotificationOpened,
  trackNotificationScheduled,
  trackPermissionPrompted,
  trackPermissionResult,
  type NotificationAnalyticsSink,
} from '../notificationAnalytics';
import {QARIAH_ANALYTICS_EVENTS} from '@/services/analytics/qariahEvents';
import type {KeyValueStorage} from '../types';

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

function fakeSink(ready = true): NotificationAnalyticsSink & {
  setReady(value: boolean): void;
  events: [string, Record<string, unknown>][];
} {
  let isReady = ready;
  const listeners = new Set<() => void>();
  const events: [string, Record<string, unknown>][] = [];
  const record = (name: string) => (props: object) =>
    events.push([name, {...props} as Record<string, unknown>]);
  return {
    events,
    isReadyToCapture: () => isReady,
    onReadyToCapture: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setReady: value => {
      isReady = value;
      listeners.forEach(listener => listener());
    },
    trackNotificationPermissionPrompted: record('prompted'),
    trackNotificationPermissionResult: record('result'),
    trackNotificationScheduled: record('scheduled'),
    trackNotificationOpened: record('opened'),
  };
}

function memoryStorage(): KeyValueStorage & {values: Map<string, string>} {
  const values = new Map<string, string>();
  return {
    values,
    getString: key => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    remove: key => {
      values.delete(key);
    },
  };
}

afterEach(() => {
  __setNotificationAnalyticsSinkForTests(null);
  jest.useRealTimers();
});

describe('the event names', () => {
  it('are the names of the sprint plan', () => {
    expect(QARIAH_ANALYTICS_EVENTS).toMatchObject({
      NOTIFICATION_PERMISSION_PROMPTED: 'notification_permission_prompted',
      NOTIFICATION_PERMISSION_RESULT: 'notification_permission_result',
      NOTIFICATION_SCHEDULED: 'notification_scheduled',
      NOTIFICATION_OPENED: 'notification_opened',
    });
  });
});

describe('sendWhenReady', () => {
  it('sends at once when ready, else when ready, else drops after the wait', async () => {
    jest.useFakeTimers();
    const sink = fakeSink(true);
    __setNotificationAnalyticsSinkForTests(sink);
    await expect(
      sendWhenReady(target => target.trackNotificationScheduled({} as never)),
    ).resolves.toBe(true);

    sink.setReady(false);
    const later = sendWhenReady(target =>
      target.trackNotificationScheduled({} as never),
    );
    sink.setReady(true);
    await expect(later).resolves.toBe(true);

    sink.setReady(false);
    const never = sendWhenReady(
      target => target.trackNotificationScheduled({} as never),
      1000,
    );
    jest.advanceTimersByTime(1000);
    await expect(never).resolves.toBe(false);
    expect(sink.events).toHaveLength(2);
  });
});

describe('the props', () => {
  beforeEach(() => {
    __setNotificationAnalyticsSinkForTests(fakeSink(true));
  });

  it('prompted and result carry the source and the answer', async () => {
    const sink = fakeSink(true);
    __setNotificationAnalyticsSinkForTests(sink);
    await trackPermissionPrompted('soft_prompt');
    await trackPermissionResult('soft_prompt', 'allow', {
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
    await trackPermissionResult('soft_prompt', 'not_now', null);
    await trackPermissionResult('settings', 'system', {
      status: 'denied',
      granted: false,
      canAskAgain: false,
    });
    expect(sink.events).toEqual([
      ['prompted', {source: 'soft_prompt', platform: Platform.OS}],
      [
        'result',
        {
          source: 'soft_prompt',
          granted: true,
          status: 'granted',
          answer: 'allow',
          platform: Platform.OS,
        },
      ],
      [
        'result',
        {
          source: 'soft_prompt',
          granted: false,
          status: 'undetermined',
          answer: 'not_now',
          platform: Platform.OS,
        },
      ],
      [
        'result',
        {
          source: 'settings',
          granted: false,
          status: 'denied',
          answer: 'system',
          platform: Platform.OS,
        },
      ],
    ]);
  });

  it('scheduled carries the type, the trigger, the source and an announcement id', async () => {
    expect(
      scheduledProps(
        {type: 'whats_new', dedupeKey: 'whats_new:2026-10-sprint48'},
        'immediate',
        'background',
      ),
    ).toEqual({
      type: 'whats_new',
      trigger: 'immediate',
      source: 'background',
      announcement_id: '2026-10-sprint48',
      platform: Platform.OS,
    });
    expect(
      scheduledProps(
        {type: 'kahf_friday', dedupeKey: 'kahf_friday'},
        'weekly',
        'sync',
      ).announcement_id,
    ).toBeNull();
    const sink = fakeSink(true);
    __setNotificationAnalyticsSinkForTests(sink);
    await trackNotificationScheduled(
      scheduledProps(
        {type: 'kahf_friday', dedupeKey: 'kahf_friday'},
        'weekly',
        'sync',
      ),
    );
    expect(sink.events[0][0]).toBe('scheduled');
  });

  it('opened carries the type, cold_start, the result and an announcement id', async () => {
    const sink = fakeSink(true);
    __setNotificationAnalyticsSinkForTests(sink);
    await trackNotificationOpened(
      {
        key: 'k',
        id: 'whats_new:2026-10-sprint48',
        type: 'whats_new',
        target: {kind: 'listen'},
      },
      true,
      'listen',
    );
    expect(sink.events).toEqual([
      [
        'opened',
        {
          type: 'whats_new',
          cold_start: true,
          result: 'listen',
          announcement_id: '2026-10-sprint48',
          platform: Platform.OS,
        },
      ],
    ]);
    expect(announcementIdOf('kahf_friday')).toBeNull();
  });
});

const GRANTED = () => true;

describe('the queue of background posts', () => {
  it('L5: queues nothing unless the stored consent is ON', () => {
    const storage = memoryStorage();
    const props = scheduledProps(
      {type: 'kahf_friday', dedupeKey: 'kahf_friday'},
      'immediate',
      'background',
    );
    queueScheduledEvent(props, storage, () => false);
    expect(storage.values.has(QUEUED_SCHEDULED_EVENTS_KEY)).toBe(false);
    queueScheduledEvent(props, storage, GRANTED);
    expect(storage.values.has(QUEUED_SCHEDULED_EVENTS_KEY)).toBe(true);
  });

  it('L5: a flush removes only the sent items; one queued during the wait stays', async () => {
    jest.useFakeTimers();
    const storage = memoryStorage();
    const first = scheduledProps(
      {type: 'followed_recitation', dedupeKey: 'a'},
      'immediate',
      'background',
    );
    const later = scheduledProps(
      {type: 'whats_new', dedupeKey: 'whats_new:2026-10-sprint48'},
      'immediate',
      'background',
    );
    queueScheduledEvent(first, storage, GRANTED);
    const sink = fakeSink(false);
    __setNotificationAnalyticsSinkForTests(sink);
    const flushed = flushQueuedScheduledEvents(storage, 60_000);
    // A background run posts during the wait.
    queueScheduledEvent(later, storage, GRANTED);
    sink.setReady(true);
    await expect(flushed).resolves.toBe(1);
    expect(sink.events).toEqual([['scheduled', first]]);
    expect(
      JSON.parse(storage.values.get(QUEUED_SCHEDULED_EVENTS_KEY) ?? '[]'),
    ).toEqual([later]);
  });

  it('keeps the events, sends them at the next start, then empties', async () => {
    const storage = memoryStorage();
    const props = scheduledProps(
      {type: 'followed_recitation', dedupeKey: 'followed_recitation:k'},
      'immediate',
      'background',
    );
    queueScheduledEvent(props, storage, GRANTED);
    queueScheduledEvent(props, storage, GRANTED);
    const sink = fakeSink(true);
    __setNotificationAnalyticsSinkForTests(sink);
    await expect(flushQueuedScheduledEvents(storage)).resolves.toBe(2);
    expect(sink.events).toEqual([
      ['scheduled', props],
      ['scheduled', props],
    ]);
    expect(storage.values.has(QUEUED_SCHEDULED_EVENTS_KEY)).toBe(false);
    await expect(flushQueuedScheduledEvents(storage)).resolves.toBe(0);
  });

  it('keeps at most the newest MAX_QUEUED_EVENTS', () => {
    const storage = memoryStorage();
    for (let i = 0; i < MAX_QUEUED_EVENTS + 5; i++) {
      queueScheduledEvent(
        {
          ...scheduledProps(
            {type: 'new_recitation', dedupeKey: `k${i}`},
            'immediate',
            'background',
          ),
          type: `t${i}`,
        },
        storage,
        GRANTED,
      );
    }
    const queue = JSON.parse(
      storage.values.get(QUEUED_SCHEDULED_EVENTS_KEY) ?? '[]',
    ) as {type: string}[];
    expect(queue).toHaveLength(MAX_QUEUED_EVENTS);
    expect(queue[0].type).toBe('t5');
  });

  it('keeps the queue when the analytics never get ready', async () => {
    jest.useFakeTimers();
    const storage = memoryStorage();
    queueScheduledEvent(
      scheduledProps(
        {type: 'whats_new', dedupeKey: 'whats_new:x'},
        'immediate',
        'background',
      ),
      storage,
      GRANTED,
    );
    __setNotificationAnalyticsSinkForTests(fakeSink(false));
    const flushed = flushQueuedScheduledEvents(storage, 1000);
    jest.advanceTimersByTime(1000);
    await expect(flushed).resolves.toBe(0);
    expect(storage.values.has(QUEUED_SCHEDULED_EVENTS_KEY)).toBe(true);
  });

  it('a broken queue value counts as empty', async () => {
    const storage = memoryStorage();
    storage.set(QUEUED_SCHEDULED_EVENTS_KEY, '{not json');
    __setNotificationAnalyticsSinkForTests(fakeSink(true));
    await expect(flushQueuedScheduledEvents(storage)).resolves.toBe(0);
  });
});
