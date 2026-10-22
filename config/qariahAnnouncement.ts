// @ai-generated
// Qariah (Sprint 48, S48.8): the "new features in this build" announcement.
//
// The id of the announcement that this build makes, or `null` for a build
// that announces nothing.
//
// - The format is `YYYY-MM-<slug>` (for example `2026-10-sprint48`): the year
//   and the month first, so a newer id sorts after an older one. An id that
//   sorts before the last recorded id (an older build installed over a newer
//   one) announces nothing (`announcementAction` in
//   `services/notifications/announcement.ts`).
// - An id, not the app version: the internal betas all have the same version,
//   so only a new id tells two builds apart.
// - A new id in a build announces once, and only after an upgrade (never after
//   a fresh install). When the user opens the app first, the app records the
//   id, and on a minor or major upgrade the update pages
//   (`data/qariahReleasePages.ts`) show the news. The background task posts
//   the `whats_new` notice only for a user who has not opened the new build.
// - Each id needs its text in the `qariah` namespace, in English and in Arabic:
//   `qariah:announcement.<id>.title` (the notice title, at most 40
//   characters) and `qariah:announcement.<id>.body` (at most 100 characters),
//   with no `{{placeholder}}` (the notice passes no params). Add the rows to
//   the review pack (`planning/pass-c/arabic-review/ui-strings.csv`, section
//   P), then run `node scripts/i18n-qariah-from-review.mjs`. A unit test
//   (`config/__tests__/qariahAnnouncement.test.ts`) fails when a text is
//   missing or too long.
//
// - The id of the release build must sort after every beta id. A beta records
//   its id, so a beta tester who installs a release with an older or the same
//   id gets no announcement (production users still get it). The test fails
//   for an id before '2026-10-sprint48', the first id.
//
// DRAFT: the owner approves the text at GATE 2, and sets the id for the
// release build.
export const QARIAH_ANNOUNCEMENT_ID: string | null = '2026-10-sprint48';
