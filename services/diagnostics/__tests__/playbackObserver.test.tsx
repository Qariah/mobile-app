// @ai
// Divergence batch C5 (PLY-S6): the report-only playback observers moved out
// of upstream's ExpoAudioProvider into `usePlaybackObserver`. This suite
// proves that the observer makes the same calls, with the same arguments and
// in the same order, as the inline provider code did before the move.
//
// `LegacyInlineObserver` below is that inline code, copied from
// `services/audio/ExpoAudioProvider.tsx` at b0562ba7: the parts of the status
// effect that fed playback health and the playback-kill sentinel, and the
// foreground detector with its `reportStoppedInBackground` callback. The
// provider's other work in the same effect (the store sync and the analytics)
// is left out; it calls none of these modules.

import React, {useCallback, useEffect, useRef} from 'react';
import {AppState, AppStateStatus, Platform} from 'react-native';
import {render, act} from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import {notePlaybackProgress} from '@/services/diagnostics/playbackHealth';
import {
  markPlaybackActive,
  updatePlaybackPosition,
  clearPlaybackActive,
  peekActivePlayback,
  type ActivePlayback,
} from '@/services/diagnostics/playbackSentinel';
import {useBackgroundPlaybackStore} from '@/store/backgroundPlaybackStore';
import {qariahAnalytics} from '@/services/analytics/qariahEvents';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {
  SENTINEL_POSITION_INTERVAL_MS,
  usePlaybackObserver,
  type ObservedPlaybackStatus,
} from '../playbackObserver';

type Call = [string, ...unknown[]];

const mockLog: Call[] = [];
const mockTracks = [
  {surahId: '18', reciterId: 'r1', reciterName: 'Reciter One'},
  {surahId: '36', reciterId: 'r2', reciterName: 'Reciter Two'},
];
const mockQueue = {tracks: mockTracks, currentIndex: 0};
let mockActive: ActivePlayback | null = null;

jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackProgress: (...args: unknown[]) =>
    mockLog.push(['notePlaybackProgress', ...args]),
}));
jest.mock('@/services/diagnostics/playbackSentinel', () => ({
  markPlaybackActive: (info: Record<string, unknown>) => {
    mockActive = {
      startedAt: 1234,
      positionSec: 0,
      ...info,
    } as unknown as ActivePlayback;
    mockLog.push(['markPlaybackActive', info]);
  },
  updatePlaybackPosition: (positionSec: number) => {
    if (mockActive) mockActive = {...mockActive, positionSec};
    mockLog.push(['updatePlaybackPosition', positionSec]);
  },
  clearPlaybackActive: () => {
    mockActive = null;
    mockLog.push(['clearPlaybackActive']);
  },
  peekActivePlayback: () => mockActive,
}));
jest.mock('@sentry/react-native', () => ({
  captureMessage: (...args: unknown[]) =>
    mockLog.push(['Sentry.captureMessage', ...args]),
}));
jest.mock('@/services/analytics/qariahEvents', () => ({
  qariahAnalytics: {
    trackPlaybackStoppedInBackground: (props: unknown) =>
      mockLog.push(['trackPlaybackStoppedInBackground', props]),
  },
}));
jest.mock('@/store/backgroundPlaybackStore', () => ({
  useBackgroundPlaybackStore: {
    getState: () => ({recordKill: () => mockLog.push(['recordKill'])}),
  },
}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {getState: () => ({queue: mockQueue})},
}));

// ---- The pre-C5 inline provider code (b0562ba7), telemetry parts only. ----
const PROGRESS_UPDATE_INTERVAL = Platform.OS === 'android' ? 2000 : 1000;

interface HostProps {
  player: {playing: boolean};
  status: ObservedPlaybackStatus;
}

