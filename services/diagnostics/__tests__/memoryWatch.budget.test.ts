/**
 * Guards the per-device DAILY emit budget on the S35.2 memory probe.
 *
 * This cap is not a tidy-up: an uncapped probe emitted 10,852 events from 130
 * users (~83 each, 87% of project volume) and rate-limited the ENTIRE Sentry
 * project to zero accepted errors for six days, while crash-free percentages
 * stayed green because sessions still ingest when errors do not. These tests
 * pin the properties that outage depended on.
 */

let mockStorage = new Map<string, string>();
let mockMmkvThrows = false;
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    if (mockMmkvThrows) throw new Error('no app-group container');
    return {
      getString: (k: string) => mockStorage.get(k),
      set: (k: string, v: string) => mockStorage.set(k, v),
      delete: (k: string) => mockStorage.delete(k),
      getAllKeys: () => Array.from(mockStorage.keys()),
    };
  },
}));

const mockCapture = jest.fn();
jest.mock('@sentry/react-native', () => ({
  captureMessage: (...a: unknown[]) => mockCapture(...a),
  flush: () => Promise.resolve(true),
  setContext: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {getUsedMemory: () => Promise.resolve(1)},
}));

// The probe is gated on; these tests exercise the budget, not the gate.
let mockDailyCap = 2;
jest.mock('../diagnostics', () => ({
  DIAGNOSTIC_BUILD_FLAG: true,
  isMemoryProbeEnabled: () => true,
  memoryProbeDailyCap: () => mockDailyCap,
  setDiagnosticsConfigListener: jest.fn(),
  areDiagnosticsEnabled: () => true,
  diagBreadcrumb: jest.fn(),
}));

const mockAddPressureListener = jest.fn();
let mockHeapRatio = 0.9; // fraction of the ART ceiling currently in use
jest.mock('../../../modules/qariah-memory', () => ({
  addMemoryPressureListener: (fn: unknown) => {
    mockAddPressureListener(fn);
    return {remove: jest.fn()};
  },
  getHeapStats: () => ({
    javaUsedMb: mockHeapRatio * 100,
    javaMaxMb: 100,
    summaryJavaHeapMb: mockHeapRatio * 100,
    summaryGraphicsMb: 0,
  }),
  setMemoryProbeEnabled: jest.fn(),
}));

const STATS = {javaUsedMb: 90, javaMaxMb: 100, trimLevel: 80} as never;
const KEY = 'memprobe:daily';

/** Drives the module's private emit path through its only real caller.
 *  `require` (not dynamic `import`) — this jest config has no vm-modules. */
function loadModule(): typeof import('../memoryWatch') {
  jest.resetModules();
  // resetModules mints a FRESH react-native instance for the module under test,
  // so AppState must be set on that copy — pollHeap() is foreground-only and the
  // RN test env leaves currentState unset.
  const rn = require('react-native') as {AppState: {currentState: string}};
  rn.AppState.currentState = 'active';
  const mod = require('../memoryWatch') as typeof import('../memoryWatch');
  mod.__resetMemoryBudgetForTests();
  return mod;
}

/** Fires the 'trim' path N times via the registered pressure listener. */
function fireTrim(n: number) {
  const mod = loadModule();
  mod.startMemoryWatch();
  const listener = mockAddPressureListener.mock.calls.at(-1)?.[0] as (
    s: unknown,
  ) => void;
  expect(listener).toBeDefined();
  for (let i = 0; i < n; i++) listener(STATS);
  return mod;
}

/**
 * Drives the REAL 'poll' path — the primary detector, and the one that actually
 * flooded. Each cycle pushes the heap above HIGH_WATER (fires) then below RESET
 * (re-arms hysteresis), which is exactly the oscillation an uncapped probe turned
 * into ~83 events/user/day.
 */
