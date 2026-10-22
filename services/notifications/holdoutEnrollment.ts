// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the notifications holdout arm is
// decided once, then kept.
//
// The rule (controller decision 2026-10-20, `planning/sprint-48-tasks.md`,
// Task 17 notes):
// - Analytics consent OFF: the arm is `notify` and the user is NOT in the
//   experiment (enrollment `unenrolled`). The user gets notifications, and
//   nothing measures them.
// - Consent ON: the PostHog flag `local_notifications_holdout` (id 976784;
//   variants `holdout` 15%, `notify` 85%) gives the arm, once the flags load.
// - A build without analytics (no PostHog key, or
//   `EXPO_PUBLIC_ANALYTICS_ENABLED=false`) counts as consent OFF: no flag can
//   load and nothing can measure the arm. (Production builds always have a
//   key; the agent test builds do not.)
// - Until the arm is known, the user counts as the holdout
//   (`isNotificationsHoldout()`): no notice, no permission card, no
//   Notifications page.
// - The arm is still unknown 7 days (`HOLDOUT_UNKNOWN_TIMEOUT_MS`) after the
//   first attempt (a DNS ad blocker on the PostHog host, the flag off, a flag
//   quota): `notify`, enrollment `unenrolled_timeout`, super property
//   `unenrolled` (controller decision 2026-10-20, review of Task 16). The time
//   of the first attempt is in MMKV (`holdout_first_attempt_at`).
//
// Only the two variant values decide. Any other flag value (`false`, a
// missing flag, no response yet) leaves the arm unknown, so the next flag
// response can decide, until the 7-day timeout. To end the experiment, roll
// `notify` out to 100%; with the flag off, a new user waits 7 days in the
// holdout.
//
// The arm is written once (MMKV id `qariah-notifications`, keys `holdout_arm`
// and `holdout_enrollment`) and never changes after: a later consent change
// does not roll it again. The super property `notif_holdout` (`holdout`,
// `notify` or `unenrolled`) marks each later event with it.
import {useAnalyticsConsentStore} from '@/store/analyticsConsentStore';
import {notificationsStorage} from './catalogDiff';
import {
  NOTIFICATIONS_HOLDOUT_ARM_KEY,
  readNotificationsHoldoutArm,
  type NotificationsHoldoutArm,
} from './holdout';
import type {KeyValueStorage} from './types';

export const NOTIFICATIONS_HOLDOUT_FLAG = 'local_notifications_holdout';
/** MMKV (`qariah-notifications`): `'flag'`, `'unenrolled'` or `'unenrolled_timeout'`. */
export const NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY = 'holdout_enrollment';
/** MMKV: the time (epoch milliseconds) of the first attempt to decide the arm. */
export const NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY =
  'holdout_first_attempt_at';
/** With no variant this long after the first attempt, the arm is `notify`. */
export const HOLDOUT_UNKNOWN_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTIF_HOLDOUT_SUPER_PROPERTY = 'notif_holdout';

/**
 * `flag`: the PostHog flag gave the arm. `unenrolled`: not in the experiment
 * (consent off, or no analytics). `unenrolled_timeout`: no variant came in 7
 * days.
 */
export type HoldoutEnrollment = 'flag' | 'unenrolled' | 'unenrolled_timeout';

/** The value of the `notif_holdout` super property. */
export type NotifHoldoutValue = 'holdout' | 'notify' | 'unenrolled';

export interface HoldoutAssignment {
  arm: NotificationsHoldoutArm;
  enrollment: HoldoutEnrollment;
}

/** The analytics consent: `unknown` until the stored choice is read. */
export type ConsentState = 'unknown' | 'granted' | 'denied';

export interface HoldoutDecisionInput {
  consent: ConsentState;
  /** The build has PostHog (an API key, no env kill switch) and a client. */
  analyticsAvailable: boolean;
  /** `getFeatureFlag(NOTIFICATIONS_HOLDOUT_FLAG)`; read only with consent ON. */
  flagValue: unknown;
  /** The time of the first attempt (epoch ms), or `null` when it is not known. */
  firstAttemptAt?: number | null;
  /** Now (epoch ms). */
  now?: number;
}

