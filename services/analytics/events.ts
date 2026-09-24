export const ANALYTICS_EVENTS = {
  // Listening
  PLAYBACK_STARTED: 'playback_started',
  PLAYBACK_PAUSED: 'playback_paused',
  PLAYBACK_RESUMED: 'playback_resumed',
  PLAYBACK_COMPLETED: 'playback_completed',
  PLAYBACK_SKIPPED: 'playback_skipped',
  PLAYBACK_SEEKED: 'playback_seeked',
  MEANINGFUL_LISTEN: 'meaningful_listen',
  RATE_CHANGED: 'rate_changed',
  QUEUE_MODIFIED: 'queue_modified',
  // Mushaf
  MUSHAF_PAGE_OPENED: 'mushaf_page_opened',
  MUSHAF_PAGE_READ: 'mushaf_page_read',
  MUSHAF_SESSION_ENDED: 'mushaf_session_ended',
  // Adhkar
  ADHKAR_SESSION_STARTED: 'adhkar_session_started',
  ADHKAR_SESSION_COMPLETED: 'adhkar_session_completed',
  TASBEEH_COMPLETED: 'tasbeeh_completed',
  // Feature usage
  RECITER_SELECTED: 'reciter_selected',
  REWAYAH_CHANGED: 'rewayah_changed',
  DOWNLOAD_STARTED: 'download_started',
  DOWNLOAD_COMPLETED: 'download_completed',
  AMBIENT_TOGGLED: 'ambient_toggled',
  FAVORITE_TOGGLED: 'favorite_toggled',
  PLAYLIST_MODIFIED: 'playlist_modified',
  SHARE_CREATED: 'share_created',
  SEARCH_PERFORMED: 'search_performed',
  TRANSLATION_VIEWED: 'translation_viewed',
  // Onboarding funnel (Sprint 35 S35.3 — Growth: D7=5%, 49% never tap a reciter,
  // and onboarding was entirely uninstrumented). First-run flow index→sign-in→done.
  // Activation is the existing MEANINGFUL_LISTEN event (the Growth-chosen marker);
  // these add the top-of-funnel discovery view the funnel was missing.
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_STEP_VIEWED: 'onboarding_step_viewed',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  ONBOARDING_SKIPPED: 'onboarding_skipped',
  // Lifecycle
  APP_OPENED: 'app_opened',
  APP_BACKGROUNDED: 'app_backgrounded',
  // @ai Silent-hang detection (REPORT-ONLY observability — Samsung "can't use the
  // app" classes, planning/observability-gap-samsung-hang-2026-06-08.md). These
  // are discrete fault/success signals, NOT ratios; the posthog-triage discrete-
  // fault tripwire files on ANY occurrence of the *_STALLED / *_NOT_COMPLETED /
  // SPLASH_STALLED events on the latest build (zero volume floor).
  RECITER_PROFILE_SURAHS_STALLED: 'reciter_profile_surahs_stalled',
  RECITER_PROFILE_SURAHS_RENDERED: 'reciter_profile_surahs_rendered',
  BOOT_NOT_COMPLETED: 'boot_not_completed',
  SPLASH_HIDDEN: 'splash_hidden',
  SPLASH_STALLED: 'splash_stalled',
  PLAYBACK_KILLED_IN_BACKGROUND: 'playback_killed_in_background',
  PLAYBACK_STOPPED_IN_BACKGROUND: 'playback_stopped_in_background',
  DEEPLINK_DROPPED: 'deeplink_dropped',
  // @ai Boot/first-screen content-readiness observability (the post-boot hang
  // class — a screen mounts but its content spinner never resolves, e.g. the
  // restored Mushaf screen stuck on the DigitalKhatt-init spinner. Boot succeeds
  // + splash hides, so every boot-level instrument reports success and is blind).
  // Same discrete fault + companion success shape as the *_STALLED pair above.
  COLD_START_BEGAN: 'cold_start_began',
  SCREEN_CONTENT_STALLED: 'screen_content_stalled',
  SCREEN_CONTENT_RENDERED: 'screen_content_rendered',
  // @ai v1 → v2 favorites restore funnel. The 3.2.0 rollout's declared PRIMARY
  // risk signal (~1,573 v1 users get their favorites back only on QF sign-in)
  // was effectively UNINSTRUMENTED: the sole instrument was a Sentry
  // captureException that fires only on a THROW, so the exact failure we fear —
  // modal shows, user taps Restore, 0 items merge, nothing throws — emitted
  // nothing anywhere, and a zero in Sentry meant "unobserved", not "healthy".
  // Every value below was already computed, typed, and then DISCARDED; these
  // events emit what existed rather than measuring anything new.
  V1_RESTORE_CHECKED: 'v1_restore_checked',
  V1_RESTORE_MERGED: 'v1_restore_merged',
  V1_RESTORE_SKIPPED: 'v1_restore_skipped',
  // @ai Sign-in funnel. The v1→v2 restore events above only fire AFTER a
  // successful QF sign-in, so without these a user who never gets through
  // sign-in is indistinguishable from one who had nothing to restore — the
  // migration's largest drop-off was structurally invisible. Derived by
  // OBSERVING AuthContext's existing `status` + `lastError`; neither
  // AuthContext nor qfOAuth is modified (see services/analytics/AuthTelemetry).
  SIGN_IN_STARTED: 'sign_in_started',
  SIGN_IN_SUCCEEDED: 'sign_in_succeeded',
  SIGN_IN_FAILED: 'sign_in_failed',
  SIGN_IN_ABANDONED: 'sign_in_abandoned',
} as const;

