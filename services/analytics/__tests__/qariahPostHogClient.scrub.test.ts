/**
 * @ai Issue #609 guard: the client that the app really uses must scrub the
 * OAuth code from `Application Opened`. PostHogProvider ignores its `options`
 * when it gets a `client`, so the hook must sit in
 * `createQariahPostHogClient()`. If the hook leaves that factory, this test
 * fails.
 *
 * The test wraps the real PostHog class. It changes only the network and the
 * storage options, so the factory's own `before_send` and
 * `captureAppLifecycleEvents` stay in force.
 */
import {Linking} from 'react-native';

jest.mock('posthog-react-native', () => {
  const actual = jest.requireActual('posthog-react-native');
  return {
    ...actual,
    PostHog: jest.fn(
      (key: string, options: Record<string, unknown>) =>
        new actual.PostHog(key, {
          ...options,
          host: 'http://127.0.0.1:9',
          persistence: 'memory',
          preloadFeatureFlags: false,
          flushAt: 1000,
          flushInterval: 0,
        }),
    ),
  };
});
jest.mock('@/modules/qariah-boot-splash', () => ({
  getBootSplashMode: () => 'unavailable',
}));
jest.mock('@/services/bootSplash', () => ({
  bootSplashExperiment: {attach: jest.fn()},
}));

import {createQariahPostHogClient} from '../qariahPostHogClient';

const OAUTH_REDIRECT =
  'com.qariah.app:/quranoauth2redirect?code=ory_ac_SECRET&state=STATE123';

describe('createQariahPostHogClient', () => {
  const savedKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  beforeEach(() => {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'phc_test';
  });
  afterEach(() => {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = savedKey;
    jest.restoreAllMocks();
  });

  it('sends Application Opened without the OAuth code', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(OAUTH_REDIRECT);
    const posthog = createQariahPostHogClient(false);
    const seen: Array<{event: string; url: unknown}> = [];
    posthog.on(
      'capture',
      (m: {event: string; properties?: Record<string, unknown>}) =>
        seen.push({event: m.event, url: m.properties?.url}),
    );
    await posthog.ready();
    // The lifecycle capture awaits getInitialURL() after init.
    await new Promise(resolve => setTimeout(resolve, 50));
    await posthog.shutdown();

    expect(seen).toContainEqual({
      event: 'Application Opened',
      url: 'com.qariah.app:/quranoauth2redirect',
    });
    expect(JSON.stringify(seen)).not.toContain('SECRET');
    expect(JSON.stringify(seen)).not.toContain('STATE123');
  });
});
