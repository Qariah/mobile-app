// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): a tap on a notification opens the
// screen of its type.
//
// The routes (the `target` in the notification data, `expoNotifier.ts`):
// - `recitation` (types 1 and 2): play the recitation
//   (`services/player/utils/playRecitation.ts`, after the session restore of
//   the boot, so the catalog is ready). A reciter that has the recitation no
//   more opens the reciter profile; a reciter that is gone opens the Listen
//   tab.
// - `surah` (the Friday Al-Kahf reminder): the recitations of the surah,
//   Browse by Surah (`/(tabs)/(a.home)/reciter/browse?surahId=18`).
// - `continue_listening`: resume the last session (the player's queue, else
//   the most recent entry of the recently played list) and open the player.
// - `listen` (the summaries and `whats_new`): the Listen tab. On a real
//   upgrade the update pages then show by themselves.
//
// `startNotificationTapRouter()` handles a cold-start tap (the response that
// started the process, `getLastNotificationResponse()`), a warm-start tap and
// a tap while the app is open (`addNotificationResponseReceivedListener`), as
// `useDeepLinkColdStartReplay` does for links: once the navigator is ready,
// once for each process. A tap is handled at most once: by its key (the
// notification id, the time of the notification, the action) in memory and
// in MMKV (`last_tap_key`), so an Android activity that starts again with
// the same intent does not play it again.
import type {Reciter, Rewayat} from '@/data/reciterData';
import {notificationsStorage} from './catalogDiff';
import {
  NOTIFICATION_TYPES,
  type KeyValueStorage,
  type NotificationTarget,
  type NotificationType,
} from './types';

/** MMKV (`qariah-notifications`): the key of the last handled tap. */
export const LAST_TAP_KEY = 'last_tap_key';

/** The router starts this long after the root mount (off the first frame). */
export const TAP_ROUTER_START_DELAY_MS = 750;

/** How long a tap waits for the navigator (the house pattern of the link replay). */
export const NAV_READY_POLL_MS = 250;
export const NAV_READY_TIMEOUT_MS = 20_000;

/** How long a play waits for the boot's session restore. */
export const SESSION_WAIT_MS = 20_000;

/** How long a tap waits for the cold-start Mushaf restore (`mushafRestoreSignal.ts`). */
export const MUSHAF_RESTORE_WAIT_MS = 10_000;

/** `DEFAULT_ACTION_IDENTIFIER` of expo-notifications: a tap on the notice. */
export const DEFAULT_TAP_ACTION = 'expo.modules.notifications.actions.DEFAULT';

/** The part of an expo `NotificationResponse` that the router reads. */
export interface NotificationResponseLike {
  actionIdentifier: string;
  notification: {
    date: number;
    request: {
      identifier: string;
      content: {data?: Record<string, unknown> | null};
    };
  };
}

export interface NotificationTap {
  /** `identifier|date|action`: one tap of one notice. */
  key: string;
  /** The notification id (`dedupeKey`). */
  id: string;
  type: NotificationType;
  target: NotificationTarget;
}

const TYPES = new Set<string>(NOTIFICATION_TYPES);

function isTarget(value: unknown): value is NotificationTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  switch (target.kind) {
    case 'recitation':
      return (
        typeof target.reciterId === 'string' &&
        typeof target.rewayahId === 'string' &&
        typeof target.surah === 'number' &&
        (target.reciterSlug === null || typeof target.reciterSlug === 'string')
      );
    case 'surah':
      return typeof target.surah === 'number';
    case 'continue_listening':
    case 'listen':
      return true;
    default:
      return false;
  }
}

/**
 * The tap of a response, or `null`: not a tap on the notice (a dismiss or
 * another action), or not a notification of this engine.
 */
export function notificationTapOf(
  response: NotificationResponseLike | null | undefined,
): NotificationTap | null {
  if (!response || response.actionIdentifier !== DEFAULT_TAP_ACTION) {
    return null;
  }
  const request = response.notification?.request;
  const data = request?.content?.data;
  if (!request || !data) return null;
  const type = data.type;
  if (typeof type !== 'string' || !TYPES.has(type)) return null;
  if (!isTarget(data.target)) return null;
  return {
    key: `${request.identifier}|${response.notification.date}|${response.actionIdentifier}`,
    id: request.identifier,
    type: type as NotificationType,
    target: data.target,
  };
}

export type TapAction =
  | {kind: 'play'; reciter: Reciter; rewayah: Rewayat; surah: number}
  | {kind: 'profile'; reciterId: string; rewayahId: string | null}
  | {kind: 'browse_surah'; surah: number}
  | {kind: 'resume'}
  | {kind: 'listen'};

