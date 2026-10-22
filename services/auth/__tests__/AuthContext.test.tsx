// @ai
// TECH_DEBT #244 (M1) — AuthContext follows the token refresh after mount.
//
// Before M1, AuthContext read the sign-in state only at mount. A refresh that
// cleared the tokens left Settings at "Signed in", and a server error during a
// refresh signed the user out. These tests drive the real qfOAuth module with
// an in-memory token store and a mock `fetch`.

import React from 'react';
import {act, render, waitFor} from '@testing-library/react-native';

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  getItemAsync: jest.fn(
    async (key: string) => mockSecureStore.get(key) ?? null,
  ),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('../pkce', () => ({
  generateCodeVerifier: () => 'test-verifier',
  generateCodeChallenge: async () => 'test-challenge',
  generateRandomHex: () => 'test-state',
}));

jest.mock('../config', () => ({
  getQfOAuthConfig: () => ({
    env: 'prelive',
    clientId: 'test-client',
    clientSecret: null,
    redirectUri: 'test-scheme://callback',
    scopes: ['openid'],
    endpoints: {
      authorize: 'https://auth.example.invalid/oauth2/auth',
      token: 'https://auth.example.invalid/oauth2/token',
    },
  }),
}));

import {AuthProvider, useAuth, type AuthContextValue} from '../AuthContext';
import {getValidAccessToken} from '../qfOAuth';
import {loadTokens, saveTokens} from '../tokenStore';

const fetchMock = jest.fn();

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let latest: AuthContextValue | null = null;

function Probe() {
  latest = useAuth();
  return null;
}

async function mountSignedInWithExpiredToken(): Promise<void> {
  await saveTokens({
    accessToken: 'expired-access',
    refreshToken: 'rt-1',
    idToken: null,
    expiresAt: Date.now() - 1_000,
  });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(latest?.status).toBe('authenticated'));
}

beforeEach(() => {
  mockSecureStore.clear();
  fetchMock.mockReset();
  (globalThis as {fetch: unknown}).fetch = fetchMock;
  latest = null;
});

describe('AuthContext — M1 refresh state', () => {
  it('stays signed in and flags a transient failure on a 503', async () => {
    await mountSignedInWithExpiredToken();
    fetchMock.mockResolvedValue(jsonResponse(503, {}));

    await act(async () => {
      await getValidAccessToken();
    });

    expect(latest?.status).toBe('authenticated');
    expect(latest?.tokenRefreshFailed).toBe(true);
    expect(await loadTokens()).not.toBeNull();
  });

  it('clears the transient flag after a later refresh succeeds', async () => {
    await mountSignedInWithExpiredToken();
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {}));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: 'access-2',
        refresh_token: 'rt-2',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    );

    await act(async () => {
      await getValidAccessToken();
    });
    await act(async () => {
      await getValidAccessToken();
    });

    expect(latest?.status).toBe('authenticated');
    expect(latest?.tokenRefreshFailed).toBe(false);
  });

  it('moves to unauthenticated when the token endpoint rejects the refresh', async () => {
    await mountSignedInWithExpiredToken();
    fetchMock.mockResolvedValue(jsonResponse(400, {error: 'invalid_grant'}));

    await act(async () => {
      await getValidAccessToken();
    });

    expect(latest?.status).toBe('unauthenticated');
    expect(latest?.tokenRefreshFailed).toBe(false);
    expect(await loadTokens()).toBeNull();
  });
});
