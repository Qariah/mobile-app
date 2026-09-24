import {PostHog} from 'posthog-react-native';
import * as Device from 'expo-device';
import {getOrCreateDeviceId} from './deviceId';
import {
  ANALYTICS_EVENTS,
  PlaybackStartedProps,
  PlaybackPausedProps,
  PlaybackResumedProps,
  PlaybackCompletedProps,
  PlaybackSkippedProps,
  PlaybackSeekedProps,
  MeaningfulListenProps,
  RateChangedProps,
  QueueModifiedProps,
  MushafPageOpenedProps,
  MushafPageReadProps,
  MushafSessionEndedProps,
  AdhkarSessionStartedProps,
  AdhkarSessionCompletedProps,
  TasbeehCompletedProps,
  ReciterSelectedProps,
  RewayahChangedProps,
  DownloadStartedProps,
  DownloadCompletedProps,
  AmbientToggledProps,
  FavoriteToggledProps,
  PlaylistModifiedProps,
  ShareCreatedProps,
  SearchPerformedProps,
  TranslationViewedProps,
  AppBackgroundedProps,
  OnboardingStartedProps,
  OnboardingStepViewedProps,
  OnboardingCompletedProps,
  OnboardingSkippedProps,
  ReciterProfileSurahsStalledProps,
  ReciterProfileSurahsRenderedProps,
  BootNotCompletedProps,
  SplashHiddenProps,
  SplashStalledProps,
  PlaybackKilledInBackgroundProps,
  PlaybackStoppedInBackgroundProps,
  DeepLinkDroppedProps,
  ColdStartBeganProps,
  ScreenContentStalledProps,
  ScreenContentRenderedProps,
  V1RestoreCheckedProps,
  V1RestoreMergedProps,
  V1RestoreSkippedProps,
  SignInStartedProps,
  SignInSucceededProps,
  SignInFailedProps,
  SignInAbandonedProps,
} from './events';
import {localAggregationStore} from './LocalAggregationStore';
import {MeaningfulListenTracker} from './MeaningfulListenTracker';
import {useAnalyticsConsentStore} from '@/store/analyticsConsentStore';

function isAnalyticsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ANALYTICS_ENABLED !== 'false';
}

/**
 * Drop ingestion from dev builds and from simulators/emulators — the PostHog
 * mirror of Sentry's `beforeSend` dev/sim drop (app/_layout.tsx). Dev/sim
 * traffic (Metro dev loop, internal-dev emulator runs, DerivedData rebuilds)
 * is not prod-user behavior; it inflates every per-user funnel and was a
 * documented source of measurement-artifact false alarms in the triage bot.
 * `Device.isDevice` is `false` on the iOS Simulator / Android emulator and
 * stays correct even for a RELEASE build on a simulator (where `__DEV__` is
 * false), so the two checks together cover both classes. Static per process.
 */
const DROP_NON_PROD_INGESTION = __DEV__ || !Device.isDevice;

/**
 * Whether the user currently consents to analytics.
 *
 * Fails CLOSED until the persisted consent store has hydrated: `zustand/persist`
 * loads from AsyncStorage asynchronously, so on a cold launch the in-memory
 * value is the default (`true`) until the stored choice arrives. Returning
 * `false` while un-hydrated guarantees we never emit an event (or identify a
 * person) before the user's saved opt-out is known.
 */
function isConsentGranted(): boolean {
  if (!useAnalyticsConsentStore.persist.hasHydrated()) return false;
  return useAnalyticsConsentStore.getState().analyticsEnabled;
}

class AnalyticsServiceImpl {
  private posthog: PostHog | null = null;
  private deviceId = '';
  private enabled = true;
  private meaningfulListenTracker: MeaningfulListenTracker;
  private sessionStartTime: number = Date.now();
  private sessionListenMs = 0;

