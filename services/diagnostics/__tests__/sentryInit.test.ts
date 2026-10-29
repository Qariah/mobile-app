// @ai TECH_DEBT #287: Sentry for a car-first process (the headless Android Auto
// root). It inits once, with the phone root's options, and never over a client
// that app/_layout.tsx (or an earlier car boot) created.

let mockClient: object | undefined;
const mockInit = jest.fn((_options: unknown) => {
  mockClient = {};
});
jest.mock('@sentry/react-native', () => ({
  init: (options: unknown) => mockInit(options),
  getClient: () => mockClient,
}));

const mockScope = jest.fn();
jest.mock('@/services/diagnostics/qariahSentryOptions', () => ({
  qariahSentryOptions: () => ({
    release: 'com.qariah.app@3.2.2+3600',
    tracesSampleRate: 0.2,
    maxBreadcrumbs: 150,
  }),
  initQariahSentryScope: () => mockScope(),
}));

const mockVersion = {
  value: {semanticVersion: '3.2.2', buildNumber: 3600} as
    | {semanticVersion: string; buildNumber: number}
    | undefined,
};
jest.mock('@/services/diagnostics/debugId', () => ({
  readVersionInfo: () => mockVersion.value,
}));

import {initSentryForCarRoot} from '../sentryInit';

describe('initSentryForCarRoot (TECH_DEBT #287)', () => {
  // Change process.env in place: the Expo Babel preset reads it through a
  // module that keeps the original object.
  const saved = {
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    analytics: process.env.EXPO_PUBLIC_ANALYTICS_ENABLED,
  };
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = undefined;
    mockVersion.value = {semanticVersion: '3.2.2', buildNumber: 3600};
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://dsn.example/1';
    delete process.env.EXPO_PUBLIC_ANALYTICS_ENABLED;
  });
  afterAll(() => {
    restore('EXPO_PUBLIC_SENTRY_DSN', saved.dsn);
    restore('EXPO_PUBLIC_ANALYTICS_ENABLED', saved.analytics);
  });

  it('inits once per process, then sets up the Qariah scope', () => {
    initSentryForCarRoot();
    initSentryForCarRoot();

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockScope).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.invocationCallOrder[0]).toBeLessThan(
      mockScope.mock.invocationCallOrder[0],
    );
  });

  it('passes the phone root options: DSN, session tracking, dist, then the Qariah options', () => {
    initSentryForCarRoot();

    expect(mockInit).toHaveBeenCalledWith({
      dsn: 'https://dsn.example/1',
      enableAutoSessionTracking: true,
      dist: '3600',
      release: 'com.qariah.app@3.2.2+3600',
      tracesSampleRate: 0.2,
      maxBreadcrumbs: 150,
    });
  });

  it('sends no dist when the manifest has no version', () => {
    mockVersion.value = undefined;
    initSentryForCarRoot();
    expect(mockInit.mock.calls[0][0]).toHaveProperty('dist', undefined);
  });

  it('does nothing when the phone root already created a client', () => {
    mockClient = {};
    initSentryForCarRoot();
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockScope).not.toHaveBeenCalled();
  });

  it('does nothing when analytics is off', () => {
    process.env.EXPO_PUBLIC_ANALYTICS_ENABLED = 'false';
    initSentryForCarRoot();
    expect(mockInit).not.toHaveBeenCalled();
  });
});
