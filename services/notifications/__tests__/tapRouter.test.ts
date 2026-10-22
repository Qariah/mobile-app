// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the tap routes of each type, and the
// cold-start and once-only handling of a tap.
import type {Reciter} from '@/data/reciterData';
import {
  BROWSE_ROUTE,
  DEFAULT_TAP_ACTION,
  LAST_TAP_KEY,
  LISTEN_ROUTE,
  RECITER_PROFILE_ROUTE,
  TAP_ROUTER_START_DELAY_MS,
  __resetTapRouterForTests,
  createTapLedger,
  notificationTapOf,
  openNotificationTap,
  resolveTapAction,
  startNotificationTapRouter,
  waitUntilReady,
  type NotificationResponseLike,
  type NotificationTap,
  type OpenTapDeps,
  type TapSource,
} from '../tapRouter';
import type {KeyValueStorage, NotificationTarget} from '../types';

const zaynab = {
  id: 'r-z',
  name: 'Zaynab',
  slug: 'zaynab',
  rewayat: [{id: 'w-z', surah_list: [18, 36]}],
} as unknown as Reciter;

const lookup = {
  byId: (id: string) => (id === zaynab.id ? zaynab : undefined),
  bySlug: (slug: string) => (slug === zaynab.slug ? zaynab : undefined),
};

function response(
  data: Record<string, unknown> | null,
  overrides: {id?: string; date?: number; action?: string} = {},
): NotificationResponseLike {
  return {
    actionIdentifier: overrides.action ?? DEFAULT_TAP_ACTION,
    notification: {
      date: overrides.date ?? 1_000,
      request: {identifier: overrides.id ?? 'kahf_friday', content: {data}},
    },
  };
}

const KAHF_DATA = {type: 'kahf_friday', target: {kind: 'surah', surah: 18}};

