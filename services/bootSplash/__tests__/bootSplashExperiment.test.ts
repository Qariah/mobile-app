// @ai Tests for the boot-splash experiment logic (ANR hotfix v2).

import {
  FLAG_RESPONSE_WATCHDOG_MS,
  armsTreatment,
  BootSplashNative,
  createBootSplashExperiment,
  FlagClientLike,
  mapExitReason,
  NONBLOCKING_SPLASH_FLAG_V2,
  PreviousProcessInfo,
  readFlagResolution,
  resolutionLabel,
} from '../bootSplashExperiment';

type StoredDetails = {
  requestError?: unknown;
  quotaLimited?: unknown;
  errorsWhileComputingFlags?: unknown;
} | null;

/** A fake PostHog client. `respond` simulates one flag response. */
function makeClient(initial?: {
  value?: string | boolean;
  details?: StoredDetails;
}) {
  let value: string | boolean | undefined = initial?.value;
  let details: StoredDetails = initial?.details ?? {};
  const subs = new Set<(flags: unknown) => void>();
  const client = {
    getFeatureFlag: jest.fn((key: string) =>
      key === NONBLOCKING_SPLASH_FLAG_V2 ? value : undefined,
    ),
    onFeatureFlags: jest.fn((cb: (flags: unknown) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }),
    setPersonPropertiesForFlags: jest.fn(),
    getStoredFlagDetails: jest.fn(() => details),
    reloadFeatureFlags: jest.fn(),
  };
  const respond = (
    next: {
      value?: string | boolean;
      details?: StoredDetails;
      /** getFeatureFlags() after the response; default {} (none stored → undefined). */
      flags?: Record<string, unknown> | undefined;
    } = {},
  ): void => {
    if ('value' in next) value = next.value;
    details = next.details === undefined ? {} : next.details;
    const flags =
      'flags' in next ? next.flags : details === null ? undefined : {};
    // Like the SDK (posthog-core onFeatureFlags): `if (flags) cb(flags)`.
    if (!flags) return;
    for (const cb of Array.from(subs)) cb(flags);
  };
  return {client, respond, subs};
}

/**
 * A fake native module. `file` stands for the boot-risk marker file.
 * Like the native side, an ANR previous exit sets the marker before
 * getPreviousProcessInfo resolves (turn off with anrSideEffect: false).
 */
function makeNative(opts?: {
  mode?: string;
  file?: {bootRisk: boolean};
  info?: () => Promise<PreviousProcessInfo | null>;
  anrSideEffect?: boolean;
}) {
  const file = opts?.file ?? {bootRisk: false};
  const infoFn = opts?.info ?? (() => Promise.resolve(null));
  const anrSideEffect = opts?.anrSideEffect ?? true;
  const native = {
    setNonBlockingSplashForNextLaunch: jest.fn(),
    setNonBlockingSplashOffKeepGuard: jest.fn(),
    getBootSplashMode: jest.fn(() => opts?.mode ?? 'control'),
    setBootRisk: jest.fn(() => {
      file.bootRisk = true;
    }),
    getBootRisk: jest.fn(() => file.bootRisk),
    getPreviousProcessInfo: jest.fn(() =>
      infoFn().then(i => {
        if (!anrSideEffect || !i || i.exitReasonCode !== 6) return i;
        const newlyEnrolledByAnr = !file.bootRisk;
        file.bootRisk = true;
        return {...i, newlyEnrolledByAnr};
      }),
    ),
  };
  return {native: native as jest.Mocked<BootSplashNative>, file};
}

function info(
  code: number,
  extra: Partial<PreviousProcessInfo> = {},
): PreviousProcessInfo {
  return {
    hasPrevious: true,
    exitReasonCode: code,
    prevMode: 'treatment',
    prevReachedReveal: true,
    bootRisk: false,
    newlyEnrolledByAnr: false,
    ...extra,
  };
}

