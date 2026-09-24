// @ai
/**
 * #217 — a native main-thread stall must NOT send a Sentry event of its own.
 * It joins a small buffer that rides on other Sentry events as the
 * `main_thread_stalls` context, so the watchdog's fail-open default costs no
 * quota.
 */

let mockFlagOn = true;
jest.mock('@/config/featureFlags', () => ({
  isFeatureEnabled: () => mockFlagOn,
}));

const mockCaptureMessage = jest.fn();
const mockSetContext = jest.fn();
const mockSetTag = jest.fn();
const mockAddBreadcrumb = jest.fn();
jest.mock('@sentry/react-native', () => ({
  setTag: (...a: unknown[]) => mockSetTag(...a),
  setContext: (...a: unknown[]) => mockSetContext(...a),
  addBreadcrumb: (...a: unknown[]) => mockAddBreadcrumb(...a),
  captureMessage: (...a: unknown[]) => mockCaptureMessage(...a),
  flush: () => Promise.resolve(true),
}));

type StallEvent = {blockedMs: number; thresholdMs: number; mainStack: string};
let mockStallListener: ((e: StallEvent) => void) | null = null;
jest.mock('../../../modules/qariah-anr-watchdog', () => ({
  setMainThreadWatchdogEnabled: jest.fn(),
  addMainThreadStallListener: (fn: (e: StallEvent) => void) => {
    mockStallListener = fn;
    return {remove: jest.fn()};
  },
}));

const mockPersistCount = jest.fn();
const mockStartRecord = jest.fn();
jest.mock('../mainThreadStallCount', () => ({
  persistMainThreadStallCount: (n: number) => mockPersistCount(n),
  startMainThreadStallRecord: () => mockStartRecord(),
}));

jest.mock('expo-device', () => ({}));
jest.mock('expo-file-system', () => ({}));

import {AppState, Platform} from 'react-native';

type DiagnosticsModule = typeof import('../diagnostics');

/** The module reads `AppState` from react-native lazily, at call time, so the
 *  listener sees the main module registry, not the isolated one. Set both. */
function setAppState(target: object, state: string): void {
  Object.defineProperty(target, 'currentState', {
    value: state,
    configurable: true,
    writable: true,
  });
}

const originalFetch = globalThis.fetch;

/** A fresh module (and react-native) instance: `enableDiagnostics` is
 *  first-call-wins, and the stall buffer is per process. */
function setPlatform(target: object, os: string): void {
  Object.defineProperty(target, 'OS', {
    value: os,
    configurable: true,
    writable: true,
  });
}

function load(appState: string, os = 'android'): DiagnosticsModule {
  let mod: DiagnosticsModule | undefined;
  jest.isolateModules(() => {
    setAppState(require('react-native').AppState, appState);
    setPlatform(require('react-native').Platform, os);
    mod = require('../diagnostics') as DiagnosticsModule;
  });
  if (!mod) throw new Error('diagnostics module failed to load');
  setAppState(AppState, appState);
  setPlatform(Platform, os);
  return mod;
}

function stall(blockedMs: number, stack = 'at main'): StallEvent {
  return {blockedMs, thresholdMs: 4000, mainStack: stack};
}

