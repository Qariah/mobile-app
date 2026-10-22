// @ai Qariah (TECH_DEBT #243) — pins the reciter-profile surah-list watchdog
// after its move out of ReciterProfile.tsx: the Sentry message name, tags and
// extra, the PostHog event props, the 5 s budget, the once-per-mount guard,
// the budget restart on a new reciter object, and the success event.

import {renderHook} from '@testing-library/react-native';
import {Platform} from 'react-native';
import {useReciterProfileSurahsWatchdog} from '../useContentReadyWatchdog';

const mockCaptureMessage = jest.fn();
jest.mock('@sentry/react-native', () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));
const mockStalled = jest.fn();
const mockRendered = jest.fn();
jest.mock('@/services/analytics/qariahEvents', () => ({
  qariahAnalytics: {
    trackReciterProfileSurahsStalled: (p: unknown) => mockStalled(p),
    trackReciterProfileSurahsRendered: (p: unknown) => mockRendered(p),
  },
}));
jest.mock('@/services/diagnostics/bootSentinel', () => ({
  markFirstContentReady: jest.fn(),
}));

type Props = Parameters<typeof useReciterProfileSurahsWatchdog>[0];

function props(over: Partial<Props> = {}): Props {
  return {
    neighborsReady: false,
    reciterId: 'r1',
    reciter: {name: 'Reciter One'},
    rewayaId: 'w1',
    tabsCount: 2,
    pagerScrolledRef: {current: false},
    ...over,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockCaptureMessage.mockClear();
  mockStalled.mockClear();
  mockRendered.mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useReciterProfileSurahsWatchdog', () => {
  it('reports one stall after 5 s with the same name, tags and props as before', () => {
    const p = props();
    renderHook(() => useReciterProfileSurahsWatchdog(p));
    jest.advanceTimersByTime(4999);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    // pager_scrolled is read when the watchdog fires.
    p.pagerScrolledRef.current = true;
    jest.advanceTimersByTime(1);

    const ctx = {
      reciter_id: 'r1',
      reciter_name: 'Reciter One',
      rewaya_id: 'w1',
      tabs_count: 2,
      neighbors_ready: false,
      pager_scrolled: true,
      platform: Platform.OS,
    };
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'reciter-profile-surahs-stalled',
      {
        level: 'warning',
        tags: {
          scope: 'reciter-profile',
          tabs_count: '2',
          rp_platform: Platform.OS,
        },
        extra: ctx,
      },
    );
    expect(mockStalled).toHaveBeenCalledWith(ctx);
    expect(mockRendered).not.toHaveBeenCalled();
  });

  it('sends null for a missing reciter name and rewayah', () => {
    renderHook(() =>
      useReciterProfileSurahsWatchdog(
        props({reciter: null, rewayaId: undefined}),
      ),
    );
    jest.advanceTimersByTime(5000);
    expect(mockStalled).toHaveBeenCalledWith(
      expect.objectContaining({reciter_name: null, rewaya_id: null}),
    );
  });

  it('reports the stall once per mount', () => {
    const {rerender} = renderHook(
      (p: Props) => useReciterProfileSurahsWatchdog(p),
      {initialProps: props()},
    );
    jest.advanceTimersByTime(5000);
    rerender(props({tabsCount: 3}));
    jest.advanceTimersByTime(5000);
    expect(mockStalled).toHaveBeenCalledTimes(1);
  });

  it('restarts the budget when the reciter object changes', () => {
    const {rerender} = renderHook(
      (p: Props) => useReciterProfileSurahsWatchdog(p),
      {initialProps: props()},
    );
    jest.advanceTimersByTime(4000);
    rerender(props({reciter: {name: 'Reciter One'}}));
    jest.advanceTimersByTime(4000);
    expect(mockStalled).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(mockStalled).toHaveBeenCalledTimes(1);
  });

  it('sends the success event once when the gate lifts, and no stall', () => {
    const ref = {current: false};
    const {rerender} = renderHook(
      (p: Props) => useReciterProfileSurahsWatchdog(p),
      {initialProps: props({pagerScrolledRef: ref})},
    );
    jest.advanceTimersByTime(2000);
    rerender(props({neighborsReady: true, pagerScrolledRef: ref}));
    rerender(
      props({neighborsReady: true, tabsCount: 3, pagerScrolledRef: ref}),
    );
    jest.advanceTimersByTime(10000);
    expect(mockStalled).not.toHaveBeenCalled();
    expect(mockRendered).toHaveBeenCalledTimes(1);
    expect(mockRendered).toHaveBeenCalledWith({
      reciter_id: 'r1',
      rewaya_id: 'w1',
      tabs_count: 2,
      platform: Platform.OS,
    });
  });
});
