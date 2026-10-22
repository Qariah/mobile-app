// @ai-generated
// Qariah (Sprint 48, S48.6): the `Notifier` over expo-notifications, with a
// mocked native module.
import i18next from 'i18next';
import {Platform} from 'react-native';
import type {NotificationCandidate} from '../types';

const mockNotifications = {
  scheduleNotificationAsync: jest.fn(async (request: {identifier: string}) => {
    return request.identifier;
  }),
  setNotificationChannelAsync: jest.fn(async () => null),
  getAllScheduledNotificationsAsync: jest.fn(
    async (): Promise<unknown[]> => [],
  ),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(
    async (): Promise<{status: string; ios?: {status: number}}> => ({
      status: 'granted',
    }),
  ),
  setNotificationHandler: jest.fn(),
  AndroidImportance: {DEFAULT: 5},
  SchedulableTriggerInputTypes: {DATE: 'date', WEEKLY: 'weekly'},
};
jest.mock('expo-notifications', () => mockNotifications);
// The i18next instance of test-utils/setupI18n.ts (English resources), also
// inside `jest.isolateModules`.
const mockI18n = {current: i18next};
jest.mock('@/i18n', () => ({
  __esModule: true,
  get default() {
    return mockI18n.current;
  },
}));

type ExpoNotifierModule = typeof import('../expoNotifier');

const originalOS = Platform.OS;
function setOS(platform: typeof Platform, os: typeof Platform.OS): void {
  Object.defineProperty(platform, 'OS', {value: os, configurable: true});
}

/**
 * A fresh module: the channels and the handler are once in each process.
 * React Native's `Platform` is a lazy getter, so a read after
 * `isolateModules` returns gets the main registry's `Platform`: set both.
 */
function load(os: 'ios' | 'android' = 'android'): ExpoNotifierModule {
  setOS(Platform, os);
  let mod: ExpoNotifierModule | undefined;
  jest.isolateModules(() => {
    setOS(
      (require('react-native') as typeof import('react-native')).Platform,
      os,
    );
    mod = require('../expoNotifier');
  });
  if (!mod) throw new Error('expoNotifier not loaded');
  return mod;
}

const TEST_TEXT = {
  notifications: {
    followedRecitation: {
      title: 'New from {{reciterName}}',
      body: 'Surah {{surahName}}',
    },
  },
};

function followedCandidate(
  overrides: Partial<NotificationCandidate> = {},
): NotificationCandidate {
  return {
    type: 'followed_recitation',
    title: {
      key: 'qariah:notifications.followedRecitation.title',
      params: {reciterName: 'Zaynab Talha'},
    },
    body: {
      key: 'qariah:notifications.followedRecitation.body',
      params: {surahName: 'Al-Kahf'},
    },
    target: {
      kind: 'recitation',
      reciterId: 'r1',
      reciterSlug: 'zaynab-talha',
      rewayahId: 'w1',
      surah: 18,
    },
    dedupeKey: 'followed_recitation:r1|w1|18||',
    coveredKeys: ['r1|w1|18||'],
    ...overrides,
  };
}

afterAll(() => setOS(Platform, originalOS));

beforeEach(() => {
  jest.clearAllMocks();
  i18next.addResourceBundle('en', 'qariah', TEST_TEXT, true, true);
});

