// @ai
// services/diagnostics/playbackHealth.ts
// --------------------------------------
// REPORT-ONLY playback-health telemetry. Qariah-only. No UI, and no change to
// player state: this module only watches and reports.
//
// Three events answer one question — "when a user starts a recitation, does
// audio actually start?":
//
//   playback_health_attempt      a play of a NEWLY LOADED track was requested
//   playback_health_first_audio  the position really advanced for that attempt
//   playback_health_no_audio     6 s passed since the tap, app in the
//                                foreground, no audio yet, and nobody paused,
//                                stopped or changed track (an in-app pause, or
//                                a native paused status after playing or
//                                buffering: headset, notification, call)
//
// The names carry a `playback_health_` prefix because older builds already send
// `playback_attempt` and `playback_first_audio` with a different schema.
//
// THE CLOCK STARTS AT THE TAP. A tap loads, then plays, and the load wait can
// take up to ~5 s. The store marks a load that will play at once
// (notePlaybackAutoPlayLoad). For that load, the attempt starts at the load and
// `load_ms` reports the wait. Any other load (restoreSession, a queue set with
// no play) starts its attempt at play(), however soon the user taps.
//
// RATE: `no_audio ÷ attempt` counts only attempts with `foreground: true`. A
// background attempt (auto-advance, screen locked) never gets a timer.
//
// `player_state: 'idle'` on a no-audio event means no load ran, or a load
// waited PLAYER_WAIT_MS for setPlayer and gave up (ExpoAudioService). A boot
// restore that reaches loadTrack before setPlayer now waits for the player
// (planning/boot-restore-player-order-plan.md), so that case no longer shows
// here. The silence is real; the cause is not a network stall.
//
// KNOWN BLIND SPOT: an iOS player that drops its rate to 0 on a network failure
// while the item stays loaded looks like a remote pause, so it sends nothing.
// That is a missed failure, never a false one.
//
// `playback_health_no_audio` also sends a Sentry warning, at most once per
// process, so a device that hits it carries a searchable marker next to its
// other diagnostics.
//
// GATED, FAIL CLOSED:
//   - build flag `playbackHealthTelemetry` (config/featureFlags.ts) = hard off;
//   - remote PostHog boolean flag `playback_health`, pushed in through
//     setPlaybackHealthEnabled(). It starts OFF and every change applies at
//     once — a flag turned off mid-attempt cancels the pending timer.
// When either is off: no events, no timers.
//
// VOLUME CAPS, FAIL CLOSED: every emit spends a per-device, per-UTC-day budget
// (deviceDailyBudget.ts). If the budget store cannot count, nothing is sent.
// Sentry's per-process event budget (sentryEventBudget.ts) applies on top.
//
// COST: one timer per attempt and a few comparisons per status update, on the
// JS thread. It never reads a native player property (a synchronous
// expo-audio getter can block the JS thread on Android — the Redmi freeze).
//
// Every entry point swallows its own errors. Telemetry must never break play.

import {AppState, type AppStateStatus} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import {isFeatureEnabled} from '@/config/featureFlags';
import {consumeDeviceDailyBudget} from './deviceDailyBudget';

/** Event names. Defined here, not in the upstream-shared analytics/events.ts. */
export const PLAYBACK_HEALTH_EVENTS = {
  ATTEMPT: 'playback_health_attempt',
  FIRST_AUDIO: 'playback_health_first_audio',
  NO_AUDIO: 'playback_health_no_audio',
} as const;

/** How long an attempt may go without audio before `playback_health_no_audio`. */
export const NO_AUDIO_AFTER_MS = 6000;

/**
 * Upper bound for a marked load: a play() later than this after its load starts
 * at play(). The readiness wait times out at 5 s, but `replace()` has no time
 * limit, so a very slow load counts from play(): a missed failure, never a
 * false one.
 */
export const LOAD_IS_TAP_MS = 10000;

/** Per-device, per-UTC-day caps. */
export const PLAYBACK_HEALTH_DAILY_CAPS = {
  attempt: 100,
  firstAudio: 100,
  noAudio: 10,
  sentryNoAudio: 3,
} as const;

const SENTRY_BUDGET_KEY = 'sentry:playback-no-audio';

// A position step smaller than this is jitter, not audio.
const MIN_ADVANCE_SEC = 0.1;
// A step larger than this is a seek, not audio. It moves the baseline instead.
const MAX_ADVANCE_SEC = 5;
// Audio detection needs two statuses (expo-audio sends one about every 500 ms):
// the first sets the baseline. When the player already reports `playing` at
// the 6 s mark, wait this long once more, so a start in the last second is not
// counted as no audio.
export const DETECTION_GRACE_MS = 1000;

export type PlaybackSource = 'stream' | 'download';