export interface PlaybackStartedProps {
  surah_id: number;
  reciter_id: string;
  reciter_name: string;
  rewayah_id: string;
  source: 'queue' | 'direct' | 'autoplay' | 'playlist';
  position_ms: number;
}

export interface PlaybackPausedProps {
  surah_id: number;
  reciter_id: string;
  reciter_name: string;
  position_ms: number;
  listened_ms: number;
}

export interface PlaybackResumedProps {
  surah_id: number;
  reciter_id: string;
  reciter_name: string;
  position_ms: number;
}

export interface PlaybackCompletedProps {
  surah_id: number;
  reciter_id: string;
  reciter_name: string;
  duration_ms: number;
  listened_ms: number;
  completion_pct: number;
}

export interface PlaybackSkippedProps {
  surah_id: number;
  reciter_id: string;
  reciter_name: string;
  position_ms: number;
  listened_ms: number;
  direction: 'next' | 'prev';
}

export interface PlaybackSeekedProps {
  surah_id: number;
  from_ms: number;
  to_ms: number;
}

export interface MeaningfulListenProps {
  surah_id: number;
  reciter_id: string;
  reciter_name: string;
  rewayah_id: string;
}

export interface RateChangedProps {
  old_rate: number;
  new_rate: number;
}

export interface QueueModifiedProps {
  action: 'add' | 'remove' | 'reorder';
  surah_id: number;
  queue_length: number;
}

export interface MushafPageOpenedProps {
  page_number: number;
  surah_id: number;
  juz_number: number;
}

export interface MushafPageReadProps {
  page_number: number;
  duration_ms: number;
  surah_id: number;
}

export interface MushafSessionEndedProps {
  pages_opened: number;
  pages_read: number;
  total_duration_ms: number;
}

export interface AdhkarSessionStartedProps {
  category: string;
}

export interface AdhkarSessionCompletedProps {
  category: string;
  duration_ms: number;
  dhikr_count: number;
}

export interface TasbeehCompletedProps {
  category: string;
  count: number;
}

export interface ReciterSelectedProps {
  reciter_id: string;
  reciter_name: string;
}

export interface RewayahChangedProps {
  rewayah_id: string;
  rewayah_name: string;
}

export interface DownloadStartedProps {
  surah_id: number;
  reciter_id: string;
}

export interface DownloadCompletedProps {
  surah_id: number;
  reciter_id: string;
  file_size_bytes: number;
}

export interface AmbientToggledProps {
  sound_type: string;
  enabled: boolean;
}

export interface FavoriteToggledProps {
  surah_id: number;
  reciter_id: string;
  action: 'add' | 'remove';
}

export interface PlaylistModifiedProps {
  action: 'create' | 'add_track' | 'remove_track';
  track_count: number;
}

export interface ShareCreatedProps {
  content_type: 'verse' | 'surah' | 'mushaf' | 'reciter' | 'adhkar';
  surah_id?: number;
}

