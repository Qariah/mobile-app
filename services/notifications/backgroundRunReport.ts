// @ai-generated
// Qariah (Sprint 48, S48.6): field evidence that the background task runs.
//
// On iOS, React Native starts only when a scene connects
// (`modules/bayaan-car/ios/BayaanCarSceneBridge.swift` `ensureStarted`), so a
// BGTask launch may run no JS at all (the task event waits for the next user
// launch), or it may run the whole boot in the background. Nothing on a test
// device shows which one the field gets. So:
// - each run of the task body records its time and status in MMKV
//   (`recordBackgroundRun`, called by `catalogTask.ts`);
// - the next boot sends ONE PostHog event `notification_background_run` for
//   the runs since the last report (`reportBackgroundRun`, called by
//   `backgroundTask.ts`), then marks them reported.
// The event goes through `analyticsService.captureDiagnosticEvent()`, so the
// consent gate and the dev/simulator drop apply. The event name is owned here,
// as `services/diagnostics/playbackHealth.ts` does, so the upstream
// `events.ts` does not change.
import {AppState, Platform} from 'react-native';
import type {KeyValueStorage} from './types';

/** MMKV (`qariah-notifications`): the ISO time of the last background run. */
export const LAST_BACKGROUND_RUN_AT_KEY = 'last_background_run_at';
/** MMKV: the status of the last background run. */
export const LAST_BACKGROUND_STATUS_KEY = 'last_background_status';
/** MMKV: the number of background runs since the last report. */
export const BACKGROUND_RUNS_SINCE_REPORT_KEY = 'background_runs_since_report';
/** MMKV: the `last_background_run_at` value that the last event reported. */
export const LAST_BACKGROUND_RUN_REPORTED_KEY = 'last_background_run_reported';

export const NOTIFICATION_BACKGROUND_RUN_EVENT = 'notification_background_run';

/** The report waits this long for the analytics consent and PostHog. */
export const BACKGROUND_RUN_REPORT_WAIT_MS = 60_000;

/** Records one run of the task body. Never throws. */
export function recordBackgroundRun(
  storage: KeyValueStorage,
  status: string,
  now: Date = new Date(),
): void {
  try {
    const runs = Number(storage.getString(BACKGROUND_RUNS_SINCE_REPORT_KEY));
    storage.set(LAST_BACKGROUND_RUN_AT_KEY, now.toISOString());
    storage.set(LAST_BACKGROUND_STATUS_KEY, status);
    storage.set(
      BACKGROUND_RUNS_SINCE_REPORT_KEY,
      String(Number.isFinite(runs) && runs > 0 ? runs + 1 : 1),
    );
  } catch {
    // Best effort: a missed record is a missed report, nothing more.
  }
}

export interface BackgroundRunEventProps {
  [key: string]: string | number | boolean | null;
  platform: string;
  /** The status of the last run. */
  status: string;
  /** Hours from the last run to this report, one decimal. */
  hours_since_run: number;
  /** This launch was in the background (the iOS BGTask launch ran the boot). */
  launch_was_background: boolean;
  /** Runs since the last report (the event reports the last one). */
  runs_since_report: number;
}

/**
 * The props of the event for the runs since the last report, or `null` when
 * there is none (or the stored values cannot be read).
 */
export function pendingBackgroundRunReport(
  storage: KeyValueStorage,
  context: {now: Date; platform: string; launchWasBackground: boolean},
): BackgroundRunEventProps | null {
  try {
    const runAt = storage.getString(LAST_BACKGROUND_RUN_AT_KEY);
    if (!runAt) return null;
    if (storage.getString(LAST_BACKGROUND_RUN_REPORTED_KEY) === runAt) {
      return null;
    }
    const runTime = Date.parse(runAt);
    if (!Number.isFinite(runTime)) return null;
    const hours = Math.max(0, (context.now.getTime() - runTime) / 3_600_000);
    const runs = Number(storage.getString(BACKGROUND_RUNS_SINCE_REPORT_KEY));
    return {
      platform: context.platform,
      status: storage.getString(LAST_BACKGROUND_STATUS_KEY) ?? 'unknown',
      hours_since_run: Math.round(hours * 10) / 10,
      launch_was_background: context.launchWasBackground,
      runs_since_report: Number.isFinite(runs) && runs > 0 ? runs : 1,
    };
  } catch {
    return null;
  }
}