interface Attempt {
  id: string;
  source: PlaybackSource;
  startedAt: number;
  /** Load wait before play(), when the attempt counts from the tap; else null. */
  loadMs: number | null;
  /** The last position seen for this attempt; null until the first status. */
  lastPositionSec: number | null;
  /** The last native status seen for this attempt, if any. */
  observedState: 'playing' | 'buffering' | 'paused' | null;
  noAudioSent: boolean;
  /** True after the one DETECTION_GRACE_MS extension was used. */
  graceUsed: boolean;
  readServiceState: (() => string) | null;
}

let remoteEnabled = false;
let loadedUrl: string | null = null;
let loadedAt: number | null = null;
let loadedUrlAttempted = false;
/** The URL the store said it will play as soon as it loads; null otherwise. */
let autoPlayUrl: string | null = null;
/** True when the current load was marked by notePlaybackAutoPlayLoad. */
let loadIsTap = false;
/**
 * One Sentry warning per process. Sentry's per-process budget drops a second
 * one anyway, so this stops a daily unit from being spent on a dropped event.
 */
let sentrySentThisProcess = false;
let attempt: Attempt | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: {remove(): void} | null = null;

function isEnabled(): boolean {
  return remoteEnabled && isFeatureEnabled('playbackHealthTelemetry');
}

function sourceOf(url: string): PlaybackSource {
  // Same test downloadService.ts uses for a local file path.
  return url.startsWith('file://') || url.startsWith('/')
    ? 'download'
    : 'stream';
}

function newAttemptId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function removeAppStateSub(): void {
  try {
    appStateSub?.remove();
  } catch {
    // listener already gone
  }
  appStateSub = null;
}

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  removeAppStateSub();
}

/** Stop watching the current attempt. No event. */
function endAttempt(): void {
  clearTimer();
  attempt = null;
}

function emit(
  event: string,
  budgetKey: string,
  cap: number,
  props: Record<string, string | number | boolean | null>,
): void {
  if (!consumeDeviceDailyBudget(budgetKey, cap)) return;
  analyticsService.captureDiagnosticEvent(event, props);
}

