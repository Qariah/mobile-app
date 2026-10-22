// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the notification card
// (`components/notifications/NotificationSoftPrompt.tsx`). It lists the five
// notification types, so that the user knows what the notifications are for.
//
// - iOS: the card asks before the system notification dialog ("Allow",
//   "Not now").
// - Android: Android 13+ asks for the permission at the first launch
//   (`ExpoAudioProvider`), and Android 12 and earlier does not ask. So the
//   card only introduces the types ("Choose notifications" opens the
//   Notifications page, "OK" closes the card). It asks for nothing.
//
// It shows after a completed play (`playbackEvents.ts`) when each of these
// holds (`shouldShowSoftPrompt`):
// - iOS or Android.
// - The user is not in the holdout (`isNotificationsHoldout()`).
// - iOS: the system can still ask (the permission is `undetermined`).
//   Android: the notifications are on (the permission is `granted`).
// - The card got no answer before (`softPromptAnswered`, read from the store
//   only after a successful read).
// It shows at most once in a process. A completion while the app is in the
// background shows the card when the app is active again.
//
// The card counts as shown, and `notification_permission_prompted` goes out,
// only when the Modal's `onShow` fires (`confirmSoftPromptShown`). It does not
// try while an action sheet is open (`getSheetStack()` of
// react-native-actions-sheet). React Native has no signal for another open
// Modal or an Alert; iOS then does not present the card, `onShow` does not
// fire within `SOFT_PROMPT_SHOW_CONFIRM_MS`, and the card waits for the next
// completed play (review of Task 16, L3).
//
// "Allow" shows the system dialog (`requestPermissionsAsync`, no badge); a
// grant syncs the native state (`notificationsSync.ts`: the background task
// and the Al-Kahf reminder). "Not now", "Choose notifications" and "OK" ask
// nothing. Each answer sets `softPromptAnswered`, so the card does not come
// back by itself; the Notifications page can still ask.
import {AppState, Platform} from 'react-native';
import {create} from 'zustand';
import {isNotificationsHoldout} from './holdout';
import {onPlaybackCompleted} from './playbackEvents';
import {
  getHydratedNotificationPrefs,
  useNotificationPrefsStore,
} from './prefsStore';
import {
  notificationPermissionAction,
  type NotificationPermissionSnapshot,
} from './permissionAction';

/** The iOS options of the request (GATE 1: no badge), as the Notifications page. */
export const IOS_PERMISSION_REQUEST = {
  ios: {allowAlert: true, allowSound: true, allowBadge: false},
} as const;

export interface SoftPromptConditions {
  platform: string;
  holdout: boolean;
  /** `null`: the toggles could not be read. */
  softPromptAnswered: boolean | null;
  /** `null`: the permission could not be read. */
  permission: NotificationPermissionSnapshot | null;
}

/** The platforms that show the card. */
function cardPlatform(platform: string): boolean {
  return platform === 'ios' || platform === 'android';
}

/** `true` when the card may show (see the file header). */
export function shouldShowSoftPrompt(input: SoftPromptConditions): boolean {
  if (!cardPlatform(input.platform)) return false;
  if (input.holdout) return false;
  if (input.softPromptAnswered !== false) return false;
  if (!input.permission) return false;
  if (input.platform === 'android') {
    return input.permission.status === 'granted';
  }
  return (
    input.permission.status === 'undetermined' &&
    notificationPermissionAction(input.permission) === 'ask'
  );
}

/** The card must show within this time after `visible` (its `onShow`), or it waits for the next play. */
export const SOFT_PROMPT_SHOW_CONFIRM_MS = 3000;

/** The visibility of the card (not persisted). */
export const useSoftPromptStore = create<{visible: boolean}>(() => ({
  visible: false,
}));

/**
 * iOS: `allow` (the system dialog) or `not_now`. Android: `choose` (the
 * Notifications page opens) or `ok`.
 */
export type SoftPromptAnswer = 'allow' | 'not_now' | 'choose' | 'ok';