/** Marks the runs up to `LAST_BACKGROUND_RUN_AT_KEY` as reported. Never throws. */
export function markBackgroundRunReported(storage: KeyValueStorage): void {
  try {
    const runAt = storage.getString(LAST_BACKGROUND_RUN_AT_KEY);
    if (runAt) storage.set(LAST_BACKGROUND_RUN_REPORTED_KEY, runAt);
    storage.remove(BACKGROUND_RUNS_SINCE_REPORT_KEY);
  } catch {
    // The next boot reports the same runs again: a duplicate, not a loss.
  }
}

/** The part of `analyticsService` that the report uses. */
export interface BackgroundRunAnalytics {
  isReadyToCapture(): boolean;
  onReadyToCapture(listener: () => void): () => void;
  captureDiagnosticEvent(
    event: string,
    properties: Record<string, string | number | boolean | null>,
  ): void;
}

export type BackgroundRunReportStatus = 'sent' | 'nothing' | 'not_ready';

export interface ReportBackgroundRunDeps {
  storage: KeyValueStorage;
  /** Default: `analyticsService`. */
  analytics?: BackgroundRunAnalytics;
  /** Default: `AppState.currentState !== 'active'` at the time of the report. */
  launchWasBackground?: boolean;
  platform?: string;
  now?: () => Date;
  waitMs?: number;
}

function defaultAnalytics(): BackgroundRunAnalytics {
  return (
    require('@/services/analytics/AnalyticsService') as typeof import('@/services/analytics/AnalyticsService')
  ).analyticsService;
}

/**
 * Sends ONE `notification_background_run` event when a background run
 * happened since the last report, then marks it reported. It waits up to
 * `waitMs` for `analyticsService.isReadyToCapture()` (the consent choice is
 * known, and PostHog is attached when consent is granted). With consent off,
 * the capture drops the event, and the runs count as reported. When the wait
 * ends first, nothing is marked: the next boot tries again. Never throws.
 */
export async function reportBackgroundRun(
  deps: ReportBackgroundRunDeps,
): Promise<BackgroundRunReportStatus> {
  try {
    const now = deps.now ?? (() => new Date());
    const peek = pendingBackgroundRunReport(deps.storage, {
      now: now(),
      platform: deps.platform ?? Platform.OS,
      launchWasBackground: false,
    });
    if (!peek) return 'nothing';
    const analytics = deps.analytics ?? defaultAnalytics();
    const ready = await new Promise<boolean>(resolve => {
      if (analytics.isReadyToCapture()) {
        resolve(true);
        return;
      }
      let unsubscribe: () => void = () => undefined;
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(analytics.isReadyToCapture());
      }, deps.waitMs ?? BACKGROUND_RUN_REPORT_WAIT_MS);
      unsubscribe = analytics.onReadyToCapture(() => {
        if (!analytics.isReadyToCapture()) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      });
    });
    if (!ready) return 'not_ready';
    const props = pendingBackgroundRunReport(deps.storage, {
      now: now(),
      platform: deps.platform ?? Platform.OS,
      launchWasBackground:
        deps.launchWasBackground ?? AppState.currentState !== 'active',
    });
    if (!props) return 'nothing';
    analytics.captureDiagnosticEvent(NOTIFICATION_BACKGROUND_RUN_EVENT, props);
    markBackgroundRunReported(deps.storage);
    return 'sent';
  } catch {
    return 'not_ready';
  }
}
