// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the holdout arm is decided once (the
// analytics consent, then the PostHog flag), written to MMKV, and never rolled
// again.
jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
import {
  HOLDOUT_UNKNOWN_TIMEOUT_MS,
  NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY,
  NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY,
  NOTIFICATIONS_HOLDOUT_FLAG,
  NOTIF_HOLDOUT_SUPER_PROPERTY,
  decideHoldoutAssignment,
  notifHoldoutValue,
  readHoldoutAssignment,
  startHoldoutEnrollment,
  writeHoldoutAssignment,
  type ConsentSource,
  type ConsentState,
  type HoldoutFlagClient,
} from '../holdoutEnrollment';
import {
  NOTIFICATIONS_HOLDOUT_ARM_KEY,
  isNotificationsHoldout,
} from '../holdout';
import type {KeyValueStorage} from '../types';

function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & {
  values: Record<string, string>;
} {
  const values = {...initial};
  return {
    values,
    getString: key => values[key],
    set: (key, value) => {
      values[key] = value;
    },
    remove: key => {
      delete values[key];
    },
  };
}

function fakeConsent(initial: ConsentState): ConsentSource & {
  set(state: ConsentState): void;
  listeners: Set<() => void>;
} {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    listeners,
    read: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: next => {
      state = next;
      listeners.forEach(listener => listener());
    },
  };
}

function fakeClient(flag?: unknown): HoldoutFlagClient & {
  setFlag(value: unknown): void;
  getFeatureFlag: jest.Mock;
  register: jest.Mock;
  listeners: Set<(flags: unknown) => void>;
} {
  let value = flag;
  const listeners = new Set<(flags: unknown) => void>();
  return {
    listeners,
    getFeatureFlag: jest.fn(() => value),
    onFeatureFlags: callback => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    register: jest.fn(async () => undefined),
    setFlag: next => {
      value = next;
      listeners.forEach(listener => listener({}));
    },
  };
}

describe('decideHoldoutAssignment', () => {
  it('waits while the consent is not read', () => {
    expect(
      decideHoldoutAssignment({
        consent: 'unknown',
        analyticsAvailable: true,
        flagValue: 'holdout',
      }),
    ).toBeNull();
  });

  it('consent OFF: notify, not in the experiment (whatever the flag says)', () => {
    for (const flagValue of [undefined, 'holdout', 'notify']) {
      expect(
        decideHoldoutAssignment({
          consent: 'denied',
          analyticsAvailable: true,
          flagValue,
        }),
      ).toEqual({arm: 'notify', enrollment: 'unenrolled'});
    }
  });

  it('a build without analytics counts as consent OFF', () => {
    expect(
      decideHoldoutAssignment({
        consent: 'granted',
        analyticsAvailable: false,
        flagValue: undefined,
      }),
    ).toEqual({arm: 'notify', enrollment: 'unenrolled'});
  });

  it('consent ON: the flag variant gives the arm', () => {
    expect(
      decideHoldoutAssignment({
        consent: 'granted',
        analyticsAvailable: true,
        flagValue: 'holdout',
      }),
    ).toEqual({arm: 'holdout', enrollment: 'flag'});
    expect(
      decideHoldoutAssignment({
        consent: 'granted',
        analyticsAvailable: true,
        flagValue: 'notify',
      }),
    ).toEqual({arm: 'notify', enrollment: 'flag'});
  });

  it('consent ON: no flag yet, or any other value, leaves the arm unknown', () => {
    for (const flagValue of [undefined, false, true, 'control', null]) {
      expect(
        decideHoldoutAssignment({
          consent: 'granted',
          analyticsAvailable: true,
          flagValue,
        }),
      ).toBeNull();
    }
  });
});