  constructor() {
    this.meaningfulListenTracker = new MeaningfulListenTracker(
      (props: MeaningfulListenProps) => {
        this.trackMeaningfulListen(props);
      },
    );
    // Keep the live PostHog instance in lock-step with the consent flag so a
    // caller can never desync the SDK from the store: any change to
    // `analyticsEnabled` (e.g. the Settings → Privacy toggle) pushes straight
    // through to optIn()/optOut().
    useAnalyticsConsentStore.subscribe(state => {
      this.applyConsent(state.analyticsEnabled);
    });
  }

  async initialize(): Promise<void> {
    this.enabled = isAnalyticsEnabled();
    if (!this.enabled) return;
    this.deviceId = getOrCreateDeviceId();
    this.sessionStartTime = Date.now();
    this.sessionListenMs = 0;
  }

  setPostHogInstance(instance: PostHog): void {
    if (!this.enabled) return;
    this.posthog = instance;
    // `debug_id` is the anonymous device UUID a user can copy from
    // Settings -> Privacy. It rides as a SUPER PROPERTY, so every event carries
    // it and a support ticket can be looked up with
    // `properties.debug_id = '<uuid>'`.
    //
    // NOT identify(). PostHog mints its own anonymous distinct_id and this app
    // deliberately never identifies the device, because identify() creates a
    // server-side person profile — a heavier, more sensitive object than a
    // property. Measured 2026-08-27: a real tester's events carried
    // distinct_id 019ee501-… while their copied debug id was 6756d487-…, so a
    // debug id looked up against distinct_id finds nothing. A super property
    // closes that gap without creating a profile.
    //
    // `deviceId` is set in initialize(); guard in case that ordering ever
    // changes, so a blank value never becomes a super property.
    instance.register({
      platform: 'mobile',
      ...(this.deviceId ? {debug_id: this.deviceId} : {}),
    });
    // Honor the user's runtime opt-out choice on the fresh instance — but only
    // once the persisted choice has hydrated, so we don't optIn() on the
    // default before a saved opt-out loads. If already hydrated, apply now;
    // otherwise apply on hydration finish.
    const persist = useAnalyticsConsentStore.persist;
    if (persist.hasHydrated()) {
      this.applyConsent(useAnalyticsConsentStore.getState().analyticsEnabled);
    } else {
      const unsub = persist.onFinishHydration(state => {
        unsub();
        this.applyConsent(state.analyticsEnabled);
      });
    }
  }

  /**
   * Apply the user's analytics consent choice to the live PostHog instance.
   * `optIn()`/`optOut()` are persisted by the SDK and respected across launches.
   * Call this whenever the Settings → Privacy toggle changes.
   */
  applyConsent(enabled: boolean): void {
    if (!this.posthog) return;
    // Don't swallow rejections silently — failing to apply an opt-out is
    // privacy-sensitive and should at least surface in logs.
    const applied = enabled ? this.posthog.optIn() : this.posthog.optOut();
    void applied.catch((error: unknown) => {
      console.warn('[Analytics] Failed to apply consent choice:', error);
    });
  }

  private capture(
    event: string,
    properties: Record<string, string | number | boolean | null>,
  ): void {
    // Drop dev-build + simulator/emulator events at the single ingestion
    // chokepoint (mirrors Sentry's beforeSend dev/sim drop). Keeps the
    // PostHog funnels free of non-prod-user traffic.
    if (DROP_NON_PROD_INGESTION) return;
    // Respect the user's runtime opt-out (Settings → Privacy) in addition to
    // PostHog's own opt-out state — belt-and-suspenders. Fails closed until the
    // consent store has hydrated.
    if (!isConsentGranted()) return;
    this.posthog?.capture(event, properties);
  }

  /**
   * @ai Qariah-only. Capture a diagnostics event whose name is owned by its
   * own module (services/diagnostics/playbackHealth.ts), so that module does
   * not have to edit the upstream-shared `events.ts`. It goes through the same
   * `capture()` chokepoint, so the dev/simulator drop and the consent gate
   * still apply.
   */
  captureDiagnosticEvent(
    event: string,
    properties: Record<string, string | number | boolean | null>,
  ): void {
    this.capture(event, properties);
  }

  // --- Listening ---

  trackPlaybackStarted(props: PlaybackStartedProps): void {
    this.capture(ANALYTICS_EVENTS.PLAYBACK_STARTED, {...props});
  }