/** What a target does, with the catalog of now (see the file header). */
export function resolveTapAction(
  target: NotificationTarget,
  lookup: {
    byId: (id: string) => Reciter | undefined;
    bySlug: (slug: string) => Reciter | undefined;
  },
): TapAction {
  switch (target.kind) {
    case 'recitation': {
      const reciter =
        lookup.byId(target.reciterId) ??
        (target.reciterSlug ? lookup.bySlug(target.reciterSlug) : undefined);
      if (!reciter) return {kind: 'listen'};
      const rewayah = reciter.rewayat?.find(r => r.id === target.rewayahId);
      if (rewayah && (rewayah.surah_list ?? []).includes(target.surah)) {
        return {kind: 'play', reciter, rewayah, surah: target.surah};
      }
      return {
        kind: 'profile',
        reciterId: reciter.id,
        rewayahId: rewayah ? rewayah.id : null,
      };
    }
    case 'surah':
      return {kind: 'browse_surah', surah: target.surah};
    case 'continue_listening':
      return {kind: 'resume'};
    case 'listen':
      return {kind: 'listen'};
  }
}

/** The part of the expo-router `router` that the routes use. */
export interface TapRouterNavigation {
  push(href: {pathname: string; params?: Record<string, string>}): void;
  navigate(href: string): void;
}

export const BROWSE_ROUTE = '/(tabs)/(a.home)/reciter/browse';
export const RECITER_PROFILE_ROUTE = '/(tabs)/(a.home)/reciter/[id]';
export const LISTEN_ROUTE = '/(tabs)/(a.home)';

export interface OpenTapDeps {
  router: TapRouterNavigation;
  /** Resolves `true` once the navigator is ready, `false` after the wait. */
  waitForNavigation: () => Promise<boolean>;
  /** Resolves once the boot restored the session (or after a time limit). */
  waitForSession: () => Promise<void>;
  /**
   * Resolves once the cold-start Mushaf restore of `app/_layout.tsx` is done
   * (or after a time limit), so its `/mushaf` push cannot land on top of the
   * screen of the tap (review of Task 16, L2).
   */
  waitForMushafRestore: () => Promise<unknown>;
  byId: (id: string) => Reciter | undefined;
  bySlug: (slug: string) => Reciter | undefined;
  playRecitation: (
    reciter: Reciter,
    rewayah: Rewayat,
    surah: number,
  ) => Promise<void>;
  /** Resolves `false` when there is no session to resume. */
  resumeLastSession: () => Promise<boolean>;
  /**
   * Closes the full player sheet, so a screen that the tap opens is not
   * under it (the mini player stays).
   */
  closePlayer: () => void;
  /**
   * Closes the open action sheets and resolves when they are closed (or
   * after a time limit). The sheets render above every screen and above the
   * player, so a tap must not open its screen or the player under a sheet
   * (TECH_DEBT #261). Never rejects.
   */
  closeSheets: () => Promise<void>;
}

export type OpenTapResult = TapAction['kind'] | 'no_navigator' | 'failed';

/** Opens the screen of a tap. Never throws. */
export async function openNotificationTap(
  tap: NotificationTap,
  deps: OpenTapDeps,
): Promise<OpenTapResult> {
  try {
    if (!(await deps.waitForNavigation())) return 'no_navigator';
    await deps.waitForMushafRestore();
    // The play and the resume need the catalog and the restored session; a
    // navigation does not, but the lookup of a recitation does.
    if (
      tap.target.kind === 'recitation' ||
      tap.target.kind === 'continue_listening'
    ) {
      await deps.waitForSession();
    }
    const action = resolveTapAction(tap.target, {
      byId: deps.byId,
      bySlug: deps.bySlug,
    });
    // Each action opens a screen or the player. A tap does not go through
    // the link handler (app/+native-intent.ts), so close the open sheets
    // here, before the action (TECH_DEBT #261).
    await deps.closeSheets();
    // A screen must not open under the full player (a play or a resume
    // opens the player itself).
    if (action.kind !== 'play' && action.kind !== 'resume') {
      deps.closePlayer();
    }
    switch (action.kind) {
      case 'play':
        await deps.playRecitation(action.reciter, action.rewayah, action.surah);
        break;
      case 'profile':
        deps.router.push({
          pathname: RECITER_PROFILE_ROUTE,
          params: {
            id: action.reciterId,
            ...(action.rewayahId ? {rewayatId: action.rewayahId} : {}),
          },
        });
        break;
      case 'browse_surah':
        deps.router.push({
          pathname: BROWSE_ROUTE,
          params: {surahId: String(action.surah)},
        });
        break;
      case 'resume':
        // No session to resume: the Listen tab.
        if (!(await deps.resumeLastSession())) {
          deps.closePlayer();
          deps.router.navigate(LISTEN_ROUTE);
          return 'listen';
        }
        break;
      case 'listen':
        deps.router.navigate(LISTEN_ROUTE);
        break;
    }
    return action.kind;
  } catch (error) {
    if (__DEV__) console.warn('[notifications] the tap failed', error);
    return 'failed';
  }
}

