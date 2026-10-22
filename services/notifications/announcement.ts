// @ai-generated
// Qariah (Sprint 48, S48.8): the "new features in this build" rule.
//
// `config/qariahAnnouncement.ts` (Task 18) gives the id of the announcement of
// this build, or `null`. An id, not the version: the internal betas all have
// the version 3.2.2, so only a new id tells two builds apart. A new id
// announces once.
//
// The id format: `YYYY-MM-<slug>` (for example `2026-10-sprint48`), so a newer
// announcement has an id that sorts after an older one. A build with an id that
// sorts BEFORE the last recorded id (an older build installed over a newer one)
// announces nothing and records nothing.
import type {AnnouncementTextKey, NotificationCandidate} from './types';

export type AnnouncementContext = 'foreground' | 'background';

/**
 * - `none`: nothing to do.
 * - `record`: keep `currentId` as the last announced id; post nothing.
 * - `record_and_cancel_pending`: keep the id and cancel a pending `whats_new`
 *   notice (the user opened the app; on a real upgrade the update pages show,
 *   so the user never gets both).
 * - `candidate`: give `whatsNewCandidate(currentId)` to `pickNotification`.
 *   Keep the id only AFTER the notice posts. When it does not post (the toggle
 *   is off, no permission, the holdout, the daily limit), keep nothing: a later
 *   background run can try again, and the next foreground start records it.
 */
export type AnnouncementAction =
  | 'none'
  | 'record'
  | 'record_and_cancel_pending'
  | 'candidate';

export interface AnnouncementActionInput {
  /** The id of this build's announcement (`YYYY-MM-<slug>`), or `null` for no announcement. */
  currentId: string | null;
  /** The last id that the app recorded (MMKV), or `null`. */
  lastAnnouncedId: string | null;
  /**
   * The first start after an install. Find it from a value that an earlier
   * build wrote (for example the last seen app version), NOT from
   * `lastAnnouncedId`: the upgrade to the first build with announcements also
   * has no `lastAnnouncedId`, and that upgrade must announce.
   */
  isFreshInstall: boolean;
  context: AnnouncementContext;
}

/** The S48.8 rule, for each start of the new binary. */
export function announcementAction(
  input: AnnouncementActionInput,
): AnnouncementAction {
  const {currentId, lastAnnouncedId, isFreshInstall, context} = input;
  if (!currentId) return 'none';
  if (currentId === lastAnnouncedId) return 'none';
  // An older announcement (a downgrade): keep the newer recorded id.
  if (lastAnnouncedId && currentId < lastAnnouncedId) return 'none';
  // Only an upgrade announces.
  if (isFreshInstall) return 'record';
  return context === 'foreground' ? 'record_and_cancel_pending' : 'candidate';
}

/**
 * The id format (`YYYY-MM-<slug>`; the slug is lower-case letters, digits and
 * dashes). Ids in this format sort by date.
 */
export const ANNOUNCEMENT_ID_FORMAT =
  /^\d{4}-(0[1-9]|1[0-2])-[a-z0-9]+(-[a-z0-9]+)*$/;

/** The i18n keys of the title and the body of an announcement. */
export function announcementTextKeys(announcementId: string): {
  title: AnnouncementTextKey;
  body: AnnouncementTextKey;
} {
  return {
    title: `qariah:announcement.${announcementId}.title`,
    body: `qariah:announcement.${announcementId}.body`,
  };
}

/** The `whats_new` notice of an announcement id. A tap opens the app (the Listen tab). */
export function whatsNewCandidate(
  announcementId: string,
): NotificationCandidate {
  const keys = announcementTextKeys(announcementId);
  return {
    type: 'whats_new',
    title: {key: keys.title},
    body: {key: keys.body},
    target: {kind: 'listen'},
    dedupeKey: `whats_new:${announcementId}`,
    coveredKeys: [],
  };
}

/**
 * The `whats_new` candidate of the background task, or `null` when this start
 * announces nothing (no id, the same id, an older id, or a fresh install).
 *
 * Give the candidate to `runCatalogCheck` as an `extraCandidates` entry (or to
 * `pickNotification`), so the toggle, the permission, the holdout and the
 * daily limit apply. The title and the body are i18n keys: the renderer
 * (Task 15) localizes them at post time, in the app language of that moment.
 * Record the id (`writeLastAnnouncedId`) only after the notice posts.
 */
export function announcementCandidate(
  input: Omit<AnnouncementActionInput, 'context'>,
): NotificationCandidate | null {
  if (announcementAction({...input, context: 'background'}) !== 'candidate') {
    return null;
  }
  return input.currentId ? whatsNewCandidate(input.currentId) : null;
}
