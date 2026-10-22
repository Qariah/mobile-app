// @ai-generated
// Qariah (Sprint 48, S48.6): the task definition, the registration and the
// boot hook (`startQariahNotifications`), with mocked native modules.
import type {Reciter} from '@/data/reciterData';

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));
jest.mock('expo-background-task', () => ({
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
  BackgroundTaskStatus: {Restricted: 1, Available: 2},
  BackgroundTaskResult: {Success: 1, Failed: 2},
}));
jest.mock('../catalogTask', () => ({
  runQariahCatalogTask: jest.fn(async (source: string) => ({
    source,
    status: 'first_check',
  })),
}));
jest.mock('../expoNotifier', () => {
  const getPermission = jest.fn(async () => 'granted');
  return {
    installNotificationHandler: jest.fn(),
    ensureNotificationChannels: jest.fn(async () => true),
    createExpoNotifier: () => ({getPermission}),
    __getPermission: getPermission,
  };
});
jest.mock('../holdout', () => ({isNotificationsHoldout: jest.fn(() => false)}));
jest.mock('../catalogDiff', () => {
  const load = jest.fn((): Set<string> | null => new Set(['r|w|1||']));
  return {
    createCatalogSnapshotStore: () => ({load}),
    notificationsStorage: {},
    __load: load,
  };
});
jest.mock('../announcementStore', () => ({
  backgroundAnnouncementCandidate: jest.fn(async () => null),
  recordPostedAnnouncement: jest.fn(() => true),
}));
jest.mock('../notificationScheduling', () => ({
  startNotificationScheduling: jest.fn(),
  setNotificationSchedulingReady: jest.fn(),
}));
jest.mock('../backgroundRunReport', () => ({
  reportBackgroundRun: jest.fn(async () => 'nothing'),
}));
jest.mock('@/data/reciterData', () => ({RECITERS: [] as unknown[]}));
jest.mock('@/services/liveCatalogSignal', () => {
  const listeners = new Set<() => void>();
  const state = {live: false};
  return {
    isLiveCatalogInMemory: () => state.live,
    subscribeLiveCatalogLoaded: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    __listeners: listeners,
    __state: state,
  };
});

const TaskManager = jest.requireMock('expo-task-manager') as {
  defineTask: jest.Mock;
  isTaskDefined: jest.Mock;
  isTaskRegisteredAsync: jest.Mock;
};
const BackgroundTask = jest.requireMock('expo-background-task') as {
  getStatusAsync: jest.Mock;
  registerTaskAsync: jest.Mock;
  unregisterTaskAsync: jest.Mock;
};
const announcementStore = jest.requireMock('../announcementStore') as {
  backgroundAnnouncementCandidate: jest.Mock;
  recordPostedAnnouncement: jest.Mock;
};
const scheduling = jest.requireMock('../notificationScheduling') as {
  startNotificationScheduling: jest.Mock;
  setNotificationSchedulingReady: jest.Mock;
};
const catalogTask = jest.requireMock('../catalogTask') as {
  runQariahCatalogTask: jest.Mock;
};
const expoNotifier = jest.requireMock('../expoNotifier') as {
  installNotificationHandler: jest.Mock;
  ensureNotificationChannels: jest.Mock;
  __getPermission: jest.Mock;
};
const holdout = jest.requireMock('../holdout') as {
  isNotificationsHoldout: jest.Mock;
};
const catalogDiff = jest.requireMock('../catalogDiff') as {__load: jest.Mock};
const runReport = jest.requireMock('../backgroundRunReport') as {
  reportBackgroundRun: jest.Mock;
};
const reciterData = jest.requireMock('@/data/reciterData') as {
  RECITERS: Reciter[];
};
const liveSignal = jest.requireMock('@/services/liveCatalogSignal') as {
  __listeners: Set<() => void>;
  __state: {live: boolean};
};

import {
  CATALOG_TASK_MINIMUM_INTERVAL_MINUTES,
  FOREGROUND_CATALOG_WAIT_MS,
  NOTIFICATIONS_START_DELAY_MS,
  QARIAH_CATALOG_TASK,
  __resetQariahNotificationsStartForTests,
  defineQariahCatalogTask,
  onNotificationsHoldoutAssigned,
  registerQariahCatalogTask,
  startQariahNotifications,
  unregisterQariahCatalogTask,
} from '../backgroundTask';

/** A network catalog lands in memory (services/liveCatalogSignal.ts). */
function loadLiveCatalog(): void {
  liveSignal.__state.live = true;
  liveSignal.__listeners.forEach(listener => listener());
}