function lastContext(
  name = 'main_thread_stalls',
): Record<string, string | number> {
  const calls = mockSetContext.mock.calls.filter(c => c[0] === name);
  return calls[calls.length - 1][1] as Record<string, string | number>;
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations; one test makes setContext throw.
  mockSetContext.mockReset();
  mockFlagOn = true;
  mockStallListener = null;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe('main-thread stall buffer (#217)', () => {
  it('sends no Sentry event and attaches the stall as context, tag and breadcrumb', () => {
    const mod = load('active');
    mod.enableDiagnostics({});
    expect(mockStallListener).not.toBeNull();
    expect(mockStartRecord).toHaveBeenCalledTimes(1);

    mockStallListener?.(stall(5200, 'at com.example.Blocked.run'));

    expect(mockCaptureMessage).not.toHaveBeenCalledWith(
      'main-thread-stall',
      expect.anything(),
    );
    expect(lastContext('main_thread_stall_count')).toEqual({
      stalls_in_process: 1,
      threshold_ms: 4000,
    });
    expect(mockPersistCount).toHaveBeenCalledWith(1);
    expect(lastContext()).toMatchObject({
      stall_1_blocked_ms: 5200,
      stall_1_bucket: '5-10s',
      stall_1_stack: 'at com.example.Blocked.run',
    });
    expect(typeof lastContext().stall_1_at).toBe('string');
    expect(mockSetTag).toHaveBeenCalledWith('main_thread_stall_seen', 'true');
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'diag.main-thread-stall',
        data: {blocked_ms: 5200, stall_bucket: '5-10s'},
      }),
    );
  });

  it('keeps only the last 5 stalls, newest first, and counts every stall', () => {
    const mod = load('active');
    for (let i = 1; i <= 7; i++) {
      mod.recordMainThreadStall(stall(4000 + i), Date.UTC(2026, 8, 13, 0, i));
    }
    const ctx = lastContext();
    expect(lastContext('main_thread_stall_count').stalls_in_process).toBe(7);
    expect(mockPersistCount).toHaveBeenLastCalledWith(7);
    expect(ctx.stall_1_blocked_ms).toBe(4007);
    expect(ctx.stall_5_blocked_ms).toBe(4003);
    expect(ctx).not.toHaveProperty('stall_6_blocked_ms');
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('caps each stack at 1200 characters', () => {
    const mod = load('active');
    mod.recordMainThreadStall(stall(4500, 'x'.repeat(5000)));
    expect(String(lastContext().stall_1_stack)).toHaveLength(1200);
  });

  it('keeps the full stall context under the 8 KB server limit', () => {
    const mod = load('active');
    for (let i = 0; i < 5; i++) {
      // The native module sends up to 4000 characters.
      mod.recordMainThreadStall(stall(29_999, 'y'.repeat(4000)));
    }
    expect(JSON.stringify(lastContext()).length).toBeLessThan(7500);
  });

  it('ignores a stall while the app is not in the foreground', () => {
    const mod = load('background');
    mod.enableDiagnostics({});
    mockStallListener?.(stall(6000));
    expect(mockSetContext).not.toHaveBeenCalledWith(
      'main_thread_stalls',
      expect.anything(),
    );
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('ignores a stall over 30 s (a doze artifact)', () => {
    const mod = load('active');
    mod.enableDiagnostics({});
    mockStallListener?.(stall(45_000));
    expect(mockSetContext).not.toHaveBeenCalledWith(
      'main_thread_stalls',
      expect.anything(),
    );
  });

  it('writes no stall record on iOS, where the watchdog is a no-op', () => {
    const mod = load('active', 'ios');
    mod.enableDiagnostics({});
    expect(mockStartRecord).not.toHaveBeenCalled();
  });

  it('does not start the watchdog when the payload turns it off', () => {
    const mod = load('active');
    mod.enableDiagnostics({mainThreadWatchdog: false});
    expect(mockStallListener).toBeNull();
    expect(mockStartRecord).not.toHaveBeenCalled();
  });

  it('never throws when Sentry throws', () => {
    const mod = load('active');
    mockSetContext.mockImplementation(() => {
      throw new Error('sentry exploded');
    });
    expect(() => mod.recordMainThreadStall(stall(4200))).not.toThrow();
  });

  it('a new process starts with an empty buffer', () => {
    const mod = load('active');
    mod.recordMainThreadStall(stall(4100));
    mod.__resetMainThreadStallsForTests();
    mod.recordMainThreadStall(stall(4300));
    expect(lastContext('main_thread_stall_count').stalls_in_process).toBe(1);
    expect(lastContext()).not.toHaveProperty('stall_2_blocked_ms');
  });
});