/** The arm for these facts, or `null` while it is not known yet (see the file header). */
export function decideHoldoutAssignment(
  input: HoldoutDecisionInput,
): HoldoutAssignment | null {
  if (input.consent === 'denied') {
    return {arm: 'notify', enrollment: 'unenrolled'};
  }
  if (input.consent === 'granted') {
    if (!input.analyticsAvailable) {
      return {arm: 'notify', enrollment: 'unenrolled'};
    }
    if (input.flagValue === 'holdout') {
      return {arm: 'holdout', enrollment: 'flag'};
    }
    if (input.flagValue === 'notify') {
      return {arm: 'notify', enrollment: 'flag'};
    }
  }
  // No variant yet (or the consent is not read): the 7-day timeout.
  if (
    typeof input.firstAttemptAt === 'number' &&
    typeof input.now === 'number' &&
    input.now - input.firstAttemptAt >= HOLDOUT_UNKNOWN_TIMEOUT_MS
  ) {
    return {arm: 'notify', enrollment: 'unenrolled_timeout'};
  }
  return null;
}

/** The value of `notif_holdout` for an arm. */
export function notifHoldoutValue(
  assignment: HoldoutAssignment,
): NotifHoldoutValue {
  if (assignment.arm === 'holdout') return 'holdout';
  return assignment.enrollment === 'flag' ? 'notify' : 'unenrolled';
}

/** The written arm, or `null` when there is none (or MMKV cannot read it). */
export function readHoldoutAssignment(
  storage: KeyValueStorage = notificationsStorage,
): HoldoutAssignment | null {
  const arm = readNotificationsHoldoutArm(storage);
  if (!arm) return null;
  let enrollment: string | undefined;
  try {
    enrollment = storage.getString(NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY);
  } catch {
    enrollment = undefined;
  }
  // The holdout comes only from the flag. A `notify` arm without a readable
  // enrollment (a DEV build that wrote the arm by hand) counts as the flag's.
  return {
    arm,
    enrollment:
      arm === 'notify' &&
      (enrollment === 'unenrolled' || enrollment === 'unenrolled_timeout')
        ? enrollment
        : 'flag',
  };
}

/**
 * The time of the first attempt to decide the arm. The first call writes now.
 * A stored time after now (a clock change) is moved to now. `null` when MMKV
 * cannot keep it: then no timeout applies.
 */
export function readOrInitFirstAttempt(
  storage: KeyValueStorage,
  now: number,
): number | null {
  try {
    const stored = Number(
      storage.getString(NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY),
    );
    if (Number.isFinite(stored) && stored > 0 && stored <= now) return stored;
    storage.set(NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY, String(now));
    return storage.getString(NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY) ===
      String(now)
      ? now
      : null;
  } catch {
    return null;
  }
}

/**
 * Writes the arm. The enrollment goes first and the arm last: the arm is the
 * value that the rest of the app reads. `true` only when a read-back gives
 * the written arm.
 */
export function writeHoldoutAssignment(
  assignment: HoldoutAssignment,
  storage: KeyValueStorage = notificationsStorage,
): boolean {
  try {
    if (storage.isAvailable && !storage.isAvailable()) return false;
    storage.set(NOTIFICATIONS_HOLDOUT_ENROLLMENT_KEY, assignment.enrollment);
    storage.set(NOTIFICATIONS_HOLDOUT_ARM_KEY, assignment.arm);
    return storage.getString(NOTIFICATIONS_HOLDOUT_ARM_KEY) === assignment.arm;
  } catch {
    return false;
  }
}

/** The part of the PostHog client that the enrollment uses. */
export interface HoldoutFlagClient {
  getFeatureFlag(key: string): unknown;
  /** Calls `callback` after each flag response; returns the unsubscribe. */
  onFeatureFlags(callback: (flags: unknown) => void): () => void;
  register(properties: Record<string, string>): unknown;
}

/** The analytics consent, injected (the tests use a fake). */
export interface ConsentSource {
  read(): ConsentState;
  /** Calls `listener` when the consent or its read state can have changed. */
  subscribe(listener: () => void): () => void;
}

/** The app's consent: the persisted store of Settings → Privacy. */
export const analyticsConsentSource: ConsentSource = {
  read: () => {
    const persist = useAnalyticsConsentStore.persist;
    if (!persist.hasHydrated()) return 'unknown';
    return useAnalyticsConsentStore.getState().analyticsEnabled
      ? 'granted'
      : 'denied';
  },
  subscribe: listener => {
    const unsubscribeState = useAnalyticsConsentStore.subscribe(() =>
      listener(),
    );
    const unsubscribeHydration =
      useAnalyticsConsentStore.persist.onFinishHydration(() => listener());
    return () => {
      unsubscribeState();
      unsubscribeHydration();
    };
  },
};