/** The once-only record of the handled taps, in memory and in MMKV. */
export function createTapLedger(
  storage: KeyValueStorage = notificationsStorage,
): {claim(key: string): boolean} {
  const seen = new Set<string>();
  return {
    /** `true` the first time a key comes (then it is recorded). */
    claim: key => {
      if (seen.has(key)) return false;
      seen.add(key);
      try {
        if (storage.getString(LAST_TAP_KEY) === key) return false;
        storage.set(LAST_TAP_KEY, key);
      } catch {
        // The memory record still stops a second tap in this process.
      }
      return true;
    },
  };
}

/** The native side of the router, injected in the tests. */
export interface TapSource {
  /** The response that started the process (or the last one), or `null`. */
  getLastResponse(): NotificationResponseLike | null;
  clearLastResponse(): void;
  addResponseListener(listener: (response: NotificationResponseLike) => void): {
    remove(): void;
  };
}

export interface TapRouterDeps {
  /** Default: expo-notifications, required on first use. */
  source?: () => TapSource;
  open: (tap: NotificationTap) => Promise<OpenTapResult>;
  /** Default: `createTapLedger()`. */
  ledger?: {claim(key: string): boolean};
  /** Each opened tap (analytics). */
  onOpened?: (
    tap: NotificationTap,
    coldStart: boolean,
    result: OpenTapResult,
  ) => void;
  startDelayMs?: number;
}

function expoTapSource(): TapSource {
  const Notifications =
    require('expo-notifications') as typeof import('expo-notifications');
  return {
    getLastResponse: () =>
      Notifications.getLastNotificationResponse() as NotificationResponseLike | null,
    clearLastResponse: () => Notifications.clearLastNotificationResponse(),
    addResponseListener: listener =>
      Notifications.addNotificationResponseReceivedListener(response =>
        listener(response as NotificationResponseLike),
      ),
  };
}

let routerStarted = false;

/**
 * Starts the router, once for each process (see the file header). The native
 * module loads after `startDelayMs`, off the first frame. Returns the stop
 * function (tests). Never throws.
 */
export function startNotificationTapRouter(deps: TapRouterDeps): () => void {
  if (routerStarted) return () => undefined;
  routerStarted = true;
  const ledger = deps.ledger ?? createTapLedger();
  let subscription: {remove(): void} | null = null;
  let stopped = false;

  const handle = (
    response: NotificationResponseLike | null,
    coldStart: boolean,
    source: TapSource,
  ): void => {
    const tap = notificationTapOf(response);
    if (!tap || !ledger.claim(tap.key)) return;
    try {
      // A later read of the last response must not give this tap again.
      source.clearLastResponse();
    } catch {
      // The ledger stops a second handling.
    }
    if (__DEV__) {
      console.log(
        `[notifications] tap: ${tap.type} (${coldStart ? 'cold' : 'warm'} start)`,
      );
    }
    void deps.open(tap).then(result => {
      if (__DEV__) console.log(`[notifications] tap opened: ${result}`);
      try {
        deps.onOpened?.(tap, coldStart, result);
      } catch {
        // Analytics must not break the router.
      }
    });
  };

  const timer = setTimeout(() => {
    if (stopped) return;
    try {
      const source = (deps.source ?? expoTapSource)();
      subscription = source.addResponseListener(response =>
        handle(response, false, source),
      );
      handle(source.getLastResponse(), true, source);
    } catch (error) {
      if (__DEV__) {
        console.warn('[notifications] the tap router did not start', error);
      }
    }
  }, deps.startDelayMs ?? TAP_ROUTER_START_DELAY_MS);

  return () => {
    stopped = true;
    clearTimeout(timer);
    subscription?.remove();
    routerStarted = false;
  };
}

/** Tests only. */
export function __resetTapRouterForTests(): void {
  routerStarted = false;
}

/** Resolves `true` once `isReady()` is true, polling (the link-replay pattern). */
export function waitUntilReady(
  isReady: () => boolean,
  timeoutMs: number = NAV_READY_TIMEOUT_MS,
  pollMs: number = NAV_READY_POLL_MS,
): Promise<boolean> {
  if (isReady()) return Promise.resolve(true);
  return new Promise(resolve => {
    const startedAt = Date.now();
    const poll = setInterval(() => {
      if (isReady()) {
        clearInterval(poll);
        resolve(true);
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(poll);
        resolve(false);
      }
    }, pollMs);
  });
}
