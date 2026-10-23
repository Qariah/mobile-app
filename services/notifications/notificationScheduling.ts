// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the scheduled types follow the player,
// the Notifications page switches and the app state.
//
// `startNotificationScheduling()` starts four subscriptions, once in a
// process (`startQariahNotifications`):
// - The player store: at each play start (the playback state becomes
//   `playing`), the "continue listening" notice moves to 3 calendar days
//   later, at the same local time (`continueListeningTrigger`), with the surah
//   and the reciter of that track. The id `continue_listening` replaces the
//   pending notice. A Qariah subscription; the upstream player does not
//   change.
// - The prefs store: the Al-Kahf switch syncs the native state
//   (`notificationsSync.ts`); "continue listening" OFF cancels its notice and
//   removes the stored play, and ON schedules it for the last play of the
//   process.
// - The app state: back to `active`, a sync (the permission can have changed
//   in the system settings, or in the Android 13+ dialog of the first launch).
//   At most once in `FOREGROUND_SYNC_MIN_MS`, unless the last sync saw no
//   permission (then each return can be the one after a grant) (review L4).
// - The syncs (`notificationsSync.ts` `onNotificationsSynced`): see below.
//
// Nothing native runs before `setNotificationSchedulingReady()` (the boot
// step, 5 s after the catalog): `expo-notifications` stays off the cold start.
// A play start before then is kept, and handled when ready.
//
// A play start reschedules at most once in `CONTINUE_RESCHEDULE_MIN_MS` for
// the same track: a stream goes `buffering` → `playing` many times. A play
// that schedules nothing (no permission yet, the arm not known yet) is kept:
// after a sync that ends with the permission granted and the arm `notify`
// (`permission_granted`, `holdout_assigned`, `foreground`), it is scheduled
// with its own play time (review of Task 16, M2: the play just before the
// iOS opt-in must get its notice).
//
// The play of the pending notice is also kept in MMKV
// (`continueListeningStore.ts`, key `continue_listening_last_play`), with the
// time of the notice (Sprint 50, TECH_DEBT #330). Android removes the alarms
// of a force-stopped app, and the next process has no play in memory. So the
// boot step reads the record: when the time of the notice is still in the
// future, it schedules the notice again at that time, with the same id. When
// the time is past, it posts nothing (no late notice) and removes the record.
// It schedules again also when the notice shows as pending: after a
// force-stop, the `expo-notifications` store on Android still lists the
// notice, but no alarm fires it. The same id replaces a pending notice, so
// iOS (which keeps the notice across a force-quit) gets no second notice.
// A play start before the boot step wins over the record.
import {AppState, type AppStateStatus} from 'react-native';
import {SURAHS} from '@/data/surahData';
import {getReciterByIdSync} from '@/services/dataService';
import {getReciterDisplayName, getSurahDisplayName} from '@/i18n/format';
import {usePlayerStore} from '@/services/player/store/playerStore';
import type {Track} from '@/types/audio';
import {notificationsStorage} from './catalogDiff';
import {
  clearContinuePlay,
  clearContinuePlayIfPast,
  readContinuePlay,
  writeContinuePlay,
} from './continueListeningStore';
import {isNotificationsHoldout} from './holdout';
import {
  getHydratedNotificationPrefs,
  useNotificationPrefsStore,
  type NotificationPrefsState,
} from './prefsStore';
import {
  continueListeningCandidate,
  continueListeningTrigger,
  type ContinueListeningText,
} from './scheduler';
import type {
  KeyValueStorage,
  NotificationPermissionStatus,
  NotificationPrefsSnapshot,
  Notifier,
} from './types';

/** The same track does not reschedule more often than this. */
export const CONTINUE_RESCHEDULE_MIN_MS = 10 * 60_000;

/** A foreground sync at most this often (iOS goes `inactive` → `active` for each pull-down). */
export const FOREGROUND_SYNC_MIN_MS = 30_000;

/** The track of a play start, the part that the notice needs. */
export interface PlayedTrack {
  reciterId: string;
  reciterName: string;
  surahId: number;
  rewayatId: string | null;
}

/**
 * - `scheduled`: a new notice (none was pending).
 * - `rescheduled`: the pending notice moved.
 * - `skipped`: off, the holdout, no permission, the toggles unreadable, the
 *   same track a short time ago, or the time of the notice is past.
 * - `failed`: a native call failed.
 */