/**
 * `true` when this build sends analytics at all: a PostHog API key and no
 * env kill switch (the same two checks as `qariahPostHogClient.ts` and
 * `AnalyticsService.ts`).
 */
export function isAnalyticsAvailableInBuild(): boolean {
  return (
    !!process.env.EXPO_PUBLIC_POSTHOG_API_KEY &&
    process.env.EXPO_PUBLIC_ANALYTICS_ENABLED !== 'false'
  );
}

export interface HoldoutEnrollmentDeps {
  /** The PostHog client, or `null` when there is none. */
  client: HoldoutFlagClient | null;
  /** Default: `isAnalyticsAvailableInBuild()`. */
  analyticsAvailable?: boolean;
  /** Default: `analyticsConsentSource`. */
  consent?: ConsentSource;
  /** Default: `notificationsStorage`. */
  storage?: KeyValueStorage;
  /** Default: `Date.now`. */
  now?: () => number;
  /**
   * Called once when the arm is known: at once for a written arm
   * (`isNew: false`), or when this start writes it (`isNew: true`).
   */
  onAssigned?: (assignment: HoldoutAssignment, isNew: boolean) => void;
}

/**
 * Starts the enrollment (see the file header). A written arm only sets the
 * super property. Else it decides at once and after each consent change and
 * flag response, until the arm is written. Returns the stop function. Never
 * throws.
 */
export function startHoldoutEnrollment(
  deps: HoldoutEnrollmentDeps,
): () => void {
  const storage = deps.storage ?? notificationsStorage;
  const consent = deps.consent ?? analyticsConsentSource;
  const analyticsAvailable =
    (deps.analyticsAvailable ?? isAnalyticsAvailableInBuild()) &&
    deps.client !== null;

  const setSuperProperty = (assignment: HoldoutAssignment): void => {
    try {
      const result = deps.client?.register({
        [NOTIF_HOLDOUT_SUPER_PROPERTY]: notifHoldoutValue(assignment),
      });
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      // A super property must not break the enrollment.
    }
  };
  const announce = (assignment: HoldoutAssignment, isNew: boolean): void => {
    setSuperProperty(assignment);
    try {
      deps.onAssigned?.(assignment, isNew);
    } catch {
      // The caller's work must not break the enrollment.
    }
  };

  const stored = readHoldoutAssignment(storage);
  if (stored) {
    announce(stored, false);
    return () => undefined;
  }

  let done = false;
  const unsubscribers: (() => void)[] = [];
  const stop = (): void => {
    done = true;
    unsubscribers.splice(0).forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch {
        // Best effort.
      }
    });
  };

  const now = deps.now ?? Date.now;

  const evaluate = (): void => {
    if (done) return;
    try {
      const nowMs = now();
      const firstAttemptAt = readOrInitFirstAttempt(storage, nowMs);
      const consentState = consent.read();
      let flagValue: unknown;
      // Read the flag only with consent: a read sends the exposure event.
      if (consentState === 'granted' && analyticsAvailable && deps.client) {
        try {
          flagValue = deps.client.getFeatureFlag(NOTIFICATIONS_HOLDOUT_FLAG);
        } catch {
          flagValue = undefined;
        }
      }
      const decision = decideHoldoutAssignment({
        consent: consentState,
        analyticsAvailable,
        flagValue,
        firstAttemptAt,
        now: nowMs,
      });
      if (!decision) return;
      // Another root of this process can have written it meanwhile.
      const existing = readHoldoutAssignment(storage);
      if (existing) {
        stop();
        announce(existing, false);
        return;
      }
      // Not stored: the arm stays unknown (the holdout); try again on the
      // next event.
      if (!writeHoldoutAssignment(decision, storage)) return;
      try {
        storage.remove(NOTIFICATIONS_HOLDOUT_FIRST_ATTEMPT_KEY);
      } catch {
        // Best effort: the arm is written; the time is not read again.
      }
      stop();
      announce(decision, true);
    } catch {
      // Try again on the next event.
    }
  };

  try {
    unsubscribers.push(consent.subscribe(evaluate));
    if (deps.client && analyticsAvailable) {
      unsubscribers.push(deps.client.onFeatureFlags(() => evaluate()));
    }
  } catch {
    // Without the subscriptions, the evaluation below is the only one.
  }
  evaluate();
  return stop;
}
