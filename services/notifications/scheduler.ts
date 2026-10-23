// @ai-generated
// Qariah (Sprint 48, S48.6): which notification to send, and the candidates.
import type {Reciter} from '@/data/reciterData';
import {listRecitations, type RecitationEntry} from './catalogDiff';
import type {
  NotificationCandidate,
  NotificationTextKey,
  NotificationTrigger,
  NotificationType,
  NotificationTypePrefs,
  RecitationKey,
} from './types';

/** The order when two types compete for the one notice of a day (the plan: 1, 5, 2, 3, 4). */
export const NOTIFICATION_PRIORITY: readonly NotificationType[] = [
  'followed_recitation',
  'whats_new',
  'new_recitation',
  'kahf_friday',
  'continue_listening',
];

/**
 * This many new recitations of one type, or more, give ONE summary notice.
 * With one notice each day, a lower number than 2 would lose the other
 * recitations of the group (owner decision, Sprint 48 Task 14 review).
 */
export const RECITATION_SUMMARY_MIN_COUNT = 2;

/** The surah of the Friday reminder. */
export const KAHF_SURAH = 18;

/** Each Friday at 09:00 local time (expo-notifications weekday 6 = Friday). */
export const KAHF_FRIDAY_TRIGGER: NotificationTrigger = {
  kind: 'weekly',
  weekday: 6,
  hour: 9,
  minute: 0,
};

/** "Continue listening" comes this many days after the last play. */
export const CONTINUE_LISTENING_DELAY_DAYS = 3;

/**
 * The day window of "continue listening" (controller decision 2026-10-20,
 * review of Task 16): a play before 09:00 gives a notice at 09:00; a play at
 * or after 21:00 gives a notice at 20:00; any other play, the same local time.
 */
export const CONTINUE_LISTENING_EARLIEST_HOUR = 9;
export const CONTINUE_LISTENING_LATE_PLAY_HOUR = 21;
export const CONTINUE_LISTENING_LATE_NOTICE_HOUR = 20;

export {localDay} from './localDay';

export interface PickNotificationInput {
  candidates: readonly NotificationCandidate[];
  prefs: NotificationTypePrefs;
  permissionGranted: boolean;
  /**
   * The user is in the `local_notifications_holdout` arm. Pass `true` when the
   * arm is not known yet: a holdout user must never get a notice.
   */
  holdout: boolean;
  /** `localDay()` of now. */
  todayLocal: string;
  /** The day of the last posted notice (`useNotificationPrefsStore`). */
  lastNotifiedDay: string | null;
}

/**
 * At most ONE candidate for the day: the first candidate of the first type in
 * `NOTIFICATION_PRIORITY` whose toggle is on. Nothing for a holdout user,
 * without permission, or when a notice already went out today. Among
 * candidates of one type, the first one wins (the builders put the newest
 * first).
 */
