/**
 * @ai Qariah (TECH_DEBT #391, lines 4 and 9 of
 * planning/posthog-event-cut-proposal.md).
 *
 * Line 4: upstream sent `playback_skipped` for every automatic advance at a
 * track end (42 k of 47 k skips in October). `skipToNext({auto: true})` sends
 * no skip; it marks the next track, so its `playback_started` says
 * `source: 'autoplay'`. A skip by the user is unchanged.
 *
 * Line 9: a run of seeks (a slider drag, taps on ±15 s) sent one
 * `playback_seeked` for each step. The store now sends one event for the run,
 * with the first `from_ms` and the last `to_ms`.
 */

jest.mock('@/services/audio/ExpoAudioService', () => ({
  expoAudioService: {
    loadTrack: jest.fn(() => Promise.resolve()),
    play: jest.fn(() => Promise.resolve(true)),
    pause: jest.fn(() => Promise.resolve()),
    seekTo: jest.fn(() => Promise.resolve()),
    getDuration: jest.fn(() => 120),
    getIsLoaded: jest.fn(() => true),
    holdsSource: jest.fn(() => true),
    runningLoad: jest.fn(() => null),
    getCurrentTime: jest.fn(() => 0),
    getPosition: jest.fn(() => 0),
    getIsPlaying: jest.fn(() => false),
    setRate: jest.fn(),
    cleanup: jest.fn(),
  },
}));

jest.mock('@/services/audio/AudioCoordinator', () => ({
  audioCoordinator: {mainWillPlay: jest.fn()},
}));

jest.mock('@/services/analytics/AnalyticsService', () => ({
  analyticsService: {
    trackPlaybackSkipped: jest.fn(),
    trackPlaybackSeeked: jest.fn(),
    trackRateChanged: jest.fn(),
  },
}));

jest.mock('@/services/diagnostics/diagnostics', () => ({
  diagBreadcrumb: jest.fn(),
}));

jest.mock('@/services/diagnostics/playbackHealth', () => ({
  notePlaybackAutoPlayLoad: jest.fn(),
}));

import {usePlayerStore} from '../playerStore';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import {
  flushPendingSeek,
  SEEK_RUN_MS,
  takeAutoplayStart,
} from '@/services/analytics/qariahEventGates';
import type {Track} from '@/types/audio';

const analytics = analyticsService as unknown as {
  trackPlaybackSkipped: jest.Mock;
  trackPlaybackSeeked: jest.Mock;
};

function makeTrack(id: string, surahId: string): Track {
  return {
    id,
    url: `https://cdn.example.com/${id}.mp3`,
    title: `Track ${id}`,
    artist: 'Test Reciter',
    reciterId: 'test-reciter',
    reciterName: 'Test Reciter',
    surahId,
  } as unknown as Track;
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));

/** A loaded queue of two surahs on track 0, in 'playing'. */
async function startQueue(): Promise<void> {
  await usePlayerStore
    .getState()
    .updateQueue([makeTrack('r:1', '1'), makeTrack('r:2', '2')], 0);
  await flush();
  usePlayerStore.getState().updatePlaybackState({state: 'playing'});
  jest.clearAllMocks();
  takeAutoplayStart(''); // clear any mark from an earlier test
}

