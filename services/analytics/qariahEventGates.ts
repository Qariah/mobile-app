// @ai Qariah (TECH_DEBT #391) — send each analytics signal once.
//
// Upstream sends five side effects as if they were user actions: the end of a
// track as `playback_paused` (and the next start as `playback_resumed`), an
// automatic advance as `playback_skipped`, an iOS `inactive` flicker (Control
// Center, the notification list, the app switcher) as `app_backgrounded` +
// `app_opened`, a page that the Mushaf session already opened as a new
// `mushaf_page_opened`, and each step of a run of seeks as a `playback_seeked`.
// They made the pause, resume and skip counts wrong, and they cost about
// 258,000 PostHog events in 28 days (planning/posthog-event-cut-proposal.md).
//
// The rules live here, in a Qariah-only file. The upstream files call them
// from small `@ai` hooks: services/audio/ExpoAudioProvider.tsx,
// services/player/store/playerStore.ts, app/_layout.tsx and
// components/mushaf/main.tsx.

import type {AppStateStatus} from 'react-native';
import {analyticsService} from './AnalyticsService';
import type {PlaybackSeekedProps} from './events';

// --- Pause at the end of a track (proposal line 2) ---

/** A pause this close to the end of the track is the track end (seconds). */
export const TRACK_END_WINDOW_S = 2;

/**
 * True when a pause that expo-audio reports is the end of the track, not the
 * user. iOS reports `playing: false` at the end once from the periodic time
 * observer (with `didJustFinish: false`) and again with `didJustFinish: true`.
 */
export function isTrackEndPause(status: {
  didJustFinish?: boolean;
  currentTime: number;
  duration: number;
}): boolean {
  if (status.didJustFinish) return true;
  return (
    status.duration > 0 &&
    status.duration - status.currentTime < TRACK_END_WINDOW_S
  );
}

// --- Automatic advance (proposal line 4) ---

let autoplayTrackId: string | null = null;

/**
 * `skipToNext()` records the track that an automatic advance loads, so the
 * next `playback_started` says `source: 'autoplay'`. A skip by the user passes
 * null, which clears the mark.
 */
export function markAutoplayStart(trackId: string | null | undefined): void {
  autoplayTrackId = trackId ?? null;
}

/**
 * True when `trackId` is the track that the last automatic advance loaded.
 * The first `playback_started` after the mark consumes it, for any track.
 */
export function takeAutoplayStart(trackId: string): boolean {
  const auto = autoplayTrackId !== null && autoplayTrackId === trackId;
  autoplayTrackId = null;
  return auto;
}

// --- One seek for a run of seeks (proposal line 9) ---

/**
 * Seeks closer together than this are one seek: the steps of a slider drag,
 * or a run of taps on the ±15 s buttons (2,289 of the 2,732 seek pairs under
 * 3 s on 2026-11-09 to 11-13 were ±15 s steps).
 */
export const SEEK_RUN_MS = 3000;

let pendingSeek: {
  trackId: string;
  props: PlaybackSeekedProps;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;

/** Sends the pending `playback_seeked` now, if there is one. */
export function flushPendingSeek(): void {
  if (!pendingSeek) return;
  const {props, timer} = pendingSeek;
  if (timer) clearTimeout(timer);
  pendingSeek = null;
  analyticsService.trackPlaybackSeeked(props);
}

/**
 * Records one seek. The event goes SEEK_RUN_MS after the last seek of a run,
 * with the `from_ms` of the first seek and the `to_ms` of the last. A seek on
 * another track sends the pending event first.
 */
export function noteSeek(trackId: string, props: PlaybackSeekedProps): void {
  if (pendingSeek && pendingSeek.trackId !== trackId) flushPendingSeek();
  if (pendingSeek) {
    if (pendingSeek.timer) clearTimeout(pendingSeek.timer);
    pendingSeek.props = {...pendingSeek.props, to_ms: props.to_ms};
  } else {
    pendingSeek = {trackId, props: {...props}, timer: null};
  }
  pendingSeek.timer = setTimeout(flushPendingSeek, SEEK_RUN_MS);
}

// --- Background and foreground (proposal line 5) ---

/**
 * The AppState listener of `app_backgrounded` and `app_opened`. Only
 * `background` is a background: `inactive` is Control Center, the
 * notification list or the app switcher, and the app stays on screen. An
 * `app_opened` comes only after a real background. The mount sends the
 * first `app_opened` (AnalyticsConnector), so a launch that starts in the
 * background counts as backgrounded.
 */
export function appLifecycleListener(
  initialState: AppStateStatus | string | null | undefined,
): (nextState: AppStateStatus) => void {
  let backgrounded = initialState === 'background';
  return nextState => {
    if (nextState === 'background') {
      if (backgrounded) return;
      backgrounded = true;
      analyticsService.trackAppBackgrounded();
    } else if (nextState === 'active' && backgrounded) {
      backgrounded = false;
      analyticsService.trackAppOpened();
    }
  };
}

// --- Mushaf pages (proposal line 6) ---

/**
 * True the first time `page` opens in this Mushaf session, and records it.
 * A swipe back to a page that the session already opened is not a new page.
 */
export function firstOpenInSession(opened: Set<number>, page: number): boolean {
  if (opened.has(page)) return false;
  opened.add(page);
  return true;
}
