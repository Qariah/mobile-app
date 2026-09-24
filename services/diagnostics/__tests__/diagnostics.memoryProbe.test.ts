// @ai
/**
 * #407 — the memory probe must FAIL CLOSED on the remote `diagnostics_mode` path.
 *
 * The probe was killed on 2026-08-31 with `{"memoryProbe": false}` after it
 * exhausted the whole Sentry error quota. On 2026-09-10 one production device
 * still sent 36 `onMemoryPressure` events in 3 s: the most probable cause is a
 * stale cached pre-kill payload (`{"sampleRate": 0.2}`, no `memoryProbe` key)
 * that fell through to a default of ON. These tests pin that only an explicit
 * `memoryProbe: true` turns the probe on from a remote payload.
 */

let mockFlagOn = true;
jest.mock('@/config/featureFlags', () => ({
  isFeatureEnabled: () => mockFlagOn,
}));

jest.mock('@sentry/react-native', () => ({
  setTag: jest.fn(),
  setContext: jest.fn(),
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
  flush: () => Promise.resolve(true),
}));

jest.mock('../../../modules/qariah-anr-watchdog', () => ({
  setMainThreadWatchdogEnabled: jest.fn(),
  addMainThreadStallListener: () => ({remove: jest.fn()}),
}));

jest.mock('expo-device', () => ({}));
jest.mock('expo-file-system', () => ({}));

type DiagnosticsModule = typeof import('../diagnostics');

const ENV_KEY = 'EXPO_PUBLIC_DIAGNOSTIC_MODE';
const originalEnv = process.env[ENV_KEY];
const originalFetch = globalThis.fetch;

/** A fresh module instance per case: `enableDiagnostics` is first-call-wins. */
function load(diagnosticBuild: boolean): DiagnosticsModule {
  if (diagnosticBuild) process.env[ENV_KEY] = 'true';
  else delete process.env[ENV_KEY];
  let mod: DiagnosticsModule | undefined;
  jest.isolateModules(() => {
    mod = require('../diagnostics') as DiagnosticsModule;
  });
  if (!mod) throw new Error('diagnostics module failed to load');
  return mod;
}

/** The remote-flag path: a normal build, enabled with the flag's payload. */
function remote(payload: unknown): DiagnosticsModule {
  const mod = load(false);
  mod.enableDiagnostics(payload);
  return mod;
}

beforeEach(() => {
  mockFlagOn = true;
  // The default sampleRate starts a heartbeat interval; keep it off the clock.
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  // A sampled session wraps global fetch; do not leak that across cases.
  globalThis.fetch = originalFetch;
  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
});

describe('memory probe gate — remote diagnostics_mode payload (normal build)', () => {
  it('stays OFF for a stale pre-kill payload without the memoryProbe key', () => {
    const mod = remote({sampleRate: 0.2});
    expect(mod.areDiagnosticsEnabled()).toBe(true);
    expect(mod.isMemoryProbeEnabled()).toBe(false);
  });

  it('stays OFF for an empty payload', () => {
    expect(remote({}).isMemoryProbeEnabled()).toBe(false);
  });

  it('stays OFF when the flag resolves with no payload at all', () => {
    expect(remote(undefined).isMemoryProbeEnabled()).toBe(false);
  });

  it('stays OFF for a null payload', () => {
    expect(remote(null).isMemoryProbeEnabled()).toBe(false);
  });

  it('stays OFF for a payload that is not an object', () => {
    expect(remote('{"memoryProbe": true}').isMemoryProbeEnabled()).toBe(false);
  });

  it('stays OFF for a non-boolean memoryProbe value', () => {
    expect(remote({memoryProbe: 'true'}).isMemoryProbeEnabled()).toBe(false);
  });

  it('turns ON only for an explicit memoryProbe: true', () => {
    expect(remote({memoryProbe: true}).isMemoryProbeEnabled()).toBe(true);
  });

  it('stays OFF for an explicit memoryProbe: false', () => {
    expect(remote({memoryProbe: false}).isMemoryProbeEnabled()).toBe(false);
  });

  it('respects the build flag as the hard local off', () => {
    mockFlagOn = false;
    expect(remote({memoryProbe: true}).isMemoryProbeEnabled()).toBe(false);
  });

  it('is OFF before diagnostics are enabled', () => {
    expect(load(false).isMemoryProbeEnabled()).toBe(false);
  });

  it('tells memoryWatch to re-sync once the config applies', () => {
    const mod = load(false);
    const listener = jest.fn();
    mod.setDiagnosticsConfigListener(listener);
    mod.enableDiagnostics({memoryProbe: true});
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('memory probe gate — one-off diagnostic APK (build flag, no payload)', () => {
  it('turns ON by default: the build is a deliberate local one-off', () => {
    const mod = load(true);
    expect(mod.DIAGNOSTIC_BUILD_FLAG).toBe(true);
    mod.enableDiagnostics();
    expect(mod.isMemoryProbeEnabled()).toBe(true);
  });

  // Not a real remote kill: the diagnostic APK enables diagnostics at boot with
  // no payload, and the later remote call returns early. This pins coerceConfig.
  it('config parsing: an explicit memoryProbe: false in a first call keeps it off', () => {
    const mod = load(true);
    mod.enableDiagnostics({memoryProbe: false});
    expect(mod.isMemoryProbeEnabled()).toBe(false);
  });

  it('still respects the build flag as the hard local off', () => {
    mockFlagOn = false;
    const mod = load(true);
    mod.enableDiagnostics();
    expect(mod.isMemoryProbeEnabled()).toBe(false);
  });
});
