// @ai Qariah (TECH_DEBT #391): the rules that send each analytics signal once.

const mockAnalytics = {
  trackAppOpened: jest.fn(),
  trackAppBackgrounded: jest.fn(),
  trackPlaybackSeeked: jest.fn(),
};
jest.mock('../AnalyticsService', () => ({
  get analyticsService() {
    return mockAnalytics;
  },
}));

import {
  appLifecycleListener,
  firstOpenInSession,
  flushPendingSeek,
  isTrackEndPause,
  markAutoplayStart,
  noteSeek,
  SEEK_RUN_MS,
  takeAutoplayStart,
} from '../qariahEventGates';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isTrackEndPause (line 2)', () => {
  it('is true when expo-audio reports didJustFinish', () => {
    expect(
      isTrackEndPause({didJustFinish: true, currentTime: 12, duration: 300}),
    ).toBe(true);
  });

  it('is true for a stop in the last 2 s, before didJustFinish (iOS)', () => {
    expect(isTrackEndPause({currentTime: 299.4, duration: 300})).toBe(true);
  });

  it('is false for a pause mid-track', () => {
    expect(isTrackEndPause({currentTime: 120, duration: 300})).toBe(false);
  });

  it('is false when the duration is not known', () => {
    expect(isTrackEndPause({currentTime: 0, duration: 0})).toBe(false);
  });
});

describe('the autoplay mark (line 4)', () => {
  it('is true once for the marked track', () => {
    markAutoplayStart('r:2');
    expect(takeAutoplayStart('r:2')).toBe(true);
    expect(takeAutoplayStart('r:2')).toBe(false);
  });

  it('is dropped by the first start of another track', () => {
    markAutoplayStart('r:2');
    expect(takeAutoplayStart('r:9')).toBe(false);
    expect(takeAutoplayStart('r:2')).toBe(false);
  });

  it('is cleared by a null mark (a skip by the user)', () => {
    markAutoplayStart('r:2');
    markAutoplayStart(null);
    expect(takeAutoplayStart('r:2')).toBe(false);
  });
});

describe('noteSeek (line 9)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    flushPendingSeek();
    jest.useRealTimers();
  });

  it('sends one event for a run, SEEK_RUN_MS after the last seek', () => {
    noteSeek('r:1', {surah_id: 1, from_ms: 0, to_ms: 15_000});
    jest.advanceTimersByTime(SEEK_RUN_MS - 1);
    noteSeek('r:1', {surah_id: 1, from_ms: 15_000, to_ms: 30_000});
    jest.advanceTimersByTime(SEEK_RUN_MS - 1);
    expect(mockAnalytics.trackPlaybackSeeked).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(mockAnalytics.trackPlaybackSeeked).toHaveBeenCalledTimes(1);
    expect(mockAnalytics.trackPlaybackSeeked).toHaveBeenCalledWith({
      surah_id: 1,
      from_ms: 0,
      to_ms: 30_000,
    });
  });

  it('a seek on another track sends the pending event at once', () => {
    noteSeek('r:1', {surah_id: 1, from_ms: 0, to_ms: 15_000});
    noteSeek('r:2', {surah_id: 2, from_ms: 0, to_ms: 9_000});
    expect(mockAnalytics.trackPlaybackSeeked).toHaveBeenCalledTimes(1);
    expect(mockAnalytics.trackPlaybackSeeked).toHaveBeenCalledWith({
      surah_id: 1,
      from_ms: 0,
      to_ms: 15_000,
    });
  });

  it('flushPendingSeek with nothing pending sends nothing', () => {
    flushPendingSeek();
    expect(mockAnalytics.trackPlaybackSeeked).not.toHaveBeenCalled();
  });
});

describe('appLifecycleListener (line 5)', () => {
  it('a pull-down of Control Center or the notification list (inactive) sends nothing', () => {
    const on = appLifecycleListener('active');
    on('inactive');
    on('active');
    expect(mockAnalytics.trackAppBackgrounded).not.toHaveBeenCalled();
    expect(mockAnalytics.trackAppOpened).not.toHaveBeenCalled();
  });

  it('a real background sends app_backgrounded once, and the return sends app_opened', () => {
    const on = appLifecycleListener('active');
    on('inactive');
    on('background');
    on('inactive');
    on('background');
    on('active');
    expect(mockAnalytics.trackAppBackgrounded).toHaveBeenCalledTimes(1);
    expect(mockAnalytics.trackAppOpened).toHaveBeenCalledTimes(1);
  });

  it('a launch in the background sends app_opened when the app comes to the front', () => {
    const on = appLifecycleListener('background');
    on('active');
    expect(mockAnalytics.trackAppOpened).toHaveBeenCalledTimes(1);
    expect(mockAnalytics.trackAppBackgrounded).not.toHaveBeenCalled();
  });

  it('Android (active and background only) is unchanged', () => {
    const on = appLifecycleListener('active');
    on('background');
    on('active');
    on('background');
    on('active');
    expect(mockAnalytics.trackAppBackgrounded).toHaveBeenCalledTimes(2);
    expect(mockAnalytics.trackAppOpened).toHaveBeenCalledTimes(2);
  });
});

describe('firstOpenInSession (line 6)', () => {
  it('is true once for each page of a session', () => {
    const opened = new Set<number>();
    expect(firstOpenInSession(opened, 5)).toBe(true);
    expect(firstOpenInSession(opened, 6)).toBe(true);
    expect(firstOpenInSession(opened, 5)).toBe(false);
    expect(firstOpenInSession(new Set<number>(), 5)).toBe(true);
  });
});
