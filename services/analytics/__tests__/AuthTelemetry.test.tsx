// @ai The `signed_in` super property is set by AuthTelemetry, an observer of
// AuthContext. signInFunnel.test.ts pins the pure status → value mapping; these
// tests pin the WIRING: the property follows the status at boot restore, on
// sign-in and on sign-out, and it is set BEFORE `sign_in_succeeded` fires (the
// effect order), so that event carries `signed_in: true`.

import React from 'react';
import {render} from '@testing-library/react-native';
import {AuthTelemetry} from '../AuthTelemetry';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

let mockAuth: {status: Status; lastError: string | null} = {
  status: 'loading',
  lastError: null,
};

jest.mock('@/services/auth', () => ({
  useAuth: () => mockAuth,
}));

// One ordered log across every analytics call, so a test can assert order.
const mockCalls: string[] = [];
const mockSetSignedIn = jest.fn((signedIn: boolean) => {
  mockCalls.push(`signed_in=${signedIn}`);
});

jest.mock('../AnalyticsService', () => ({
  analyticsService: {
    setSignedIn: (signedIn: boolean) => mockSetSignedIn(signedIn),
  },
}));
jest.mock('../qariahEvents', () => ({
  qariahAnalytics: {
    trackSignInStarted: () => mockCalls.push('sign_in_started'),
    trackSignInSucceeded: () => mockCalls.push('sign_in_succeeded'),
    trackSignInFailed: () => mockCalls.push('sign_in_failed'),
    trackSignInAbandoned: () => mockCalls.push('sign_in_abandoned'),
  },
}));

function mount(status: Status) {
  mockAuth = {status, lastError: null};
  const view = render(<AuthTelemetry />);
  return (next: Status) => {
    mockAuth = {status: next, lastError: null};
    view.rerender(<AuthTelemetry />);
  };
}

describe('AuthTelemetry — signed_in super property', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockSetSignedIn.mockClear();
  });

  it('sets nothing while the session is still loading at boot', () => {
    mount('loading');

    expect(mockCalls).toEqual([]);
  });

  it('reports a restored session at boot, with no funnel event', () => {
    const update = mount('loading');
    update('authenticated');

    expect(mockCalls).toEqual(['signed_in=true']);
  });

  it('reports no session at boot as signed out', () => {
    const update = mount('loading');
    update('unauthenticated');

    expect(mockCalls).toEqual(['signed_in=false']);
  });

  it('sets signed_in=true before sign_in_succeeded fires', () => {
    const update = mount('loading');
    update('unauthenticated');
    update('loading');
    update('authenticated');

    expect(mockCalls).toEqual([
      'signed_in=false',
      'sign_in_started',
      'signed_in=true',
      'sign_in_succeeded',
    ]);
  });

  it('reports a sign-out as signed out', () => {
    const update = mount('authenticated');
    update('unauthenticated');

    expect(mockCalls).toEqual(['signed_in=true', 'signed_in=false']);
  });

  it('never throws into the auth tree when analytics throws', () => {
    mockSetSignedIn.mockImplementationOnce(() => {
      throw new Error('analytics down');
    });

    expect(() => mount('authenticated')).not.toThrow();
  });
});