describe('playback_skipped: only a skip by the user (TECH_DEBT #391 line 4)', () => {
  beforeEach(() => {
    usePlayerStore.getState().reset();
  });

  it('a skip by the user sends playback_skipped and marks no autoplay start', async () => {
    await startQueue();

    await usePlayerStore.getState().skipToNext();

    expect(analytics.trackPlaybackSkipped).toHaveBeenCalledTimes(1);
    expect(analytics.trackPlaybackSkipped).toHaveBeenCalledWith(
      expect.objectContaining({surah_id: 1, direction: 'next'}),
    );
    expect(usePlayerStore.getState().queue.currentIndex).toBe(1);
    expect(takeAutoplayStart('r:2')).toBe(false);
  });

  it('an automatic advance sends no playback_skipped and marks the next track as autoplay', async () => {
    await startQueue();

    await usePlayerStore.getState().skipToNext({auto: true});

    expect(analytics.trackPlaybackSkipped).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queue.currentIndex).toBe(1);
    expect(takeAutoplayStart('r:2')).toBe(true);
    // The first playback_started consumes the mark.
    expect(takeAutoplayStart('r:2')).toBe(false);
  });

  it('a skip by the user after an automatic advance clears the mark', async () => {
    await startQueue();
    usePlayerStore.getState().setRepeatMode('queue');

    await usePlayerStore.getState().skipToNext({auto: true});
    await usePlayerStore.getState().skipToNext();

    expect(analytics.trackPlaybackSkipped).toHaveBeenCalledTimes(1);
    expect(takeAutoplayStart('r:1')).toBe(false);
  });

  it('a press event as the argument is a skip by the user', async () => {
    await startQueue();

    // An onPress handler passes its event object.
    await (
      usePlayerStore.getState().skipToNext as (e: unknown) => Promise<void>
    )({nativeEvent: {}});

    expect(analytics.trackPlaybackSkipped).toHaveBeenCalledTimes(1);
  });
});

describe('playback_seeked: one event for a run of seeks (TECH_DEBT #391 line 9)', () => {
  beforeEach(async () => {
    usePlayerStore.getState().reset();
    await startQueue();
    jest.useFakeTimers();
  });

  afterEach(() => {
    flushPendingSeek();
    jest.useRealTimers();
  });

  it('three ±15 s taps in a row send one event: the first from, the last to', async () => {
    usePlayerStore.getState().updatePlaybackState({position: 10});

    await usePlayerStore.getState().seekTo(25);
    await jest.advanceTimersByTimeAsync(400);
    await usePlayerStore.getState().seekTo(40);
    await jest.advanceTimersByTimeAsync(400);
    await usePlayerStore.getState().seekTo(55);

    expect(analytics.trackPlaybackSeeked).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(SEEK_RUN_MS);

    expect(analytics.trackPlaybackSeeked).toHaveBeenCalledTimes(1);
    expect(analytics.trackPlaybackSeeked).toHaveBeenCalledWith({
      surah_id: 1,
      from_ms: 10_000,
      to_ms: 55_000,
    });
  });

  it('two seeks further apart than the run window send two events', async () => {
    usePlayerStore.getState().updatePlaybackState({position: 10});

    await usePlayerStore.getState().seekTo(30);
    await jest.advanceTimersByTimeAsync(SEEK_RUN_MS + 100);
    await usePlayerStore.getState().seekTo(90);
    await jest.advanceTimersByTimeAsync(SEEK_RUN_MS + 100);

    expect(analytics.trackPlaybackSeeked).toHaveBeenCalledTimes(2);
    expect(analytics.trackPlaybackSeeked.mock.calls[0][0]).toEqual({
      surah_id: 1,
      from_ms: 10_000,
      to_ms: 30_000,
    });
    expect(analytics.trackPlaybackSeeked.mock.calls[1][0]).toEqual({
      surah_id: 1,
      from_ms: 30_000,
      to_ms: 90_000,
    });
  });

  it('a seek on the next track sends the pending seek of the last track first', async () => {
    usePlayerStore.getState().updatePlaybackState({position: 10});
    await usePlayerStore.getState().seekTo(20);

    await usePlayerStore.getState().skipToNext();
    usePlayerStore.getState().updatePlaybackState({position: 0});
    await usePlayerStore.getState().seekTo(5);

    expect(analytics.trackPlaybackSeeked).toHaveBeenCalledTimes(1);
    expect(analytics.trackPlaybackSeeked).toHaveBeenCalledWith({
      surah_id: 1,
      from_ms: 10_000,
      to_ms: 20_000,
    });
    await jest.advanceTimersByTimeAsync(SEEK_RUN_MS);
    expect(analytics.trackPlaybackSeeked).toHaveBeenCalledTimes(2);
    expect(analytics.trackPlaybackSeeked).toHaveBeenLastCalledWith({
      surah_id: 2,
      from_ms: 0,
      to_ms: 5_000,
    });
  });
});
