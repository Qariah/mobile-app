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
} from './events';
import {localAggregationStore} from './LocalAggregationStore';
import {MeaningfulListenTracker} from './MeaningfulListenTracker';
import {useAnalyticsConsentStore} from '@/store/analyticsConsentStore';

function isAnalyticsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ANALYTICS_ENABLED !== 'false';
}

/**
 * Drop ingestion from dev builds and from simulators/emulators — the PostHog
 * mirror of Sentry's `beforeSend` dev/sim drop (qariahSentryOptions.ts). Dev/sim
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
  private readyListeners = new Set<() => void>();
  // @ai Qariah-only. The last signed-in state reported by setSignedIn(), or
  // `null` before auth has resolved. Kept so the super property can be
  // (re-)applied whenever PostHog connects or consent is granted later.
  private signedIn: boolean | null = null;

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
    useAnalyticsConsentStore.persist.onFinishHydration(() => {
      this.notifyIfReady();
    });
  }

  async initialize(): Promise<void> {
    this.enabled = isAnalyticsEnabled();
    if (!this.enabled) {
      this.notifyIfReady();
      return;
    }
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
      this.notifyIfReady();
    } else {
      const unsub = persist.onFinishHydration(state => {
        unsub();
        this.applyConsent(state.analyticsEnabled);
      });
    }
  }

  /**
   * Whether an event tracked now reaches its final destination: the saved
   * consent choice is known and, when consent is granted, the PostHog instance
   * is attached. With analytics off or consent declined the event is dropped
   * from PostHog by design, so that also counts as ready. Queued events (widget
   * completions) wait for this before they are drained.
   */
  isReadyToCapture(): boolean {
    if (!useAnalyticsConsentStore.persist.hasHydrated()) return false;
    if (!this.enabled || !isConsentGranted()) return true;
    return this.posthog !== null;
  }

  /** Calls `listener` each time `isReadyToCapture()` may have become true. */
  onReadyToCapture(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  private notifyIfReady(): void {
    if (!this.isReadyToCapture()) return;
    this.readyListeners.forEach(listener => listener());
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
    // @ai Qariah-only. setPostHogInstance() and the consent subscription both
    // route through here, so this one line re-applies `signed_in` when PostHog
    // connects, when consent hydrates, and when the user opts back in.
    if (enabled) this.applySignedIn();
  }

  /**
   * @ai Qariah-only. Report whether a QF account is signed in, as the
   * `signed_in` SUPER PROPERTY — every later event carries it, so a signed-in
   * person is countable on every launch, not only on the launch where they
   * signed in.
   *
   * NOT identify(): identify() creates a server-side person profile, which this
   * app deliberately avoids (see setPostHogInstance). A super property is a
   * plain boolean on the event.
   *
   * registerForSession(), NOT register(): register() persists to disk, so the
   * boot-window events of the NEXT launch (app_opened, cold_start_began) would
   * carry this launch's value before auth resolves — a stale `true` after a
   * session expired. registerForSession() lives in memory for this process
   * only (only posthog.reset() clears it; a session rotation does not), so
   * each launch starts without the property and gets it from auth.
   *
   * Called by services/analytics/AuthTelemetry (an observer of AuthContext), so
   * `services/auth/` carries no analytics coupling. Safe to call before PostHog
   * connects or before consent hydrates: the value is kept and applied later.
   */
  setSignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
    this.applySignedIn();
  }

  private applySignedIn(): void {
    if (!this.posthog || this.signedIn === null) return;
    // Same fail-closed gate as capture() and identifyUser(): nothing is given
    // to PostHog until the persisted consent choice is known and granted.
    if (!isConsentGranted()) return;
    this.posthog.registerForSession({signed_in: this.signedIn});
  }

  private capture(
    event: string,
    properties: Record<string, string | number | boolean | null>,
    timestamp?: Date,
  ): void {
    // Drop dev-build + simulator/emulator events at the single ingestion
    // chokepoint (mirrors Sentry's beforeSend dev/sim drop). Keeps the
    // PostHog funnels free of non-prod-user traffic.
    if (DROP_NON_PROD_INGESTION) return;
    // Respect the user's runtime opt-out (Settings → Privacy) in addition to
    // PostHog's own opt-out state — belt-and-suspenders. Fails closed until the
    // consent store has hydrated.
    if (!isConsentGranted()) return;
    if (timestamp) {
      this.posthog?.capture(event, properties, {timestamp});
      return;
    }
    this.posthog?.capture(event, properties);
  }

  /**
   * @ai Qariah-only. Capture an event whose name is owned by its own module
   * (services/analytics/qariahEvents.ts, services/diagnostics/playbackHealth.ts),
   * so that module does not have to edit the upstream-shared `events.ts`.
   * It goes through the same `capture()` chokepoint, so the dev/simulator
   * drop and the consent gate still apply.
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

  /** `completedAt` dates a completion made earlier (a queued widget event). */
  trackAdhkarSessionCompleted(
    props: AdhkarSessionCompletedProps,
    completedAt?: Date,
  ): void {
    this.capture(
      ANALYTICS_EVENTS.ADHKAR_SESSION_COMPLETED,
      {...props},
      completedAt,
    );
    localAggregationStore.incrementAdhkarSessions(
      completedAt
        ? localAggregationStore.dayKey(completedAt)
        : localAggregationStore.getToday(),
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