export type ContinueScheduleResult =
  | 'scheduled'
  | 'rescheduled'
  | 'skipped'
  | 'failed';

export interface ContinueScheduleDeps {
  notifier: Notifier;
  isHoldout: () => boolean;
  readPrefs: () => Promise<NotificationPrefsSnapshot | null>;
  /** The surah and the reciter in the app language. */
  textFor: (track: PlayedTrack) => ContinueListeningText;
  /** Default: `Date.now`. */
  now?: () => number;
}

/** The part of a player track that the notice needs, or `null` (an upload, no surah). */
export function playedTrackOf(
  track: Track | null | undefined,
): PlayedTrack | null {
  if (!track || track.isUserUpload || !track.surahId) return null;
  const surahId = parseInt(track.surahId, 10);
  if (!Number.isInteger(surahId) || surahId < 1 || !track.reciterId) {
    return null;
  }
  return {
    reciterId: track.reciterId,
    reciterName: track.reciterName,
    surahId,
    rewayatId: track.rewayatId ?? null,
  };
}

/** The surah and the reciter names in the app language of now. */
export function continueTextFor(track: PlayedTrack): ContinueListeningText {
  const surah = SURAHS[track.surahId - 1];
  const reciter = getReciterByIdSync(track.reciterId);
  return {
    surahName: surah ? getSurahDisplayName(surah) : String(track.surahId),
    reciterName: reciter ? getReciterDisplayName(reciter) : track.reciterName,
  };
}

/**
 * Schedules "continue listening" 3 calendar days after `playedAt` for
 * `track`, when its toggle is on, the user is not in the holdout and the
 * permission is granted. With `fireAt` (epoch milliseconds), the notice comes
 * at that time: the boot step keeps the time of the first schedule.
 *
 * A time of the notice that is now or past gives `skipped`, also when it
 * passes during the checks: nothing is scheduled. On Android, a past date
 * makes `expo-notifications` remove the stored request (the pending notice
 * goes), and on iOS the call rejects. A replay in a long-lived process (the
 * switch ON again, a granted sync) or a boot just before the time can give
 * such a date (review of Task 10). Never throws.
 */
export async function scheduleContinueListening(
  track: PlayedTrack,
  playedAt: Date,
  deps: ContinueScheduleDeps,
  fireAt?: number,
): Promise<ContinueScheduleResult> {
  try {
    const trigger =
      fireAt === undefined
        ? continueListeningTrigger(playedAt)
        : {kind: 'date' as const, at: fireAt};
    const now = deps.now ?? Date.now;
    const isPast = (): boolean => trigger.at <= now();
    if (isPast()) return 'skipped';
    const allowed = async (): Promise<boolean> => {
      if (deps.isHoldout()) return false;
      const prefs = await deps.readPrefs();
      return prefs !== null && prefs.continue_listening === true;
    };
    if (!(await allowed())) return 'skipped';
    if ((await deps.notifier.getPermission()) !== 'granted') return 'skipped';
    const candidate = continueListeningCandidate(deps.textFor(track));
    const pending = deps.notifier.listScheduled
      ? (await deps.notifier.listScheduled()).some(
          request => request.id === candidate.dedupeKey,
        )
      : false;
    // The switch can change during the awaits above (review L6).
    if (!(await allowed())) return 'skipped';
    // The time can pass during the awaits above.
    if (isPast()) return 'skipped';
    await deps.notifier.schedule(candidate, trigger);
    return pending ? 'rescheduled' : 'scheduled';
  } catch {
    return 'failed';
  }
}

function trackKey(track: PlayedTrack): string {
  return `${track.reciterId}|${track.rewayatId ?? ''}|${track.surahId}`;
}