function tapFor(
  type: NotificationTap['type'],
  target: NotificationTarget,
): NotificationTap {
  return {key: `${type}|1|a`, id: type, type, target};
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

describe('notificationTapOf', () => {
  it('reads the type, the target and a key of the tap', () => {
    expect(notificationTapOf(response(KAHF_DATA, {date: 42}))).toEqual({
      key: `kahf_friday|42|${DEFAULT_TAP_ACTION}`,
      id: 'kahf_friday',
      type: 'kahf_friday',
      target: {kind: 'surah', surah: 18},
    });
  });

  it('ignores a dismiss, a notice of another sender and a bad target', () => {
    expect(
      notificationTapOf(
        response(KAHF_DATA, {
          action: 'com.apple.UNNotificationDismissActionIdentifier',
        }),
      ),
    ).toBeNull();
    expect(notificationTapOf(response(null))).toBeNull();
    expect(
      notificationTapOf(response({type: 'promo', target: {kind: 'listen'}})),
    ).toBeNull();
    expect(
      notificationTapOf(
        response({type: 'followed_recitation', target: {kind: 'recitation'}}),
      ),
    ).toBeNull();
    expect(notificationTapOf(null)).toBeNull();
  });
});

describe('resolveTapAction (the route table)', () => {
  const recitation = (
    overrides: Partial<Extract<NotificationTarget, {kind: 'recitation'}>> = {},
  ): NotificationTarget => ({
    kind: 'recitation',
    reciterId: 'r-z',
    reciterSlug: 'zaynab',
    rewayahId: 'w-z',
    surah: 18,
    ...overrides,
  });

  it.each([
    ['a recitation in the catalog: play it', recitation(), {kind: 'play'}],
    [
      'the reciter by its slug (a new id): play it',
      recitation({reciterId: 'old-id'}),
      {kind: 'play'},
    ],
    [
      'a surah that the rewayah has no more: the profile, on that rewayah',
      recitation({surah: 1}),
      {kind: 'profile', reciterId: 'r-z', rewayahId: 'w-z'},
    ],
    [
      'a rewayah that is gone: the profile',
      recitation({rewayahId: 'gone'}),
      {kind: 'profile', reciterId: 'r-z', rewayahId: null},
    ],
    [
      'a reciter that is gone: the Listen tab',
      recitation({reciterId: 'gone', reciterSlug: null}),
      {kind: 'listen'},
    ],
    [
      'Al-Kahf: Browse by Surah 18',
      {kind: 'surah', surah: 18},
      {kind: 'browse_surah', surah: 18},
    ],
    ['continue: resume', {kind: 'continue_listening'}, {kind: 'resume'}],
    [
      'a summary or whats_new: the Listen tab',
      {kind: 'listen'},
      {kind: 'listen'},
    ],
  ] as const)('%s', (_label, target, expected) => {
    expect(
      resolveTapAction(target as NotificationTarget, lookup),
    ).toMatchObject(expected);
  });

  it('a play carries the reciter, the rewayah and the surah', () => {
    const action = resolveTapAction(recitation({surah: 36}), lookup);
    expect(action).toEqual({
      kind: 'play',
      reciter: zaynab,
      rewayah: zaynab.rewayat[0],
      surah: 36,
    });
  });
});

describe('openNotificationTap', () => {
  function deps(overrides: Partial<OpenTapDeps> = {}): OpenTapDeps & {
    router: {push: jest.Mock; navigate: jest.Mock};
    playRecitation: jest.Mock;
    resumeLastSession: jest.Mock;
    waitForSession: jest.Mock;
    closePlayer: jest.Mock;
  } {
    return {
      router: {push: jest.fn(), navigate: jest.fn()},
      waitForNavigation: async () => true,
      waitForSession: jest.fn(async () => undefined),
      byId: lookup.byId,
      bySlug: lookup.bySlug,
      playRecitation: jest.fn(async () => undefined),
      resumeLastSession: jest.fn(async () => true),
      closePlayer: jest.fn(),
      waitForMushafRestore: jest.fn(async () => true),
      ...overrides,
    } as never;
  }

  it('a recitation: waits for the session, then plays it (no navigation)', async () => {
    const d = deps();
    const result = await openNotificationTap(
      tapFor('followed_recitation', {
        kind: 'recitation',
        reciterId: 'r-z',
        reciterSlug: 'zaynab',
        rewayahId: 'w-z',
        surah: 18,
      }),
      d,
    );
    expect(result).toBe('play');
    expect(d.waitForSession).toHaveBeenCalled();
    expect(d.playRecitation).toHaveBeenCalledWith(
      zaynab,
      zaynab.rewayat[0],
      18,
    );
    expect(d.router.push).not.toHaveBeenCalled();
    // The play opens the player: it is not closed first.
    expect(d.closePlayer).not.toHaveBeenCalled();
  });

  it('a recitation that is gone from the rewayah: the reciter profile', async () => {
    const d = deps();
    await openNotificationTap(
      tapFor('new_recitation', {
        kind: 'recitation',
        reciterId: 'r-z',
        reciterSlug: null,
        rewayahId: 'w-z',
        surah: 2,
      }),
      d,
    );
    expect(d.router.push).toHaveBeenCalledWith({
      pathname: RECITER_PROFILE_ROUTE,
      params: {id: 'r-z', rewayatId: 'w-z'},
    });
  });

  it('Al-Kahf: pushes Browse by Surah 18', async () => {
    const d = deps();
    await expect(
      openNotificationTap(tapFor('kahf_friday', {kind: 'surah', surah: 18}), d),
    ).resolves.toBe('browse_surah');
    expect(BROWSE_ROUTE).toBe('/(tabs)/(a.home)/reciter/browse');
    expect(d.router.push).toHaveBeenCalledWith({
      pathname: BROWSE_ROUTE,
      params: {surahId: '18'},
    });
    expect(d.waitForSession).not.toHaveBeenCalled();
    // The screen does not open under the full player.
    expect(d.closePlayer).toHaveBeenCalled();
  });

  it('continue: resumes the session; with none, the Listen tab', async () => {
    const d = deps();
    await expect(
      openNotificationTap(
        tapFor('continue_listening', {kind: 'continue_listening'}),
        d,
      ),
    ).resolves.toBe('resume');
    expect(d.resumeLastSession).toHaveBeenCalled();
    expect(d.router.navigate).not.toHaveBeenCalled();
    expect(d.closePlayer).not.toHaveBeenCalled();

    const none = deps({resumeLastSession: jest.fn(async () => false)});
    await expect(
      openNotificationTap(
        tapFor('continue_listening', {kind: 'continue_listening'}),
        none,
      ),
    ).resolves.toBe('listen');
    expect(none.router.navigate).toHaveBeenCalledWith(LISTEN_ROUTE);
  });

  it('whats_new and a summary: the Listen tab', async () => {
    const d = deps();
    await openNotificationTap(tapFor('whats_new', {kind: 'listen'}), d);
    expect(d.router.navigate).toHaveBeenCalledWith('/(tabs)/(a.home)');
  });

  it('L2: waits for the cold-start Mushaf restore before it navigates', async () => {
    let release: () => void = () => undefined;
    const restore = new Promise<void>(resolve => {
      release = resolve;
    });
    const d = deps({waitForMushafRestore: () => restore});
    const opened = openNotificationTap(
      tapFor('kahf_friday', {kind: 'surah', surah: 18}),
      d,
    );
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(d.router.push).not.toHaveBeenCalled();
    release();
    await expect(opened).resolves.toBe('browse_surah');
    expect(d.router.push).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the navigator never gets ready', async () => {
    const d = deps({waitForNavigation: async () => false});
    await expect(
      openNotificationTap(tapFor('kahf_friday', {kind: 'surah', surah: 18}), d),
    ).resolves.toBe('no_navigator');
    expect(d.router.push).not.toHaveBeenCalled();
  });

  it('gives failed, and does not throw, when the play throws', async () => {
    const d = deps({
      playRecitation: jest.fn(async () => {
        throw new Error('player');
      }),
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      openNotificationTap(
        tapFor('followed_recitation', {
          kind: 'recitation',
          reciterId: 'r-z',
          reciterSlug: 'zaynab',
          rewayahId: 'w-z',
          surah: 18,
        }),
        d,
      ),
    ).resolves.toBe('failed');
    jest.restoreAllMocks();
  });
});

describe('createTapLedger', () => {
  it('claims a key once, in memory and in MMKV (a new process too)', () => {
    const storage = memoryStorage();
    const ledger = createTapLedger(storage);
    expect(ledger.claim('a')).toBe(true);
    expect(ledger.claim('a')).toBe(false);
    expect(storage.values.get(LAST_TAP_KEY)).toBe('a');
    // A new process (an Android activity that starts again with the intent).
    expect(createTapLedger(storage).claim('a')).toBe(false);
    expect(createTapLedger(storage).claim('b')).toBe(true);
  });
});

describe('startNotificationTapRouter', () => {
  function fakeSource(last: NotificationResponseLike | null): TapSource & {
    emit(response: NotificationResponseLike): void;
    clearLastResponse: jest.Mock;
    listeners: number;
  } {
    const listeners = new Set<(r: NotificationResponseLike) => void>();
    let current = last;
    return {
      getLastResponse: () => current,
      clearLastResponse: jest.fn(() => {
        current = null;
      }),
      addResponseListener: listener => {
        listeners.add(listener);
        return {remove: () => listeners.delete(listener)};
      },
      emit: r => listeners.forEach(listener => listener(r)),
      get listeners() {
        return listeners.size;
      },
    };
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    __resetTapRouterForTests();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('a cold start: opens the tap that started the app, once, after the delay', async () => {
    const source = fakeSource(response(KAHF_DATA));
    const open = jest.fn(async () => 'browse_surah' as const);
    const onOpened = jest.fn();
    startNotificationTapRouter({
      source: () => source,
      open,
      ledger: createTapLedger(memoryStorage()),
      onOpened,
    });
    expect(open).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TAP_ROUTER_START_DELAY_MS);
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(source.clearLastResponse).toHaveBeenCalled();
    expect(onOpened).toHaveBeenCalledWith(
      expect.objectContaining({type: 'kahf_friday'}),
      true,
      'browse_surah',
    );
    // The same response from the listener does not open it again.
    source.emit(response(KAHF_DATA));
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a warm start or a tap while open: the listener opens it (cold_start false)', async () => {
    const source = fakeSource(null);
    const open = jest.fn(async () => 'listen' as const);
    const onOpened = jest.fn();
    startNotificationTapRouter({
      source: () => source,
      open,
      ledger: createTapLedger(memoryStorage()),
      onOpened,
    });
    jest.advanceTimersByTime(TAP_ROUTER_START_DELAY_MS);
    expect(open).not.toHaveBeenCalled();
    source.emit(
      response(
        {type: 'whats_new', target: {kind: 'listen'}},
        {id: 'whats_new:2026-10-sprint48', date: 7},
      ),
    );
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(onOpened).toHaveBeenCalledWith(
      expect.objectContaining({type: 'whats_new'}),
      false,
      'listen',
    );
    // A second notice of the same id at another time is a new tap.
    source.emit(response(KAHF_DATA, {date: 8}));
    source.emit(response(KAHF_DATA, {date: 8}));
    await flush();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('starts once in a process', () => {
    const source = fakeSource(null);
    const sourceFactory = jest.fn(() => source);
    startNotificationTapRouter({source: sourceFactory, open: jest.fn()});
    startNotificationTapRouter({source: sourceFactory, open: jest.fn()});
    jest.advanceTimersByTime(TAP_ROUTER_START_DELAY_MS);
    expect(sourceFactory).toHaveBeenCalledTimes(1);
    expect(source.listeners).toBe(1);
  });

  it('does not throw when the native module is missing', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    startNotificationTapRouter({
      source: () => {
        throw new Error('no module');
      },
      open: jest.fn(),
    });
    expect(() =>
      jest.advanceTimersByTime(TAP_ROUTER_START_DELAY_MS),
    ).not.toThrow();
  });
});

describe('waitUntilReady', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves at once, after a poll, or false after the time limit', async () => {
    await expect(waitUntilReady(() => true)).resolves.toBe(true);
    let ready = false;
    const later = waitUntilReady(() => ready, 1000, 100);
    ready = true;
    jest.advanceTimersByTime(100);
    await expect(later).resolves.toBe(true);
    const never = waitUntilReady(() => false, 1000, 100);
    jest.advanceTimersByTime(1000);
    await expect(never).resolves.toBe(false);
  });
});