export interface SearchPerformedProps {
  query: string;
  results_count: number;
}

export interface TranslationViewedProps {
  translation_id: string;
  language: string;
}

export interface AppBackgroundedProps {
  session_duration_ms: number;
  total_listen_ms: number;
}

// --- Onboarding funnel (S35.3) ---

/** First-run onboarding flow entered (the welcome screen mounted). Fired once. */
export interface OnboardingStartedProps {
  platform: string;
}

/** A single onboarding step was viewed — top-of-funnel drop-off per step. */
export interface OnboardingStepViewedProps {
  step: 'welcome' | 'sign_in';
  step_index: number;
}

/** Onboarding finished (reached `done`) — the user is now in the app. */
export interface OnboardingCompletedProps {
  signed_in: boolean;
  /** Whether the first-run reciter-discovery nudge fired (onboardingReciterNudge). */
  reciter_nudge: boolean;
}

/** The user skipped the sign-in step (chose "Skip for now" rather than signing
 *  in). Onboarding still COMPLETES; this measures the sign-in-skip rate. */
export interface OnboardingSkippedProps {
  step: 'sign_in';
}

// @ai REPORT-ONLY silent-hang detection props.

/** Reciter-profile surah list still in the skeleton state after the watchdog
 *  budget — the `neighborsReady` gate never lifted (2026-06-04 single-tab class,
 *  TECH_DEBT #114/#115, or a Samsung ScrollView quirk). Fired once per mount. */
export interface ReciterProfileSurahsStalledProps {
  reciter_id: string;
  reciter_name: string | null;
  rewaya_id: string | null;
  tabs_count: number;
  neighbors_ready: boolean;
  pager_scrolled: boolean;
  platform: string;
}

/** Companion success event — the surah list first rendered (gate lifted). Gives
 *  PostHog a denominator so a stall RATE is computable per build. */
export interface ReciterProfileSurahsRenderedProps {
  reciter_id: string;
  rewaya_id: string | null;
  tabs_count: number;
  platform: string;
}

/** A *previous* launch wrote the boot sentinel and never cleared it — the only
 *  signal that survives a hard cold-start hang. Reported on the NEXT launch. */
export interface BootNotCompletedProps {
  failed_version: string;
  failed_build: string;
  detected_at_ms: number;
  /** Furthest boot milestone the wedged launch reached before it died — names
   *  exactly where the hard hang was (e.g. 'catalog-ready', 'session-restored',
   *  or 'ready' = booted-but-first-screen-content never rendered). */
  furthest_step?: string;
}

/** Once-per-process cold-start marker. The correct denominator for the boot
 *  funnel: `app_opened` ALSO fires on every warm `AppState→active` resume (it can
 *  fire 20x/session), so a `splash_hidden / app_opened` ratio massively
 *  over-reports hangs. `cold_start_began` fires exactly once per process at the
 *  first interactive render, so `splash_hidden | screen_content_rendered` over
 *  `cold_start_began` is the true cold-start completion rate. */
export interface ColdStartBeganProps {
  platform: string;
  /** @ai #217 — present only when the previous process that ran the native
   *  main-thread watchdog (Android, diagnostics cohort) left a readable record.
   *  RATE (platform = android) = events with `prev_process_main_thread_stalls`
   *  > 0 ÷ events with `prev_process_watchdog_ran`, grouped by
   *  `prev_process_build` (not by this
   *  event's own build: after an update they differ).
   *  See services/diagnostics/mainThreadStallCount.ts. */
  prev_process_watchdog_ran?: boolean;
  /** The build of that previous process. */
  prev_process_build?: string;
  /** Its stall count, 0 included. */
  prev_process_main_thread_stalls?: number;
}

/** A screen mounted but its content never became ready within the budget — the
 *  post-boot "spinner forever" class (e.g. the restored Mushaf screen stuck on
 *  the DigitalKhatt-init spinner). REPORT-ONLY: fired LIVE once per mount; does
 *  NOT touch the screen's loading logic or force any state. Generic across
 *  screens (the reciter-profile surah list has its own bespoke pair). */
export interface ScreenContentStalledProps {
  screen: string;
  /** What the screen was waiting on when it stalled (e.g. 'digital-khatt-init',
   *  'catalog', 'reciter-fetch') — names the dependency, for triage. */
  awaiting: string;
  elapsed_ms: number;
  /** True when this stall happened on the cold-start restore destination (the
   *  most user-visible "won't open" variant) vs a later in-session navigation. */
  cold: boolean;
  platform: string;
}