function playerStateOf(a: Attempt): string {
  if (a.observedState) return a.observedState;
  try {
    return a.readServiceState?.() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function onNoAudioTimer(): void {
  try {
    timer = null;
    const a = attempt;
    if (!a || !isEnabled() || AppState.currentState !== 'active') {
      removeAppStateSub();
      return;
    }
    // @ai The player says `playing` and a baseline position exists, but the
    // second status has not arrived yet. Wait once more. The AppState listener
    // stays, so a move to the background still cancels the extension.
    if (
      !a.graceUsed &&
      a.observedState === 'playing' &&
      a.lastPositionSec !== null
    ) {
      a.graceUsed = true;
      timer = setTimeout(onNoAudioTimer, DETECTION_GRACE_MS);
      return;
    }
    removeAppStateSub();
    a.noAudioSent = true;
    const waitedMs = Date.now() - a.startedAt;
    const playerState = playerStateOf(a);
    emit(
      PLAYBACK_HEALTH_EVENTS.NO_AUDIO,
      PLAYBACK_HEALTH_EVENTS.NO_AUDIO,
      PLAYBACK_HEALTH_DAILY_CAPS.noAudio,
      {
        attempt_id: a.id,
        waited_ms: waitedMs,
        source: a.source,
        player_state: playerState,
      },
    );
    if (
      !sentrySentThisProcess &&
      consumeDeviceDailyBudget(
        SENTRY_BUDGET_KEY,
        PLAYBACK_HEALTH_DAILY_CAPS.sentryNoAudio,
      )
    ) {
      sentrySentThisProcess = true;
      Sentry.captureMessage('playback-no-audio', {
        level: 'warning',
        tags: {scope: 'playback-health', source: a.source},
        fingerprint: ['playback-no-audio'],
        extra: {attempt_id: a.id, player_state: playerState},
      });
    }
    // Keep the attempt: a late first audio still reports, with
    // after_no_audio = true.
  } catch {
    // never throw from telemetry
  }
}

/**
 * Turn the telemetry on or off from the remote flag. Only `true` turns it on.
 * Every call applies at once; turning it off cancels any pending timer.
 */
export function setPlaybackHealthEnabled(on: boolean): void {
  try {
    remoteEnabled = on === true;
    if (!isEnabled()) endAttempt();
  } catch {
    // never throw from telemetry
  }
}

/**
 * The player store will load `url` and play it as soon as the load finishes
 * (playerStore.loadTrackAtIndex with autoPlay). Call it just before the load.
 * The attempt for that load then counts from the load, which is the tap.
 */
export function notePlaybackAutoPlayLoad(url: string): void {
  try {
    autoPlayUrl = url;
  } catch {
    // never throw from telemetry
  }
}

/**
 * A new source is being loaded (ExpoAudioService.loadTrack). This is a track
 * change: it ends the previous attempt, and the next play request for this
 * source is a new attempt.
 */
export function notePlaybackLoad(url: string): void {
  try {
    loadedUrl = url;
    loadedAt = Date.now();
    loadedUrlAttempted = false;
    loadIsTap = autoPlayUrl === url;
    autoPlayUrl = null;
    endAttempt();
  } catch {
    // never throw from telemetry
  }
}

/**
 * Play was requested (ExpoAudioService.play). The first request after a load
 * starts an attempt. A resume of the same loaded source is not an attempt.
 *
 * `readServiceState` gives `player_state` a value when no native status has
 * arrived yet. It must be cheap and must not read a native player property.
 */
export function notePlaybackPlayRequested(
  readServiceState?: () => string,
): void {
  try {
    if (!isEnabled()) return;
    if (!loadedUrl || loadedUrlAttempted) return;
    loadedUrlAttempted = true;
    endAttempt();
    const now = Date.now();
    // @ai Count from the tap only for a load the store marked as load-then-play
    // (the load wait is part of what the user waits through). A load with no
    // play (restoreSession at boot) counts from play(), however soon the tap.
    const tapAt =
      loadIsTap && loadedAt !== null && now - loadedAt <= LOAD_IS_TAP_MS
        ? loadedAt
        : null;
    const foreground = AppState.currentState === 'active';
    const startedAt = tapAt ?? now;
    const a: Attempt = {
      id: newAttemptId(),
      source: sourceOf(loadedUrl),
      startedAt,
      loadMs: tapAt !== null ? now - tapAt : null,
      lastPositionSec: null,
      observedState: null,
      noAudioSent: false,
      graceUsed: false,
      readServiceState: readServiceState ?? null,
    };
    attempt = a;
    emit(
      PLAYBACK_HEALTH_EVENTS.ATTEMPT,
      PLAYBACK_HEALTH_EVENTS.ATTEMPT,
      PLAYBACK_HEALTH_DAILY_CAPS.attempt,
      {
        attempt_id: a.id,
        source: a.source,
        load_ms: a.loadMs,
        foreground,
      },
    );
    // Only a foreground attempt can become `playback_health_no_audio`. An
    // auto-advance in the background still reports its first audio, but it
    // gets no timer.
    if (!foreground) return;
    timer = setTimeout(
      onNoAudioTimer,
      Math.max(0, NO_AUDIO_AFTER_MS - (now - startedAt)),
    );
    appStateSub = AppState.addEventListener(
      'change',
      (next: AppStateStatus) => {
        try {
          if (next !== 'active') clearTimer();
        } catch {
          // never throw from telemetry
        }
      },
    );
  } catch {
    // never throw from telemetry
  }
}

/**
 * The user paused or stopped playback, or the player was torn down. A later
 * play() of the same load counts from play(), not from the load.
 */
export function notePlaybackPaused(): void {
  try {
    autoPlayUrl = null;
    loadIsTap = false;
    endAttempt();
  } catch {
    // never throw from telemetry
  }
}

/**
 * A native status update arrived (ExpoAudioProvider). The first time the
 * position moves forward while playing, the attempt has audio.
 */
export function notePlaybackProgress(
  positionSec: number,
  playing: boolean,
  buffering: boolean,
): void {
  try {
    const a = attempt;
    if (!a) return;
    if (!isEnabled()) {
      endAttempt();
      return;
    }
    // @ai A pause that does not go through ExpoAudioService.pause() (headset,
    // notification, lock screen, an iOS call) arrives only as a native status.
    // expo-audio reports a stall as buffering (iOS isBuffering; Android keeps
    // playing = intended), and a failed item never reaches this function
    // (isLoaded false). So "paused and not buffering, after playing or
    // buffering" is a real pause: end the attempt and send nothing.
    const wasActive =
      a.observedState === 'playing' || a.observedState === 'buffering';
    if (wasActive && !playing && !buffering && !a.noAudioSent) {
      endAttempt();
      return;
    }
    a.observedState = buffering ? 'buffering' : playing ? 'playing' : 'paused';
    if (!Number.isFinite(positionSec)) return;
    const prev = a.lastPositionSec;
    a.lastPositionSec = positionSec;
    if (prev === null || !playing) return;
    const delta = positionSec - prev;
    if (delta <= MIN_ADVANCE_SEC || delta > MAX_ADVANCE_SEC) return;
    const afterNoAudio = a.noAudioSent;
    endAttempt();
    emit(
      PLAYBACK_HEALTH_EVENTS.FIRST_AUDIO,
      PLAYBACK_HEALTH_EVENTS.FIRST_AUDIO,
      PLAYBACK_HEALTH_DAILY_CAPS.firstAudio,
      {
        attempt_id: a.id,
        ms_to_first_audio: Date.now() - a.startedAt,
        load_ms: a.loadMs,
        after_no_audio: afterNoAudio,
      },
    );
  } catch {
    // never throw from telemetry
  }
}

/** Test seam — returns the module to its initial state. */
export function __resetPlaybackHealthForTests(): void {
  clearTimer();
  remoteEnabled = false;
  loadedUrl = null;
  loadedAt = null;
  loadedUrlAttempted = false;
  autoPlayUrl = null;
  loadIsTap = false;
  sentrySentThisProcess = false;
  attempt = null;
}