// attach starts an 8 s watchdog timer; fake timers keep jest from waiting.
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('mapExitReason', () => {
  it.each([
    [6, 'anr'],
    [4, 'crash'],
    [5, 'crash_native'],
    [10, 'user'],
    [11, 'user'],
    [3, 'low_memory'],
    [0, 'unknown'],
    [-1, 'unknown'],
    [-2, 'unknown'],
    [-3, 'unknown'],
    [-99, 'unknown'],
    [1, 'other'],
    [2, 'other'],
    [13, 'other'],
    [16, 'other'],
    [NaN, 'unknown'],
    [6.5, 'unknown'],
    [Infinity, 'unknown'],
  ])('maps %p to %p', (code, label) => {
    expect(mapExitReason(code)).toBe(label);
  });
});

describe('armsTreatment and resolutionLabel', () => {
  it.each([
    ['treatment', false, true, 'treatment'],
    ['control', false, false, 'control'],
    [false, false, false, 'false'],
    [undefined, false, false, 'missing'],
    ['weird', false, false, 'other'],
    [true, false, false, 'other'],
    ['treatment', true, false, 'error'],
    ['control', true, false, 'error'],
    [undefined, true, false, 'error'],
  ] as const)(
    'value %p requestFailed %p → arms %p, label %p',
    (value, requestFailed, arms, label) => {
      const r = {value, requestFailed};
      expect(armsTreatment(r)).toBe(arms);
      expect(resolutionLabel(r)).toBe(label);
    },
  );
});

describe('readFlagResolution', () => {
  it('reads a good response', () => {
    const {client} = makeClient({value: 'treatment'});
    expect(readFlagResolution(client)).toEqual({
      value: 'treatment',
      requestFailed: false,
    });
  });

  it('flags a request error', () => {
    const {client} = makeClient({
      value: 'treatment',
      details: {requestError: {type: 'timeout'}},
    });
    expect(readFlagResolution(client).requestFailed).toBe(true);
  });

  it('flags a feature-flag quota limit', () => {
    const {client} = makeClient({
      value: 'treatment',
      details: {quotaLimited: ['feature_flags']},
    });
    expect(readFlagResolution(client).requestFailed).toBe(true);
  });

  it('flags a partial response (errorsWhileComputingFlags)', () => {
    const {client} = makeClient({
      value: 'treatment',
      details: {errorsWhileComputingFlags: true},
    });
    expect(readFlagResolution(client).requestFailed).toBe(true);
  });

  it('ignores a quota limit on another feature', () => {
    const {client} = makeClient({
      value: 'treatment',
      details: {quotaLimited: ['recordings']},
    });
    expect(readFlagResolution(client).requestFailed).toBe(false);
  });

  it('fails closed for a client without getStoredFlagDetails', () => {
    const client: FlagClientLike = {
      getFeatureFlag: () => 'treatment',
      onFeatureFlags: () => () => undefined,
      setPersonPropertiesForFlags: () => undefined,
    };
    const r = readFlagResolution(client);
    expect(r).toEqual({value: undefined, requestFailed: true});
    expect(armsTreatment(r)).toBe(false);
  });

  it('fails closed when the client throws', () => {
    const {client} = makeClient({value: 'treatment'});
    client.getFeatureFlag.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(readFlagResolution(client)).toEqual({
      value: undefined,
      requestFailed: true,
    });
  });
});

