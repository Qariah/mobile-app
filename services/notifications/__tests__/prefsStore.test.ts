// @ai-generated
// Qariah (Sprint 48, S48.6 and S48.7): the notification preferences store.
// Defaults, version 1, persistence through a fake AsyncStorage, and the
// hydration result that the background task reads (QARIAHV2-20: a failed read
// must not look like "every type ON, nothing posted today").

// `mock`-prefixed: jest hoists `jest.mock()` and lets its factory use only
// out-of-scope names with this prefix.
let mockDisk: Record<string, string> = {};
let mockFailReads = false;
let mockHoldReads = false;
let mockHeldReads: Array<() => void> = [];

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => {
      if (mockFailReads) {
        return Promise.reject(
          new Error('Failed to read storage file. NSCocoaErrorDomain Code=257'),
        );
      }
      const value = Object.prototype.hasOwnProperty.call(mockDisk, key)
        ? mockDisk[key]
        : null;
      if (!mockHoldReads) return Promise.resolve(value);
      return new Promise<string | null>(resolve => {
        mockHeldReads.push(() => resolve(value));
      });
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      mockDisk[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete mockDisk[key];
    }),
  },
}));

// One function for every module registry (each `isolateModules` load calls the
// factory again), so a test can read the events of the store that it loaded.
const mockCaptureMessage = jest.fn();
jest.mock('@sentry/react-native', () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  addBreadcrumb: jest.fn(),
}));

function unreadableEvents(): number {
  return mockCaptureMessage.mock.calls.filter(
    ([message]) => message === 'notification-prefs-unreadable',
  ).length;
}

const KEY = 'qariah-notification-prefs';

type PrefsModule = typeof import('../prefsStore');