  trackPlaybackPaused(props: PlaybackPausedProps): void {
    this.capture(ANALYTICS_EVENTS.PLAYBACK_PAUSED, {...props});
    localAggregationStore.addListeningTime(
      localAggregationStore.getToday(),
      props.listened_ms,
      String(props.surah_id),
      props.reciter_id,
    );
    this.sessionListenMs += props.listened_ms;
  }

  trackPlaybackResumed(props: PlaybackResumedProps): void {
    this.capture(ANALYTICS_EVENTS.PLAYBACK_RESUMED, {...props});
  }

  trackPlaybackCompleted(props: PlaybackCompletedProps): void {
    this.capture(ANALYTICS_EVENTS.PLAYBACK_COMPLETED, {...props});
    localAggregationStore.addListeningTime(
      localAggregationStore.getToday(),
      props.listened_ms,
      String(props.surah_id),
      props.reciter_id,
    );
    this.sessionListenMs += props.listened_ms;
  }

  trackPlaybackSkipped(props: PlaybackSkippedProps): void {
    this.capture(ANALYTICS_EVENTS.PLAYBACK_SKIPPED, {...props});
    localAggregationStore.addListeningTime(
      localAggregationStore.getToday(),
      props.listened_ms,
      String(props.surah_id),
      props.reciter_id,
    );
    this.sessionListenMs += props.listened_ms;
  }

  trackPlaybackSeeked(props: PlaybackSeekedProps): void {
    this.capture(ANALYTICS_EVENTS.PLAYBACK_SEEKED, {...props});
  }

  trackMeaningfulListen(props: MeaningfulListenProps): void {
    this.capture(ANALYTICS_EVENTS.MEANINGFUL_LISTEN, {...props});
    localAggregationStore.incrementMeaningfulListens(
      localAggregationStore.getToday(),
    );
    localAggregationStore.markSurahCompleted(String(props.surah_id));
  }

  trackRateChanged(props: RateChangedProps): void {
    this.capture(ANALYTICS_EVENTS.RATE_CHANGED, {...props});
  }

  trackQueueModified(props: QueueModifiedProps): void {
    this.capture(ANALYTICS_EVENTS.QUEUE_MODIFIED, {...props});
  }

  // --- Mushaf ---

  trackMushafPageOpened(props: MushafPageOpenedProps): void {
    this.capture(ANALYTICS_EVENTS.MUSHAF_PAGE_OPENED, {...props});
  }

  trackMushafPageRead(props: MushafPageReadProps): void {
    this.capture(ANALYTICS_EVENTS.MUSHAF_PAGE_READ, {...props});
    localAggregationStore.addPagesRead(localAggregationStore.getToday(), 1);
  }

  trackMushafSessionEnded(props: MushafSessionEndedProps): void {
    this.capture(ANALYTICS_EVENTS.MUSHAF_SESSION_ENDED, {...props});
    localAggregationStore.addPagesOpened(
      localAggregationStore.getToday(),
      props.pages_opened,
    );
  }

  // --- Adhkar ---

  trackAdhkarSessionStarted(props: AdhkarSessionStartedProps): void {
    this.capture(ANALYTICS_EVENTS.ADHKAR_SESSION_STARTED, {...props});
  }

  trackAdhkarSessionCompleted(props: AdhkarSessionCompletedProps): void {
    this.capture(ANALYTICS_EVENTS.ADHKAR_SESSION_COMPLETED, {...props});
    localAggregationStore.incrementAdhkarSessions(
      localAggregationStore.getToday(),
    );
  }

  trackTasbeehCompleted(props: TasbeehCompletedProps): void {
    this.capture(ANALYTICS_EVENTS.TASBEEH_COMPLETED, {...props});
    localAggregationStore.addTasbeehCount(
      localAggregationStore.getToday(),
      props.count,
    );
  }

  // --- Feature Usage ---

  trackReciterSelected(props: ReciterSelectedProps): void {
    this.capture(ANALYTICS_EVENTS.RECITER_SELECTED, {...props});
  }

