// @ai-generated
// Qariah (Sprint 48, S48.6): the field report of the background runs — the
// record of each run, and ONE `notification_background_run` event at the next
// boot, through the analytics service.
import {
  BACKGROUND_RUNS_SINCE_REPORT_KEY,
  LAST_BACKGROUND_RUN_AT_KEY,
  LAST_BACKGROUND_RUN_REPORTED_KEY,
  LAST_BACKGROUND_STATUS_KEY,
  NOTIFICATION_BACKGROUND_RUN_EVENT,
  pendingBackgroundRunReport,
  recordBackgroundRun,
  reportBackgroundRun,
  type BackgroundRunAnalytics,
} from '../backgroundRunReport';
import type {KeyValueStorage} from '../types';

function memoryStorage(): KeyValueStorage & {data: Map<string, string>} {
  const data = new Map<string, string>();
  return {
    data,
    getString: key => data.get(key),
    set: (key, value) => {
      data.set(key, value);
    },
    remove: key => {
      data.delete(key);
    },
  };
}

function fakeAnalytics(ready = true) {
  const listeners = new Set<() => void>();
  const state = {ready};
  const analytics = {
    isReadyToCapture: jest.fn(() => state.ready),
    onReadyToCapture: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    captureDiagnosticEvent: jest.fn(),
  };
  const becomeReady = () => {
    state.ready = true;
    listeners.forEach(listener => listener());
  };
  return {
    analytics: analytics satisfies BackgroundRunAnalytics,
    becomeReady,
    listeners,
  };
}

const RUN = new Date('2026-10-20T03:00:00.000Z');
const BOOT = new Date('2026-10-20T09:30:00.000Z'); // 6.5 h later

afterEach(() => {
  jest.useRealTimers();
});

describe('recordBackgroundRun', () => {
  it('keeps the time and the status of the last run, and counts the runs', () => {
    const storage = memoryStorage();
    recordBackgroundRun(storage, 'first_check', RUN);
    recordBackgroundRun(storage, 'version_unchanged', BOOT);
    expect(storage.data.get(LAST_BACKGROUND_RUN_AT_KEY)).toBe(
      BOOT.toISOString(),
    );
    expect(storage.data.get(LAST_BACKGROUND_STATUS_KEY)).toBe(
      'version_unchanged',
    );
    expect(storage.data.get(BACKGROUND_RUNS_SINCE_REPORT_KEY)).toBe('2');
  });

  it('does not throw when the storage throws', () => {
    const storage = memoryStorage();
    storage.set = () => {
      throw new Error('full');
    };
    expect(() => recordBackgroundRun(storage, 'posted', RUN)).not.toThrow();
  });
});

describe('pendingBackgroundRunReport', () => {
  const context = {now: BOOT, platform: 'ios', launchWasBackground: true};

  it('gives nothing when no run happened', () => {
    expect(pendingBackgroundRunReport(memoryStorage(), context)).toBeNull();
  });

  it('gives the props of the last run', () => {
    const storage = memoryStorage();
    recordBackgroundRun(storage, 'first_check', RUN);
    expect(pendingBackgroundRunReport(storage, context)).toEqual({
      platform: 'ios',
      status: 'first_check',
      hours_since_run: 6.5,
      launch_was_background: true,
      runs_since_report: 1,
    });
  });

  it('gives nothing for a run that was reported', () => {
    const storage = memoryStorage();
    recordBackgroundRun(storage, 'first_check', RUN);
    storage.set(LAST_BACKGROUND_RUN_REPORTED_KEY, RUN.toISOString());
    expect(pendingBackgroundRunReport(storage, context)).toBeNull();
  });
});

describe('reportBackgroundRun', () => {
  it('sends ONE event for the runs since the last report, then marks them reported', async () => {
    const storage = memoryStorage();
    recordBackgroundRun(storage, 'first_check', RUN);
    recordBackgroundRun(storage, 'nothing_new', RUN);
    const {analytics} = fakeAnalytics(true);
    const deps = {
      storage,
      analytics,
      platform: 'android',
      launchWasBackground: false,
      now: () => BOOT,
    };
    await expect(reportBackgroundRun(deps)).resolves.toBe('sent');
    expect(analytics.captureDiagnosticEvent).toHaveBeenCalledTimes(1);
    expect(analytics.captureDiagnosticEvent).toHaveBeenCalledWith(
      NOTIFICATION_BACKGROUND_RUN_EVENT,
      {
        platform: 'android',
        status: 'nothing_new',
        hours_since_run: 6.5,
        launch_was_background: false,
        runs_since_report: 2,
      },
    );
    expect(storage.data.get(LAST_BACKGROUND_RUN_REPORTED_KEY)).toBe(
      RUN.toISOString(),
    );
    expect(storage.data.has(BACKGROUND_RUNS_SINCE_REPORT_KEY)).toBe(false);

    // The next boot has nothing to report.
    await expect(reportBackgroundRun(deps)).resolves.toBe('nothing');
    expect(analytics.captureDiagnosticEvent).toHaveBeenCalledTimes(1);

    // A new run is reported again.
    recordBackgroundRun(storage, 'posted', BOOT);
    await expect(reportBackgroundRun(deps)).resolves.toBe('sent');
    expect(analytics.captureDiagnosticEvent).toHaveBeenCalledTimes(2);
  });

  it('sends nothing, and asks nothing of the analytics, when no run happened', async () => {
    const {analytics} = fakeAnalytics(false);
    await expect(
      reportBackgroundRun({storage: memoryStorage(), analytics}),
    ).resolves.toBe('nothing');
    expect(analytics.onReadyToCapture).not.toHaveBeenCalled();
  });

  it('waits until the analytics service can capture (the consent is known)', async () => {
    const storage = memoryStorage();
    recordBackgroundRun(storage, 'posted', RUN);
    const {analytics, becomeReady, listeners} = fakeAnalytics(false);
    const report = reportBackgroundRun({
      storage,
      analytics,
      platform: 'ios',
      launchWasBackground: true,
      now: () => BOOT,
    });
    await Promise.resolve();
    expect(analytics.captureDiagnosticEvent).not.toHaveBeenCalled();
    becomeReady();
    await expect(report).resolves.toBe('sent');
    expect(analytics.captureDiagnosticEvent).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('marks nothing when the analytics service is not ready in time, so the next boot tries again', async () => {
    jest.useFakeTimers();
    const storage = memoryStorage();
    recordBackgroundRun(storage, 'posted', RUN);
    const {analytics, listeners} = fakeAnalytics(false);
    const report = reportBackgroundRun({storage, analytics, waitMs: 1000});
    await jest.advanceTimersByTimeAsync(1000);
    await expect(report).resolves.toBe('not_ready');
    expect(analytics.captureDiagnosticEvent).not.toHaveBeenCalled();
    expect(storage.data.has(LAST_BACKGROUND_RUN_REPORTED_KEY)).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it('does not throw when the capture throws', async () => {
    const storage = memoryStorage();
    recordBackgroundRun(storage, 'posted', RUN);
    const {analytics} = fakeAnalytics(true);
    analytics.captureDiagnosticEvent.mockImplementation(() => {
      throw new Error('posthog');
    });
    await expect(reportBackgroundRun({storage, analytics})).resolves.toBe(
      'not_ready',
    );
    expect(storage.data.has(LAST_BACKGROUND_RUN_REPORTED_KEY)).toBe(false);
  });
});
