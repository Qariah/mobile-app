// @ai
// services/diagnostics/playbackObserver.ts
// ----------------------------------------
// The Qariah REPORT-ONLY playback observers. Upstream's
// `services/audio/ExpoAudioProvider.tsx` calls `usePlaybackObserver(player,
// status)` once, with its shared player and its `useAudioPlayerStatus` status
// (divergence batch C5, PLY-S6). This code was inline in the provider; it
// moved here without a behaviour change. It never changes playback.
//
// What it does, at each status change of the provider:
// - Playback health (`playbackHealth.ts`): `notePlaybackProgress` on each
//   loaded status. It runs first, as it did at the top of the provider's
//   status effect.
// - The playback-kill sentinel (#54 / #104, `playbackSentinel.ts`): a
//   synchronous MMKV record while audio plays. It arms on the first `playing`
//   status and disarms on the first status that is not playing and not
//   buffering (a rebuffer does not disarm: a kill during a buffer is a kill
//   during playback). While armed, the record's position is refreshed at the
//   provider's progress interval. When the process dies with the record set,
//   the NEXT launch reports `playback-killed-in-background`
//   (`components/QariahRootEffects.tsx`).
// - The involuntary background-stop detector, SILENT variant (S33.2): when the
//   app comes to the foreground with the sentinel armed but the player not
//   playing, the player stopped with no JS event. It reports
//   `playback-stopped-in-background` (Sentry warning + PostHog) and, on
//   Android, records the kill for the bounded battery-unrestrict prompt. A
//   pause that JS sees (in the app, the notification, a call) disarms the
//   sentinel first, so it is not reported. See
//   planning/background-audio-kill-diagnosis-2026-06-10.md.
//
// The arm state is per provider instance (a ref), as it was in the provider.
//
// The Android POST_NOTIFICATIONS request and its denial bookkeeping moved to
// the notifications feature (`services/notifications/launchPermission.ts`).

import {useEffect, useRef} from 'react';
import {AppState, Platform} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {qariahAnalytics} from '@/services/analytics/qariahEvents';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {useBackgroundPlaybackStore} from '@/store/backgroundPlaybackStore';
import {notePlaybackProgress} from './playbackHealth';
import {
  markPlaybackActive,
  updatePlaybackPosition,
  clearPlaybackActive,
  peekActivePlayback,
  type ActivePlayback,
} from './playbackSentinel';

/**
 * How often the sentinel's position is refreshed while playing. The same
 * value as the provider's PROGRESS_UPDATE_INTERVAL, the throttle that the
 * refresh used when it was inline (one small sync MMKV write per tick).
 */
export const SENTINEL_POSITION_INTERVAL_MS =
  Platform.OS === 'android' ? 2000 : 1000;

/** The status fields that the observers read (expo-audio `AudioStatus`). */
export interface ObservedPlaybackStatus {
  isLoaded: boolean;
  playing: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
}

/** The player field that the foreground detector reads. */
export interface ObservedPlayer {
  readonly playing: boolean;
}

/**
 * S33.2: emit the involuntary background-stop signal. REPORT-ONLY, and on
 * Android it trips the bounded battery-unrestrict prompt. Never throws.
 */
export function reportStoppedInBackground(
  rec: ActivePlayback | null,
  via: 'disarm' | 'foreground',
): void {
  const detectedAt = Date.now();
  try {
    Sentry.captureMessage('playback-stopped-in-background', {
      level: 'warning',
      tags: {scope: 'audio', detect_via: via},
      extra: {
        surah_id: rec?.surahId ?? null,
        reciter_id: rec?.reciterId ?? null,
        position_sec: rec?.positionSec ?? 0,
        started_at_ms: rec?.startedAt ?? 0,
        detected_at_ms: detectedAt,
      },
    });
  } catch {
    // best-effort; telemetry must never throw into the audio path
  }
  qariahAnalytics.trackPlaybackStoppedInBackground({
    surah_id: rec?.surahId ?? null,
    reciter_id: rec?.reciterId ?? null,
    reciter_name: rec?.reciterName ?? null,
    position_sec: rec?.positionSec ?? 0,
    started_at_ms: rec?.startedAt ?? 0,
    detected_at_ms: detectedAt,
  });
  // Record the kill for the bounded battery-unrestrict prompt (Android only —
  // the OEM background-stop path).
  if (Platform.OS === 'android') {
    useBackgroundPlaybackStore.getState().recordKill();
  }
}

/** The observers of one ExpoAudioProvider (see the file header). */
export function usePlaybackObserver(
  player: ObservedPlayer,
  status: ObservedPlaybackStatus,
): void {
  // Tracked apart from the provider's `wasPlaying`, which turns false on a
  // mid-play BUFFERING status: a pause after a rebuffer must still disarm.
  const sentinelArmed = useRef(false);
  const lastPositionRefresh = useRef(0);

  // The same dependencies as the provider's status effect, so it runs on the
  // same status changes.
  useEffect(() => {
    if (!status.isLoaded) return;

    // REPORT-ONLY playback-health: a few comparisons, no native reads.
    notePlaybackProgress(
      status.currentTime,
      status.playing,
      status.isBuffering,
    );

    // Refresh where the audio is, so a process death reports the position it
    // died at. A no-op while the sentinel is not armed.
    const now = Date.now();
    if (now - lastPositionRefresh.current >= SENTINEL_POSITION_INTERVAL_MS) {
      lastPositionRefresh.current = now;
      if (status.playing) updatePlaybackPosition(status.currentTime);
    }

    if (status.playing) {
      if (!sentinelArmed.current) {
        sentinelArmed.current = true;
        const {queue} = usePlayerStore.getState();
        const currentTrack = queue.tracks[queue.currentIndex] ?? null;
        markPlaybackActive({
          surahId: currentTrack?.surahId ?? null,
          reciterId: currentTrack?.reciterId ?? null,
          reciterName: currentTrack?.reciterName ?? null,
          positionSec: status.currentTime,
        });
      }
    } else if (!status.isBuffering && sentinelArmed.current) {
      // A stop that JS sees (a pause, the notification, a call or audio-focus
      // loss, a recoverable service pause): disarm. Not reported: those
      // interruptions are frequent and legitimate. Only a SILENT player death
      // (still armed at the next foreground) is the OEM-kill signal.
      sentinelArmed.current = false;
      clearPlaybackActive();
    }
  }, [
    status.currentTime,
    status.duration,
    status.isLoaded,
    status.isBuffering,
    status.playing,
  ]);

  // The SILENT variant of the background-stop detector (see the file header).
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') return;
      if (!sentinelArmed.current) return; // we did not think audio was playing
      let stillPlaying = false;
      try {
        stillPlaying = player.playing;
      } catch {
        stillPlaying = false; // player object gone → it was stopped
      }
      if (stillPlaying) return; // audio survived — nothing to report

      // Armed but not playing on return → silent involuntary background stop.
      const rec = peekActivePlayback();
      sentinelArmed.current = false;
      clearPlaybackActive();
      reportStoppedInBackground(rec, 'foreground');
    });
    return () => sub.remove();
  }, [player]);
}