describe('createExpoNotifier().schedule', () => {
  it('posts now: the dedupe key is the id, the text is rendered, data has type and target', async () => {
    const {createExpoNotifier} = load('android');
    const id = await createExpoNotifier().schedule(followedCandidate(), {
      kind: 'immediate',
    });
    expect(id).toBe('followed_recitation:r1|w1|18||');
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'followed_recitation:r1|w1|18||',
      content: {
        title: 'New from Zaynab Talha',
        body: 'Surah Al-Kahf',
        data: {
          type: 'followed_recitation',
          target: {
            kind: 'recitation',
            reciterId: 'r1',
            reciterSlug: 'zaynab-talha',
            rewayahId: 'w1',
            surah: 18,
          },
        },
      },
      trigger: {channelId: 'qariah-followed-recitation'},
    });
  });

  it('maps a date trigger and a weekly trigger, each with the channel of its type', async () => {
    const {createExpoNotifier} = load('android');
    const notifier = createExpoNotifier();
    await notifier.schedule(
      followedCandidate({
        type: 'continue_listening',
        title: {text: 'Continue'},
        body: undefined,
        dedupeKey: 'continue_listening',
      }),
      {kind: 'date', at: 1_800_000_000_000},
    );
    await notifier.schedule(
      followedCandidate({
        type: 'kahf_friday',
        title: {text: 'Friday'},
        body: {text: 'Al-Kahf'},
        dedupeKey: 'kahf_friday',
      }),
      {kind: 'weekly', weekday: 6, hour: 9, minute: 0},
    );
    const calls = mockNotifications.scheduleNotificationAsync.mock
      .calls as unknown as [{content: unknown; trigger: unknown}][];
    expect(calls[0][0].trigger).toEqual({
      type: 'date',
      date: 1_800_000_000_000,
      channelId: 'qariah-continue-listening',
    });
    // No body key when the candidate has no body.
    expect(calls[0][0].content).toEqual({
      title: 'Continue',
      data: expect.objectContaining({type: 'continue_listening'}),
    });
    expect(calls[1][0].trigger).toEqual({
      type: 'weekly',
      weekday: 6,
      hour: 9,
      minute: 0,
      channelId: 'qariah-kahf-friday',
    });
  });

  it('gives every key the app name, and a plural key its form', async () => {
    const {createExpoNotifier} = load('android');
    await createExpoNotifier().schedule(
      followedCandidate({
        type: 'new_recitation',
        title: {key: 'qariah:notifications.newRecitationSummary.title'},
        body: {
          key: 'qariah:notifications.newRecitationSummary.body',
          params: {count: 3, reciterName: 'Zaynab Talha'},
        },
        target: {kind: 'listen'},
        dedupeKey: 'new_recitation:summary:3:k',
      }),
      {kind: 'immediate'},
    );
    const [[request]] = mockNotifications.scheduleNotificationAsync.mock
      .calls as unknown as [[{content: {title: string; body: string}}]];
    expect(request.content.title).toBe('New recitations');
    expect(request.content.body).toBe('3 new recitations on Qariah.');
  });

  it('refuses a text key that no locale file has, and schedules nothing', async () => {
    const {createExpoNotifier, NotificationTextMissingError} = load('android');
    // An announcement id with no text in any locale file.
    const candidate = followedCandidate({
      title: {key: 'qariah:announcement.2099-01-missing.title'},
    });
    await expect(
      createExpoNotifier().schedule(candidate, {kind: 'immediate'}),
    ).rejects.toBeInstanceOf(NotificationTextMissingError);
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('the Android channels', () => {
  it('creates one channel for each type, once in a process, with importance DEFAULT', async () => {
    const {createExpoNotifier, NOTIFICATION_CHANNELS} = load('android');
    const notifier = createExpoNotifier();
    await notifier.schedule(followedCandidate(), {kind: 'immediate'});
    await notifier.schedule(followedCandidate(), {kind: 'immediate'});
    const calls = mockNotifications.setNotificationChannelAsync.mock
      .calls as unknown as [string, {name: string; importance: number}][];
    expect(calls).toHaveLength(5);
    expect(calls.map(([id]) => id)).toEqual(
      Object.values(NOTIFICATION_CHANNELS).map(channel => channel.id),
    );
    for (const [, input] of calls) expect(input.importance).toBe(5);
  });

  it('names a channel from the first key that exists, else the English default', () => {
    const {notificationChannelName} = load('android');
    // The `channels.*` key (review pack row 354).
    expect(notificationChannelName('followed_recitation')).toBe(
      i18next.t('qariah:notifications.channels.followedRecitation'),
    );
    i18next.addResourceBundle(
      'en',
      'qariah',
      {notifications: {channels: {kahfFriday: 'Al-Kahf on Friday'}}},
      true,
      true,
    );
    expect(notificationChannelName('kahf_friday')).toBe('Al-Kahf on Friday');
  });

  it('falls back to the English default name when no key exists', () => {
    const {notificationChannelName, NOTIFICATION_CHANNELS} = load('android');
    const spy = jest.spyOn(i18next, 'exists').mockReturnValue(false);
    const t = jest
      .spyOn(i18next, 't')
      .mockImplementation(
        ((_key: unknown, options?: {defaultValue?: string}) =>
          options?.defaultValue ?? '') as never,
      );
    expect(notificationChannelName('whats_new')).toBe(
      NOTIFICATION_CHANNELS.whats_new.defaultName,
    );
    spy.mockRestore();
    t.mockRestore();
  });

  it('creates no channel on iOS', async () => {
    const {createExpoNotifier, ensureNotificationChannels} = load('ios');
    await expect(ensureNotificationChannels()).resolves.toBe(true);
    await createExpoNotifier().schedule(followedCandidate(), {
      kind: 'immediate',
    });
    expect(
      mockNotifications.setNotificationChannelAsync,
    ).not.toHaveBeenCalled();
  });

  it('tries again after a failed creation', async () => {
    const {ensureNotificationChannels} = load('android');
    mockNotifications.setNotificationChannelAsync.mockRejectedValueOnce(
      new Error('no'),
    );
    await expect(ensureNotificationChannels()).resolves.toBe(false);
    await expect(ensureNotificationChannels()).resolves.toBe(true);
  });
});

describe('createExpoNotifier() other methods', () => {
  it('cancelByType cancels only the scheduled notifications of that type', async () => {
    const {createExpoNotifier} = load('android');
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      {identifier: 'a', content: {data: {type: 'kahf_friday'}}},
      {identifier: 'b', content: {data: {type: 'continue_listening'}}},
      {identifier: 'c', content: {data: {}}},
      {identifier: 'd', content: {data: {type: 'kahf_friday'}}},
    ]);
    await createExpoNotifier().cancelByType('kahf_friday');
    expect(
      mockNotifications.cancelScheduledNotificationAsync.mock.calls,
    ).toEqual([['a'], ['d']]);
  });

  it('cancel cancels one id', async () => {
    const {createExpoNotifier} = load('android');
    await createExpoNotifier().cancel('kahf_friday');
    expect(
      mockNotifications.cancelScheduledNotificationAsync,
    ).toHaveBeenCalledWith('kahf_friday');
  });

  it.each([
    [{status: 'granted'}, 'granted'],
    [{status: 'undetermined', ios: {status: 3}}, 'granted'], // provisional
    [{status: 'undetermined', ios: {status: 4}}, 'granted'], // ephemeral
    [{status: 'denied', ios: {status: 1}}, 'denied'],
    [{status: 'denied'}, 'denied'],
    [{status: 'undetermined', ios: {status: 0}}, 'undetermined'],
  ])('getPermission maps %j to %s', async (permission, expected) => {
    const {createExpoNotifier} = load('ios');
    mockNotifications.getPermissionsAsync.mockResolvedValueOnce(permission);
    await expect(createExpoNotifier().getPermission()).resolves.toBe(expected);
  });
});

describe('installNotificationHandler', () => {
  it('shows a banner and a list entry with no sound and no badge, once in a process', async () => {
    const {installNotificationHandler} = load('ios');
    installNotificationHandler();
    installNotificationHandler();
    expect(mockNotifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    const [{handleNotification}] = mockNotifications.setNotificationHandler.mock
      .calls[0] as [{handleNotification: () => Promise<unknown>}];
    await expect(handleNotification()).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });
});