/** A cache or bundled fill: the catalog in memory is not the network one. */
function loadCachedCatalog(): void {
  liveSignal.__state.live = false;
}

/** Let the promise chains of the fire-and-forget work settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  holdout.isNotificationsHoldout.mockReturnValue(false);
  TaskManager.isTaskDefined.mockReturnValue(false);
  TaskManager.isTaskRegisteredAsync.mockResolvedValue(false);
  BackgroundTask.getStatusAsync.mockResolvedValue(2);
  expoNotifier.__getPermission.mockResolvedValue('granted');
  catalogDiff.__load.mockReturnValue(new Set(['r|w|1||']));
  reciterData.RECITERS.splice(0, reciterData.RECITERS.length);
  liveSignal.__listeners.clear();
  liveSignal.__state.live = false;
  __resetQariahNotificationsStartForTests();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('defineQariahCatalogTask', () => {
  it('defines the task once, and its body runs the background check and reports success', async () => {
    defineQariahCatalogTask();
    expect(TaskManager.defineTask).toHaveBeenCalledTimes(1);
    const [name, executor] = TaskManager.defineTask.mock.calls[0] as [
      string,
      () => Promise<number>,
    ];
    expect(name).toBe(QARIAH_CATALOG_TASK);
    await expect(executor()).resolves.toBe(1);
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledWith(
      'background',
      {},
    );

    TaskManager.isTaskDefined.mockReturnValue(true);
    defineQariahCatalogTask();
    expect(TaskManager.defineTask).toHaveBeenCalledTimes(1);
  });

  it('gives the whats_new candidate to the background check, and records it after the post', async () => {
    const candidate = {
      type: 'whats_new',
      dedupeKey: 'whats_new:2026-10-sprint48',
    };
    announcementStore.backgroundAnnouncementCandidate.mockResolvedValueOnce(
      candidate,
    );
    catalogTask.runQariahCatalogTask.mockResolvedValueOnce({
      source: 'background',
      status: 'posted',
      check: {posted: candidate},
    });
    defineQariahCatalogTask();
    const executor = TaskManager.defineTask.mock
      .calls[0][1] as () => Promise<number>;
    await expect(executor()).resolves.toBe(1);
    const [source, deps] = catalogTask.runQariahCatalogTask.mock.calls[0] as [
      string,
      {extraCandidates: () => unknown[]},
    ];
    expect(source).toBe('background');
    expect(deps.extraCandidates()).toEqual([candidate]);
    expect(announcementStore.recordPostedAnnouncement).toHaveBeenCalledWith(
      candidate,
      candidate,
    );
  });

  it('gives no whats_new candidate while its switch is off', async () => {
    const {useNotificationPrefsStore} =
      require('../prefsStore') as typeof import('../prefsStore');
    useNotificationPrefsStore.getState().setTypeEnabled('whats_new', false);
    try {
      defineQariahCatalogTask();
      const executor = TaskManager.defineTask.mock
        .calls[0][1] as () => Promise<number>;
      await executor();
      expect(
        announcementStore.backgroundAnnouncementCandidate,
      ).not.toHaveBeenCalled();
      expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledWith(
        'background',
        {},
      );
      expect(announcementStore.recordPostedAnnouncement).not.toHaveBeenCalled();
    } finally {
      useNotificationPrefsStore.getState().setTypeEnabled('whats_new', true);
    }
  });

  it('reports success and does not throw when the body throws', async () => {
    defineQariahCatalogTask();
    const executor = TaskManager.defineTask.mock
      .calls[0][1] as () => Promise<number>;
    catalogTask.runQariahCatalogTask.mockRejectedValueOnce(new Error('boom'));
    await expect(executor()).resolves.toBe(1);
  });

  it('does not throw when defineTask throws', () => {
    TaskManager.defineTask.mockImplementationOnce(() => {
      throw new Error('no task manager');
    });
    expect(() => defineQariahCatalogTask()).not.toThrow();
  });
});

describe('registerQariahCatalogTask', () => {
  it('registers the task with a minimum interval of 12 hours', async () => {
    await expect(registerQariahCatalogTask()).resolves.toBe('registered');
    expect(CATALOG_TASK_MINIMUM_INTERVAL_MINUTES).toBe(720);
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(
      QARIAH_CATALOG_TASK,
      {minimumInterval: 720},
    );
  });

  it('does not register a task that is registered', async () => {
    TaskManager.isTaskRegisteredAsync.mockResolvedValue(true);
    await expect(registerQariahCatalogTask()).resolves.toBe(
      'already_registered',
    );
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('does not register when the OS restricts background tasks', async () => {
    BackgroundTask.getStatusAsync.mockResolvedValue(1);
    await expect(registerQariahCatalogTask()).resolves.toBe('restricted');
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('unregisters the task of a holdout user', async () => {
    holdout.isNotificationsHoldout.mockReturnValue(true);
    TaskManager.isTaskRegisteredAsync.mockResolvedValue(true);
    await expect(registerQariahCatalogTask()).resolves.toBe(
      'unregistered_holdout',
    );
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(
      QARIAH_CATALOG_TASK,
    );
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('registers nothing for a holdout user with no task', async () => {
    holdout.isNotificationsHoldout.mockReturnValue(true);
    await expect(registerQariahCatalogTask()).resolves.toBe('holdout');
    expect(BackgroundTask.unregisterTaskAsync).not.toHaveBeenCalled();
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('does not register without the notification permission', async () => {
    expoNotifier.__getPermission.mockResolvedValue('undetermined');
    await expect(registerQariahCatalogTask()).resolves.toBe('no_permission');
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('unregisters the task when the permission was taken back', async () => {
    expoNotifier.__getPermission.mockResolvedValue('denied');
    TaskManager.isTaskRegisteredAsync.mockResolvedValue(true);
    await expect(registerQariahCatalogTask()).resolves.toBe(
      'unregistered_no_permission',
    );
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(
      QARIAH_CATALOG_TASK,
    );
  });

  it('gives failed when the permission read fails', async () => {
    expoNotifier.__getPermission.mockRejectedValueOnce(new Error('no'));
    await expect(registerQariahCatalogTask()).resolves.toBe('failed');
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('gives failed and does not throw when the native call fails', async () => {
    BackgroundTask.registerTaskAsync.mockRejectedValueOnce(new Error('no'));
    await expect(registerQariahCatalogTask()).resolves.toBe('failed');
  });

  it('unregisterQariahCatalogTask does not throw', async () => {
    TaskManager.isTaskRegisteredAsync.mockRejectedValueOnce(new Error('no'));
    await expect(unregisterQariahCatalogTask()).resolves.toBe(false);
  });
});

describe('startQariahNotifications', () => {
  it('returns at once; after the delay it registers, prepares and reports', async () => {
    jest.useFakeTimers();
    startQariahNotifications();
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
    expect(expoNotifier.installNotificationHandler).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS);
    await flush();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledTimes(1);
    expect(expoNotifier.installNotificationHandler).toHaveBeenCalledTimes(1);
    expect(expoNotifier.ensureNotificationChannels).toHaveBeenCalledTimes(1);
    expect(runReport.reportBackgroundRun).toHaveBeenCalledTimes(1);
  });

  it('starts the scheduling subscriptions at once, and lets them act after the boot sync', async () => {
    jest.useFakeTimers();
    startQariahNotifications();
    expect(scheduling.startNotificationScheduling).toHaveBeenCalledTimes(1);
    expect(scheduling.setNotificationSchedulingReady).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS);
    await flush();
    expect(scheduling.setNotificationSchedulingReady).toHaveBeenCalledTimes(1);
  });

  it('prepares no notification for a holdout user', async () => {
    jest.useFakeTimers();
    holdout.isNotificationsHoldout.mockReturnValue(true);
    startQariahNotifications();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS);
    await flush();
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
    expect(expoNotifier.installNotificationHandler).not.toHaveBeenCalled();
    expect(expoNotifier.ensureNotificationChannels).not.toHaveBeenCalled();
  });

  it('with no stored snapshot, waits for the network catalog of the boot and checks it (no second download)', async () => {
    jest.useFakeTimers();
    catalogDiff.__load.mockReturnValue(null);
    reciterData.RECITERS.push({id: 'seed'} as unknown as Reciter);
    loadCachedCatalog(); // the bundled seed is in memory
    startQariahNotifications();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS + 5_000);
    expect(catalogTask.runQariahCatalogTask).not.toHaveBeenCalled();
    loadLiveCatalog();
    await flush();
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledTimes(1);
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledWith(
      'foreground',
      expect.objectContaining({catalog: expect.any(Array)}),
    );
    await jest.advanceTimersByTimeAsync(FOREGROUND_CATALOG_WAIT_MS);
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledTimes(1);
  });

  it('with no stored snapshot and no network catalog in time, fetches the catalog itself', async () => {
    jest.useFakeTimers();
    catalogDiff.__load.mockReturnValue(null);
    reciterData.RECITERS.push({id: 'seed'} as unknown as Reciter);
    startQariahNotifications();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS);
    expect(catalogTask.runQariahCatalogTask).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(FOREGROUND_CATALOG_WAIT_MS);
    await flush();
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledTimes(1);
    // No catalog: the body reads the version and downloads.
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledWith(
      'foreground',
      {},
    );
  });

  it('with a snapshot and a network catalog in memory, checks a copy of it after the delay', async () => {
    jest.useFakeTimers();
    const catalog = [{id: 'r1'}] as unknown as Reciter[];
    reciterData.RECITERS.push(...catalog);
    loadLiveCatalog();
    startQariahNotifications();
    await flush();
    expect(catalogTask.runQariahCatalogTask).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS);
    await flush();
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledTimes(1);
    const [source, deps] = catalogTask.runQariahCatalogTask.mock.calls[0] as [
      string,
      {catalog: Reciter[]},
    ];
    expect(source).toBe('foreground');
    expect(deps.catalog).toEqual(catalog);
    expect(deps.catalog).not.toBe(reciterData.RECITERS);
    // Later network loads do not run it again.
    loadLiveCatalog();
    await jest.advanceTimersByTimeAsync(FOREGROUND_CATALOG_WAIT_MS);
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledTimes(1);
  });

  it('with a snapshot and a cached or bundled catalog, waits for a network catalog', async () => {
    jest.useFakeTimers();
    loadCachedCatalog();
    startQariahNotifications();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS + 10_000);
    expect(catalogTask.runQariahCatalogTask).not.toHaveBeenCalled();
    loadLiveCatalog();
    await flush();
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledWith(
      'foreground',
      expect.objectContaining({catalog: []}),
    );
    expect(liveSignal.__listeners.size).toBe(0);
  });

  it('does not run the foreground check when no network catalog comes', async () => {
    jest.useFakeTimers();
    startQariahNotifications();
    await jest.advanceTimersByTimeAsync(
      NOTIFICATIONS_START_DELAY_MS + FOREGROUND_CATALOG_WAIT_MS,
    );
    await flush();
    expect(catalogTask.runQariahCatalogTask).not.toHaveBeenCalled();
    expect(liveSignal.__listeners.size).toBe(0);
    loadLiveCatalog();
    await flush();
    expect(catalogTask.runQariahCatalogTask).not.toHaveBeenCalled();
  });

  it('a new holdout arm before the boot step does nothing (the boot step reads it)', async () => {
    jest.useFakeTimers();
    catalogDiff.__load.mockReturnValue(null);
    onNotificationsHoldoutAssigned('notify');
    await flush();
    expect(TaskManager.isTaskRegisteredAsync).not.toHaveBeenCalled();
    expect(catalogTask.runQariahCatalogTask).not.toHaveBeenCalled();
  });

  it('a new notify arm after the boot step syncs again and takes the first snapshot', async () => {
    jest.useFakeTimers();
    catalogDiff.__load.mockReturnValue(null);
    loadLiveCatalog(); // the network catalog of the boot is in memory
    startQariahNotifications();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS);
    await flush();
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledTimes(1);
    const registered = TaskManager.isTaskRegisteredAsync.mock.calls.length;
    onNotificationsHoldoutAssigned('notify');
    await jest.advanceTimersByTimeAsync(1000);
    await flush();
    expect(TaskManager.isTaskRegisteredAsync.mock.calls.length).toBeGreaterThan(
      registered,
    );
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledTimes(2);
  });

  it('a new holdout arm after the boot step syncs, and runs no catalog check', async () => {
    jest.useFakeTimers();
    catalogDiff.__load.mockReturnValue(null);
    loadLiveCatalog(); // the network catalog of the boot is in memory
    startQariahNotifications();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS);
    await flush();
    holdout.isNotificationsHoldout.mockReturnValue(true);
    onNotificationsHoldoutAssigned('holdout');
    await jest.advanceTimersByTimeAsync(1000);
    await flush();
    expect(catalogTask.runQariahCatalogTask).toHaveBeenCalledTimes(1);
  });

  it('starts once in a process', async () => {
    jest.useFakeTimers();
    startQariahNotifications();
    startQariahNotifications();
    await jest.advanceTimersByTimeAsync(NOTIFICATIONS_START_DELAY_MS);
    await flush();
    expect(TaskManager.isTaskRegisteredAsync).toHaveBeenCalledTimes(1);
    expect(runReport.reportBackgroundRun).toHaveBeenCalledTimes(1);
  });
});
