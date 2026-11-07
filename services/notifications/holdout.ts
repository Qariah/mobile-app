// @ai-generated
// Qariah (Sprint 48, S48.6 and S48.7): the notifications holdout arm.
//
// 15% of users are in the holdout (PostHog flag `local_notifications_holdout`).
// A holdout user gets no notification, no permission card and no
// Notifications page (sprint plan S48.6).
//
// `holdoutEnrollment.ts` decides the arm once (the analytics consent and the
// flag) and writes it to MMKV (id `qariah-notifications`, key `holdout_arm`,
// value `'holdout'` or `'notify'`). This module only reads that value.
//
// An unknown arm (nothing written yet, or a value that MMKV cannot read)
// counts as the holdout: a holdout user must never see the page or get a
// notice. The one exception is a DEV build (`__DEV__`): there an unknown arm
// counts as `'notify'`, so that a debug build can show and test the page
// before the flags load. A written arm always wins, also in DEV, so a DEV
// build can still test the holdout (write `'holdout'`).
import {notificationsStorage} from './catalogDiff';
import type {KeyValueStorage} from './types';

export const NOTIFICATIONS_HOLDOUT_ARM_KEY = 'holdout_arm';

export type NotificationsHoldoutArm = 'holdout' | 'notify';

/** The written arm, or `null` when there is none (or it cannot be read). */
export function readNotificationsHoldoutArm(
  storage: KeyValueStorage = notificationsStorage,
): NotificationsHoldoutArm | null {
  try {
    const value = storage.getString(NOTIFICATIONS_HOLDOUT_ARM_KEY);
    return value === 'holdout' || value === 'notify' ? value : null;
  } catch {
    return null;
  }
}

/**
 * `true` when the user is in the holdout, or when the arm is unknown in a
 * release build (the safe default). See the note at the top of this file.
 */
export function isNotificationsHoldout(
  storage: KeyValueStorage = notificationsStorage,
  isDev: boolean = __DEV__,
): boolean {
  const arm = readNotificationsHoldoutArm(storage);
  if (arm === null) return !isDev;
  return arm === 'holdout';
}