/** The sources of the subscriptions, injected in the tests. */
export interface NotificationSchedulingDeps {
  subscribePlayStarts?: (listener: (track: PlayedTrack) => void) => () => void;
  subscribePrefs?: (
    listener: (
      next: NotificationPrefsState,
      previous: NotificationPrefsState,
    ) => void,
  ) => () => void;
  subscribeAppActive?: (listener: () => void) => () => void;
  /** Default: the `Notifier` of `expoNotifier.ts`, required on first use. */
  notifier?: () => Notifier;
  isHoldout?: () => boolean;
  readPrefs?: () => Promise<NotificationPrefsSnapshot | null>;
  textFor?: (track: PlayedTrack) => ContinueListeningText;
  /** Default: `syncNotifications` of `notificationsSync.ts`. */
  sync?: (reason: string) => Promise<unknown>;
  /** Default: `onNotificationsSynced` of `notificationsSync.ts`. */
  subscribeSynced?: (listener: (result: SyncOutcome) => void) => () => void;
  now?: () => number;
  /**
   * Each "continue listening" result of a play (not of the boot step that
   * schedules the stored play again). Default: `notification_scheduled` for a
   * new notice.
   */
  onContinueScheduled?: (result: ContinueScheduleResult) => void;
  /** The store of the last play. Default: `notificationsStorage` (MMKV `qariah-notifications`). */
  storage?: KeyValueStorage;
}

/** Play starts from the player store: the state becomes `playing`. */
function subscribePlayerPlayStarts(
  listener: (track: PlayedTrack) => void,
): () => void {
  return usePlayerStore.subscribe((state, previous) => {
    if (state.playback.state !== 'playing') return;
    if (previous.playback.state === 'playing') return;
    const played = playedTrackOf(state.queue.tracks[state.queue.currentIndex]);
    if (played) listener(played);
  });
}

function subscribeNotificationPrefs(
  listener: (
    next: NotificationPrefsState,
    previous: NotificationPrefsState,
  ) => void,
): () => void {
  return useNotificationPrefsStore.subscribe(listener);
}

function subscribeAppStateActive(listener: () => void): () => void {
  let last: AppStateStatus | null = AppState.currentState;
  const subscription = AppState.addEventListener('change', state => {
    const previous = last;
    last = state;
    if (state === 'active' && previous !== 'active') listener();
  });
  return () => subscription.remove();
}

function defaultNotifier(): Notifier {
  const {createExpoNotifier} =
    require('./expoNotifier') as typeof import('./expoNotifier');
  return createExpoNotifier();
}

function defaultSubscribeSynced(
  listener: (result: SyncOutcome) => void,
): () => void {
  const {onNotificationsSynced} =
    require('./notificationsSync') as typeof import('./notificationsSync');
  return onNotificationsSynced(listener);
}

function defaultSync(reason: string): Promise<unknown> {
  const {syncNotifications} =
    require('./notificationsSync') as typeof import('./notificationsSync');
  return syncNotifications(reason);
}

/** The part of a sync result (`notificationsSync.ts`) that this module reads. */
export interface SyncOutcome {
  reason: string;
  holdout: boolean;
  permission?: NotificationPermissionStatus;
}

/** The syncs after which a kept play is scheduled again (review M2). */
const REPLAY_REASONS: ReadonlySet<string> = new Set([
  'permission_granted',
  'holdout_assigned',
  'foreground',
]);

interface SchedulingState {
  ready: boolean;
  /** A play start before `ready`. */
  pendingPlay: {track: PlayedTrack; at: number} | null;
  /** The last play start of the process (also before `ready`). */
  lastPlay: {track: PlayedTrack; at: number} | null;
  lastScheduled: {key: string; at: number} | null;
  lastForegroundSync: number;
  /** The last sync saw the arm `notify` and no granted permission. */
  lastSyncNotGranted: boolean;
  /** Counts the syncs that ended granted (a schedule that started before one tries again). */
  grantedSyncs: number;
  stop: (() => void) | null;
  deps: NotificationSchedulingDeps;
}

const state: SchedulingState = {
  ready: false,
  pendingPlay: null,
  lastPlay: null,
  lastScheduled: null,
  lastForegroundSync: 0,
  lastSyncNotGranted: false,
  grantedSyncs: 0,
  stop: null,
  deps: {},
};

function storageOf(deps: NotificationSchedulingDeps): KeyValueStorage {
  return deps.storage ?? notificationsStorage;
}

function handlePlayStart(track: PlayedTrack, at: number): void {
  state.lastPlay = {track, at};
  if (!state.ready) {
    state.pendingPlay = {track, at};
    return;
  }
  scheduleContinueFor(track, at, continueListeningTrigger(at).at, 'play');
}

/**
 * - `play`: a play start (also a play that a sync or the switch schedules
 *   again).
 * - `restore`: the boot step schedules the stored play again (TECH_DEBT #330).
 */
