// @ai-generated
// Qariah (Sprint 48, S48.8, Task 18): the foreground record runs once for
// each process, at the first `active` app state, with the fresh-install value
// that it read at the start.
import type {AppStateStatus} from 'react-native';
import type {ForegroundAnnouncementResult} from '../announcementStore';
import type {
  AppStateSource,
  ForegroundAnnouncementDeps,
} from '../useForegroundAnnouncementRecord';

type Start = (deps?: ForegroundAnnouncementDeps) => void;

/** A fresh module, so the once-for-each-process guard starts unset. */
function loadStart(): Start {
  let start: Start | undefined;
  jest.isolateModules(() => {
    start =
      require('../useForegroundAnnouncementRecord').startForegroundAnnouncementRecord;
  });
  return start as Start;
}

function fakeAppState(initial: AppStateStatus | null): AppStateSource & {
  emit(state: AppStateStatus): void;
  listeners: number;
} {
  const listeners = new Set<(state: AppStateStatus) => void>();
  return {
    currentState: initial,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return {remove: () => listeners.delete(listener)};
    },
    emit: state => {
      for (const listener of [...listeners]) listener(state);
    },
    get listeners() {
      return listeners.size;
    },
  };
}

const RESULT: ForegroundAnnouncementResult = {
  action: 'record_and_cancel_pending',
  recorded: true,
};

async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe('startForegroundAnnouncementRecord', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('after the record, removes the notice of the current id', async () => {
    const start = loadStart();
    const order: string[] = [];
    start({
      appState: fakeAppState('active'),
      readFreshInstall: async () => false,
      record: () => {
        order.push('record');
        return {action: 'none', recorded: false};
      },
      clearNotice: id => order.push(`clear:${id}`),
      currentId: '2026-10-sprint48',
    });
    await settle();
    // Also for `none`: the background run posted and recorded this id.
    expect(order).toEqual(['record', 'clear:2026-10-sprint48']);
  });

  it('removes nothing for a build with no announcement', async () => {
    const start = loadStart();
    const clearNotice = jest.fn();
    start({
      appState: fakeAppState('active'),
      readFreshInstall: async () => false,
      record: () => RESULT,
      clearNotice,
      currentId: null,
    });
    await settle();
    expect(clearNotice).not.toHaveBeenCalled();
  });

  it('records at once when the app is already active', async () => {
    const start = loadStart();
    const record = jest.fn(() => RESULT);
    const onResult = jest.fn();
    start({
      appState: fakeAppState('active'),
      readFreshInstall: async () => false,
      record,
      onResult,
    });
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(false);
    expect(onResult).toHaveBeenCalledWith(RESULT);
  });

  it('waits for the first active state (a background launch)', async () => {
    const start = loadStart();
    const appState = fakeAppState('background');
    const readFreshInstall = jest.fn(async () => true);
    const record = jest.fn(() => RESULT);
    start({appState, readFreshInstall, record});

    // The read starts at once, before the user can close the onboarding.
    expect(readFreshInstall).toHaveBeenCalledTimes(1);
    await settle();
    expect(record).not.toHaveBeenCalled();

    appState.emit('inactive');
    await settle();
    expect(record).not.toHaveBeenCalled();

    appState.emit('active');
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(true);
    expect(appState.listeners).toBe(0);

    appState.emit('background');
    appState.emit('active');
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('treats the "unknown" state of an iOS cold start as not active yet', async () => {
    const start = loadStart();
    const appState = fakeAppState('unknown');
    const record = jest.fn(() => RESULT);
    start({appState, readFreshInstall: async () => false, record});
    await settle();
    expect(record).not.toHaveBeenCalled();
    appState.emit('active');
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('runs once for each process', async () => {
    const start = loadStart();
    const record = jest.fn(() => RESULT);
    const deps = {
      appState: fakeAppState('active'),
      readFreshInstall: async () => false,
      record,
    };
    start(deps);
    start(deps);
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('never throws into the caller', async () => {
    const start = loadStart();
    expect(() =>
      start({
        appState: fakeAppState('active'),
        readFreshInstall: async () => false,
        record: () => {
          throw new Error('record failed');
        },
      }),
    ).not.toThrow();
    await settle();

    const startAgain = loadStart();
    const record = jest.fn(() => RESULT);
    expect(() =>
      startAgain({
        appState: fakeAppState('active'),
        readFreshInstall: () => {
          throw new Error('read failed');
        },
        record,
      }),
    ).not.toThrow();
    await settle();
    // A failed read counts as a fresh install: record, announce nothing.
    expect(record).toHaveBeenCalledWith(true);
  });

  it('counts a rejected read as a fresh install', async () => {
    const start = loadStart();
    const appState = fakeAppState('background');
    const record = jest.fn(() => RESULT);
    start({
      appState,
      readFreshInstall: () => Promise.reject(new Error('read failed')),
      record,
    });
    await settle();
    appState.emit('active');
    await settle();
    expect(record).toHaveBeenCalledWith(true);
  });
});