/** Companion success — the watched screen's content rendered. Gives the stall a
 *  RATE denominator (stalled / (stalled + rendered)) per build/screen. */
export interface ScreenContentRenderedProps {
  screen: string;
  awaiting: string;
  elapsed_ms: number;
  cold: boolean;
  platform: string;
}

/** Splash actually hidden — success, carries time-to-interactive for charting a
 *  real TTI distribution per build / device tier. */
export interface SplashHiddenProps {
  tti_ms: number;
  platform: string;
}

/** Splash never hidden / app not interactive within the TTI budget. REPORT-ONLY:
 *  the watchdog does NOT force-reveal the app — it only fires this fault. */
export interface SplashStalledProps {
  elapsed_ms: number;
  platform: string;
}

/** A *previous* process died while audio was playing (playback sentinel never
 *  cleared — OEM task-killer kill, user swipe-away, or crash mid-playback).
 *  Reported on the NEXT launch; the only signal that survives the death. */
export interface PlaybackKilledInBackgroundProps {
  surah_id: string | null;
  reciter_id: string | null;
  reciter_name: string | null;
  position_sec: number;
  started_at_ms: number;
  detected_at_ms: number;
}

/** A navigational deep link was received but the router never reached its
 *  target within the budget (#105 — link silently dropped on slow cold start).
 *  REPORT-ONLY: the watchdog never retries or navigates. */
export interface DeepLinkDroppedProps {
  target_path: string;
  pathname_at_check: string;
  cold: boolean;
  elapsed_ms: number;
}

/** Audio was playing, the app was backgrounded, and on return the player was no
 *  longer playing despite no user pause/stop — the OEM stopped the media
 *  foreground service ("app idle" / battery restriction). Distinct from a
 *  whole-process kill (PLAYBACK_KILLED_IN_BACKGROUND): here the PROCESS
 *  survived, so the sentinel never reported it. REPORT-ONLY (S33.2). */
export interface PlaybackStoppedInBackgroundProps {
  surah_id: string | null;
  reciter_id: string | null;
  reciter_name: string | null;
  position_sec: number;
  started_at_ms: number;
  detected_at_ms: number;
}

// --- v1 → v2 favorites restore funnel ---

/** The restore check ran and resolved to one of the 7 union arms of
 *  `RestoreCheckResult`. Fired on EVERY arm, which is the whole point: without
 *  it, "no restores happened" is indistinguishable from "the check never ran".
 *  `kind` is the funnel's top; counts are zero for every non-candidate arm.
 *
 *  PII: carries `reason` (a closed-set coarse code assigned at the construction
 *  site) and `http_status`, NEVER the free-text `detail`. `detail` can embed a
 *  fetch error message containing the request URL, and that URL's path segment
 *  is sha256(email) — the direct lookup key into the public migration bucket.
 *  Zod issue text can likewise echo received values. Neither belongs in
 *  analytics; the coarse code carries the triage value without the risk. */
export interface V1RestoreCheckedProps {
  platform: string;
  kind:
    | 'candidate'
    | 'empty'
    | 'not-found'
    | 'already-done'
    | 'no-auth'
    | 'schema-error'
    | 'network-error';
  reciters: number;
  surahs: number;
  recitations: number;
  recitations_without_slug: number;
  /** Closed-set failure code for the two error arms; null on success arms. */
  reason: string | null;
  /** HTTP status when the failure was an R2 non-OK response; null otherwise. */
  http_status: number | null;
  /** First 8 hex chars of the sha256(email) lookup key — which blob we looked
   *  under. Null on the two arms that return before the hash is computed
   *  (`already-done`, `no-auth`) and on the `userinfo-failed` error.
   *
   *  Deliberately a PREVIEW, never the full hash: the full value is the path
   *  segment into a public bucket, whereas 8 hex chars is 32 of 256 bits and
   *  cannot be walked back to a key. It exists so "we looked under the wrong
   *  key" is answerable from the dashboard — the question a `not-found` report
   *  always raises and no other field on this event can settle. */
  email_hash_preview: string | null;
}

