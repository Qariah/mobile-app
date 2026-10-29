// @ai-generated
// Qariah-only cases for AnalyticsService, moved out of upstream's suite
// (AnalyticsService.test.ts) so that file stays close to upstream (2026-10-24
// divergence audit, batch C1): the consent gate before hydration (ANR hotfix
// v2), the `debug_id` super property, and the `signed_in` super property.
const mockStorage = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
    delete: (key: string) => mockStorage.delete(key),
    getAllKeys: () => Array.from(mockStorage.keys()),
  }),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-device-id',
}));

// In the jest/node env expo-device reports isDevice:false and the RN preset sets
// __DEV__:true, so DROP_NON_PROD_INGESTION (`__DEV__ || !Device.isDevice`) would
// drop every event regardless of consent — masking the capture-forwarding +
// opt-out behavior these tests assert. Present a production-like device so the
// real chokepoint logic runs. (Pre-existing gap from the #190 ingestion guard.)
jest.mock('expo-device', () => ({isDevice: true}));
Object.assign(global, {__DEV__: false});

const mockIncrementAdhkarSessions = jest.fn();
jest.mock('../LocalAggregationStore', () => ({
  localAggregationStore: {
    getToday: () => '2026-04-16',
    dayKey: (date: Date) => date.toISOString().slice(0, 10),
    addListeningTime: jest.fn(),
    addPagesRead: jest.fn(),
    addPagesOpened: jest.fn(),
    incrementMeaningfulListens: jest.fn(),
    incrementAdhkarSessions: (date: string) =>
      mockIncrementAdhkarSessions(date),
    addTasbeehCount: jest.fn(),
    markSurahCompleted: jest.fn(),
  },
}));

type FakePostHog = {
  capture: jest.Mock;
  identify: jest.Mock;
  register: jest.Mock;
  registerForSession: jest.Mock;
  optIn: jest.Mock;
  optOut: jest.Mock;
};

function makeFakePostHog(): FakePostHog {
  return {
    capture: jest.fn(),
    identify: jest.fn(),
    register: jest.fn(),
    registerForSession: jest.fn(),
    // optIn()/optOut() return Promise<void> on the real SDK; mirror that so
    // applyConsent's rejection-guard (`.catch`) has a promise to attach to.
    optIn: jest.fn(() => Promise.resolve()),
    optOut: jest.fn(() => Promise.resolve()),
  };
}

type ConsentStore =
  typeof import('@/store/analyticsConsentStore').useAnalyticsConsentStore;

async function loadService(envEnabled: string | undefined): Promise<{
  analyticsService: typeof import('../AnalyticsService').analyticsService;
  consentStore: ConsentStore;
}> {
  const original = process.env.EXPO_PUBLIC_ANALYTICS_ENABLED;
  if (envEnabled === undefined) {
    delete process.env.EXPO_PUBLIC_ANALYTICS_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_ANALYTICS_ENABLED = envEnabled;
  }
  jest.resetModules();
  mockStorage.clear();
  const mod = require('../AnalyticsService');
  const consentMod = require('@/store/analyticsConsentStore');
  const consentStore: ConsentStore = consentMod.useAnalyticsConsentStore;
  // Initialize while the env flag is still set — the service latches `enabled`
  // inside initialize(), so the env var is only read once.
  await mod.analyticsService.initialize();
  // The consent store persists over AsyncStorage and hydrates asynchronously;
  // the service fails closed until then. Wait so assertions see the real flag.
  await waitForConsentHydration(consentStore);
  if (original === undefined) {
    delete process.env.EXPO_PUBLIC_ANALYTICS_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_ANALYTICS_ENABLED = original;
  }
  return {analyticsService: mod.analyticsService, consentStore};
}

async function waitForConsentHydration(store: ConsentStore): Promise<void> {
  // Force a deterministic rehydrate rather than waiting on the one-shot
  // onFinishHydration: under this jest preset the store's automatic initial
  // hydration doesn't reliably settle before assertions, leaving hasHydrated()
  // false (and isConsentGranted() failing closed). rehydrate() resolves only
  // after storage is re-read + applied, with hasHydrated() flipped true.
  await store.persist.rehydrate();
}

