// @ai
/**
 * Guards the REPORT-ONLY playback-health telemetry: the flag gate (fail
 * closed, live), the 6 s no-audio rule, the cancel paths, the daily caps and
 * the never-throw contract.
 */

const mockStorage = new Map<string, string>();
let mockBudgetThrows = false;
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (k: string) => {
      if (mockBudgetThrows) throw new Error('read failed');
      return mockStorage.get(k);
    },
    set: (k: string, v: string) => {
      if (mockBudgetThrows) throw new Error('disk full');
      mockStorage.set(k, v);
    },
  }),
}));

const mockCaptureMessage = jest.fn();
jest.mock('@sentry/react-native', () => ({
  captureMessage: (...a: unknown[]) => mockCaptureMessage(...a),
}));

const mockCapture = jest.fn();
jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    captureDiagnosticEvent: (...a: unknown[]) => mockCapture(...a),
  },
}));

let mockBuildFlag = true;
jest.mock('@/config/featureFlags', () => ({
  isFeatureEnabled: () => mockBuildFlag,
}));

import {AppState} from 'react-native';
import {
  DETECTION_GRACE_MS,
  NO_AUDIO_AFTER_MS,
  PLAYBACK_HEALTH_EVENTS,
  notePlaybackAutoPlayLoad,
  notePlaybackLoad,
  notePlaybackPaused,
  notePlaybackPlayRequested,
  notePlaybackProgress,
  setPlaybackHealthEnabled,
  __resetPlaybackHealthForTests,
} from '../playbackHealth';
import {__resetDeviceDailyBudgetForTests} from '../deviceDailyBudget';

const STREAM = 'https://cdn.example.test/001.mp3';
const DOWNLOAD = 'file:///data/downloads/002.mp3';

let appStateHandler: ((s: string) => void) | null = null;
const mockRemove = jest.fn();

function setAppState(s: string): void {
  (AppState as unknown as {currentState: string}).currentState = s;
}

function events(name: string): unknown[][] {
  return mockCapture.mock.calls.filter(c => c[0] === name);
}

/** A store load-then-play (a user tap): one attempt. */
function startAttempt(url = STREAM): void {
  notePlaybackAutoPlayLoad(url);
  notePlaybackLoad(url);
  notePlaybackPlayRequested(() => 'loading');
}

/** A new process: module state resets, the daily budget store stays. */
function newProcess(): void {
  __resetPlaybackHealthForTests();
  setPlaybackHealthEnabled(true);
}

