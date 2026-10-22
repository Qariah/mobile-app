// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): "continue listening" follows each play
// start; the switches and the app state sync the scheduled types.
import {DEFAULT_NOTIFICATION_TYPE_PREFS} from '../prefsStore';
import type {NotificationPrefsState} from '../prefsStore';
import {
  CONTINUE_RESCHEDULE_MIN_MS,
  FOREGROUND_SYNC_MIN_MS,
  __resetNotificationSchedulingForTests,
  playedTrackOf,
  scheduleContinueListening,
  setNotificationSchedulingReady,
  startNotificationScheduling,
  type ContinueScheduleDeps,
  type PlayedTrack,
  type SyncOutcome,
} from '../notificationScheduling';
import {CONTINUE_LISTENING_DELAY_DAYS} from '../scheduler';
import type {
  NotificationPermissionStatus,
  NotificationPrefsSnapshot,
  Notifier,
} from '../types';

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
// The player store and the catalog are not needed: the tests inject the
// subscriptions and the text.
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {subscribe: jest.fn(() => () => undefined)},
}));
jest.mock('@/services/dataService', () => ({
  getReciterByIdSync: jest.fn(() => undefined),
}));

type FakeNotifier = Notifier & {
  scheduled: Map<string, {type: string; at?: number; body?: unknown}>;
  schedule: jest.Mock;
  cancelByType: jest.Mock;
  getPermission: jest.Mock;
};

function fakeNotifier(
  permission: NotificationPermissionStatus = 'granted',
): FakeNotifier {
  const scheduled = new Map<
    string,
    {type: string; at?: number; body?: unknown}
  >();
  return {
    scheduled,
    schedule: jest.fn(
      async (
        candidate: {dedupeKey: string; type: string; body?: unknown},
        trigger: {at?: number},
      ) => {
        scheduled.set(candidate.dedupeKey, {
          type: candidate.type,
          at: trigger.at,
          body: candidate.body,
        });
        return candidate.dedupeKey;
      },
    ),
    cancel: jest.fn(async () => undefined),
    cancelByType: jest.fn(async (type: string) => {
      for (const [id, entry] of scheduled) {
        if (entry.type === type) scheduled.delete(id);
      }
    }),
    getPermission: jest.fn(async () => permission),
    listScheduled: async () =>
      [...scheduled].map(([id, entry]) => ({id, type: entry.type})),
  };
}

const prefs = (
  overrides: Partial<NotificationPrefsSnapshot> = {},
): NotificationPrefsSnapshot => ({
  ...DEFAULT_NOTIFICATION_TYPE_PREFS,
  lastNotifiedDay: null,
  ...overrides,
});

const KAHF: PlayedTrack = {
  reciterId: 'r1',
  reciterName: 'Zaynab',
  surahId: 18,
  rewayatId: 'w1',
};
const YASIN: PlayedTrack = {...KAHF, surahId: 36};

function continueDeps(
  notifier: FakeNotifier,
  overrides: Partial<ContinueScheduleDeps> = {},
): ContinueScheduleDeps {
  return {
    notifier,
    isHoldout: () => false,
    readPrefs: async () => prefs(),
    textFor: track => ({
      surahName: `surah:${track.surahId}`,
      reciterName: track.reciterName,
    }),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  __resetNotificationSchedulingForTests();
});

describe('playedTrackOf', () => {
  it('takes a surah track; an upload or a track with no surah gives null', () => {
    expect(
      playedTrackOf({
        id: 'r1:18',
        url: 'u',
        title: 'Al-Kahf',
        artist: 'Zaynab',
        reciterId: 'r1',
        reciterName: 'Zaynab',
        surahId: '18',
        rewayatId: 'w1',
      }),
    ).toEqual(KAHF);
    expect(
      playedTrackOf({
        id: 'u',
        url: 'u',
        title: 't',
        artist: 'a',
        reciterId: 'r1',
        reciterName: 'a',
        surahId: '18',
        isUserUpload: true,
      }),
    ).toBeNull();
    expect(
      playedTrackOf({
        id: 'x',
        url: 'u',
        title: 't',
        artist: 'a',
        reciterId: 'r1',
        reciterName: 'a',
      }),
    ).toBeNull();
    expect(playedTrackOf(undefined)).toBeNull();
  });
});