type ContinueSource = 'play' | 'restore';

/**
 * One schedule of the notice for the play of `track` at `at`, at `fireAt`.
 * A success keeps the play in MMKV (`continueListeningStore.ts`).
 */
function scheduleContinueFor(
  track: PlayedTrack,
  at: number,
  fireAt: number,
  source: ContinueSource,
): void {
  const key = trackKey(track);
  const last = state.lastScheduled;
  if (last && last.key === key && at - last.at < CONTINUE_RESCHEDULE_MIN_MS) {
    return;
  }
  const attempt = {key, at};
  state.lastScheduled = attempt;
  const grantedSyncsAtStart = state.grantedSyncs;
  const deps = state.deps;
  void scheduleContinueListening(
    track,
    new Date(at),
    {
      notifier: (deps.notifier ?? defaultNotifier)(),
      isHoldout: deps.isHoldout ?? isNotificationsHoldout,
      readPrefs: deps.readPrefs ?? (() => getHydratedNotificationPrefs()),
      textFor: deps.textFor ?? continueTextFor,
      now: deps.now,
    },
    fireAt,
  ).then(result => {
    // The time of the notice is past: nothing was scheduled, and a stored
    // play with a past time is of no use. A newer play keeps its record.
    if (result === 'skipped') {
      const now = (deps.now ?? Date.now)();
      if (fireAt <= now) clearContinuePlayIfPast(now, storageOf(deps));
    }
    // Keep the play of the pending notice for the next process. Not when the
    // switch went OFF (it sets `lastScheduled` to null and removes the
    // record) or a newer play started meanwhile.
    if (
      (result === 'scheduled' || result === 'rescheduled') &&
      state.lastScheduled === attempt
    ) {
      writeContinuePlay({track, playedAt: at, fireAt}, storageOf(deps));
    }
    if (result === 'failed' || result === 'skipped') {
      // Nothing is pending for this play: the next play start, or a sync
      // that ends granted, schedules it.
      if (state.lastScheduled === attempt) state.lastScheduled = null;
      // A granted sync came while this attempt ran: try once more.
      if (
        result === 'skipped' &&
        state.ready &&
        state.grantedSyncs !== grantedSyncsAtStart &&
        state.lastPlay?.at === at
      ) {
        scheduleContinueFor(track, at, fireAt, source);
      }
    }
    if (__DEV__) {
      const label = source === 'restore' ? ' (restore)' : '';
      console.log(`[notifications] continue listening${label}: ${result}`);
      (
        require('./notificationsSync') as typeof import('./notificationsSync')
      ).devLogScheduled();
    }
    // The boot step sets the same notice again: it is not a new notice.
    if (source === 'restore') return;
    try {
      (deps.onContinueScheduled ?? reportContinueScheduled)(result);
    } catch {
      // A listener must not break the scheduling.
    }
  });
}

/**
 * The boot step (TECH_DEBT #330): schedules the stored play again when the
 * time of its notice is still in the future. A time that is past posts
 * nothing, and the record goes. A holdout user gets nothing (and loads no
 * notifier). The checks of `scheduleContinueListening` (the switch, the
 * permission) apply.
 */
function restoreContinueListening(): void {
  const deps = state.deps;
  const storage = storageOf(deps);
  const saved = readContinuePlay(storage);
  if (!saved) return;
  if (saved.fireAt <= (deps.now ?? Date.now)()) {
    clearContinuePlay(storage);
    return;
  }
  if ((deps.isHoldout ?? isNotificationsHoldout)()) return;
  // The play of this process from now on: the switch ON again and a granted
  // sync use it, as for a play start.
  state.lastPlay = {track: saved.track, at: saved.playedAt};
  scheduleContinueFor(saved.track, saved.playedAt, saved.fireAt, 'restore');
}

/** `notification_scheduled` for a NEW "continue listening" notice. */
function reportContinueScheduled(result: ContinueScheduleResult): void {
  if (result !== 'scheduled') return;
  const analytics =
    require('./notificationAnalytics') as typeof import('./notificationAnalytics');
  void analytics.trackNotificationScheduled(
    analytics.scheduledProps(
      {type: 'continue_listening', dedupeKey: 'continue_listening'},
      'date',
      'play',
    ),
  );
}

