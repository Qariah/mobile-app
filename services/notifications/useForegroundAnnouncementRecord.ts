// @ai-generated
// Qariah (Sprint 48, S48.8): the foreground record of the announcement id,
// once for each process.
//
// `components/QariahRootEffects.tsx` calls `useForegroundAnnouncementRecord()`.
// Why there, and not in `qariahBootCompleted()` (`services/qariahBoot.ts`):
// - `bootApp()` also runs when the app starts without a user: a background
//   launch, or another root that boots first. A record there would store the
//   id before the background task can post, so the notice would never post.
// - The root effects mount in the same commit as the What's New onboarding,
//   so the last seen version is read before the user can close it (see
//   `readIsFreshInstall`).
//
// The read starts at the mount. The record waits for the first `active` app
// state, because an iOS background launch can mount the React tree too.
//
// After the record, the `whats_new` notice of this build's id leaves the
// notification list (a shown one) and the schedule (a pending one): the user
// opened the app. The removal waits `ANNOUNCEMENT_CLEAR_DELAY_MS`, so
// `expo-notifications` stays off the cold start.
import {useEffect} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import {QARIAH_ANNOUNCEMENT_ID} from '@/config/qariahAnnouncement';
import {isNotificationsHoldout} from './holdout';
import {
  clearAnnouncementNotice,
  readIsFreshInstall,
  recordForegroundAnnouncement,
  type ForegroundAnnouncementResult,
} from './announcementStore';

/** The removal of the notice waits this long (the boot step's delay). */
export const ANNOUNCEMENT_CLEAR_DELAY_MS = 5_000;

/**
 * The removal of the app (after the delay, with the expo `Notifier`). Not for
 * the holdout: it never gets the notice, and must not load
 * `expo-notifications` (review of Task 16, L1).
 */
function clearNoticeLater(announcementId: string): void {
  setTimeout(() => {
    try {
      if (isNotificationsHoldout()) return;
      const {createExpoNotifier} =
        require('./expoNotifier') as typeof import('./expoNotifier');
      void clearAnnouncementNotice(announcementId, createExpoNotifier());
    } catch (error) {
      if (__DEV__) {
        console.warn('[notifications] announcement clear failed:', error);
      }
    }
  }, ANNOUNCEMENT_CLEAR_DELAY_MS);
}

/** The part of `AppState` that this module uses, so a test can pass a fake. */
export interface AppStateSource {
  currentState: AppStateStatus | null | undefined;
  addEventListener(
    type: 'change',
    listener: (state: AppStateStatus) => void,
  ): {remove(): void};
}

export interface ForegroundAnnouncementDeps {
  appState?: AppStateSource;
  readFreshInstall?: () => Promise<boolean>;
  record?: (isFreshInstall: boolean) => ForegroundAnnouncementResult;
  onResult?: (result: ForegroundAnnouncementResult) => void;
  /**
   * Removes the notice of the id. Default: the app's removal, but only with
   * the default `record` (a test that injects a record injects this too).
   */
  clearNotice?: (announcementId: string) => void;
  /** Default: `QARIAH_ANNOUNCEMENT_ID`. */
  currentId?: string | null;
}

let started = false;

/**
 * Starts the foreground record. The first call in a process does the work;
 * each later call does nothing. Never throws.
 */
export function startForegroundAnnouncementRecord(
  deps: ForegroundAnnouncementDeps = {},
): void {
  if (started) return;
  started = true;
  try {
    const appState = deps.appState ?? AppState;
    const record =
      deps.record ??
      ((isFreshInstall: boolean) =>
        recordForegroundAnnouncement({isFreshInstall}));
    // Read now, before the user can close the onboarding (it writes the
    // last seen version). A failed read counts as a fresh install, as in
    // `readIsFreshInstall`: the id is recorded and nothing is announced.
    const read = deps.readFreshInstall ?? readIsFreshInstall;
    let freshInstall: Promise<boolean>;
    try {
      freshInstall = read().catch(() => true);
    } catch {
      freshInstall = Promise.resolve(true);
    }

    const clearNotice =
      deps.clearNotice ?? (deps.record ? undefined : clearNoticeLater);
    const currentId =
      deps.currentId === undefined ? QARIAH_ANNOUNCEMENT_ID : deps.currentId;

    let ran = false;
    const run = (): void => {
      if (ran) return;
      ran = true;
      freshInstall
        .then(isFreshInstall => {
          const result = record(isFreshInstall);
          if (__DEV__) {
            console.log('[notifications] announcement (foreground):', result);
          }
          // After the record (the stored id stops a new post): also for the
          // id that the background run posted and recorded.
          if (currentId && clearNotice) clearNotice(currentId);
          deps.onResult?.(result);
        })
        .catch(error => {
          if (__DEV__) {
            console.warn('[notifications] announcement record failed:', error);
          }
        });
    };

    if (appState.currentState === 'active') {
      run();
      return;
    }
    // The subscription lives until the first `active` state, also after an
    // unmount: the record is once for each process, not for each mount.
    const subscription = appState.addEventListener('change', state => {
      if (state !== 'active') return;
      subscription.remove();
      run();
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[notifications] announcement record failed:', error);
    }
  }
}

/** Records the announcement id when the user opens the app (see the file header). */
export function useForegroundAnnouncementRecord(): void {
  useEffect(() => {
    startForegroundAnnouncementRecord();
  }, []);
}