/** The user tapped Restore and the merge completed. `restored_total` is the
 *  headline (the number the user was promised); the 11 add/skip/already-present
 *  counters are the breakdown that explains a disappointing total. All 12 come
 *  off `RestoreMergeResult` — the 11 counters are its fields verbatim,
 *  `restored_total` is the sum of the three `*_added` ones — and every one of
 *  them was thrown away after building a toast string before this event
 *  existed. */
export interface V1RestoreMergedProps {
  platform: string;
  restored_total: number;
  reciters_added: number;
  recitations_added: number;
  surahs_added: number;
  reciters_skipped_no_slug: number;
  recitations_skipped_no_slug: number;
  recitations_skipped_no_surah: number;
  recitations_skipped_no_reciter: number;
  recitations_skipped_no_rewayat: number;
  /** Items the candidate offered — the denominator for restored_total. */
  candidate_total: number;
  /** Items that resolved to a v2 target the user already had locally. Neither
   *  added nor skipped, so before #388 they were invisible here — which made a
   *  benign re-run (restored 0, every skip 0) unreadable in the funnel and
   *  indistinguishable from a real merge failure. `added + skipped +
   *  already_present + surahs_lost_to_write_error` reconciles to
   *  `candidate_total`.
   *
   *  The last term used to be the honest exception: the plain-surah branch
   *  writes through a single try/catch, so an AsyncStorage failure aborted the
   *  whole surah loop and the sum fell short. #394 gave that abort its own
   *  counter, so the ledger reconciles on every class. */
  reciters_already_present: number;
  recitations_already_present: number;
  surahs_already_present: number;
  /** #394 — plain-surah rows an AsyncStorage failure lost (QARIAHV2-20: a full
   *  device throws in `setItem`). Non-zero means the user restored less than
   *  the app told them, so it is the one counter here that is a fault report
   *  rather than a breakdown. `surahs_added` deliberately excludes these:
   *  before #394 they were counted as added, which put the loss behind
   *  `restored_total > 0` where the zero-merge alarm could never see it. */
  surahs_lost_to_write_error: number;
}

/** The user declined the restore (Skip, backdrop dismiss, or the zero-item
 *  variant's Continue). `pending_total` separates a real decline (> 0 items
 *  left on the table) from the empty-state acknowledgement (0). */
export interface V1RestoreSkippedProps {
  platform: string;
  pending_total: number;
  reciters: number;
  surahs: number;
  recitations: number;
}

/**
 * Closed set of sign-in failure reasons.
 *
 * `AuthContext.lastError` is a raw human-readable string built in
 * `services/auth/qfOAuth.ts` — it can embed an OAuth error_description or a
 * caught exception message, so it is NOT safe to emit verbatim (same reasoning
 * as `V1RestoreFailureReason`). We classify it into this fixed set and emit
 * ONLY these labels, so a reworded upstream message degrades to `other` rather
 * than leaking anything. Classifying by inspection rather than at the
 * construction site is a deliberate trade: it keeps `qfOAuth.ts` — the most
 * fragile file in the app — at a zero-line diff.
 */
export type SignInFailureReason =
  | 'session-ended'
  | 'oauth-error'
  | 'state-mismatch'
  | 'no-code'
  | 'other';

/** A sign-in attempt began (`unauthenticated` → `loading`). The initial mount,
 *  which also starts in `loading`, is deliberately NOT counted. */
export interface SignInStartedProps {
  platform: string;
}

/** Sign-in completed and the session is authenticated. `duration_ms` is the
 *  full round trip including the external browser, so a rising tail here is the
 *  signal for "sign-in feels broken" reports that never produce an error. */
export interface SignInSucceededProps {
  platform: string;
  duration_ms: number | null;
}

/** Sign-in returned an actual error (NOT a user cancellation — AuthContext
 *  deliberately leaves `lastError` null for those; see SignInAbandonedProps). */
export interface SignInFailedProps {
  platform: string;
  duration_ms: number | null;
  reason: SignInFailureReason;
}

/** The attempt ended back at `unauthenticated` with NO error recorded — i.e.
 *  the user dismissed the OAuth browser. This is the drop-off that matters most
 *  for the migration: these users keep their v1 favorites stranded. */
export interface SignInAbandonedProps {
  platform: string;
  duration_ms: number | null;
}