describe('the stored arm and the super property', () => {
  it('maps each arm to the notif_holdout value', () => {
    expect(notifHoldoutValue({arm: 'holdout', enrollment: 'flag'})).toBe(
      'holdout',
    );
    expect(notifHoldoutValue({arm: 'notify', enrollment: 'flag'})).toBe(
      'notify',
    );
    expect(notifHoldoutValue({arm: 'notify', enrollment: 'unenrolled'})).toBe(
      'unenrolled',
    );
  });

  it('writes the enrollment and the arm, and reads them back', () => {
    const storage = memoryStorage();
    expect(
      writeHoldoutAssignment(
        {arm: 'notify', enrollment: 'unenrolled'},
        storage,
      ),
    ).toBe(true);
    expect(storage.values).toEqual({
      [NOTIFICATIONS_HOLDOUT_ARM_KEY]: 'notify',
      [NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY]: 'unenrolled',
    });
    expect(readHoldoutAssignment(storage)).toEqual({
      arm: 'notify',
      enrollment: 'unenrolled',
    });
    // The arm of holdout.ts follows the written value, also in a release.
    expect(isNotificationsHoldout(storage, false)).toBe(false);
  });

  it('a write that does not read back fails', () => {
    const storage: KeyValueStorage = {
      getString: () => undefined,
      set: jest.fn(),
      remove: jest.fn(),
    };
    expect(
      writeHoldoutAssignment({arm: 'holdout', enrollment: 'flag'}, storage),
    ).toBe(false);
    const unavailable = {...memoryStorage(), isAvailable: () => false};
    expect(
      writeHoldoutAssignment({arm: 'holdout', enrollment: 'flag'}, unavailable),
    ).toBe(false);
  });

  it('a notify arm without a readable enrollment counts as the flag arm', () => {
    expect(
      readHoldoutAssignment(
        memoryStorage({[NOTIFICATIONS_HOLDOUT_ARM_KEY]: 'notify'}),
      ),
    ).toEqual({arm: 'notify', enrollment: 'flag'});
  });
});