function handlePrefsChange(
  next: NotificationPrefsState,
  previous: NotificationPrefsState,
): void {
  if (!state.ready) return;
  const deps = state.deps;
  // A holdout user has no switches and nothing scheduled: load nothing.
  if ((deps.isHoldout ?? isNotificationsHoldout)()) return;
  if (next.kahf_friday !== previous.kahf_friday) {
    void (deps.sync ?? defaultSync)('toggle').catch(() => undefined);
  }
  if (previous.continue_listening && !next.continue_listening) {
    state.lastScheduled = null;
    // The next process must not schedule the notice again.
    clearContinuePlay(storageOf(deps));
    try {
      void (deps.notifier ?? defaultNotifier)()
        .cancelByType('continue_listening')
        .catch(() => undefined);
    } catch {
      // Best effort: the next sync cancels it.
    }
  }
  // ON again: the last play of the process gets its notice now.
  if (!previous.continue_listening && next.continue_listening) {
    const lastPlay = state.lastPlay;
    if (lastPlay) handlePlayStart(lastPlay.track, lastPlay.at);
  }
}

function handleAppActive(): void {
  if (!state.ready) return;
  const now = (state.deps.now ?? Date.now)();
  // After a sync with no permission, each return to the app syncs: the user
  // can come back from the system settings or the system dialog.
  if (
    !state.lastSyncNotGranted &&
    now - state.lastForegroundSync < FOREGROUND_SYNC_MIN_MS
  ) {
    return;
  }
  state.lastForegroundSync = now;
  void (state.deps.sync ?? defaultSync)('foreground').catch(() => undefined);
}

/** A sync ended (`notificationsSync.ts`): the M2 replay and the L4 state. */
function handleSynced(result: SyncOutcome): void {
  const granted = !result.holdout && result.permission === 'granted';
  state.lastSyncNotGranted = !result.holdout && !granted;
  if (!granted) return;
  state.grantedSyncs += 1;
  if (!state.ready || !REPLAY_REASONS.has(result.reason)) return;
  const lastPlay = state.lastPlay;
  if (lastPlay) handlePlayStart(lastPlay.track, lastPlay.at);
}

/**
 * Starts the subscriptions (see the file header), once in a process. Returns
 * the stop function. Never throws.
 */
export function startNotificationScheduling(
  deps: NotificationSchedulingDeps = {},
): () => void {
  if (state.stop) return state.stop;
  state.deps = deps;
  const now = deps.now ?? Date.now;
  const unsubscribers: (() => void)[] = [];
  try {
    unsubscribers.push(
      (deps.subscribePlayStarts ?? subscribePlayerPlayStarts)(track =>
        handlePlayStart(track, now()),
      ),
      (deps.subscribePrefs ?? subscribeNotificationPrefs)(handlePrefsChange),
      (deps.subscribeAppActive ?? subscribeAppStateActive)(handleAppActive),
      (deps.subscribeSynced ?? defaultSubscribeSynced)(handleSynced),
    );
  } catch (error) {
    if (__DEV__) {
      console.warn('[notifications] the scheduling did not start', error);
    }
  }
  const stop = (): void => {
    unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
    state.stop = null;
    state.ready = false;
  };
  state.stop = stop;
  return stop;
}

/**
 * The boot step ran: from now on the subscriptions act. A play start that
 * came before is handled now. Else the stored play gets its notice again
 * when its time is still in the future (TECH_DEBT #330, see the file header).
 * The boot sync already read the switches and the permission, so the
 * foreground sync waits `FOREGROUND_SYNC_MIN_MS`.
 */
export function setNotificationSchedulingReady(): void {
  if (state.ready) return;
  state.ready = true;
  state.lastForegroundSync = (state.deps.now ?? Date.now)();
  const pending = state.pendingPlay;
  state.pendingPlay = null;
  if (pending) {
    handlePlayStart(pending.track, pending.at);
    return;
  }
  restoreContinueListening();
}

/** Tests only. */
export function __resetNotificationSchedulingForTests(): void {
  state.stop?.();
  state.ready = false;
  state.pendingPlay = null;
  state.lastPlay = null;
  state.lastScheduled = null;
  state.lastForegroundSync = 0;
  state.lastSyncNotGranted = false;
  state.grantedSyncs = 0;
  state.stop = null;
  state.deps = {};
}