  trackRewayahChanged(props: RewayahChangedProps): void {
    this.capture(ANALYTICS_EVENTS.REWAYAH_CHANGED, {...props});
  }

  trackDownloadStarted(props: DownloadStartedProps): void {
    this.capture(ANALYTICS_EVENTS.DOWNLOAD_STARTED, {...props});
  }

  trackDownloadCompleted(props: DownloadCompletedProps): void {
    this.capture(ANALYTICS_EVENTS.DOWNLOAD_COMPLETED, {...props});
  }

  trackAmbientToggled(props: AmbientToggledProps): void {
    this.capture(ANALYTICS_EVENTS.AMBIENT_TOGGLED, {...props});
  }

  trackFavoriteToggled(props: FavoriteToggledProps): void {
    this.capture(ANALYTICS_EVENTS.FAVORITE_TOGGLED, {...props});
  }

  trackPlaylistModified(props: PlaylistModifiedProps): void {
    this.capture(ANALYTICS_EVENTS.PLAYLIST_MODIFIED, {...props});
  }

  trackShareCreated(props: ShareCreatedProps): void {
    this.capture(ANALYTICS_EVENTS.SHARE_CREATED, {...props});
  }

  trackSearchPerformed(props: SearchPerformedProps): void {
    this.capture(ANALYTICS_EVENTS.SEARCH_PERFORMED, {...props});
  }

  trackTranslationViewed(props: TranslationViewedProps): void {
    this.capture(ANALYTICS_EVENTS.TRANSLATION_VIEWED, {...props});
  }

  // --- Lifecycle ---

  trackAppOpened(): void {
    this.sessionStartTime = Date.now();
    this.sessionListenMs = 0;
    this.capture(ANALYTICS_EVENTS.APP_OPENED, {});
  }

  trackAppBackgrounded(): void {
    const props: AppBackgroundedProps = {
      session_duration_ms: Date.now() - this.sessionStartTime,
      total_listen_ms: this.sessionListenMs,
    };
    this.capture(ANALYTICS_EVENTS.APP_BACKGROUNDED, {...props});
  }

  // --- Onboarding funnel (S35.3) ---

  trackOnboardingStarted(props: OnboardingStartedProps): void {
    this.capture(ANALYTICS_EVENTS.ONBOARDING_STARTED, {...props});
  }

  trackOnboardingStepViewed(props: OnboardingStepViewedProps): void {
    this.capture(ANALYTICS_EVENTS.ONBOARDING_STEP_VIEWED, {...props});
  }

  trackOnboardingCompleted(props: OnboardingCompletedProps): void {
    this.capture(ANALYTICS_EVENTS.ONBOARDING_COMPLETED, {...props});
  }

  trackOnboardingSkipped(props: OnboardingSkippedProps): void {
    this.capture(ANALYTICS_EVENTS.ONBOARDING_SKIPPED, {...props});
  }

  // --- Silent-hang detection (REPORT-ONLY observability) ---
  // @ai planning/observability-gap-samsung-hang-2026-06-08.md. Discrete fault +
  // companion success signals for the Samsung "can't use the app" hang classes
  // that never throw and never crash (so Sentry is blind) and produce no
  // downstream event (so ratio detectors are blind). These give them a queryable,
  // auto-filing signal. Pure telemetry — no behavioral side effects.

  trackReciterProfileSurahsStalled(
    props: ReciterProfileSurahsStalledProps,
  ): void {
    this.capture(ANALYTICS_EVENTS.RECITER_PROFILE_SURAHS_STALLED, {...props});
  }

  trackReciterProfileSurahsRendered(
    props: ReciterProfileSurahsRenderedProps,
  ): void {
    this.capture(ANALYTICS_EVENTS.RECITER_PROFILE_SURAHS_RENDERED, {...props});
  }

  trackBootNotCompleted(props: BootNotCompletedProps): void {
    this.capture(ANALYTICS_EVENTS.BOOT_NOT_COMPLETED, {...props});
  }

  trackSplashHidden(props: SplashHiddenProps): void {
    this.capture(ANALYTICS_EVENTS.SPLASH_HIDDEN, {...props});
  }