describe('startHoldoutEnrollment', () => {
  it('a written arm: sets the super property, reports it as not new, reads no flag', () => {
    const storage = memoryStorage({
      [NOTIFICATIONS_HOLDOUT_ARM_KEY]: 'holdout',
      [NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY]: 'flag',
    });
    const client = fakeClient('notify');
    const consent = fakeConsent('granted');
    const onAssigned = jest.fn();
    startHoldoutEnrollment({
      client,
      analyticsAvailable: true,
      consent,
      storage,
      onAssigned,
    });
    expect(client.register).toHaveBeenCalledWith({
      [NOTIF_HOLDOUT_SUPER_PROPERTY]: 'holdout',
    });
    expect(onAssigned).toHaveBeenCalledWith(
      {arm: 'holdout', enrollment: 'flag'},
      false,
    );
    expect(client.getFeatureFlag).not.toHaveBeenCalled();
    expect(consent.listeners.size).toBe(0);
    expect(client.listeners.size).toBe(0);
  });

  it('consent ON: waits for the flag, then writes its variant once', () => {
    const storage = memoryStorage();
    const client = fakeClient(undefined);
    const consent = fakeConsent('granted');
    const onAssigned = jest.fn();
    startHoldoutEnrollment({
      client,
      analyticsAvailable: true,
      consent,
      storage,
      onAssigned,
    });
    expect(onAssigned).not.toHaveBeenCalled();
    expect(storage.values[NOTIFICATIONS_HOLDOUT_ARM_KEY]).toBeUndefined();
    // Unknown: the holdout, in a release build.
    expect(isNotificationsHoldout(storage, false)).toBe(true);

    client.setFlag('holdout');
    expect(client.getFeatureFlag).toHaveBeenCalledWith(
      NOTIFICATIONS_HOLDOUT_FLAG,
    );
    expect(storage.values).toMatchObject({
      [NOTIFICATIONS_HOLDOUT_ARM_KEY]: 'holdout',
      [NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY]: 'flag',
    });
    expect(client.register).toHaveBeenCalledWith({notif_holdout: 'holdout'});
    expect(onAssigned).toHaveBeenCalledTimes(1);
    expect(onAssigned).toHaveBeenCalledWith(
      {arm: 'holdout', enrollment: 'flag'},
      true,
    );
    // Stopped: no more listening.
    expect(consent.listeners.size).toBe(0);
    expect(client.listeners.size).toBe(0);
  });

  it('never rolls again: a later consent change or flag change does nothing', () => {
    const storage = memoryStorage();
    const client = fakeClient('notify');
    const consent = fakeConsent('granted');
    const onAssigned = jest.fn();
    startHoldoutEnrollment({
      client,
      analyticsAvailable: true,
      consent,
      storage,
      onAssigned,
    });
    expect(storage.values[NOTIFICATIONS_HOLDOUT_ARM_KEY]).toBe('notify');
    consent.set('denied');
    client.setFlag('holdout');
    expect(onAssigned).toHaveBeenCalledTimes(1);
    expect(storage.values[NOTIFICATIONS_HOLDOUT_ARM_KEY]).toBe('notify');

    // The next start reads the written arm, whatever the consent is now.
    const later = jest.fn();
    startHoldoutEnrollment({
      client: fakeClient('holdout'),
      analyticsAvailable: true,
      consent: fakeConsent('denied'),
      storage,
      onAssigned: later,
    });
    expect(later).toHaveBeenCalledWith(
      {arm: 'notify', enrollment: 'flag'},
      false,
    );
  });

  it('consent OFF: notify, unenrolled, and the flag is never read', () => {
    const storage = memoryStorage();
    const client = fakeClient('holdout');
    const consent = fakeConsent('unknown');
    const onAssigned = jest.fn();
    startHoldoutEnrollment({
      client,
      analyticsAvailable: true,
      consent,
      storage,
      onAssigned,
    });
    expect(onAssigned).not.toHaveBeenCalled();
    consent.set('denied');
    expect(client.getFeatureFlag).not.toHaveBeenCalled();
    expect(onAssigned).toHaveBeenCalledWith(
      {arm: 'notify', enrollment: 'unenrolled'},
      true,
    );
    expect(client.register).toHaveBeenCalledWith({notif_holdout: 'unenrolled'});
  });

  it('a build without analytics: notify, unenrolled, no flag read', () => {
    const storage = memoryStorage();
    const client = fakeClient('holdout');
    const onAssigned = jest.fn();
    startHoldoutEnrollment({
      client,
      analyticsAvailable: false,
      consent: fakeConsent('granted'),
      storage,
      onAssigned,
    });
    expect(client.getFeatureFlag).not.toHaveBeenCalled();
    expect(onAssigned).toHaveBeenCalledWith(
      {arm: 'notify', enrollment: 'unenrolled'},
      true,
    );
  });

  it('a failed write keeps the arm unknown and tries again at the next event', () => {
    let writable = false;
    const backing = memoryStorage();
    const storage: KeyValueStorage = {
      getString: key => backing.getString(key),
      set: (key, value) => {
        if (writable) backing.set(key, value);
      },
      remove: key => backing.remove(key),
    };
    const client = fakeClient('notify');
    const onAssigned = jest.fn();
    startHoldoutEnrollment({
      client,
      analyticsAvailable: true,
      consent: fakeConsent('granted'),
      storage,
      onAssigned,
    });
    expect(onAssigned).not.toHaveBeenCalled();
    expect(client.register).not.toHaveBeenCalled();
    writable = true;
    client.setFlag('notify');
    expect(onAssigned).toHaveBeenCalledWith(
      {arm: 'notify', enrollment: 'flag'},
      true,
    );
  });

  it('the stop function ends the listening', () => {
    const client = fakeClient(undefined);
    const consent = fakeConsent('granted');
    const stop = startHoldoutEnrollment({
      client,
      analyticsAvailable: true,
      consent,
      storage: memoryStorage(),
    });
    expect(client.listeners.size).toBe(1);
    stop();
    expect(client.listeners.size).toBe(0);
    expect(consent.listeners.size).toBe(0);
  });

  it('does not throw when the client throws', () => {
    const client = fakeClient('notify');
    client.register.mockImplementation(() => {
      throw new Error('register');
    });
    client.getFeatureFlag.mockImplementation(() => {
      throw new Error('flags');
    });
    expect(() =>
      startHoldoutEnrollment({
        client,
        analyticsAvailable: true,
        consent: fakeConsent('granted'),
        storage: memoryStorage(),
      }),
    ).not.toThrow();
  });
});