/** A fresh module registry: `persist` hydrates once, at module load. */
function loadModule(): PrefsModule {
  let mod: PrefsModule | undefined;
  jest.isolateModules(() => {
    mod = require('../prefsStore');
  });
  if (!mod) throw new Error('prefsStore did not load');
  return mod;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function stored(): {state: Record<string, unknown>; version: number} {
  return JSON.parse(mockDisk[KEY]);
}

describe('useNotificationPrefsStore', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDisk = {};
    mockFailReads = false;
    mockHoldReads = false;
    mockHeldReads = [];
    mockCaptureMessage.mockClear();
    // The guard warns in __DEV__ when it defers or refuses a write.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('defaults: every type on, the soft prompt not answered, no notice yet', async () => {
    const {useNotificationPrefsStore, DEFAULT_NOTIFICATION_TYPE_PREFS} =
      loadModule();
    await settle();
    const state = useNotificationPrefsStore.getState();
    expect(DEFAULT_NOTIFICATION_TYPE_PREFS).toEqual({
      followed_recitation: true,
      new_recitation: true,
      kahf_friday: true,
      continue_listening: true,
      whats_new: true,
    });
    expect(state).toMatchObject({
      ...DEFAULT_NOTIFICATION_TYPE_PREFS,
      softPromptAnswered: false,
      lastNotifiedDay: null,
    });
  });

  it('persists under its key with version 1', async () => {
    const {
      useNotificationPrefsStore,
      NOTIFICATION_PREFS_STORAGE_KEY,
      NOTIFICATION_PREFS_VERSION,
    } = loadModule();
    expect(NOTIFICATION_PREFS_STORAGE_KEY).toBe(KEY);
    expect(NOTIFICATION_PREFS_VERSION).toBe(1);
    expect(useNotificationPrefsStore.persist.getOptions().version).toBe(1);
    await settle();

    useNotificationPrefsStore.getState().setTypeEnabled('kahf_friday', false);
    useNotificationPrefsStore.getState().setSoftPromptAnswered(true);
    useNotificationPrefsStore.getState().setLastNotifiedDay('2026-10-20');
    await settle();

    expect(stored()).toEqual({
      state: {
        followed_recitation: true,
        new_recitation: true,
        kahf_friday: false,
        continue_listening: true,
        whats_new: true,
        softPromptAnswered: true,
        lastNotifiedDay: '2026-10-20',
      },
      version: 1,
    });
  });

  it('each setter changes only its own field', async () => {
    const {useNotificationPrefsStore} = loadModule();
    await settle();
    const before = useNotificationPrefsStore.getState();
    before.setTypeEnabled('whats_new', false);
    const after = useNotificationPrefsStore.getState();
    expect(after.whats_new).toBe(false);
    expect(after.followed_recitation).toBe(true);
    expect(after.softPromptAnswered).toBe(false);
    expect(after.lastNotifiedDay).toBeNull();
  });

  it('a new start reads the stored values back', async () => {
    const first = loadModule();
    await settle();
    first.useNotificationPrefsStore
      .getState()
      .setTypeEnabled('continue_listening', false);
    first.useNotificationPrefsStore.getState().setLastNotifiedDay('2026-10-19');
    await settle();

    const second = loadModule();
    await settle();
    expect(second.useNotificationPrefsStore.getState()).toMatchObject({
      continue_listening: false,
      lastNotifiedDay: '2026-10-19',
      followed_recitation: true,
    });
  });

  it('a setter while the read is in flight does not destroy a stored value', async () => {
    const storedBlob = JSON.stringify({
      state: {
        followed_recitation: false,
        new_recitation: true,
        kahf_friday: true,
        continue_listening: true,
        whats_new: true,
        softPromptAnswered: true,
        lastNotifiedDay: '2026-10-19',
      },
      version: 1,
    });
    mockDisk[KEY] = storedBlob;
    mockHoldReads = true;
    const {useNotificationPrefsStore} = loadModule();
    // The read has not come back: the storage guard holds this write.
    useNotificationPrefsStore.getState().setTypeEnabled('whats_new', false);
    expect(mockDisk[KEY]).toBe(storedBlob);

    mockHeldReads.forEach(release => release());
    await settle();
    // The held write adds no key that the stored value lacks, so it is not
    // replayed; the stored values win the merge (zustand's default merge).
    expect(mockDisk[KEY]).toBe(storedBlob);
    expect(useNotificationPrefsStore.getState()).toMatchObject({
      followed_recitation: false,
      softPromptAnswered: true,
      lastNotifiedDay: '2026-10-19',
    });
  });

  it('a stored value without a newer type gets that type at its default', async () => {
    mockDisk[KEY] = JSON.stringify({
      state: {followed_recitation: false, lastNotifiedDay: '2026-10-18'},
      version: 1,
    });
    const {useNotificationPrefsStore} = loadModule();
    await settle();
    expect(useNotificationPrefsStore.getState()).toMatchObject({
      followed_recitation: false,
      new_recitation: true,
      whats_new: true,
      lastNotifiedDay: '2026-10-18',
    });
  });

  describe('getHydratedNotificationPrefs', () => {
    it('gives the stored values after a successful read', async () => {
      mockDisk[KEY] = JSON.stringify({
        state: {new_recitation: false, lastNotifiedDay: '2026-10-20'},
        version: 1,
      });
      const {getHydratedNotificationPrefs} = loadModule();
      const prefs = await getHydratedNotificationPrefs();
      expect(prefs).toMatchObject({
        new_recitation: false,
        lastNotifiedDay: '2026-10-20',
      });
    });

    it('a fresh install is a successful read', async () => {
      const {getHydratedNotificationPrefs, whenNotificationPrefsHydrated} =
        loadModule();
      await expect(whenNotificationPrefsHydrated()).resolves.toBe(true);
      await expect(getHydratedNotificationPrefs()).resolves.toMatchObject({
        followed_recitation: true,
        lastNotifiedDay: null,
      });
    });

    it('gives null after a failed read, and never writes the defaults over the stored values', async () => {
      const storedBlob = JSON.stringify({
        state: {followed_recitation: false, lastNotifiedDay: '2026-10-20'},
        version: 1,
      });
      mockDisk[KEY] = storedBlob;
      mockFailReads = true;
      const {getHydratedNotificationPrefs, useNotificationPrefsStore} =
        loadModule();
      await expect(getHydratedNotificationPrefs()).resolves.toBeNull();

      // The store holds the defaults, which the background task must not use.
      expect(useNotificationPrefsStore.getState().followed_recitation).toBe(
        true,
      );
      useNotificationPrefsStore.getState().setLastNotifiedDay('2026-10-21');
      await settle();
      expect(mockDisk[KEY]).toBe(storedBlob);
    });

    it('a later successful rehydrate gives the stored values', async () => {
      mockDisk[KEY] = JSON.stringify({
        state: {kahf_friday: false},
        version: 1,
      });
      mockFailReads = true;
      const {getHydratedNotificationPrefs, useNotificationPrefsStore} =
        loadModule();
      await expect(getHydratedNotificationPrefs()).resolves.toBeNull();

      mockFailReads = false;
      const rehydrating = useNotificationPrefsStore.persist.rehydrate();
      // A read is in flight again, so the result waits for it.
      const prefs = getHydratedNotificationPrefs();
      await rehydrating;
      await expect(prefs).resolves.toMatchObject({kahf_friday: false});
    });

    it('reads once more after a failed read, and writes resume when it succeeds', async () => {
      mockDisk[KEY] = JSON.stringify({
        state: {continue_listening: false},
        version: 1,
      });
      mockFailReads = true;
      const {whenNotificationPrefsHydrated, useNotificationPrefsStore} =
        loadModule();
      await settle();
      // The container became readable after the start (the first unlock).
      mockFailReads = false;
      await expect(whenNotificationPrefsHydrated()).resolves.toBe(true);
      expect(useNotificationPrefsStore.getState().continue_listening).toBe(
        false,
      );

      useNotificationPrefsStore.getState().setTypeEnabled('kahf_friday', false);
      await settle();
      expect(stored().state).toMatchObject({
        continue_listening: false,
        kahf_friday: false,
      });
    });

    it('gives null when the second read fails too', async () => {
      const getItem = jest.requireMock(
        '@react-native-async-storage/async-storage',
      ).default.getItem as jest.Mock;
      mockFailReads = true;
      const {getHydratedNotificationPrefs} = loadModule();
      await settle();
      getItem.mockClear();
      await expect(getHydratedNotificationPrefs()).resolves.toBeNull();
      // Exactly one more read for this call.
      expect(getItem).toHaveBeenCalledTimes(1);
    });

    it('two callers after a failed read share one extra read', async () => {
      const getItem = jest.requireMock(
        '@react-native-async-storage/async-storage',
      ).default.getItem as jest.Mock;
      mockDisk[KEY] = JSON.stringify({state: {whats_new: false}, version: 1});
      mockFailReads = true;
      const {whenNotificationPrefsHydrated} = loadModule();
      await settle();
      getItem.mockClear();
      mockFailReads = false;
      mockHoldReads = true;
      const first = whenNotificationPrefsHydrated();
      const second = whenNotificationPrefsHydrated();
      await settle();
      expect(getItem).toHaveBeenCalledTimes(1);
      mockHeldReads.forEach(release => release());
      await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    });

    it('waits for a read in flight', async () => {
      mockHoldReads = true;
      const {whenNotificationPrefsHydrated} = loadModule();
      let result: boolean | undefined;
      whenNotificationPrefsHydrated().then(ok => {
        result = ok;
      });
      await settle();
      expect(result).toBeUndefined();
      mockHeldReads.forEach(release => release());
      await settle();
      expect(result).toBe(true);
    });

    it('gives false when the read does not finish in time', async () => {
      jest.useFakeTimers();
      try {
        mockHoldReads = true;
        const {whenNotificationPrefsHydrated} = loadModule();
        const pending = whenNotificationPrefsHydrated(1000);
        jest.advanceTimersByTime(1000);
        await expect(pending).resolves.toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('a stored value that is not valid JSON', () => {
    it('counts as a failed read: null, one Sentry event, and no write over it', async () => {
      mockDisk[KEY] = '{"state":{"followed_recitation":fal';
      const {
        getHydratedNotificationPrefs,
        markNotifiedToday,
        whenNotificationPrefsHydrated,
      } = loadModule();
      await expect(getHydratedNotificationPrefs()).resolves.toBeNull();
      await expect(whenNotificationPrefsHydrated()).resolves.toBe(false);
      await expect(markNotifiedToday(new Date(2026, 9, 20))).resolves.toBe(
        false,
      );
      await settle();
      expect(mockDisk[KEY]).toBe('{"state":{"followed_recitation":fal');
      // Several reads failed; the event went once.
      expect(unreadableEvents()).toBe(1);
    });

    it('a read that the storage refuses is not reported as unreadable JSON', async () => {
      mockFailReads = true;
      const {getHydratedNotificationPrefs} = loadModule();
      await expect(getHydratedNotificationPrefs()).resolves.toBeNull();
      expect(unreadableEvents()).toBe(0);
    });
  });

  describe('markNotifiedToday', () => {
    it('records the local day of now', async () => {
      const {markNotifiedToday, useNotificationPrefsStore} = loadModule();
      await expect(
        markNotifiedToday(new Date(2026, 9, 20, 23, 30)),
      ).resolves.toBe(true);
      expect(useNotificationPrefsStore.getState().lastNotifiedDay).toBe(
        '2026-10-20',
      );
      await settle();
      expect(stored().state.lastNotifiedDay).toBe('2026-10-20');
    });

    it('gives false and writes nothing after a failed read', async () => {
      const storedBlob = JSON.stringify({
        state: {lastNotifiedDay: '2026-10-19'},
        version: 1,
      });
      mockDisk[KEY] = storedBlob;
      mockFailReads = true;
      const {markNotifiedToday, useNotificationPrefsStore} = loadModule();
      await expect(markNotifiedToday(new Date(2026, 9, 20))).resolves.toBe(
        false,
      );
      expect(useNotificationPrefsStore.getState().lastNotifiedDay).toBeNull();
      await settle();
      expect(mockDisk[KEY]).toBe(storedBlob);
    });

    it('notificationPrefsSource reads and marks through the store', async () => {
      mockDisk[KEY] = JSON.stringify({
        state: {whats_new: false, lastNotifiedDay: '2026-10-18'},
        version: 1,
      });
      const {notificationPrefsSource, useNotificationPrefsStore} = loadModule();
      await expect(notificationPrefsSource.read()).resolves.toMatchObject({
        whats_new: false,
        lastNotifiedDay: '2026-10-18',
      });
      await expect(
        notificationPrefsSource.markNotifiedToday(new Date(2026, 9, 21, 8)),
      ).resolves.toBe(true);
      expect(useNotificationPrefsStore.getState().lastNotifiedDay).toBe(
        '2026-10-21',
      );
    });
  });
});
