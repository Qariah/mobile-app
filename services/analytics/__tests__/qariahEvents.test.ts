// @ai Qariah (TECH_DEBT #243) — the Qariah events moved out of the upstream
// events.ts / AnalyticsService.ts. These tests pin the PostHog event names
// (the triage scripts and the dashboards match on them) and the route: every
// track function sends its event through captureDiagnosticEvent, so the
// dev/simulator drop and the consent gate still apply.

const mockCaptureDiagnosticEvent = jest.fn();
jest.mock('../AnalyticsService', () => ({
  analyticsService: {
    captureDiagnosticEvent: (...args: unknown[]) =>
      mockCaptureDiagnosticEvent(...args),
  },
}));

import {QARIAH_ANALYTICS_EVENTS, qariahAnalytics} from '../qariahEvents';

// Each track function and the event name it must send.
const TRACKS: Array<[keyof typeof qariahAnalytics, string]> = [
  ['trackOnboardingStarted', 'onboarding_started'],
  ['trackOnboardingStepViewed', 'onboarding_step_viewed'],
  ['trackOnboardingCompleted', 'onboarding_completed'],
  ['trackOnboardingSkipped', 'onboarding_skipped'],
  ['trackReciterProfileSurahsStalled', 'reciter_profile_surahs_stalled'],
  ['trackReciterProfileSurahsRendered', 'reciter_profile_surahs_rendered'],
  ['trackBootNotCompleted', 'boot_not_completed'],
  ['trackSplashHidden', 'splash_hidden'],
  ['trackSplashStalled', 'splash_stalled'],
  ['trackPlaybackKilledInBackground', 'playback_killed_in_background'],
  ['trackDeepLinkDropped', 'deeplink_dropped'],
  ['trackColdStartBegan', 'cold_start_began'],
  ['trackBootSplashFlagResolved', 'boot_splash_flag_resolved'],
  ['trackBootRiskEnrolled', 'boot_risk_enrolled'],
  ['trackScreenContentStalled', 'screen_content_stalled'],
  ['trackScreenContentRendered', 'screen_content_rendered'],
  ['trackPlaybackStoppedInBackground', 'playback_stopped_in_background'],
  ['trackV1RestoreChecked', 'v1_restore_checked'],
  ['trackV1RestoreMerged', 'v1_restore_merged'],
  ['trackV1RestoreSkipped', 'v1_restore_skipped'],
  ['trackSignInStarted', 'sign_in_started'],
  ['trackSignInSucceeded', 'sign_in_succeeded'],
  ['trackSignInFailed', 'sign_in_failed'],
  ['trackSignInAbandoned', 'sign_in_abandoned'],
  ['trackVerseNoteCreated', 'verse_note_created'],
  ['trackVerseNoteDeleted', 'verse_note_deleted'],
  ['trackVerseHighlightSet', 'verse_highlight_set'],
  ['trackVerseHighlightRemoved', 'verse_highlight_removed'],
  ['trackVerseBookmarkToggled', 'verse_bookmark_toggled'],
  // Sprint 48 (S48.6): the local notifications.
  ['trackNotificationPermissionPrompted', 'notification_permission_prompted'],
  ['trackNotificationPermissionResult', 'notification_permission_result'],
  ['trackNotificationScheduled', 'notification_scheduled'],
  ['trackNotificationOpened', 'notification_opened'],
];

describe('qariahEvents', () => {
  beforeEach(() => mockCaptureDiagnosticEvent.mockClear());

  it('keeps every Qariah event name', () => {
    expect(Object.values(QARIAH_ANALYTICS_EVENTS).sort()).toEqual(
      TRACKS.map(([, name]) => name).sort(),
    );
  });

  it('has one track function for each event', () => {
    expect(Object.keys(qariahAnalytics).sort()).toEqual(
      TRACKS.map(([fn]) => fn).sort(),
    );
  });

  it.each(TRACKS)(
    '%s sends %s through captureDiagnosticEvent with the props unchanged',
    (fn, name) => {
      const props = {a: 1, b: 'x', c: null, d: true};
      // The props types differ per event; the route is the same for all.
      (qariahAnalytics[fn] as unknown as (p: typeof props) => void)(props);
      expect(mockCaptureDiagnosticEvent).toHaveBeenCalledTimes(1);
      const [event, sent] = mockCaptureDiagnosticEvent.mock.calls[0];
      expect(event).toBe(name);
      expect(sent).toEqual(props);
      // A copy, as AnalyticsService's `{...props}` was.
      expect(sent).not.toBe(props);
    },
  );
});