describe('the 7-day timeout (review of Task 16, M1)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = Date.UTC(2026, 9, 20, 9);

  it('decides notify, unenrolled_timeout, only after 7 days with no variant', () => {
    const base = {
      consent: 'granted' as const,
      analyticsAvailable: true,
      flagValue: undefined,
      firstAttemptAt: T0,
    };
    expect(HOLDOUT_UNKNOWN_TIMEOUT_MS).toBe(7 * DAY);
    expect(
      decideHoldoutAssignment({...base, now: T0 + 7 * DAY - 1}),
    ).toBeNull();
    expect(decideHoldoutAssignment({...base, now: T0 + 7 * DAY})).toEqual({
      arm: 'notify',
      enrollment: 'unenrolled_timeout',
    });
    // A consent that is never read times out too.
    expect(
      decideHoldoutAssignment({...base, consent: 'unknown', now: T0 + 8 * DAY}),
    ).toEqual({arm: 'notify', enrollment: 'unenrolled_timeout'});
    // A variant that comes on time still decides.
    expect(
      decideHoldoutAssignment({
        ...base,
        flagValue: 'holdout',
        now: T0 + 8 * DAY,
      }),
    ).toEqual({arm: 'holdout', enrollment: 'flag'});
  });

  it('maps the timeout arm to the unenrolled super property, and reads it back', () => {
    expect(
      notifHoldoutValue({arm: 'notify', enrollment: 'unenrolled_timeout'}),
    ).toBe('unenrolled');
    const storage = memoryStorage();
    writeHoldoutAssignment(
      {arm: 'notify', enrollment: 'unenrolled_timeout'},
      storage,
    );
    expect(readHoldoutAssignment(storage)).toEqual({
      arm: 'notify',
      enrollment: 'unenrolled_timeout',
    });
  });

  it('keeps the first attempt across starts, and writes the timeout arm at a start 7 days later', () => {
    const storage = memoryStorage();
    let now = T0;
    const first = jest.fn();
    // Start 1: the flag never loads (an ad blocker on the PostHog host).
    const stop = startHoldoutEnrollment({
      client: fakeClient(undefined),
      analyticsAvailable: true,
      consent: fakeConsent('granted'),
      storage,
      now: () => now,
      onAssigned: first,
    });
    stop();
    expect(first).not.toHaveBeenCalled();
    expect(storage.values[NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY]).toBe(
      String(T0),
    );

    // Start 2, 6 days later: still unknown, the first attempt does not move.
    now = T0 + 6 * DAY;
    startHoldoutEnrollment({
      client: fakeClient(undefined),
      analyticsAvailable: true,
      consent: fakeConsent('granted'),
      storage,
      now: () => now,
      onAssigned: first,
    })();
    expect(first).not.toHaveBeenCalled();
    expect(storage.values[NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY]).toBe(
      String(T0),
    );

    // Start 3, 7 days later: notify, unenrolled_timeout.
    now = T0 + 7 * DAY;
    const client = fakeClient(undefined);
    const onAssigned = jest.fn();
    startHoldoutEnrollment({
      client,
      analyticsAvailable: true,
      consent: fakeConsent('granted'),
      storage,
      now: () => now,
      onAssigned,
    });
    expect(onAssigned).toHaveBeenCalledWith(
      {arm: 'notify', enrollment: 'unenrolled_timeout'},
      true,
    );
    expect(client.register).toHaveBeenCalledWith({notif_holdout: 'unenrolled'});
    expect(storage.values).toMatchObject({
      [NOTIFICATIONS_HOLDOUT_ARM_KEY]: 'notify',
      [NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY]: 'unenrolled_timeout',
    });
    expect(
      storage.values[NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY],
    ).toBeUndefined();
    expect(isNotificationsHoldout(storage, false)).toBe(false);
  });

  it('moves a first attempt that is in the future (a clock change) to now', () => {
    const storage = memoryStorage({
      [NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY]: String(T0 + 30 * DAY),
    });
    startHoldoutEnrollment({
      client: fakeClient(undefined),
      analyticsAvailable: true,
      consent: fakeConsent('granted'),
      storage,
      now: () => T0,
    })();
    expect(storage.values[NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY]).toBe(
      String(T0),
    );
  });
});