describe('AnalyticsService (Qariah)', () => {
  describe('when analytics is enabled (default)', () => {
    // @ai ANR hotfix v2: app/_layout.tsx now connects the PostHog client at
    // module scope, before the consent store hydrates. The capture chokepoint
    // must still block every event until the stored consent is known.
    it('blocks a capture made before the consent store hydrates (module-scope connect)', async () => {
      const {analyticsService, consentStore} = await loadService(undefined);
      // The Qariah events (TECH_DEBT #243) send through the same service
      // instance: require them from the module registry that loadService reset.
      const {qariahAnalytics} =
        require('../qariahEvents') as typeof import('../qariahEvents');
      const hydrated = jest
        .spyOn(consentStore.persist, 'hasHydrated')
        .mockReturnValue(false);
      const posthog = makeFakePostHog();
      analyticsService.setPostHogInstance(
        posthog as unknown as Parameters<
          typeof analyticsService.setPostHogInstance
        >[0],
      );

      qariahAnalytics.trackSplashStalled({
        elapsed_ms: 12000,
        platform: 'android',
      });
      qariahAnalytics.trackBootRiskEnrolled({reason: 'splash_stalled'});

      expect(posthog.capture).not.toHaveBeenCalled();
      // No consent choice is applied before the stored choice is known.
      expect(posthog.optIn).not.toHaveBeenCalled();

      hydrated.mockReturnValue(true);
      qariahAnalytics.trackBootRiskEnrolled({reason: 'splash_stalled'});
      expect(posthog.capture).toHaveBeenCalledWith('boot_risk_enrolled', {
        reason: 'splash_stalled',
      });
      hydrated.mockRestore();
    });

    it('never registers a blank debug_id as a super property', async () => {
      // A blank value would be worse than an absent one: every event would
      // carry an empty property that silently matches nothing.
      const {analyticsService} = await loadService(undefined);
      // @ts-expect-error - reach into the private field to force the edge case
      analyticsService.deviceId = '';
      const posthog = makeFakePostHog();
      analyticsService.setPostHogInstance(
        posthog as unknown as Parameters<
          typeof analyticsService.setPostHogInstance
        >[0],
      );
      const registered = posthog.register.mock.calls[0][0];
      expect(registered).not.toHaveProperty('debug_id');
      expect(registered.platform).toBe('mobile');
    });
  });

  describe('setSignedIn (signed_in super property)', () => {
    type Service = Awaited<ReturnType<typeof loadService>>['analyticsService'];

    function connect(service: Service): FakePostHog {
      const posthog = makeFakePostHog();
      service.setPostHogInstance(
        posthog as unknown as Parameters<typeof service.setPostHogInstance>[0],
      );
      return posthog;
    }

    // Every value of `signed_in` given to PostHog, in order. It must arrive
    // through registerForSession() only — never the persisted register().
    function signedInCalls(posthog: FakePostHog): unknown[] {
      const persisted = posthog.register.mock.calls.filter(
        call => 'signed_in' in ((call as unknown[])[0] as object),
      );
      expect(persisted).toEqual([]);
      return posthog.registerForSession.mock.calls
        .map(call => (call as unknown[])[0] as Record<string, unknown>)
        .filter(props => 'signed_in' in props)
        .map(props => props.signed_in);
    }

    it('sets signed_in as an in-memory super property, never via identify()', async () => {
      const {analyticsService} = await loadService(undefined);
      const posthog = connect(analyticsService);

      analyticsService.setSignedIn(true);
      analyticsService.setSignedIn(false);

      expect(posthog.registerForSession).toHaveBeenCalledWith({
        signed_in: true,
      });
      expect(posthog.registerForSession).toHaveBeenCalledWith({
        signed_in: false,
      });
      expect(signedInCalls(posthog)).toEqual([true, false]);
      expect(posthog.identify).not.toHaveBeenCalled();
    });

    it('does not register anything before auth has reported a state', async () => {
      const {analyticsService} = await loadService(undefined);
      const posthog = connect(analyticsService);

      expect(signedInCalls(posthog)).toEqual([]);
    });

    it('keeps a state reported before PostHog connects and applies it on connect', async () => {
      // Session restore can resolve before the PostHog provider hands over
      // its instance.
      const {analyticsService} = await loadService(undefined);
      analyticsService.setSignedIn(true);

      const posthog = connect(analyticsService);

      expect(signedInCalls(posthog)).toEqual([true]);
    });

    it('fails closed until consent hydrates, then applies the kept state', async () => {
      const {analyticsService, consentStore} = await loadService(undefined);
      const hydrated = jest
        .spyOn(consentStore.persist, 'hasHydrated')
        .mockReturnValue(false);

      const posthog = connect(analyticsService);
      analyticsService.setSignedIn(true);
      expect(signedInCalls(posthog)).toEqual([]);

      hydrated.mockRestore();
      await consentStore.persist.rehydrate();

      expect(signedInCalls(posthog)).toEqual([true]);
    });

    it('does not register while opted out, and applies the latest state on opt-in', async () => {
      const {analyticsService, consentStore} = await loadService(undefined);
      const posthog = connect(analyticsService);
      analyticsService.setSignedIn(true);

      consentStore.getState().setAnalyticsEnabled(false);
      // A sign-out while opted out is kept, not sent.
      analyticsService.setSignedIn(false);
      expect(signedInCalls(posthog)).toEqual([true]);

      consentStore.getState().setAnalyticsEnabled(true);
      expect(signedInCalls(posthog)).toEqual([true, false]);
    });

    it('is a no-op when analytics is disabled via env flag', async () => {
      const {analyticsService} = await loadService('false');
      const posthog = connect(analyticsService);

      analyticsService.setSignedIn(true);

      expect(posthog.register).not.toHaveBeenCalled();
      expect(posthog.registerForSession).not.toHaveBeenCalled();
    });
  });
});