  trackSplashStalled(props: SplashStalledProps): void {
    this.capture(ANALYTICS_EVENTS.SPLASH_STALLED, {...props});
  }

  trackPlaybackKilledInBackground(
    props: PlaybackKilledInBackgroundProps,
  ): void {
    this.capture(ANALYTICS_EVENTS.PLAYBACK_KILLED_IN_BACKGROUND, {...props});
  }

  trackDeepLinkDropped(props: DeepLinkDroppedProps): void {
    this.capture(ANALYTICS_EVENTS.DEEPLINK_DROPPED, {...props});
  }

  // @ai Boot/first-screen content-readiness (the post-boot "spinner forever"
  // class). Same discrete fault + companion success shape as the *_STALLED pair.
  trackColdStartBegan(props: ColdStartBeganProps): void {
    this.capture(ANALYTICS_EVENTS.COLD_START_BEGAN, {...props});
  }

  trackScreenContentStalled(props: ScreenContentStalledProps): void {
    this.capture(ANALYTICS_EVENTS.SCREEN_CONTENT_STALLED, {...props});
  }

  trackScreenContentRendered(props: ScreenContentRenderedProps): void {
    this.capture(ANALYTICS_EVENTS.SCREEN_CONTENT_RENDERED, {...props});
  }

  trackPlaybackStoppedInBackground(
    props: PlaybackStoppedInBackgroundProps,
  ): void {
    this.capture(ANALYTICS_EVENTS.PLAYBACK_STOPPED_IN_BACKGROUND, {...props});
  }

  // --- v1 → v2 favorites restore funnel ---
  // The 3.2.0 rollout's primary risk signal. Report-only: these emit values the
  // restore path already computed and discarded — no behavior changes.

  trackV1RestoreChecked(props: V1RestoreCheckedProps): void {
    this.capture(ANALYTICS_EVENTS.V1_RESTORE_CHECKED, {...props});
  }

  trackV1RestoreMerged(props: V1RestoreMergedProps): void {
    this.capture(ANALYTICS_EVENTS.V1_RESTORE_MERGED, {...props});
  }

  trackV1RestoreSkipped(props: V1RestoreSkippedProps): void {
    this.capture(ANALYTICS_EVENTS.V1_RESTORE_SKIPPED, {...props});
  }

  // --- Sign-in funnel ---
  // The gate in front of the restore funnel above. Emitted by an OBSERVER of
  // AuthContext's public state (services/analytics/AuthTelemetry), so the auth
  // implementation itself carries no analytics coupling.

  trackSignInStarted(props: SignInStartedProps): void {
    this.capture(ANALYTICS_EVENTS.SIGN_IN_STARTED, {...props});
  }

  trackSignInSucceeded(props: SignInSucceededProps): void {
    this.capture(ANALYTICS_EVENTS.SIGN_IN_SUCCEEDED, {...props});
  }

  trackSignInFailed(props: SignInFailedProps): void {
    this.capture(ANALYTICS_EVENTS.SIGN_IN_FAILED, {...props});
  }

  trackSignInAbandoned(props: SignInAbandonedProps): void {
    this.capture(ANALYTICS_EVENTS.SIGN_IN_ABANDONED, {...props});
  }

  // --- Identity ---

  identifyUser(userId: string): void {
    // identify() creates a person profile server-side (more sensitive than a
    // generic event), so it must honor the same opt-out / hydration gate.
    if (!isConsentGranted()) return;
    this.posthog?.identify(userId);
  }

  // --- Helpers ---

  updatePlaybackProgress(positionMs: number): void {
    this.meaningfulListenTracker.updateProgress(positionMs);
  }

  setTrackDuration(
    totalDurationMs: number,
    surahId: number,
    reciterId: string,
    reciterName: string,
    rewayahId: string,
  ): void {
    this.meaningfulListenTracker.startTracking({
      totalDurationMs,
      surahId,
      reciterId,
      reciterName,
      rewayahId,
    });
  }
}

export const analyticsService = new AnalyticsServiceImpl();