function firePollCycles(n: number) {
  const mod = loadModule();
  mod.startMemoryWatch();
  for (let i = 0; i < n; i++) {
    mockHeapRatio = 0.9; // above HIGH_WATER (0.85) -> fire
    jest.advanceTimersByTime(5000);
    mockHeapRatio = 0.5; // below RESET (0.7) -> re-arm
    jest.advanceTimersByTime(5000);
  }
  return mod;
}

beforeEach(() => {
  mockStorage = new Map();
  mockMmkvThrows = false;
  mockCapture.mockClear();
  mockAddPressureListener.mockClear();
  mockDailyCap = 2;
  mockHeapRatio = 0.9;
  jest.useFakeTimers().setSystemTime(new Date('2026-08-31T12:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('memory-probe daily budget', () => {
  it('emits at most MAX_EVENTS_PER_DAY (2) per source, then goes silent', () => {
    fireTrim(10);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('tags each emit with its 1-based daily sequence', () => {
    fireTrim(5);
    const seqs = mockCapture.mock.calls.map(
      c => (c[1] as {tags: {daily_seq: string}}).tags.daily_seq,
    );
    expect(seqs).toEqual(['1', '2']);
  });

  it('PERSISTS across a process restart — the OOM kills the process, so an\n     in-memory counter would be no cap at all on a crash-looping device', () => {
    fireTrim(2);
    expect(mockCapture).toHaveBeenCalledTimes(2);
    mockCapture.mockClear();
    // Fresh module registry == a relaunched app; mockStorage survives, as MMKV does.
    fireTrim(5);
    expect(mockCapture).toHaveBeenCalledTimes(0);
  });

  it('resets on the next UTC day', () => {
    fireTrim(5);
    expect(mockCapture).toHaveBeenCalledTimes(2);
    mockCapture.mockClear();
    jest.setSystemTime(new Date('2026-09-01T00:05:00Z'));
    fireTrim(5);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it("keeps 'trim' and 'poll' budgets separate so frequent poll noise cannot\n     swallow the rare, high-value pre-OOM trim signal", () => {
    mockStorage.set(KEY, JSON.stringify({day: '2026-08-31', trim: 0, poll: 2}));
    fireTrim(3);
    // poll is spent; trim must still have its full budget.
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('FAILS CLOSED when MMKV is unavailable — an uncounted probe is what\n     caused the outage; "cannot count" must mean "do not emit"', () => {
    mockMmkvThrows = true;
    fireTrim(5);
    expect(mockCapture).toHaveBeenCalledTimes(0);
  });

  it('treats a corrupt budget record as a fresh day rather than emitting freely', () => {
    mockStorage.set(KEY, '{not json');
    fireTrim(10);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale day in the record', () => {
    mockStorage.set(
      KEY,
      JSON.stringify({day: '2026-08-30', trim: 99, poll: 99}),
    );
    fireTrim(5);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });
  it("caps the REAL 'poll' path — the primary detector that actually flooded —\n     across repeated hysteresis oscillations, not just the 'trim' listener", () => {
    firePollCycles(10);
    expect(mockCapture).toHaveBeenCalledTimes(2);
    const sources = mockCapture.mock.calls.map(
      c => (c[1] as {tags: {source: string}}).tags.source,
    );
    expect(sources).toEqual(['poll', 'poll']);
  });

  it("does not clobber the other source's counter on write-back", () => {
    mockStorage.set(KEY, JSON.stringify({day: '2026-08-31', trim: 0, poll: 2}));
    fireTrim(3);
    const saved = JSON.parse(mockStorage.get(KEY) as string) as {
      trim: number;
      poll: number;
    };
    expect(saved.trim).toBe(2);
    expect(saved.poll).toBe(2); // untouched by the trim write
  });

  it('honours a remotely-dialled cap without a rebuild', () => {
    mockDailyCap = 1;
    fireTrim(5);
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('emits nothing when the remote cap is dialled to 0', () => {
    mockDailyCap = 0;
    fireTrim(5);
    expect(mockCapture).toHaveBeenCalledTimes(0);
  });
});