export function pickNotification(
  input: PickNotificationInput,
): NotificationCandidate | null {
  const {candidates, prefs, permissionGranted, holdout} = input;
  if (holdout || !permissionGranted) return null;
  if (input.lastNotifiedDay === input.todayLocal) return null;
  for (const type of NOTIFICATION_PRIORITY) {
    // Strict: a missing value is OFF.
    if (prefs[type] !== true) continue;
    const candidate = candidates.find(c => c.type === type);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * The recitation keys that this check holds back: the `coveredKeys` of each
 * candidate that was not picked, but that a later check can still post (its
 * toggle is on, and it lost to the order or to the daily limit). Leave these
 * keys out of the saved snapshot (`snapshotAfter`), so the next check finds
 * them again.
 *
 * The keys of a candidate whose toggle is off, and every key when the user is
 * in the holdout or has no permission, are dropped on purpose: they go into the
 * snapshot, so a later "on" does not announce old recitations.
 */
export function heldBackKeys(
  input: PickNotificationInput,
  picked: NotificationCandidate | null,
): RecitationKey[] {
  if (input.holdout || !input.permissionGranted) return [];
  const out: RecitationKey[] = [];
  for (const candidate of input.candidates) {
    if (candidate === picked) continue;
    if (input.prefs[candidate.type] !== true) continue;
    out.push(...candidate.coveredKeys);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The recitation candidates

type RecitationType = 'followed_recitation' | 'new_recitation';

const RECITATION_TEXT: Record<
  RecitationType,
  {
    title: NotificationTextKey;
    body: NotificationTextKey;
    bodyRange: NotificationTextKey;
    summaryTitle: NotificationTextKey;
    summaryBody: NotificationTextKey;
  }
> = {
  followed_recitation: {
    title: 'qariah:notifications.followedRecitation.title',
    body: 'qariah:notifications.followedRecitation.body',
    bodyRange: 'qariah:notifications.followedRecitation.bodyRange',
    summaryTitle: 'qariah:notifications.followedRecitationSummary.title',
    summaryBody: 'qariah:notifications.followedRecitationSummary.body',
  },
  new_recitation: {
    title: 'qariah:notifications.newRecitation.title',
    body: 'qariah:notifications.newRecitation.body',
    bodyRange: 'qariah:notifications.newRecitation.bodyRange',
    summaryTitle: 'qariah:notifications.newRecitationSummary.title',
    summaryBody: 'qariah:notifications.newRecitationSummary.body',
  },
};

export interface BuildRecitationCandidatesInput {
  /** From `diffCatalog`. */
  newKeys: readonly RecitationKey[];
  /** The catalog that `newKeys` came from. */
  reciters: readonly Reciter[];
  /** `useFavoriteRecitersStore.getState().favoriteReciterIds` ("follow" = favorite). */
  favoriteReciterIds: readonly string[];
  /** The reciter name in the app language. Default: the catalog `name`. */
  formatReciterName?: (reciter: Reciter) => string;
  /** The surah name in the app language. Default: the surah number. */
  formatSurahName?: (surah: number) => string;
}

// Plain comparisons, not `localeCompare`: the order must not depend on the ICU
// data of the JS engine (as `getNewlyAddedRecitations`).
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Newest first: `addedAt` (a missing date last), then reciter name, rewayah id, surah. */
function newestFirst(a: RecitationEntry, b: RecitationEntry): number {
  if (a.addedAt !== b.addedAt) {
    if (a.addedAt === undefined) return 1;
    if (b.addedAt === undefined) return -1;
    return compareText(b.addedAt, a.addedAt);
  }
  return (
    compareText(a.reciter.name, b.reciter.name) ||
    compareText(a.rewayah.id, b.rewayah.id) ||
    a.surah - b.surah
  );
}

/**
 * The candidates for the new recitations. A recitation of a favorite reciter
 * gives a `followed_recitation` candidate and nothing else; each other one, a
 * `new_recitation` candidate. So each type gives one candidate:
 * - one recitation: a single candidate that opens the recitation;
 * - `RECITATION_SUMMARY_MIN_COUNT` (2) or more: ONE summary candidate (the
 *   count and the reciter of the newest one in the body, the same params for
 *   both types) that opens the Listen tab and covers each key of the group.
 * A key that is not in `reciters` is skipped.
 */
export function buildRecitationCandidates(
  input: BuildRecitationCandidatesInput,
): NotificationCandidate[] {
  const {
    newKeys,
    reciters,
    favoriteReciterIds,
    formatReciterName = reciter => reciter.name,
    formatSurahName = surah => String(surah),
  } = input;
  if (newKeys.length === 0) return [];

  const wanted = new Set(newKeys);
  const favorites = new Set(favoriteReciterIds);
  const entries = listRecitations(reciters)
    .filter(entry => wanted.has(entry.key))
    .sort(newestFirst);

  const byType: Record<RecitationType, RecitationEntry[]> = {
    followed_recitation: [],
    new_recitation: [],
  };
  for (const entry of entries) {
    byType[
      favorites.has(entry.reciter.id) ? 'followed_recitation' : 'new_recitation'
    ].push(entry);
  }

  const out: NotificationCandidate[] = [];
  for (const type of ['followed_recitation', 'new_recitation'] as const) {
    const group = byType[type];
    if (group.length === 0) continue;
    const text = RECITATION_TEXT[type];

    if (group.length >= RECITATION_SUMMARY_MIN_COUNT) {
      const newest = group[0];
      const reciterName = formatReciterName(newest.reciter);
      const count = group.length;
      out.push({
        type,
        title: {key: text.summaryTitle},
        body: {key: text.summaryBody, params: {count, reciterName}},
        target: {kind: 'listen'},
        dedupeKey: `${type}:summary:${count}:${newest.key}`,
        coveredKeys: group.map(entry => entry.key),
      });
      continue;
    }

    // One recitation of this type.
    const [entry] = group;
    const surahName = formatSurahName(entry.surah);
    const reciterName = formatReciterName(entry.reciter);
    out.push({
      type,
      title: {key: text.title, params: {reciterName}},
      body: entry.range
        ? {
            key: text.bodyRange,
            params: {
              surahName,
              reciterName,
              from: entry.range.from,
              to: entry.range.to,
            },
          }
        : {key: text.body, params: {surahName, reciterName}},
      target: {
        kind: 'recitation',
        reciterId: entry.reciter.id,
        reciterSlug: entry.reciter.slug ?? null,
        rewayahId: entry.rewayah.id,
        surah: entry.surah,
      },
      dedupeKey: `${type}:${entry.key}`,
      coveredKeys: [entry.key],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scheduled types

/** The Friday Al-Kahf reminder. A tap opens the recitations of surah 18. */
export function kahfFridayCandidate(): NotificationCandidate {
  return {
    type: 'kahf_friday',
    title: {key: 'qariah:notifications.kahfFriday.title'},
    body: {key: 'qariah:notifications.kahfFriday.body'},
    target: {kind: 'surah', surah: KAHF_SURAH},
    dedupeKey: 'kahf_friday',
    coveredKeys: [],
  };
}

/** The track of the last play, in the app language, for the "continue listening" text. */
export interface ContinueListeningText {
  surahName: string;
  reciterName: string;
}

/** "Continue listening". A tap restores the last session. */
export function continueListeningCandidate(
  text: ContinueListeningText,
): NotificationCandidate {
  return {
    type: 'continue_listening',
    title: {key: 'qariah:notifications.continueListening.title'},
    body: {
      key: 'qariah:notifications.continueListening.body',
      params: {surahName: text.surahName, reciterName: text.reciterName},
    },
    target: {kind: 'continue_listening'},
    dedupeKey: 'continue_listening',
    coveredKeys: [],
  };
}

/**
 * `CONTINUE_LISTENING_DELAY_DAYS` calendar days after the last play, at the
 * same local time of day, inside the day window: a play before 09:00 gives
 * 09:00, a play at or after 21:00 gives 20:00. It adds calendar days, not 72
 * hours, so a change to or from summer time does not move the time of day.
 */
export function continueListeningTrigger(
  lastPlayAt: Date | number,
): Extract<NotificationTrigger, {kind: 'date'}> {
  const played = new Date(lastPlayAt);
  const at = new Date(played);
  at.setDate(at.getDate() + CONTINUE_LISTENING_DELAY_DAYS);
  const hour = played.getHours();
  if (hour < CONTINUE_LISTENING_EARLIEST_HOUR) {
    at.setHours(CONTINUE_LISTENING_EARLIEST_HOUR, 0, 0, 0);
  } else if (hour >= CONTINUE_LISTENING_LATE_PLAY_HOUR) {
    at.setHours(CONTINUE_LISTENING_LATE_NOTICE_HOUR, 0, 0, 0);
  }
  return {kind: 'date', at: at.getTime()};
}