describe('scheduleContinueListening', () => {
  it('schedules the notice 3 calendar days after the play, at the same time, with the track text', async () => {
    const notifier = fakeNotifier();
    const playedAt = new Date(2026, 9, 20, 18, 15);
    await expect(
      scheduleContinueListening(KAHF, playedAt, continueDeps(notifier)),
    ).resolves.toBe('scheduled');
    const entry = notifier.scheduled.get('continue_listening');
    const at = new Date(entry?.at ?? 0);
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([
      20 + CONTINUE_LISTENING_DELAY_DAYS,
      18,
      15,
    ]);
    expect(entry?.body).toEqual({
      key: 'qariah:notifications.continueListening.body',
      params: {surahName: 'surah:18', reciterName: 'Zaynab'},
    });
  });

  it('a second play replaces the pending notice (one id)', async () => {
    const notifier = fakeNotifier();
    await scheduleContinueListening(
      KAHF,
      new Date(2026, 9, 20, 8),
      continueDeps(notifier),
    );
    await expect(
      scheduleContinueListening(
        YASIN,
        new Date(2026, 9, 21, 22),
        continueDeps(notifier),
      ),
    ).resolves.toBe('rescheduled');
    expect([...notifier.scheduled.keys()]).toEqual(['continue_listening']);
    expect(
      new Date(notifier.scheduled.get('continue_listening')?.at ?? 0).getDate(),
    ).toBe(24);
  });

  it.each([
    [
      'the toggle is off',
      {readPrefs: async () => prefs({continue_listening: false})},
    ],
    ['the toggles cannot be read', {readPrefs: async () => null}],
    ['the holdout', {isHoldout: () => true}],
  ])('schedules nothing when %s', async (_label, override) => {
    const notifier = fakeNotifier();
    await expect(
      scheduleContinueListening(
        KAHF,
        new Date(),
        continueDeps(notifier, override),
      ),
    ).resolves.toBe('skipped');
    expect(notifier.schedule).not.toHaveBeenCalled();
  });

  it('schedules nothing without the permission', async () => {
    const notifier = fakeNotifier('denied');
    await expect(
      scheduleContinueListening(KAHF, new Date(), continueDeps(notifier)),
    ).resolves.toBe('skipped');
  });

  it('gives failed, and does not throw, when the native call fails', async () => {
    const notifier = fakeNotifier();
    notifier.schedule.mockRejectedValue(new Error('native'));
    await expect(
      scheduleContinueListening(KAHF, new Date(), continueDeps(notifier)),
    ).resolves.toBe('failed');
  });
});