/** The native and store parts, injected in the tests. */
export interface SoftPromptDeps {
  platform?: () => string;
  isHoldout?: () => boolean;
  readAnswered?: () => Promise<boolean | null>;
  getPermission?: () => Promise<NotificationPermissionSnapshot>;
  requestPermission?: () => Promise<NotificationPermissionSnapshot>;
  setAnswered?: () => void;
  /** After a grant. Default: `syncNotifications('permission_granted')`. */
  onGranted?: () => Promise<unknown>;
  isAppActive?: () => boolean;
  /** Calls `listener` when the app is active again. Returns the unsubscribe. */
  onAppActive?: (listener: () => void) => () => void;
  subscribeCompleted?: (listener: () => void) => () => void;
  /** `true` while an action sheet is open. Default: `getSheetStack()` of react-native-actions-sheet. */
  isOtherSheetOpen?: () => boolean;
  /** The card showed. Default: `notification_permission_prompted`. */
  onPrompted?: () => void;
  /** The answer and the permission after it. Default: `notification_permission_result`. */
  onResult?: (
    answer: SoftPromptAnswer,
    permission: NotificationPermissionSnapshot | null,
  ) => void;
}

function notificationsModule(): typeof import('expo-notifications') {
  return require('expo-notifications') as typeof import('expo-notifications');
}

function analyticsModule(): typeof import('./notificationAnalytics') {
  return require('./notificationAnalytics') as typeof import('./notificationAnalytics');
}

/** The analytics source: the iOS card asks (`soft_prompt`); the Android card only introduces (`intro_card`). */
function cardSource(): 'soft_prompt' | 'intro_card' {
  return state.deps.platform() === 'android' ? 'intro_card' : 'soft_prompt';
}

const defaults: Required<SoftPromptDeps> = {
  platform: () => Platform.OS,
  isHoldout: () => isNotificationsHoldout(),
  readAnswered: async () => {
    const prefs = await getHydratedNotificationPrefs();
    return prefs ? prefs.softPromptAnswered : null;
  },
  getPermission: () => notificationsModule().getPermissionsAsync(),
  requestPermission: () =>
    notificationsModule().requestPermissionsAsync(IOS_PERMISSION_REQUEST),
  setAnswered: () =>
    useNotificationPrefsStore.getState().setSoftPromptAnswered(true),
  onGranted: () => {
    const {syncNotifications} =
      require('./notificationsSync') as typeof import('./notificationsSync');
    return syncNotifications('permission_granted');
  },
  isAppActive: () => AppState.currentState === 'active',
  onAppActive: listener => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') listener();
    });
    return () => subscription.remove();
  },
  subscribeCompleted: onPlaybackCompleted,
  isOtherSheetOpen: () => {
    const {getSheetStack} =
      require('react-native-actions-sheet') as typeof import('react-native-actions-sheet');
    return getSheetStack().length > 0;
  },
  onPrompted: () => {
    void analyticsModule().trackPermissionPrompted(cardSource());
  },
  onResult: (answer, permission) => {
    void analyticsModule().trackPermissionResult(
      cardSource(),
      answer,
      permission,
    );
  },
};

/**
 * - `idle`: may try at the next completed play.
 * - `waiting`: the conditions hold; waits for the app to be active.
 * - `presenting`: `visible` is set; waits for the Modal's `onShow`.
 * - `done`: shown (or the system dialog was answered): never again in this process.
 */
type CardPhase = 'idle' | 'waiting' | 'presenting' | 'done';

const state: {
  deps: Required<SoftPromptDeps>;
  phase: CardPhase;
  /** The permission when the card showed (the result event of an Android answer). */
  shownPermission: NotificationPermissionSnapshot | null;
  checking: boolean;
  confirmTimer: ReturnType<typeof setTimeout> | null;
  stop: (() => void) | null;
} = {
  deps: defaults,
  phase: 'idle',
  shownPermission: null,
  checking: false,
  confirmTimer: null,
  stop: null,
};

function clearConfirmTimer(): void {
  if (state.confirmTimer) clearTimeout(state.confirmTimer);
  state.confirmTimer = null;
}

function otherSheetOpen(): boolean {
  try {
    return state.deps.isOtherSheetOpen();
  } catch {
    return false;
  }
}

