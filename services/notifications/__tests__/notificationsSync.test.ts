// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the sync of the native notification
// state with the holdout arm, the permission and the toggles.
import {DEFAULT_NOTIFICATION_TYPE_PREFS} from '../prefsStore';
import {
  NOTIFICATIONS_WERE_ACTIVE_KEY,
  __resetNotificationsSyncForTests,
  cancelAllScheduledNotifications,
  onNotificationsSynced,
  syncKahfReminder,
  syncNotifications,
  type NotificationsSyncDeps,
} from '../notificationsSync';
import {KAHF_FRIDAY_TRIGGER} from '../scheduler';
import type {
  KeyValueStorage,
  NotificationPermissionStatus,
  NotificationPrefsSnapshot,
  Notifier,
} from '../types';

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

type FakeNotifier = Notifier & {
  scheduled: Map<string, string | null>;
  schedule: jest.Mock;
  cancel: jest.Mock;
  cancelByType: jest.Mock;
  getPermission: jest.Mock;
};

function fakeNotifier(
  permission: NotificationPermissionStatus = 'granted',
  scheduled: [string, string | null][] = [],
): FakeNotifier {
  const map = new Map<string, string | null>(scheduled);
  return {
    scheduled: map,
    schedule: jest.fn(async (candidate: {dedupeKey: string; type: string}) => {
      map.set(candidate.dedupeKey, candidate.type);
      return candidate.dedupeKey;
    }),
    cancel: jest.fn(async (id: string) => {
      map.delete(id);
    }),
    cancelByType: jest.fn(async (type: string) => {
      for (const [id, t] of map) if (t === type) map.delete(id);
    }),
    getPermission: jest.fn(async () => permission),
    listScheduled: async () => [...map].map(([id, type]) => ({id, type})),
  };
}

const prefs = (
  overrides: Partial<NotificationPrefsSnapshot> = {},
): NotificationPrefsSnapshot => ({
  ...DEFAULT_NOTIFICATION_TYPE_PREFS,
  lastNotifiedDay: null,
  ...overrides,
});

