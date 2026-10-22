// @ai-generated
// Qariah (Sprint 48, S48.6): the types of the local-notification engine.
//
// This module and the other pure modules in this folder make no native call.
// The native side (`expo-notifications`, `expo-background-task`) comes in
// through the `Notifier` interface below (Task 15).

/**
 * The five notification types. The order of this list is NOT the priority;
 * the priority is `NOTIFICATION_PRIORITY` in `scheduler.ts`.
 */
export const NOTIFICATION_TYPES = [
  'followed_recitation',
  'new_recitation',
  'kahf_friday',
  'continue_listening',
  'whats_new',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** One on/off toggle for each type (the Notifications settings page, S48.7). */
export type NotificationTypePrefs = Record<NotificationType, boolean>;

/**
 * One recitation: `reciterId|rewayahId|surah|from|to`. `from` and `to` are
 * empty for a complete surah (`r1|w1|18||`).
 *
 * The rule is the one of `scripts/catalog-added-at.mjs` (`rangeKey`) and of the
 * ops console: the FIRST `surah_metadata` row of a listed surah gives its
 * range, and the row is partial only with `is_full === false` and a `range`.
 * No row, or any other row, is a complete surah. So a range change is a new
 * recitation.
 */
export type RecitationKey = string;

/**
 * The i18n keys that the engine uses (the `qariah` namespace). The strings
 * come from the review pack (section P of
 * `planning/pass-c/arabic-review/ui-strings.csv`, then
 * `scripts/i18n-qariah-from-review.mjs`); never type them by hand.
 *
 * The params of each key (`count` keys are plural keys: `_one`/`_other` in
 * English, the six forms in Arabic). The renderer (`expoNotifier.ts`) adds
 * `{{appName}}` to every key, so a text can name the app:
 * - `followedRecitation.title`, `newRecitation.title`: `{{reciterName}}`.
 * - `followedRecitation.body`, `newRecitation.body`: `{{surahName}}`,
 *   `{{reciterName}}`.
 * - `followedRecitation.bodyRange`, `newRecitation.bodyRange`: `{{surahName}}`,
 *   `{{reciterName}}`, `{{from}}`, `{{to}}` (a partial recording).
 * - `followedRecitationSummary.title`, `newRecitationSummary.title`: no params.
 * - `followedRecitationSummary.body`, `newRecitationSummary.body`:
 *   `{{count}}`, `{{reciterName}}`.
 * - `kahfFriday.*`, `continueListening.title`: no params.
 * - `continueListening.body`: `{{surahName}}`, `{{reciterName}}` (the track
 *   of the last play).
 *
 * In the summaries, `reciterName` is the reciter of the newest recitation.
 * A text may leave out a param that the engine passes.
 *
 * The `whats_new` text is not in this list: it is
 * `qariah:announcement.<id>.title` and `.body` (S48.8, `config/qariahAnnouncement.ts`).
 */
export const NOTIFICATION_TEXT_KEYS = [
  'qariah:notifications.followedRecitation.title',
  'qariah:notifications.followedRecitation.body',
  'qariah:notifications.followedRecitation.bodyRange',
  'qariah:notifications.followedRecitationSummary.title',
  'qariah:notifications.followedRecitationSummary.body',
  'qariah:notifications.newRecitation.title',
  'qariah:notifications.newRecitation.body',
  'qariah:notifications.newRecitation.bodyRange',
  'qariah:notifications.newRecitationSummary.title',
  'qariah:notifications.newRecitationSummary.body',
  'qariah:notifications.kahfFriday.title',
  'qariah:notifications.kahfFriday.body',
  'qariah:notifications.continueListening.title',
  'qariah:notifications.continueListening.body',
] as const;

export type NotificationTextKey = (typeof NOTIFICATION_TEXT_KEYS)[number];

/** The announcement text of S48.8. */
export type AnnouncementTextKey =
  | `qariah:announcement.${string}.title`
  | `qariah:announcement.${string}.body`;

/**
 * The text of a title or a body: an i18n key with its params, or a literal
 * text. The renderer (Task 15) calls `i18n.t(key, params)` at post time, so the
 * text is in the app language of that moment.
 */
export type NotificationText =
  | {
      key: NotificationTextKey | AnnouncementTextKey;
      params?: Record<string, string | number>;
    }
  | {text: string};

/** The screen that a tap opens (`tapRouter.ts` maps each kind to a route). */
export type NotificationTarget =
  /** `qariah://reciter/<slug>/<surah>?rewayah=<id>`. `reciterSlug` can be null in the catalog. */
  | {
      kind: 'recitation';
      reciterId: string;
      reciterSlug: string | null;
      rewayahId: string;
      surah: number;
    }
  /** The recitations of one surah (Browse by Surah); the Al-Kahf reminder uses 18. */
  | {kind: 'surah'; surah: number}
  /** Restore the last listening session. */
  | {kind: 'continue_listening'}
  /** The Listen tab (the summaries and `whats_new`). */
  | {kind: 'listen'};

export interface NotificationCandidate {
  type: NotificationType;
  title: NotificationText;
  body?: NotificationText;
  target: NotificationTarget;
  /**
   * A stable id for this one notice. Two candidates with the same key are the
   * same notice: the notifier uses it as the notification id, so a second post
   * replaces the first and does not add a second one.
   */
  dedupeKey: string;
  /**
   * The recitation keys that this notice announces: one key for a single
   * recitation, each key of the group for a summary, none for the other types.
   * The keys of a candidate that the daily limit or the order holds back stay
   * out of the saved snapshot (`snapshotAfter`), so the next check finds them
   * again.
   */
  coveredKeys: RecitationKey[];
}

/**
 * When a scheduled notification fires.
 * - `immediate`: now (the background check posts).
 * - `date`: once, at `at` (epoch milliseconds).
 * - `weekly`: each week on `weekday` at `hour:minute` local time. `weekday` uses
 *   the expo-notifications numbers: 1 = Sunday … 7 = Saturday (Friday = 6).
 */
export type NotificationTrigger =
  | {kind: 'immediate'}
  | {kind: 'date'; at: number}
  | {kind: 'weekly'; weekday: number; hour: number; minute: number};

export type NotificationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'undetermined';

/**
 * The native side, injected. Task 15 implements it with `expo-notifications`;
 * the tests use a fake.
 */
export interface Notifier {
  /** Schedules (or posts) the candidate. Resolves with the notification id. */
  schedule(
    candidate: NotificationCandidate,
    trigger: NotificationTrigger,
  ): Promise<string>;
  cancel(id: string): Promise<void>;
  /** Cancels each scheduled notification of the type. */
  cancelByType(type: NotificationType): Promise<void>;
  getPermission(): Promise<NotificationPermissionStatus>;
  /**
   * The scheduled (not yet shown) notifications of this engine: the id and
   * the `type` in their data (`null` for a notification of another sender).
   */
  listScheduled?(): Promise<{id: string; type: string | null}[]>;
  /** Removes a shown notification from the notification list. */
  dismissDelivered?(id: string): Promise<void>;
}

/** The part of MMKV that the engine uses, so a test can pass a fake. */
export interface KeyValueStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  /**
   * `false` when the storage did not open (MMKV can throw at creation). When
   * the method is missing, the storage counts as available.
   */
  isAvailable?(): boolean;
}

/** The preferences that a check reads (`useNotificationPrefsStore` state). */
export interface NotificationPrefsSnapshot extends NotificationTypePrefs {
  lastNotifiedDay: string | null;
}

/**
 * The preferences for a check, injected. `prefsStore.ts` gives the app's
 * source (`notificationPrefsSource`); the tests use a fake.
 */
export interface NotificationPrefsSource {
  /** The stored preferences, or `null` when they could not be read: then post nothing. */
  read(): Promise<NotificationPrefsSnapshot | null>;
  /** Records the local day of `now` as the day of the last notice. `false` when it could not. */
  markNotifiedToday(now: Date): Promise<boolean>;
}