/** Sets `visible`; the card counts as shown only at `confirmSoftPromptShown`. */
function present(): void {
  if (state.phase === 'presenting' || state.phase === 'done') return;
  // An action sheet is open: try again at the next completed play.
  if (otherSheetOpen()) {
    state.phase = 'idle';
    return;
  }
  state.phase = 'presenting';
  useSoftPromptStore.setState({visible: true});
  clearConfirmTimer();
  state.confirmTimer = setTimeout(() => {
    state.confirmTimer = null;
    if (state.phase !== 'presenting') return;
    // iOS did not present it (another Modal or an Alert): the next play.
    state.phase = 'idle';
    useSoftPromptStore.setState({visible: false});
  }, SOFT_PROMPT_SHOW_CONFIRM_MS);
}

/** The Modal's `onShow`: the card is on screen. Sends the prompted event once. */
export function confirmSoftPromptShown(): void {
  if (state.phase !== 'presenting') return;
  clearConfirmTimer();
  state.phase = 'done';
  try {
    state.deps.onPrompted();
  } catch {
    // Analytics must not break the card.
  }
}

/** A completed play: show the card when the conditions hold. Never throws. */
export async function maybeShowSoftPrompt(): Promise<boolean> {
  const deps = state.deps;
  if (state.phase !== 'idle' || state.checking) return false;
  if (!cardPlatform(deps.platform())) return false;
  state.checking = true;
  try {
    if (deps.isHoldout()) return false;
    const softPromptAnswered = await deps.readAnswered();
    if (softPromptAnswered !== false) return false;
    let permission: NotificationPermissionSnapshot | null;
    try {
      permission = await deps.getPermission();
    } catch {
      permission = null;
    }
    if (
      !shouldShowSoftPrompt({
        platform: deps.platform(),
        holdout: false,
        softPromptAnswered,
        permission,
      })
    ) {
      // iOS: an answered system dialog never asks again, so stop checking.
      // Android: the user can turn the notifications on later, so check
      // again at the next completed play.
      if (
        deps.platform() === 'ios' &&
        permission &&
        permission.status !== 'undetermined'
      ) {
        state.phase = 'done';
      }
      return false;
    }
    if (otherSheetOpen()) return false;
    state.shownPermission = permission;
    if (deps.isAppActive()) {
      present();
    } else {
      state.phase = 'waiting';
      const unsubscribe = deps.onAppActive(() => {
        unsubscribe();
        if (state.phase !== 'waiting') return;
        state.phase = 'idle';
        present();
      });
    }
    return state.phase !== 'idle';
  } catch {
    return false;
  } finally {
    state.checking = false;
  }
}

/** The answer of the card (see the file header). Never throws. */
export async function answerSoftPrompt(
  answer: SoftPromptAnswer,
): Promise<NotificationPermissionSnapshot | null> {
  const deps = state.deps;
  clearConfirmTimer();
  state.phase = 'done';
  useSoftPromptStore.setState({visible: false});
  try {
    deps.setAnswered();
  } catch {
    // The card does not show again in this process (`done`).
  }
  // Android asks for nothing: the result event carries the permission that
  // the card saw.
  let permission: NotificationPermissionSnapshot | null =
    answer === 'choose' || answer === 'ok' ? state.shownPermission : null;
  if (answer === 'allow') {
    try {
      permission = await deps.requestPermission();
    } catch (error) {
      if (__DEV__) {
        console.warn('[notifications] permission request failed', error);
      }
    }
    if (permission?.granted || permission?.status === 'granted') {
      try {
        await deps.onGranted();
      } catch {
        // The next boot syncs.
      }
    }
  }
  try {
    deps.onResult(answer, permission);
  } catch {
    // Analytics must not break the card.
  }
  return permission;
}

/**
 * Starts listening for completed plays, once in a process (the card's
 * mount). Returns the stop function.
 */
export function startSoftPrompt(deps: SoftPromptDeps = {}): () => void {
  if (state.stop) return state.stop;
  state.deps = {...defaults, ...deps};
  if (!cardPlatform(state.deps.platform())) return () => undefined;
  const unsubscribe = state.deps.subscribeCompleted(() => {
    void maybeShowSoftPrompt();
  });
  const stop = (): void => {
    unsubscribe();
    state.stop = null;
  };
  state.stop = stop;
  return stop;
}

/** Tests only. */
export function __resetSoftPromptForTests(): void {
  state.stop?.();
  state.stop = null;
  clearConfirmTimer();
  state.phase = 'idle';
  state.shownPermission = null;
  state.checking = false;
  state.deps = defaults;
  useSoftPromptStore.setState({visible: false});
}
