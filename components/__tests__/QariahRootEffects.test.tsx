// @ai Qariah (TECH_DEBT #243) — pins the effect ORDER of <QariahRootEffects>.
// The Qariah root effects used to be inline in upstream's AnalyticsConnector:
// the boot-splash tags, flags, nav and prompts ran BEFORE its connect effect
// (setPostHogInstance + app_opened), and the next-launch reports
// (cold_start_began, boot-not-completed, playback-killed) ran AFTER it. The
// wrapper must keep that order.

import React, {useEffect} from 'react';
import {render} from '@testing-library/react-native';
import {QariahRootEffects} from '../QariahRootEffects';

const mockLog: string[] = [];

jest.mock('posthog-react-native', () => ({
  usePostHog: () => ({register: jest.fn(), unregister: jest.fn()}),
  useFeatureFlag: () => undefined,
  useFeatureFlagWithPayload: () => [undefined, undefined],
}));
jest.mock('expo-router', () => ({usePathname: () => '/'}));
jest.mock('@sentry/react-native', () => ({
  captureMessage: (name: string) => mockLog.push(`sentry:${name}`),
}));
jest.mock('@/config/featureFlags', () => ({isFeatureEnabled: () => true}));
jest.mock('@/modules/qariah-boot-splash', () => ({
  getBootSplashMode: () => 'unavailable',
}));
jest.mock('@/services/bootSplash', () => ({
  bootSplashExperiment: {
    active: false,
    onResolved: () => () => undefined,
    isEnrolled: () => false,
  },
  enrolBootRisk: (reason: string) => mockLog.push(`enrol:${reason}`),
  NONBLOCKING_SPLASH_FLAG_V2: 'nonblocking_splash_v2',
  UNKNOWN_COLD_START_BOOT_PROPS: {},
}));
jest.mock('@/services/analytics/qariahEvents', () => ({
  qariahAnalytics: {
    trackColdStartBegan: () => mockLog.push('cold_start_began'),
    trackBootNotCompleted: () => mockLog.push('boot_not_completed'),
    trackPlaybackKilledInBackground: () =>
      mockLog.push('playback_killed_in_background'),
    trackBootSplashFlagResolved: () => mockLog.push('boot_splash_flag'),
    trackBootRiskEnrolled: () => mockLog.push('boot_risk_enrolled'),
  },
}));
jest.mock('@/services/diagnostics/playbackHealth', () => ({
  setPlaybackHealthEnabled: () => mockLog.push('playback_health'),
}));
jest.mock('@/services/diagnostics/diagnostics', () => ({
  enableDiagnostics: () => mockLog.push('enable_diagnostics'),
  diagNav: () => mockLog.push('diag_nav'),
}));
jest.mock('@/services/diagnostics/mainThreadStallCount', () => ({
  takePreviousProcessStallRecord: () => null,
}));
jest.mock('@/services/diagnostics/bootSentinel', () => ({
  consumePreviousIncompleteBoot: () => ({
    version: '3.2.1',
    build: '2027',
    furthestStep: 'catalog-ready',
  }),
}));
jest.mock('@/services/diagnostics/playbackSentinel', () => ({
  consumeKilledPlayback: () => ({
    surahId: '1',
    reciterId: 'r',
    reciterName: 'R',
    positionSec: 1,
    startedAt: 1,
  }),
}));
function mockEffectHook(name: string): () => void {
  return () => {
    const {useEffect: useMockEffect} = jest.requireActual('react');
    useMockEffect(() => {
      mockLog.push(name);
    }, []);
  };
}
jest.mock('@/services/diagnostics/deepLinkWatchdog', () => ({
  useDeepLinkWatchdog: mockEffectHook('deeplink_watchdog'),
}));
jest.mock('@/services/diagnostics/deepLinkColdStartReplay', () => ({
  useDeepLinkColdStartReplay: mockEffectHook('deeplink_replay'),
}));
jest.mock('@/hooks/useBackgroundPlaybackPrompt', () => ({
  useBackgroundPlaybackPrompt: mockEffectHook('battery_prompt'),
  useNotificationsDeniedPrompt: mockEffectHook('notifications_prompt'),
}));
jest.mock('@/services/notifications/useForegroundAnnouncementRecord', () => ({
  useForegroundAnnouncementRecord: mockEffectHook('announcement_record'),
}));
jest.mock('@/components/notifications/NotificationSoftPrompt', () => ({
  NotificationSoftPrompt: () => null,
}));
jest.mock('@/services/notifications/useQariahNotifications', () => ({
  useQariahNotifications: mockEffectHook('qariah_notifications'),
}));
jest.mock('@/store/backgroundPlaybackStore', () => ({
  useBackgroundPlaybackStore: {
    getState: () => ({recordKill: () => mockLog.push('record_kill')}),
  },
}));

/** Stands in for upstream's AnalyticsConnector. */
function FakeAnalyticsConnector(): null {
  useEffect(() => {
    mockLog.push('connect+app_opened');
  }, []);
  return null;
}

describe('QariahRootEffects', () => {
  beforeEach(() => {
    mockLog.length = 0;
  });

  it('runs the pre-connect effects, then the wrapped connector, then the next-launch reports', () => {
    render(
      <QariahRootEffects>
        <FakeAnalyticsConnector />
      </QariahRootEffects>,
    );
    expect(mockLog).toEqual([
      'playback_health',
      'diag_nav',
      'deeplink_watchdog',
      'deeplink_replay',
      'battery_prompt',
      'notifications_prompt',
      'announcement_record',
      'qariah_notifications',
      'connect+app_opened',
      'cold_start_began',
      'sentry:boot-not-completed',
      'boot_not_completed',
      'enrol:boot_not_completed',
      'sentry:playback-killed-in-background',
      'playback_killed_in_background',
    ]);
  });
});