describe('startNotificationScheduling', () => {
  function harness(
    start = Date.UTC(2026, 9, 20, 9),
    options: {
      isHoldout?: () => boolean;
      readPrefs?: () => Promise<NotificationPrefsSnapshot | null>;
    } = {},
  ) {
    let now = start;
    const synced: {listener: ((result: SyncOutcome) => void) | null} = {
      listener: null,
    };
    const play: {listener: ((track: PlayedTrack) => void) | null} = {
      listener: null,
    };
    const prefsListener: {
      listener:
        | ((
            next: NotificationPrefsState,
            previous: NotificationPrefsState,
          ) => void)
        | null;
    } = {listener: null};
    const active: {listener: (() => void) | null} = {listener: null};
    const notifier = fakeNotifier();
    const sync = jest.fn(async () => undefined);
    const onContinueScheduled = jest.fn();
    startNotificationScheduling({
      subscribePlayStarts: listener => {
        play.listener = listener;
        return () => undefined;
      },
      subscribePrefs: listener => {
        prefsListener.listener = listener;
        return () => undefined;
      },
      subscribeAppActive: listener => {
        active.listener = listener;
        return () => undefined;
      },
      subscribeSynced: listener => {
        synced.listener = listener;
        return () => undefined;
      },
      notifier: () => notifier,
      isHoldout: options.isHoldout ?? (() => false),
      readPrefs: options.readPrefs ?? (async () => prefs()),
      textFor: track => ({
        surahName: String(track.surahId),
        reciterName: track.reciterName,
      }),
      sync,
      now: () => now,
      onContinueScheduled,
    });
    return {
      notifier,
      sync,
      onContinueScheduled,
      synced: (result: SyncOutcome) => synced.listener?.(result),
      play: (track: PlayedTrack) => play.listener?.(track),
      changePrefs: (
        next: Partial<NotificationPrefsState>,
        previous: Partial<NotificationPrefsState>,
      ) =>
        prefsListener.listener?.(
          next as NotificationPrefsState,
          previous as NotificationPrefsState,
        ),
      active: () => active.listener?.(),
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('keeps a play start before the boot step, and schedules it when ready', async () => {
    const h = harness();
    h.play(KAHF);
    await flush();
    expect(h.notifier.schedule).not.toHaveBeenCalled();
    setNotificationSchedulingReady();
    await flush();
    expect(h.notifier.schedule).toHaveBeenCalledTimes(1);
    expect(h.onContinueScheduled).toHaveBeenCalledWith('scheduled');
  });

  it('each play start reschedules; the same track only after the minimum gap', async () => {
    const h = harness();
    setNotificationSchedulingReady();
    h.play(KAHF);
    await flush();
    h.play(KAHF); // buffering → playing again
    await flush();
    expect(h.notifier.schedule).toHaveBeenCalledTimes(1);
    h.play(YASIN); // another track: at once
    await flush();
    expect(h.notifier.schedule).toHaveBeenCalledTimes(2);
    h.advance(CONTINUE_RESCHEDULE_MIN_MS);
    h.play(YASIN);
    await flush();
    expect(h.notifier.schedule).toHaveBeenCalledTimes(3);
  });

  it('the Al-Kahf switch syncs; "continue listening" OFF cancels its notice', async () => {
    const h = harness();
    setNotificationSchedulingReady();
    h.play(KAHF);
    await flush();
    expect(h.notifier.scheduled.has('continue_listening')).toBe(true);

    h.changePrefs(
      {kahf_friday: false, continue_listening: true},
      {kahf_friday: true, continue_listening: true},
    );
    expect(h.sync).toHaveBeenCalledWith('toggle');

    h.changePrefs(
      {kahf_friday: false, continue_listening: false},
      {kahf_friday: false, continue_listening: true},
    );
    await flush();
    expect(h.notifier.cancelByType).toHaveBeenCalledWith('continue_listening');
    expect(h.notifier.scheduled.has('continue_listening')).toBe(false);
    // The next play of the same track schedules again (the gap starts over).
    h.play(KAHF);
    await flush();
    expect(h.notifier.schedule).toHaveBeenCalledTimes(2);
  });

  it('changes to other fields do nothing', async () => {
    const h = harness();
    setNotificationSchedulingReady();
    h.changePrefs(
      {kahf_friday: true, continue_listening: true, lastNotifiedDay: 'x'},
      {kahf_friday: true, continue_listening: true, lastNotifiedDay: null},
    );
    await flush();
    expect(h.sync).not.toHaveBeenCalled();
    expect(h.notifier.cancelByType).not.toHaveBeenCalled();
  });

  it('back in the foreground: a sync, at most once in the minimum gap', () => {
    const h = harness();
    h.active(); // before the boot step: nothing
    expect(h.sync).not.toHaveBeenCalled();
    setNotificationSchedulingReady();
    h.active(); // the boot sync just ran
    expect(h.sync).not.toHaveBeenCalled();
    h.advance(FOREGROUND_SYNC_MIN_MS);
    h.active();
    h.active();
    expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.sync).toHaveBeenCalledWith('foreground');
  });

  it('by default, a NEW notice sends notification_scheduled (a moved one does not)', async () => {
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
      let playListener: ((track: PlayedTrack) => void) | null = null;
      startNotificationScheduling({
        subscribePlayStarts: listener => {
          playListener = listener;
          return () => undefined;
        },
        subscribePrefs: () => () => undefined,
        subscribeAppActive: () => () => undefined,
        notifier: () => notifier,
        isHoldout: () => false,
        readPrefs: async () => prefs(),
        textFor: track => ({surahName: '18', reciterName: track.reciterName}),
      });
      setNotificationSchedulingReady();
      (playListener as unknown as (track: PlayedTrack) => void)(KAHF);
      await flush();
      (playListener as unknown as (track: PlayedTrack) => void)(YASIN);
      await flush();
      expect(notifier.schedule).toHaveBeenCalledTimes(2);
      expect(scheduled).toEqual([
        expect.objectContaining({
          type: 'continue_listening',
          trigger: 'date',
          source: 'play',
        }),
      ]);
    } finally {
      __setNotificationAnalyticsSinkForTests(null);
    }
  });

  it('M2: a play before the permission is scheduled after the grant, with its own play time', async () => {
    const h = harness();
    h.notifier.getPermission.mockResolvedValue('undetermined');
    setNotificationSchedulingReady();
    h.play(KAHF); // at T0 (09:00 UTC)
    await flush();
    expect(h.notifier.schedule).not.toHaveBeenCalled();
    expect(h.onContinueScheduled).toHaveBeenCalledWith('skipped');

    h.advance(5 * 60_000); // the user answers the card 5 minutes later
    h.notifier.getPermission.mockResolvedValue('granted');
    h.synced({
      reason: 'permission_granted',
      holdout: false,
      permission: 'granted',
    });
    await flush();
    expect(h.notifier.schedule).toHaveBeenCalledTimes(1);
    const [, trigger] = h.notifier.schedule.mock.calls[0] as [
      unknown,
      {at: number},
    ];
    const expected = new Date(Date.UTC(2026, 9, 20, 9));
    expected.setDate(expected.getDate() + CONTINUE_LISTENING_DELAY_DAYS);
    const hour = new Date(Date.UTC(2026, 9, 20, 9)).getHours();
    if (hour < 9) expected.setHours(9, 0, 0, 0);
    else if (hour >= 21) expected.setHours(20, 0, 0, 0);
    // The trigger comes from the play time, not from the grant time.
    expect(trigger.at).toBe(expected.getTime());
  });

  it('M2: a play before the arm is known is scheduled after holdout_assigned', async () => {
    let holdout = true;
    const h = harness(undefined, {isHoldout: () => holdout});
    setNotificationSchedulingReady();
    h.play(KAHF);
    await flush();
    expect(h.notifier.schedule).not.toHaveBeenCalled();
    holdout = false;
    h.synced({
      reason: 'holdout_assigned',
      holdout: false,
      permission: 'granted',
    });
    await flush();
    expect(h.notifier.schedule).toHaveBeenCalledTimes(1);
  });

  it('M2: a sync for another reason, a holdout sync or a sync with no permission replays nothing', async () => {
    const h = harness();
    h.notifier.getPermission.mockResolvedValue('undetermined');
    setNotificationSchedulingReady();
    h.play(KAHF);
    await flush();
    h.notifier.getPermission.mockResolvedValue('granted');
    h.synced({reason: 'boot', holdout: false, permission: 'granted'});
    h.synced({reason: 'foreground', holdout: true});
    h.synced({reason: 'foreground', holdout: false, permission: 'denied'});
    await flush();
    expect(h.notifier.schedule).not.toHaveBeenCalled();
  });

  it('M2: a scheduled play is not scheduled twice by a later granted sync', async () => {
    const h = harness();
    setNotificationSchedulingReady();
    h.play(KAHF);
    await flush();
    h.synced({reason: 'foreground', holdout: false, permission: 'granted'});
    await flush();
    expect(h.notifier.schedule).toHaveBeenCalledTimes(1);
  });

  it('M2: a grant that comes while the play is checked tries once more', async () => {
    const h = harness();
    let answer: (status: NotificationPermissionStatus) => void = () =>
      undefined;
    h.notifier.getPermission.mockImplementationOnce(
      () =>
        new Promise<NotificationPermissionStatus>(resolve => {
          answer = resolve;
        }),
    );
    setNotificationSchedulingReady();
    h.play(KAHF);
    await flush();
    // The grant comes while the first check waits.
    h.synced({
      reason: 'permission_granted',
      holdout: false,
      permission: 'granted',
    });
    answer('undetermined');
    await flush();
    expect(h.notifier.schedule).toHaveBeenCalledTimes(1);
  });

  it('L4: after a sync with no permission, each return to the app syncs', () => {
    const h = harness();
    setNotificationSchedulingReady();
    h.synced({reason: 'boot', holdout: false, permission: 'undetermined'});
    h.active();
    h.active();
    expect(h.sync).toHaveBeenCalledTimes(2);
    // Granted: the throttle applies again.
    h.synced({reason: 'foreground', holdout: false, permission: 'granted'});
    h.active();
    expect(h.sync).toHaveBeenCalledTimes(2);
    // A holdout sync keeps the throttle too.
    h.synced({reason: 'foreground', holdout: true});
    h.active();
    expect(h.sync).toHaveBeenCalledTimes(2);
  });

  it('L6: the switch is read again just before the schedule', async () => {
    let calls = 0;
    const h = harness(undefined, {
      readPrefs: async () => {
        calls += 1;
        return prefs({continue_listening: calls === 1});
      },
    });
    setNotificationSchedulingReady();
    h.play(KAHF);
    await flush();
    expect(calls).toBe(2);
    expect(h.notifier.schedule).not.toHaveBeenCalled();
    expect(h.onContinueScheduled).toHaveBeenCalledWith('skipped');
  });

  it('"continue listening" ON again schedules the last play', async () => {
    const h = harness();
    setNotificationSchedulingReady();
    h.play(KAHF);
    await flush();
    h.changePrefs(
      {kahf_friday: true, continue_listening: false},
      {kahf_friday: true, continue_listening: true},
    );
    await flush();
    expect(h.notifier.scheduled.has('continue_listening')).toBe(false);
    h.changePrefs(
      {kahf_friday: true, continue_listening: true},
      {kahf_friday: true, continue_listening: false},
    );
    await flush();
    expect(h.notifier.scheduled.has('continue_listening')).toBe(true);
  });

  it('a switch change of a holdout user loads nothing', async () => {
    const h = harness(undefined, {isHoldout: () => true});
    setNotificationSchedulingReady();
    h.changePrefs(
      {kahf_friday: false, continue_listening: false},
      {kahf_friday: true, continue_listening: true},
    );
    await flush();
    expect(h.sync).not.toHaveBeenCalled();
    expect(h.notifier.cancelByType).not.toHaveBeenCalled();
  });

  it('starts once in a process', () => {
    const subscribe = jest.fn(() => () => undefined);
    const first = startNotificationScheduling({
      subscribePlayStarts: subscribe,
      subscribePrefs: subscribe,
      subscribeAppActive: subscribe,
      subscribeSynced: subscribe,
    });
    const second = startNotificationScheduling({
      subscribePlayStarts: subscribe,
      subscribePrefs: subscribe,
      subscribeAppActive: subscribe,
      subscribeSynced: subscribe,
    });
    expect(first).toBe(second);
    expect(subscribe).toHaveBeenCalledTimes(4);
  });
});