describe('attach', () => {
  it('re-applies boot_risk with reload=false synchronously when enrolled', () => {
    const {native} = makeNative({file: {bootRisk: true}});
    const {client} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledTimes(1);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledWith(
      {boot_risk: 'true'},
      false,
    );
    // No flag response yet: the native value is untouched.
    expect(native.setNonBlockingSplashForNextLaunch).not.toHaveBeenCalled();
  });

  it('does not send boot_risk when the device is not enrolled', () => {
    const {native} = makeNative();
    const {client} = makeClient();
    createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    }).attach(client);
    expect(client.setPersonPropertiesForFlags).not.toHaveBeenCalled();
    expect(client.onFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['iOS platform', false, 'control'],
    ['native module absent', true, 'unavailable'],
  ])('does nothing when inactive (%s)', (_name, isAndroid, mode) => {
    const {native} = makeNative({mode, file: {bootRisk: true}});
    const {client} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid,
      buildFlagEnabled: false,
    });
    expect(exp.active).toBe(false);
    exp.attach(client);
    expect(client.setPersonPropertiesForFlags).not.toHaveBeenCalled();
    expect(client.onFeatureFlags).not.toHaveBeenCalled();
    expect(client.getFeatureFlag).not.toHaveBeenCalled();
    expect(native.setNonBlockingSplashForNextLaunch).not.toHaveBeenCalled();
    expect(native.setBootRisk).not.toHaveBeenCalled();
  });

  it('subscribes only once when called twice', () => {
    const {native} = makeNative({file: {bootRisk: true}});
    const {client, subs} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    exp.attach(client);
    expect(client.onFeatureFlags).toHaveBeenCalledTimes(1);
    expect(subs.size).toBe(1);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledTimes(1);
  });

  it('never throws when the client throws', () => {
    const {native} = makeNative({file: {bootRisk: true}});
    const {client} = makeClient();
    client.setPersonPropertiesForFlags.mockImplementation(() => {
      throw new Error('boom');
    });
    client.onFeatureFlags.mockImplementation(() => {
      throw new Error('boom');
    });
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    expect(() => exp.attach(client)).not.toThrow();
  });
});