function LegacyInlineObserver({player, status}: HostProps): null {
  const lastProgressUpdate = useRef(0);
  const playbackSentinelArmed = useRef(false);

  const reportStoppedInBackground = useCallback(
    (rec: ActivePlayback | null, via: 'disarm' | 'foreground'): void => {
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
        // best-effort
      }
      qariahAnalytics.trackPlaybackStoppedInBackground({
        surah_id: rec?.surahId ?? null,
        reciter_id: rec?.reciterId ?? null,
        reciter_name: rec?.reciterName ?? null,
        position_sec: rec?.positionSec ?? 0,
        started_at_ms: rec?.startedAt ?? 0,
        detected_at_ms: detectedAt,
      });
      if (Platform.OS === 'android') {
        useBackgroundPlaybackStore.getState().recordKill();
      }
    },
    [],
  );

  useEffect(() => {
    if (!status.isLoaded) return;

    notePlaybackProgress(
      status.currentTime,
      status.playing,
      status.isBuffering,
    );

    const now = Date.now();
    const shouldUpdateProgress =
      now - lastProgressUpdate.current >= PROGRESS_UPDATE_INTERVAL;

    if (shouldUpdateProgress) {
      lastProgressUpdate.current = now;
      if (status.playing) {
        updatePlaybackPosition(status.currentTime);
      }
    }

    const trackStore = usePlayerStore.getState();
    const currentTrack =
      trackStore.queue.tracks[trackStore.queue.currentIndex] ?? null;

    if (status.playing) {
      if (!playbackSentinelArmed.current) {
        playbackSentinelArmed.current = true;
        markPlaybackActive({
          surahId: currentTrack?.surahId ?? null,
          reciterId: currentTrack?.reciterId ?? null,
          reciterName: currentTrack?.reciterName ?? null,
          positionSec: status.currentTime,
        });
      }
    } else if (!status.isBuffering && playbackSentinelArmed.current) {
      playbackSentinelArmed.current = false;
      clearPlaybackActive();
    }
  }, [
    status.currentTime,
    status.duration,
    status.isLoaded,
    status.isBuffering,
    status.playing,
  ]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') return;
      if (!playbackSentinelArmed.current) return;
      let stillPlaying = false;
      try {
        stillPlaying = player.playing;
      } catch {
        stillPlaying = false;
      }
      if (stillPlaying) return;
      const rec = peekActivePlayback();
      playbackSentinelArmed.current = false;
      clearPlaybackActive();
      reportStoppedInBackground(rec, 'foreground');
    });
    return () => sub.remove();
  }, [player, reportStoppedInBackground]);

  return null;
}
// ---- End of the pre-C5 copy. ----

function NewObserver({player, status}: HostProps): null {
  usePlaybackObserver(player, status);
  return null;
}

const appStateHandlers = new Set<(state: AppStateStatus) => void>();
let now = 0;
let originalOS: typeof Platform.OS;

beforeEach(() => {
  mockLog.length = 0;
  mockActive = null;
  mockQueue.currentIndex = 0;
  appStateHandlers.clear();
  originalOS = Platform.OS;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, handler) => {
      const h = handler as (state: AppStateStatus) => void;
      appStateHandlers.add(h);
      return {remove: () => appStateHandlers.delete(h)} as ReturnType<
        typeof AppState.addEventListener
      >;
    });
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', {
    value: originalOS,
    configurable: true,
  });
  jest.restoreAllMocks();
});

function setOS(os: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true});
}

/**
 * One session: a load, a play with progress, a rebuffer, a pause, a second
 * play of another track, a silent player death in the background, a return
 * with the audio alive, and a duration-only status change. Returns the calls.
 */
function runSession(Host: (props: HostProps) => null): Call[] {
  mockLog.length = 0;
  mockActive = null;
  mockQueue.currentIndex = 0;
  now = 1_000_000;
  const player = {playing: false};
  let status: ObservedPlaybackStatus = {
    isLoaded: false,
    playing: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
  };
  const view = render(<Host player={player} status={status} />);
  const step = (dt: number, patch: Partial<ObservedPlaybackStatus>): void => {
    now += dt;
    status = {...status, ...patch};
    view.rerender(<Host player={player} status={status} />);
  };
  const appState = (state: AppStateStatus): void => {
    act(() => {
      appStateHandlers.forEach(h => h(state));
    });
  };

  // Load, then play with progress (some ticks inside the throttle window).
  step(50, {isLoaded: true, duration: 300});
  step(100, {isBuffering: true});
  step(100, {isBuffering: false, playing: true, currentTime: 0});
  player.playing = true;
  step(500, {currentTime: 0.5});
  step(500, {currentTime: 1.0});
  step(500, {currentTime: 1.5});
  step(1100, {currentTime: 2.6});
  // A rebuffer mid-play: not playing, buffering. Does not disarm.
  step(400, {playing: false, isBuffering: true});
  step(900, {playing: true, isBuffering: false, currentTime: 3.1});
  // A pause that JS sees: disarms.
  player.playing = false;
  step(700, {playing: false, currentTime: 3.4});
  step(2500, {currentTime: 3.4, duration: 301}); // duration-only change
  // Another track plays: arms with the new track.
  mockQueue.currentIndex = 1;
  player.playing = true;
  step(300, {playing: true, currentTime: 0, duration: 200});
  step(1500, {currentTime: 1.5});
  // Background, then a silent player death (no status), then foreground.
  appState('background');
  player.playing = false;
  now += 60_000;
  appState('active'); // reports once
  appState('active'); // disarmed: no second report
  // Play again; the audio survives the background.
  player.playing = true;
  step(500, {playing: true, currentTime: 1.6});
  appState('background');
  now += 30_000;
  appState('active'); // still playing: no report
  view.unmount();
  return [...mockLog];
}