describe('playbackHealth', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockStorage.clear();
    mockBudgetThrows = false;
    mockBuildFlag = true;
    appStateHandler = null;
    setAppState('active');
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, handler) => {
        appStateHandler = handler as (s: string) => void;
        return {remove: mockRemove} as never;
      });
    __resetDeviceDailyBudgetForTests();
    __resetPlaybackHealthForTests();
  });

  afterEach(() => {
    __resetPlaybackHealthForTests();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses event names that no older build sends', () => {
    expect(PLAYBACK_HEALTH_EVENTS).toEqual({
      ATTEMPT: 'playback_health_attempt',
      FIRST_AUDIO: 'playback_health_first_audio',
      NO_AUDIO: 'playback_health_no_audio',
    });
  });

  it('does nothing while the remote flag is off (the default)', () => {
    startAttempt();
    notePlaybackProgress(0, true, false);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS + 1000);
    notePlaybackProgress(1, true, false);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does nothing when the build flag is off, even with the remote flag on', () => {
    mockBuildFlag = false;
    setPlaybackHealthEnabled(true);
    startAttempt();
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS + 1000);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels the timer when the flag turns off mid-attempt', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    expect(events('playback_health_attempt')).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(1);
    setPlaybackHealthEnabled(false);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS + 1000);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('applies every flag change, not only the first', () => {
    setPlaybackHealthEnabled(false);
    setPlaybackHealthEnabled(true);
    startAttempt();
    expect(events('playback_health_attempt')).toHaveLength(1);
  });

  it('reports first audio when the position advances before 6 s', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    const attempt = events('playback_health_attempt')[0][1] as {
      attempt_id: string;
      source: string;
    };
    expect(attempt).toEqual({
      attempt_id: expect.stringMatching(/^[a-z0-9]+$/),
      source: 'stream',
      load_ms: 0,
      foreground: true,
    });

    notePlaybackProgress(0, false, true);
    jest.advanceTimersByTime(2000);
    notePlaybackProgress(0.5, true, false);

    const first = events('playback_health_first_audio');
    expect(first).toHaveLength(1);
    expect(first[0][1]).toEqual({
      attempt_id: attempt.attempt_id,
      ms_to_first_audio: expect.any(Number),
      load_ms: 0,
      after_no_audio: false,
    });
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('sends one no_audio and one Sentry warning after 6 s in the foreground', () => {
    setPlaybackHealthEnabled(true);
    startAttempt(DOWNLOAD);
    notePlaybackProgress(0, false, true);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS - 1);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    jest.advanceTimersByTime(1);
    // Further ticks with no movement must not re-send.
    notePlaybackProgress(0, false, true);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS * 3);

    const noAudio = events('playback_health_no_audio');
    expect(noAudio).toHaveLength(1);
    expect(noAudio[0][1]).toEqual({
      attempt_id: expect.any(String),
      waited_ms: NO_AUDIO_AFTER_MS,
      source: 'download',
      player_state: 'buffering',
    });
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith('playback-no-audio', {
      level: 'warning',
      tags: {scope: 'playback-health', source: 'download'},
      fingerprint: ['playback-no-audio'],
      extra: {
        attempt_id: (noAudio[0][1] as {attempt_id: string}).attempt_id,
        player_state: 'buffering',
      },
    });
  });

  it('uses the service state when no native status has arrived', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    expect(
      (events('playback_health_no_audio')[0][1] as {player_state: string})
        .player_state,
    ).toBe('loading');
  });

  it('sends nothing when the user pauses before 6 s', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    jest.advanceTimersByTime(3000);
    notePlaybackPaused();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    notePlaybackProgress(0, true, false);
    notePlaybackProgress(1, true, false);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    expect(events('playback_health_first_audio')).toHaveLength(0);
  });

  it('sends nothing when a remote pause (headset, notification) arrives as a native status', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    notePlaybackProgress(0, false, true); // buffering
    jest.advanceTimersByTime(2000);
    notePlaybackProgress(0, false, false); // paused, not buffering
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('does not end the attempt on a first status of paused (no playing or buffering seen yet)', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    notePlaybackProgress(0, false, false);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    expect(events('playback_health_no_audio')).toHaveLength(1);
  });

  it('counts the 6 s from the tap when play() follows its own load', () => {
    setPlaybackHealthEnabled(true);
    notePlaybackAutoPlayLoad(STREAM);
    notePlaybackLoad(STREAM);
    jest.advanceTimersByTime(4000); // the load wait
    notePlaybackPlayRequested(() => 'loading');
    expect(
      (events('playback_health_attempt')[0][1] as {load_ms: number | null})
        .load_ms,
    ).toBe(4000);
    jest.advanceTimersByTime(1999);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    jest.advanceTimersByTime(1);
    const noAudio = events('playback_health_no_audio');
    expect(noAudio).toHaveLength(1);
    expect((noAudio[0][1] as {waited_ms: number}).waited_ms).toBe(
      NO_AUDIO_AFTER_MS,
    );
  });

  it('fires at once when the load wait alone passed 6 s', () => {
    setPlaybackHealthEnabled(true);
    notePlaybackAutoPlayLoad(STREAM);
    notePlaybackLoad(STREAM);
    jest.advanceTimersByTime(7000);
    notePlaybackPlayRequested(() => 'loading');
    jest.advanceTimersByTime(0);
    const noAudio = events('playback_health_no_audio');
    expect(noAudio).toHaveLength(1);
    expect((noAudio[0][1] as {waited_ms: number}).waited_ms).toBe(7000);
  });

  it('counts from play() when the load was long before it (restoreSession)', () => {
    setPlaybackHealthEnabled(true);
    notePlaybackLoad(STREAM);
    jest.advanceTimersByTime(60_000);
    notePlaybackPlayRequested(() => 'ready');
    expect(
      (events('playback_health_attempt')[0][1] as {load_ms: number | null})
        .load_ms,
    ).toBeNull();
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS - 1);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(events('playback_health_no_audio')).toHaveLength(1);
  });

  it('counts from play() for a tap 7 s after a restore load (no false no_audio)', () => {
    setPlaybackHealthEnabled(true);
    // restoreSession loads at boot and does not play.
    notePlaybackLoad(STREAM);
    jest.advanceTimersByTime(7000);
    notePlaybackPlayRequested(() => 'ready');
    expect(
      (events('playback_health_attempt')[0][1] as {load_ms: number | null})
        .load_ms,
    ).toBeNull();
    jest.advanceTimersByTime(0);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS - 1);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    jest.advanceTimersByTime(1);
    const noAudio = events('playback_health_no_audio');
    expect(noAudio).toHaveLength(1);
    expect((noAudio[0][1] as {waited_ms: number}).waited_ms).toBe(
      NO_AUDIO_AFTER_MS,
    );
  });

  it('counts from play() for an unmarked load, however soon the tap', () => {
    setPlaybackHealthEnabled(true);
    notePlaybackLoad(STREAM);
    jest.advanceTimersByTime(1000);
    notePlaybackPlayRequested(() => 'ready');
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS - 1);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(events('playback_health_no_audio')).toHaveLength(1);
  });

  it('applies a mark only to the next load of the same URL', () => {
    setPlaybackHealthEnabled(true);
    // A mark for another URL does not apply.
    notePlaybackAutoPlayLoad('https://cdn.example.test/other.mp3');
    notePlaybackLoad(STREAM);
    jest.advanceTimersByTime(3000);
    notePlaybackPlayRequested(() => 'ready');
    expect(
      (events('playback_health_attempt')[0][1] as {load_ms: number | null})
        .load_ms,
    ).toBeNull();
    // A mark is spent by one load: a second, unmarked load of the URL counts
    // from play().
    notePlaybackAutoPlayLoad(STREAM);
    notePlaybackLoad(STREAM);
    notePlaybackLoad(STREAM);
    jest.advanceTimersByTime(3000);
    notePlaybackPlayRequested(() => 'ready');
    expect(
      (events('playback_health_attempt')[1][1] as {load_ms: number | null})
        .load_ms,
    ).toBeNull();
  });

  it('counts from play() when a pause or stop came after a marked load', () => {
    setPlaybackHealthEnabled(true);
    notePlaybackAutoPlayLoad(STREAM);
    notePlaybackLoad(STREAM);
    notePlaybackPaused();
    jest.advanceTimersByTime(7000);
    notePlaybackPlayRequested(() => 'paused');
    expect(
      (events('playback_health_attempt')[0][1] as {load_ms: number | null})
        .load_ms,
    ).toBeNull();
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS - 1);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(events('playback_health_no_audio')).toHaveLength(1);
  });

  it('a pause clears a mark that no load has spent yet', () => {
    setPlaybackHealthEnabled(true);
    notePlaybackAutoPlayLoad(STREAM);
    notePlaybackPaused();
    notePlaybackLoad(STREAM);
    jest.advanceTimersByTime(3000);
    notePlaybackPlayRequested(() => 'ready');
    expect(
      (events('playback_health_attempt')[0][1] as {load_ms: number | null})
        .load_ms,
    ).toBeNull();
  });

  it('waits one grace period when the player already reports playing at 6 s', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    jest.advanceTimersByTime(5600);
    notePlaybackProgress(0, true, false); // baseline, playing
    jest.advanceTimersByTime(400); // the 6 s mark
    expect(events('playback_health_no_audio')).toHaveLength(0);
    jest.advanceTimersByTime(500);
    notePlaybackProgress(0.5, true, false); // audio moved
    jest.advanceTimersByTime(DETECTION_GRACE_MS);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    expect(events('playback_health_first_audio')[0][1]).toMatchObject({
      after_no_audio: false,
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('sends no_audio after the grace period when a playing position never moves', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    notePlaybackProgress(0, true, false);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    notePlaybackProgress(0, true, false);
    jest.advanceTimersByTime(DETECTION_GRACE_MS);
    const noAudio = events('playback_health_no_audio');
    expect(noAudio).toHaveLength(1);
    expect(noAudio[0][1]).toMatchObject({
      waited_ms: NO_AUDIO_AFTER_MS + DETECTION_GRACE_MS,
      player_state: 'playing',
    });
    // Only one extension.
    jest.advanceTimersByTime(DETECTION_GRACE_MS * 5);
    expect(events('playback_health_no_audio')).toHaveLength(1);
  });

  it('cancels the grace period when the app goes to the background', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    notePlaybackProgress(0, true, false);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    // The listener must stay subscribed through the grace second.
    expect(mockRemove).not.toHaveBeenCalled();
    setAppState('background');
    appStateHandler?.('background');
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(DETECTION_GRACE_MS);
    expect(events('playback_health_no_audio')).toHaveLength(0);
  });

  it('does not treat a resume of the same source as a new attempt', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    notePlaybackPaused();
    notePlaybackPlayRequested(() => 'paused');
    expect(events('playback_health_attempt')).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sends no_audio for nothing when the app goes to the background', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    jest.advanceTimersByTime(2000);
    setAppState('background');
    appStateHandler?.('background');
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('arms no timer for an attempt that starts in the background', () => {
    setPlaybackHealthEnabled(true);
    setAppState('background');
    startAttempt();
    expect(events('playback_health_attempt')).toHaveLength(1);
    expect(events('playback_health_attempt')[0][1]).toMatchObject({
      foreground: false,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports a late first audio with after_no_audio = true', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    notePlaybackProgress(0, false, true);
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    expect(events('playback_health_no_audio')).toHaveLength(1);
    jest.advanceTimersByTime(4000);
    notePlaybackProgress(0.6, true, false);
    const first = events('playback_health_first_audio');
    expect(first).toHaveLength(1);
    expect(first[0][1]).toMatchObject({after_no_audio: true});
  });

  it('cancels the old timer when a new track loads', () => {
    setPlaybackHealthEnabled(true);
    startAttempt(STREAM);
    jest.advanceTimersByTime(4000);
    notePlaybackLoad('https://cdn.example.test/003.mp3');
    expect(jest.getTimerCount()).toBe(0);
    notePlaybackPlayRequested(() => 'loading');
    expect(events('playback_health_attempt')).toHaveLength(2);
    // The old attempt's 6 s passes: nothing.
    jest.advanceTimersByTime(2500);
    expect(events('playback_health_no_audio')).toHaveLength(0);
    // The new attempt's 6 s passes: one event, for the new attempt.
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    const noAudio = events('playback_health_no_audio');
    expect(noAudio).toHaveLength(1);
    expect((noAudio[0][1] as {attempt_id: string}).attempt_id).toBe(
      (events('playback_health_attempt')[1][1] as {attempt_id: string})
        .attempt_id,
    );
  });

  it('treats a large jump as a seek, not as audio', () => {
    setPlaybackHealthEnabled(true);
    startAttempt();
    notePlaybackProgress(0, true, false);
    notePlaybackProgress(120, true, false);
    expect(events('playback_health_first_audio')).toHaveLength(0);
    notePlaybackProgress(120.5, true, false);
    expect(events('playback_health_first_audio')).toHaveLength(1);
  });

  it('enforces the daily caps', () => {
    setPlaybackHealthEnabled(true);
    for (let i = 0; i < 12; i++) {
      startAttempt(`https://cdn.example.test/${i}.mp3`);
      jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    }
    expect(events('playback_health_attempt')).toHaveLength(12);
    expect(events('playback_health_no_audio')).toHaveLength(10);
    // One Sentry warning per process.
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
  });

  it('caps Sentry at 3 a day across processes, and spends no unit on a second warning in one process', () => {
    newProcess();
    // Process 1: two no-audio attempts, one Sentry warning, one daily unit.
    for (let i = 0; i < 2; i++) {
      startAttempt(`https://cdn.example.test/p1-${i}.mp3`);
      jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    }
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    // Processes 2 and 3 each spend one more unit. Process 4 finds none left.
    for (let p = 2; p <= 4; p++) {
      newProcess();
      startAttempt(`https://cdn.example.test/p${p}.mp3`);
      jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    }
    expect(events('playback_health_no_audio')).toHaveLength(5);
    expect(mockCaptureMessage).toHaveBeenCalledTimes(3);
  });

  it('caps playback_health_attempt at 100 a day', () => {
    setPlaybackHealthEnabled(true);
    for (let i = 0; i < 105; i++) {
      startAttempt(`https://cdn.example.test/${i}.mp3`);
    }
    expect(events('playback_health_attempt')).toHaveLength(100);
  });

  it('emits nothing when the budget store throws', () => {
    mockBudgetThrows = true;
    setPlaybackHealthEnabled(true);
    startAttempt();
    jest.advanceTimersByTime(NO_AUDIO_AFTER_MS);
    notePlaybackProgress(0, true, false);
    notePlaybackProgress(1, true, false);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('swallows an internal throw', () => {
    setPlaybackHealthEnabled(true);
    mockCapture.mockImplementation(() => {
      throw new Error('posthog exploded');
    });
    mockCaptureMessage.mockImplementation(() => {
      throw new Error('sentry exploded');
    });
    expect(() => startAttempt()).not.toThrow();
    expect(() => jest.advanceTimersByTime(NO_AUDIO_AFTER_MS)).not.toThrow();
    expect(() => notePlaybackProgress(Number.NaN, true, false)).not.toThrow();
    expect(() =>
      notePlaybackPlayRequested(() => {
        throw new Error('state reader exploded');
      }),
    ).not.toThrow();
    expect(() => notePlaybackPaused()).not.toThrow();
  });
});