function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & {values: Map<string, string>} {
  const values = new Map(Object.entries(initial));
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

function deps(
  notifier: FakeNotifier,
  overrides: Partial<NotificationsSyncDeps> = {},
): NotificationsSyncDeps & {
  register: jest.Mock;
  unregister: jest.Mock;
  prepare: jest.Mock;
} {
  return {
    notifier,
    isHoldout: () => false,
    readPrefs: async () => prefs(),
    register: jest.fn(async () => 'registered' as const),
    unregister: jest.fn(async () => true),
    prepare: jest.fn(async () => undefined),
    storage: memoryStorage(),
    ...overrides,
  } as never;
}

beforeEach(() => {
  __resetNotificationsSyncForTests();
});

describe('syncKahfReminder', () => {
  it('schedules ONE weekly reminder (Friday 09:00) while the toggle is on', async () => {
    const notifier = fakeNotifier();
    await expect(
      syncKahfReminder({
        notifier,
        holdout: false,
        permission: 'granted',
        prefs: prefs(),
      }),
    ).resolves.toBe('scheduled');
    expect(notifier.schedule).toHaveBeenCalledWith(
      expect.objectContaining({type: 'kahf_friday', dedupeKey: 'kahf_friday'}),
      KAHF_FRIDAY_TRIGGER,
    );
    expect([...notifier.scheduled]).toEqual([['kahf_friday', 'kahf_friday']]);
  });

  it('is idempotent: a second sync replaces the same id (never two)', async () => {
    const notifier = fakeNotifier('granted', [['kahf_friday', 'kahf_friday']]);
    const input = {
      notifier,
      holdout: false,
      permission: 'granted' as const,
      prefs: prefs(),
    };
    await expect(syncKahfReminder(input)).resolves.toBe('rescheduled');
    await expect(syncKahfReminder(input)).resolves.toBe('rescheduled');
    expect([...notifier.scheduled.keys()]).toEqual(['kahf_friday']);
  });

  it('keeps exactly one: another id of the type goes', async () => {
    const notifier = fakeNotifier('granted', [
      ['kahf_friday:old', 'kahf_friday'],
      ['continue_listening', 'continue_listening'],
    ]);
    await syncKahfReminder({
      notifier,
      holdout: false,
      permission: 'granted',
      prefs: prefs(),
    });
    expect(notifier.cancel).toHaveBeenCalledWith('kahf_friday:old');
    expect([...notifier.scheduled.keys()].sort()).toEqual([
      'continue_listening',
      'kahf_friday',
    ]);
  });

  it.each([
    ['the toggle is off', {prefs: prefs({kahf_friday: false})}],
    ['no permission', {permission: 'denied' as const}],
    ['the holdout', {holdout: true}],
  ])('cancels the reminder when %s', async (_label, override) => {
    const notifier = fakeNotifier('granted', [['kahf_friday', 'kahf_friday']]);
    await expect(
      syncKahfReminder({
        notifier,
        holdout: false,
        permission: 'granted',
        prefs: prefs(),
        ...override,
      }),
    ).resolves.toBe('cancelled');
    expect(notifier.cancelByType).toHaveBeenCalledWith('kahf_friday');
    expect(notifier.scheduled.size).toBe(0);
  });

  it('off with nothing pending: no native cancel', async () => {
    const notifier = fakeNotifier();
    await expect(
      syncKahfReminder({
        notifier,
        holdout: false,
        permission: 'granted',
        prefs: prefs({kahf_friday: false}),
      }),
    ).resolves.toBe('off');
    expect(notifier.cancelByType).not.toHaveBeenCalled();
  });

  it('changes nothing when the toggles could not be read', async () => {
    const notifier = fakeNotifier('granted', [['kahf_friday', 'kahf_friday']]);
    await expect(
      syncKahfReminder({
        notifier,
        holdout: false,
        permission: 'granted',
        prefs: null,
      }),
    ).resolves.toBe('unchanged');
    expect(notifier.schedule).not.toHaveBeenCalled();
    expect(notifier.cancelByType).not.toHaveBeenCalled();
  });

  it('gives failed, and does not throw, when a native call fails', async () => {
    const notifier = fakeNotifier();
    notifier.schedule.mockRejectedValue(new Error('native'));
    await expect(
      syncKahfReminder({
        notifier,
        holdout: false,
        permission: 'granted',
        prefs: prefs(),
      }),
    ).resolves.toBe('failed');
  });
});

describe('cancelAllScheduledNotifications', () => {
  it('cancels each notification of the engine and leaves the others', async () => {
    const notifier = fakeNotifier('granted', [
      ['kahf_friday', 'kahf_friday'],
      ['continue_listening', 'continue_listening'],
      ['someone-else', null],
    ]);
    await expect(cancelAllScheduledNotifications(notifier)).resolves.toBe(2);
    expect([...notifier.scheduled.keys()]).toEqual(['someone-else']);
  });
});

describe('syncNotifications', () => {
  it('the holdout after the notify side ran: unregisters the task and cancels every scheduled notice', async () => {
    const notifier = fakeNotifier('granted', [
      ['kahf_friday', 'kahf_friday'],
      ['continue_listening', 'continue_listening'],
    ]);
    const storage = memoryStorage();
    // The notify side ran once (the arm was notify, or DEV).
    await syncNotifications('boot', deps(notifier, {storage}));
    expect(storage.values.get(NOTIFICATIONS_WERE_ACTIVE_KEY)).toBe('1');
    notifier.scheduled.set('continue_listening', 'continue_listening');
    const d = deps(notifier, {isHoldout: () => true, storage});
    const result = await syncNotifications('holdout_assigned', d);
    expect(result).toMatchObject({
      holdout: true,
      registration: 'unregistered',
      cancelled: 2,
    });
    expect(d.unregister).toHaveBeenCalledTimes(1);
    expect(d.register).not.toHaveBeenCalled();
    expect(d.prepare).not.toHaveBeenCalled();
    expect(notifier.scheduled.size).toBe(0);
    expect(storage.values.has(NOTIFICATIONS_WERE_ACTIVE_KEY)).toBe(false);
  });

  it('L1: a holdout user that never ran the notify side touches no notifier (expo-notifications stays unloaded)', async () => {
    const notifier = fakeNotifier();
    const getPermission = notifier.getPermission;
    const d = deps(notifier, {isHoldout: () => true});
    const result = await syncNotifications('boot', d);
    expect(result).toMatchObject({holdout: true, cancelled: 0});
    expect(d.unregister).toHaveBeenCalledTimes(1);
    expect(getPermission).not.toHaveBeenCalled();
    expect(notifier.cancel).not.toHaveBeenCalled();
    expect(notifier.cancelByType).not.toHaveBeenCalled();
  });

  it('notify: registers, prepares and schedules the Al-Kahf reminder', async () => {
    const notifier = fakeNotifier();
    const d = deps(notifier);
    const result = await syncNotifications('boot', d);
    expect(result).toMatchObject({
      holdout: false,
      permission: 'granted',
      registration: 'registered',
      kahf: 'scheduled',
      continueCancelled: false,
    });
    expect(d.register).toHaveBeenCalledTimes(1);
    expect(d.prepare).toHaveBeenCalledTimes(1);
    expect(notifier.scheduled.has('kahf_friday')).toBe(true);
  });

  it('cancels "continue listening" when its toggle is off or there is no permission', async () => {
    for (const [permission, toggles] of [
      ['granted', prefs({continue_listening: false})],
      ['denied', prefs()],
    ] as const) {
      const notifier = fakeNotifier(permission, [
        ['continue_listening', 'continue_listening'],
      ]);
      const result = await syncNotifications(
        'foreground',
        deps(notifier, {readPrefs: async () => toggles}),
      );
      expect(result.continueCancelled).toBe(true);
      expect(notifier.scheduled.has('continue_listening')).toBe(false);
    }
  });

  it('keeps "continue listening" while its toggle is on', async () => {
    const notifier = fakeNotifier('granted', [
      ['continue_listening', 'continue_listening'],
    ]);
    await syncNotifications('foreground', deps(notifier));
    expect(notifier.scheduled.has('continue_listening')).toBe(true);
  });

  it('changes no scheduled notice when the toggles could not be read', async () => {
    const notifier = fakeNotifier('granted', [
      ['continue_listening', 'continue_listening'],
    ]);
    const result = await syncNotifications(
      'boot',
      deps(notifier, {readPrefs: async () => null}),
    );
    expect(result.kahf).toBe('unchanged');
    expect(notifier.schedule).not.toHaveBeenCalled();
    expect(notifier.cancelByType).not.toHaveBeenCalled();
  });

  it('runs one sync at a time, and one more after it for the calls meanwhile', async () => {
    const notifier = fakeNotifier();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const d = deps(notifier, {
      register: jest.fn(async () => {
        await gate;
        return 'registered' as const;
      }),
    });
    const first = syncNotifications('boot', d);
    const second = syncNotifications('foreground', d);
    const third = syncNotifications('foreground', d);
    expect(second).toBe(third);
    release();
    await Promise.all([first, second, third]);
    expect(d.register).toHaveBeenCalledTimes(2);
  });

  it('a NEW Al-Kahf reminder sends notification_scheduled; a replaced one does not', async () => {
    const {__setNotificationAnalyticsSinkForTests} =
      require('../notificationAnalytics') as typeof import('../notificationAnalytics');
    const scheduled: unknown[] = [];
    __setNotificationAnalyticsSinkForTests({
      isReadyToCapture: () => true,
      onReadyToCapture: () => () => undefined,
      trackNotificationPermissionPrompted: jest.fn(),
      trackNotificationPermissionResult: jest.fn(),
      trackNotificationScheduled: props => scheduled.push(props),
      trackNotificationOpened: jest.fn(),
    });
    try {
      const notifier = fakeNotifier();
      await syncNotifications('boot', deps(notifier));
      await syncNotifications('foreground', deps(notifier));
      expect(scheduled).toEqual([
        expect.objectContaining({
          type: 'kahf_friday',
          trigger: 'weekly',
          source: 'sync',
        }),
      ]);
    } finally {
      __setNotificationAnalyticsSinkForTests(null);
    }
  });

  it('tells the listeners, and never rejects', async () => {
    const listener = jest.fn();
    onNotificationsSynced(listener);
    const notifier = fakeNotifier();
    const d = deps(notifier, {
      register: jest.fn(async () => {
        throw new Error('native');
      }),
    });
    const result = await syncNotifications('boot', d);
    expect(result.failed).toBe(true);
    expect(listener).toHaveBeenCalledWith(result);
  });
});