describe('usePlaybackObserver (C5 move, parity with the inline provider code)', () => {
  it('iOS: the same calls, arguments and order as the inline code', () => {
    setOS('ios');
    const legacy = runSession(LegacyInlineObserver);
    const moved = runSession(NewObserver);
    expect(moved).toEqual(legacy);
    // The session is not empty: it exercised every branch.
    expect(legacy.filter(c => c[0] === 'markPlaybackActive')).toHaveLength(3);
    expect(legacy.filter(c => c[0] === 'clearPlaybackActive')).toHaveLength(2);
    expect(
      legacy.filter(c => c[0] === 'updatePlaybackPosition').length,
    ).toBeGreaterThan(1);
    expect(legacy.filter(c => c[0] === 'recordKill')).toHaveLength(0);
  });

  it('Android: the same calls, and the kill is recorded for the prompt', () => {
    setOS('android');
    const legacy = runSession(LegacyInlineObserver);
    const moved = runSession(NewObserver);
    expect(moved).toEqual(legacy);
    expect(legacy.filter(c => c[0] === 'recordKill')).toHaveLength(1);
  });

  it('the foreground report keeps its event names and payloads', () => {
    setOS('android');
    const calls = runSession(NewObserver);
    const report = calls.findIndex(c => c[0] === 'Sentry.captureMessage');
    // The armed track was the second one, at its last refreshed position.
    expect(calls.slice(report - 1, report + 3)).toEqual([
      ['clearPlaybackActive'],
      [
        'Sentry.captureMessage',
        'playback-stopped-in-background',
        {
          level: 'warning',
          tags: {scope: 'audio', detect_via: 'foreground'},
          extra: {
            surah_id: '36',
            reciter_id: 'r2',
            position_sec: 1.5,
            started_at_ms: 1234,
            detected_at_ms: expect.any(Number),
          },
        },
      ],
      [
        'trackPlaybackStoppedInBackground',
        {
          surah_id: '36',
          reciter_id: 'r2',
          reciter_name: 'Reciter Two',
          position_sec: 1.5,
          started_at_ms: 1234,
          detected_at_ms: expect.any(Number),
        },
      ],
      ['recordKill'],
    ]);
  });

  it('arms with the track and the position of the first playing status', () => {
    setOS('ios');
    const calls = runSession(NewObserver);
    expect(calls.find(c => c[0] === 'markPlaybackActive')).toEqual([
      'markPlaybackActive',
      {
        surahId: '18',
        reciterId: 'r1',
        reciterName: 'Reciter One',
        positionSec: 0,
      },
    ]);
  });

  it('sends nothing before the source is loaded, and drops its listener on unmount', () => {
    const view = render(
      <NewObserver
        player={{playing: false}}
        status={{
          isLoaded: false,
          playing: true,
          isBuffering: false,
          currentTime: 5,
          duration: 10,
        }}
      />,
    );
    expect(mockLog).toEqual([]);
    expect(appStateHandlers.size).toBe(1);
    view.unmount();
    expect(appStateHandlers.size).toBe(0);
  });

  it('refreshes the position at the provider interval (iOS 1 s, Android 2 s)', () => {
    expect(SENTINEL_POSITION_INTERVAL_MS).toBe(
      Platform.OS === 'android' ? 2000 : 1000,
    );
    jest.isolateModules(() => {
      // The isolated registry has its own react-native module.
      const rn = require('react-native') as typeof import('react-native');
      Object.defineProperty(rn.Platform, 'OS', {
        value: 'android',
        configurable: true,
      });
      const mod =
        require('../playbackObserver') as typeof import('../playbackObserver');
      expect(mod.SENTINEL_POSITION_INTERVAL_MS).toBe(2000);
    });
  });
});