describe('the iOS opt-in path (review M2), end to end', () => {
  it('play, then "Allow" on the card: the sync after the grant schedules the play', async () => {
    const sync =
      require('../notificationsSync') as typeof import('../notificationsSync');
    const soft = require('../softPrompt') as typeof import('../softPrompt');
    sync.__resetNotificationsSyncForTests();
    soft.__resetSoftPromptForTests();

    let permission: NotificationPermissionStatus = 'undetermined';
    const notifier = fakeNotifier();
    notifier.getPermission.mockImplementation(async () => permission);
    let playListener: ((track: PlayedTrack) => void) | null = null;
    // The default `subscribeSynced`: the real `onNotificationsSynced`.
    startNotificationScheduling({
      subscribePlayStarts: listener => {
        playListener = listener;
        return () => undefined;
      },
      subscribePrefs: () => () => undefined,
      subscribeAppActive: () => () => undefined,
      notifier: () => notifier,
      isHoldout: () => false,
      readPrefs: async () => prefs(),
      textFor: track => ({surahName: '18', reciterName: track.reciterName}),
      onContinueScheduled: () => undefined,
    });
    setNotificationSchedulingReady();

    // 1. The first completed play (permission not asked yet): nothing.
    (playListener as unknown as (track: PlayedTrack) => void)(KAHF);
    await flush();
    expect(notifier.schedule).not.toHaveBeenCalled();

    // 2. The card: "Allow"; the system grants; the grant syncs.
    soft.startSoftPrompt({
      platform: () => 'ios',
      isHoldout: () => false,
      readAnswered: async () => false,
      getPermission: async () => ({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
      }),
      requestPermission: async () => {
        permission = 'granted';
        return {status: 'granted', granted: true, canAskAgain: true};
      },
      setAnswered: () => undefined,
      onGranted: () =>
        sync.syncNotifications('permission_granted', {
          notifier,
          isHoldout: () => false,
          readPrefs: async () => prefs(),
          register: async () => 'registered',
          unregister: async () => true,
          prepare: async () => undefined,
        }),
      subscribeCompleted: () => () => undefined,
      onPrompted: () => undefined,
      onResult: () => undefined,
    });
    await soft.answerSoftPrompt('allow');
    await flush();

    // 3. "Continue listening" is scheduled for the play of step 1.
    const continueCalls = notifier.schedule.mock.calls.filter(
      ([candidate]) =>
        (candidate as {type: string}).type === 'continue_listening',
    );
    expect(continueCalls).toHaveLength(1);
    soft.__resetSoftPromptForTests();
    sync.__resetNotificationsSyncForTests();
  });
});