describe('flag responses', () => {
  function setup(buildFlagEnabled = true) {
    const {native} = makeNative();
    const {client, respond} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled,
    });
    exp.attach(client);
    return {native, client, respond, exp};
  }

  it('writes true for treatment, then OFF with the guard kept after an error response', () => {
    const {native, respond} = setup();
    respond({value: 'treatment'});
    expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledTimes(1);
    expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenLastCalledWith(
      true,
    );
    expect(native.setNonBlockingSplashOffKeepGuard).not.toHaveBeenCalled();
    respond({value: 'treatment', details: {requestError: {type: 'network'}}});
    expect(native.setNonBlockingSplashOffKeepGuard).toHaveBeenCalledTimes(1);
    expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a request error', {requestError: {type: 'network'}}],
    ['a flag quota limit', {quotaLimited: ['feature_flags']}],
    ['a partial response', {errorsWhileComputingFlags: true}],
  ])(
    'writes OFF with the guard kept for %s',
    (_name, details: StoredDetails) => {
      const {native, respond, exp} = setup();
      const cb = jest.fn();
      exp.onResolved(cb);
      respond({value: 'treatment', details});
      expect(native.setNonBlockingSplashOffKeepGuard).toHaveBeenCalledTimes(1);
      expect(native.setNonBlockingSplashForNextLaunch).not.toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith({
        resolution: {value: 'treatment', requestFailed: true},
        label: 'error',
        armsNextLaunch: false,
      });
    },
  );

  it('a good response after a failed one writes the full value', () => {
    const {native, respond} = setup();
    respond({value: 'control', details: {requestError: {type: 'network'}}});
    expect(native.setNonBlockingSplashOffKeepGuard).toHaveBeenCalledTimes(1);
    respond({value: 'control'});
    expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledTimes(1);
    expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledWith(
      false,
    );
  });

  it('does not call back when there are no flag details', () => {
    const {native, respond} = setup();
    respond({value: 'treatment', details: null});
    expect(native.setNonBlockingSplashForNextLaunch).not.toHaveBeenCalled();
    expect(native.setNonBlockingSplashOffKeepGuard).not.toHaveBeenCalled();
  });

  it.each([['control'], [false], [undefined], ['weird']])(
    'writes false for %p',
    value => {
      const {native, respond} = setup();
      respond({value});
      expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledTimes(1);
      expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledWith(
        false,
      );
      expect(native.setNonBlockingSplashOffKeepGuard).not.toHaveBeenCalled();
    },
  );

  it('writes false once at attach and does not subscribe when the build flag is off', () => {
    const {native, client, respond, exp} = setup(false);
    expect(client.onFeatureFlags).not.toHaveBeenCalled();
    expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledTimes(1);
    expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledWith(
      false,
    );
    const cb = jest.fn();
    exp.onResolved(cb);
    respond({value: 'treatment'});
    respond({value: 'treatment'});
    expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledTimes(1);
    expect(native.setNonBlockingSplashOffKeepGuard).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it('never reads the flag when the build flag is off', () => {
    const {client, respond} = setup(false);
    respond({value: 'treatment'});
    expect(client.getFeatureFlag).not.toHaveBeenCalled();
    expect(client.getStoredFlagDetails).not.toHaveBeenCalled();
  });

  it('still re-applies boot_risk when the build flag is off', () => {
    const {native} = makeNative({file: {bootRisk: true}});
    const {client} = makeClient();
    createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: false,
    }).attach(client);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledWith(
      {boot_risk: 'true'},
      false,
    );
    expect(client.onFeatureFlags).not.toHaveBeenCalled();
  });

  it('onResolved replays the last resolution, fires on new ones, and unsubscribes', () => {
    const {respond, exp} = setup();
    const early = jest.fn();
    exp.onResolved(early);
    expect(early).not.toHaveBeenCalled();
    respond({value: 'control'});
    expect(early).toHaveBeenCalledTimes(1);

    const late = jest.fn();
    const unsubscribe = exp.onResolved(late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenLastCalledWith({
      resolution: {value: 'control', requestFailed: false},
      label: 'control',
      armsNextLaunch: false,
    });

    respond({value: 'treatment'});
    expect(late).toHaveBeenCalledTimes(2);
    expect(late).toHaveBeenLastCalledWith({
      resolution: {value: 'treatment', requestFailed: false},
      label: 'treatment',
      armsNextLaunch: true,
    });

    unsubscribe();
    respond({value: 'control'});
    expect(late).toHaveBeenCalledTimes(2);
    expect(early).toHaveBeenCalledTimes(3);
  });

  it('a throwing listener does not stop the others', () => {
    const {respond, exp} = setup();
    exp.onResolved(() => {
      throw new Error('boom');
    });
    const cb = jest.fn();
    exp.onResolved(cb);
    expect(() => respond({value: 'control'})).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('enrol', () => {
  it('sets the marker, sends the property once with reload default, and returns true only the first time', () => {
    const {native} = makeNative();
    const {client} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    expect(exp.isEnrolled()).toBe(false);

    expect(exp.enrol('splash_stalled')).toBe(true);
    expect(native.setBootRisk).toHaveBeenCalledTimes(1);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledTimes(1);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledWith({
      boot_risk: 'true',
    });
    expect(exp.isEnrolled()).toBe(true);

    expect(exp.enrol('boot_not_completed')).toBe(false);
    expect(native.setBootRisk).toHaveBeenCalledTimes(2);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledTimes(1);
  });

  it('returns false when the marker already existed at start', () => {
    const {native} = makeNative({file: {bootRisk: true}});
    const {client} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    expect(exp.isEnrolled()).toBe(true);
    expect(exp.enrol('splash_stalled')).toBe(false);
    expect(native.setBootRisk).toHaveBeenCalledTimes(1);
    // Only the re-apply at attach (reload=false). The first flag request
    // carries the property, so enrol does not send it again.
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledTimes(1);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledWith(
      {boot_risk: 'true'},
      false,
    );
  });

  it('counts an in-process enrolment even when the marker write is not visible yet', () => {
    const {native} = makeNative();
    native.setBootRisk.mockImplementation(() => undefined);
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    expect(exp.enrol('splash_stalled')).toBe(true);
    expect(exp.isEnrolled()).toBe(true);
    expect(exp.enrol('splash_stalled')).toBe(false);
  });

  it('applies an enrolment made before attach at attach time', () => {
    const {native} = makeNative();
    native.setBootRisk.mockImplementation(() => undefined);
    const {client} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.enrol('boot_not_completed');
    exp.attach(client);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledTimes(1);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledWith(
      {boot_risk: 'true'},
      false,
    );
  });

  it('does nothing when inactive', () => {
    const {native} = makeNative({mode: 'unavailable'});
    const {client} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    expect(exp.enrol('splash_stalled')).toBe(false);
    expect(exp.isEnrolled()).toBe(false);
    expect(native.setBootRisk).not.toHaveBeenCalled();
    expect(client.setPersonPropertiesForFlags).not.toHaveBeenCalled();
  });

  it('never throws when the native marker write throws', () => {
    const {native} = makeNative();
    native.setBootRisk.mockImplementation(() => {
      throw new Error('boom');
    });
    native.getBootRisk.mockImplementation(() => {
      throw new Error('boom');
    });
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    expect(exp.enrol('splash_stalled')).toBe(true);
  });
});

describe('persistence across a restart', () => {
  it('a new instance re-applies boot_risk before any flag response', () => {
    const file = {bootRisk: false};

    const first = makeNative({file});
    const firstClient = makeClient();
    const exp1 = createBootSplashExperiment({
      native: first.native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp1.attach(firstClient.client);
    expect(exp1.enrol('splash_stalled')).toBe(true);
    expect(file.bootRisk).toBe(true);

    // Simulated restart: new native wrapper, new client, same "file".
    const second = makeNative({file});
    const secondClient = makeClient();
    const exp2 = createBootSplashExperiment({
      native: second.native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp2.attach(secondClient.client);
    expect(
      secondClient.client.setPersonPropertiesForFlags,
    ).toHaveBeenCalledWith({boot_risk: 'true'}, false);
    expect(secondClient.client.getFeatureFlag).not.toHaveBeenCalled();
    expect(exp2.isEnrolled()).toBe(true);
    expect(exp2.enrol('splash_stalled')).toBe(false);
  });
});

describe('previousProcess', () => {
  const UNKNOWN = {
    prev_exit_reason: 'unknown',
    prev_process_boot_splash_mode: 'unknown',
    prev_reached_reveal: false,
    prev_process_known: false,
  };

  function setup(
    infoFn: () => Promise<PreviousProcessInfo | null>,
    file = {bootRisk: false},
    anrSideEffect = true,
  ) {
    const {native} = makeNative({info: infoFn, file, anrSideEffect});
    const {client} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    return {native, client, exp};
  }

  it('maps an ANR and enrols the device', async () => {
    const {native, client, exp} = setup(() => Promise.resolve(info(6)));
    const result = await exp.previousProcess();
    expect(result).toEqual({
      props: {
        prev_exit_reason: 'anr',
        prev_process_boot_splash_mode: 'treatment',
        prev_reached_reveal: true,
        prev_process_known: true,
      },
      newlyEnrolledByAnr: true,
    });
    expect(native.setBootRisk).toHaveBeenCalledTimes(1);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledWith({
      boot_risk: 'true',
    });
  });

  it('uses the native newlyEnrolledByAnr and still sends the person property', async () => {
    // The native side set the marker first, so enrol() alone would say false.
    const file = {bootRisk: false};
    const {client, exp} = setup(() => Promise.resolve(info(6)), file);
    const result = await exp.previousProcess();
    expect(file.bootRisk).toBe(true);
    expect(result?.newlyEnrolledByAnr).toBe(true);
    expect(client.setPersonPropertiesForFlags).toHaveBeenCalledWith({
      boot_risk: 'true',
    });
  });

  it('falls back to the enrol result when the native value is false', async () => {
    const {native, exp} = setup(
      () => Promise.resolve(info(6)),
      {bootRisk: false},
      false,
    );
    const result = await exp.previousProcess();
    expect(result?.newlyEnrolledByAnr).toBe(true);
    expect(native.setBootRisk).toHaveBeenCalledTimes(1);
  });

  it('reports newlyEnrolledByAnr false when the device was already enrolled', async () => {
    const {exp} = setup(() => Promise.resolve(info(6)), {bootRisk: true});
    const result = await exp.previousProcess();
    expect(result?.props.prev_exit_reason).toBe('anr');
    expect(result?.newlyEnrolledByAnr).toBe(false);
  });

  it.each([
    [4, 'crash'],
    [10, 'user'],
    [0, 'unknown'],
    [-3, 'unknown'],
  ])('maps code %p to %p and does not enrol', async (code, label) => {
    const {native, exp} = setup(() =>
      Promise.resolve(info(code, {prevMode: null, prevReachedReveal: false})),
    );
    const result = await exp.previousProcess();
    expect(result).toEqual({
      props: {
        prev_exit_reason: label,
        prev_process_boot_splash_mode: 'unknown',
        prev_reached_reveal: false,
        prev_process_known: true,
      },
      newlyEnrolledByAnr: false,
    });
    expect(native.setBootRisk).not.toHaveBeenCalled();
  });

  it('keeps prev_process_known false when there was no previous process', async () => {
    const {exp} = setup(() =>
      Promise.resolve(
        info(-3, {
          hasPrevious: false,
          prevMode: null,
          prevReachedReveal: false,
        }),
      ),
    );
    const result = await exp.previousProcess();
    expect(result?.props).toEqual(UNKNOWN);
  });

  it('returns unknown props for null info', async () => {
    const {exp} = setup(() => Promise.resolve(null));
    expect(await exp.previousProcess()).toEqual({
      props: UNKNOWN,
      newlyEnrolledByAnr: false,
    });
  });

  it('returns unknown props for a rejected promise', async () => {
    const {exp} = setup(() => Promise.reject(new Error('boom')));
    expect(await exp.previousProcess()).toEqual({
      props: UNKNOWN,
      newlyEnrolledByAnr: false,
    });
  });

  it('returns unknown props for a synchronous throw', async () => {
    const {exp} = setup(() => {
      throw new Error('boom');
    });
    expect(await exp.previousProcess()).toEqual({
      props: UNKNOWN,
      newlyEnrolledByAnr: false,
    });
  });

  describe('with fake timers', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('returns unknown props after the timeout', async () => {
      const {native, exp} = setup(() => new Promise(() => undefined));
      const pending = exp.previousProcess(500);
      jest.advanceTimersByTime(499);
      let settled = false;
      pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      jest.advanceTimersByTime(1);
      expect(await pending).toEqual({
        props: UNKNOWN,
        newlyEnrolledByAnr: false,
      });
      expect(native.setBootRisk).not.toHaveBeenCalled();
      // Only the attach flag-response watchdog remains; the read timer is gone.
      expect(jest.getTimerCount()).toBe(1);
    });

    it('uses a 2000 ms default timeout', async () => {
      const {exp} = setup(() => new Promise(() => undefined));
      const pending = exp.previousProcess();
      let settled = false;
      pending.then(() => {
        settled = true;
      });
      jest.advanceTimersByTime(1999);
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      jest.advanceTimersByTime(1);
      expect((await pending)?.props).toEqual(UNKNOWN);
      expect(settled).toBe(true);
    });

    it('clears the timer when the info arrives first', async () => {
      const {exp} = setup(() => Promise.resolve(info(4)));
      const result = await exp.previousProcess(5000);
      expect(result?.props.prev_exit_reason).toBe('crash');
      // Only the attach flag-response watchdog remains; the read timer is gone.
      expect(jest.getTimerCount()).toBe(1);
    });
  });

  it('returns null when inactive', async () => {
    const {native} = makeNative({
      mode: 'unavailable',
      info: () => Promise.resolve(info(6)),
    });
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    expect(await exp.previousProcess()).toBeNull();
    expect(native.getPreviousProcessInfo).not.toHaveBeenCalled();
    expect(native.setBootRisk).not.toHaveBeenCalled();
  });
});

// @ai Review M2 (Task 3): offline, the SDK sends no /flags request, so no
// response arrives. attach then requests the flags once more after 8 s.
describe('flag-response watchdog', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('reloads once when no response arrives, and a failed reload writes a transient OFF', () => {
    const {native} = makeNative();
    const {client, respond} = makeClient({value: 'treatment'});
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    jest.advanceTimersByTime(FLAG_RESPONSE_WATCHDOG_MS - 1);
    expect(client.reloadFeatureFlags).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(client.reloadFeatureFlags).toHaveBeenCalledTimes(1);
    // The reload fails (offline): the SDK stores requestError and emits.
    respond({
      value: 'treatment',
      details: {requestError: {type: 'connection_error'}},
    });
    expect(native.setNonBlockingSplashOffKeepGuard).toHaveBeenCalledTimes(1);
    expect(native.setNonBlockingSplashForNextLaunch).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(client.reloadFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it('a good treatment response after the watchdog reload still arms', () => {
    const {native} = makeNative();
    const {client, respond} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    jest.advanceTimersByTime(FLAG_RESPONSE_WATCHDOG_MS);
    expect(client.reloadFeatureFlags).toHaveBeenCalledTimes(1);
    respond({value: 'treatment'});
    expect(native.setNonBlockingSplashForNextLaunch).toHaveBeenCalledWith(true);
    expect(native.setNonBlockingSplashOffKeepGuard).not.toHaveBeenCalled();
  });

  it('writes nothing when a response stores no flags object', () => {
    const {native} = makeNative();
    const {client, respond} = makeClient();
    createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    }).attach(client);
    respond({value: 'treatment', flags: undefined});
    expect(native.setNonBlockingSplashForNextLaunch).not.toHaveBeenCalled();
  });

  it('does not reload when a response arrives in time', () => {
    const {native} = makeNative();
    const {client, respond} = makeClient();
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    respond({value: 'control'});
    jest.advanceTimersByTime(60_000);
    expect(client.reloadFeatureFlags).not.toHaveBeenCalled();
  });

  it('with a client that never resolves, reloads once and writes nothing', () => {
    const {native} = makeNative();
    const {client} = makeClient({value: 'treatment'});
    const exp = createBootSplashExperiment({
      native,
      isAndroid: true,
      buildFlagEnabled: true,
    });
    exp.attach(client);
    jest.advanceTimersByTime(10 * FLAG_RESPONSE_WATCHDOG_MS);
    expect(client.reloadFeatureFlags).toHaveBeenCalledTimes(1);
    expect(native.setNonBlockingSplashForNextLaunch).not.toHaveBeenCalled();
    expect(native.setNonBlockingSplashOffKeepGuard).not.toHaveBeenCalled();
  });

  it('starts no watchdog when the build flag is off or on iOS', () => {
    for (const cfg of [
      {isAndroid: true, buildFlagEnabled: false, mode: 'control'},
      {isAndroid: false, buildFlagEnabled: true, mode: 'unavailable'},
    ]) {
      const {native} = makeNative({mode: cfg.mode});
      const {client} = makeClient();
      createBootSplashExperiment({
        native,
        isAndroid: cfg.isAndroid,
        buildFlagEnabled: cfg.buildFlagEnabled,
      }).attach(client);
      jest.advanceTimersByTime(60_000);
      expect(client.reloadFeatureFlags).not.toHaveBeenCalled();
    }
  });
});
