// @ai
// TECH_DEBT #244 — the first tests for services/auth/qfOAuth.ts.
//
// The token store is an in-memory map behind the expo-secure-store API, and
// `fetch` is a jest mock. No test calls a live QF endpoint.

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

import {
  getValidAccessToken,
  refreshAccessToken,
  refreshAfterUnauthorized,
  signOut,
  subscribeAuthEvents,
  type AuthEvent,
} from '../qfOAuth';
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

function tokenResponse(access: string, refresh: string) {
  return jsonResponse(200, {
    access_token: access,
    refresh_token: refresh,
    expires_in: 3600,
    token_type: 'bearer',
  });
}

async function seedExpiredSession(refreshToken = 'rt-1'): Promise<void> {
  await saveTokens({
    accessToken: 'expired-access',
    refreshToken,
    idToken: null,
    expiresAt: Date.now() - 1_000,
  });
}

beforeEach(() => {
  mockSecureStore.clear();
  fetchMock.mockReset();
  (globalThis as {fetch: unknown}).fetch = fetchMock;
});

describe('H1 — single-flight token refresh', () => {
  it('sends one refresh request for four parallel callers', async () => {
    await seedExpiredSession();
    fetchMock.mockResolvedValue(tokenResponse('new-access', 'rt-2'));

    const results = await Promise.all([
      getValidAccessToken(),
      getValidAccessToken(),
      getValidAccessToken(),
      getValidAccessToken(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      'new-access',
      'new-access',
      'new-access',
      'new-access',
    ]);
    const stored = await loadTokens();
    expect(stored?.accessToken).toBe('new-access');
    expect(stored?.refreshToken).toBe('rt-2');
  });

  it('sends the stored refresh token, not an old copy that a caller holds', async () => {
    await seedExpiredSession('rt-2');
    fetchMock.mockResolvedValue(tokenResponse('access-3', 'rt-3'));

    await refreshAccessToken('rt-1');

    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body).toContain('refresh_token=rt-2');
    expect(body).not.toContain('rt-1');
  });

  it('returns the stored tokens when a refresh ended just before the call', async () => {
    // A caller read rt-1, then another refresh rotated it to rt-2.
    await saveTokens({
      accessToken: 'fresh-access',
      refreshToken: 'rt-2',
      idToken: null,
      expiresAt: Date.now() + 60_000,
    });

    const result = await refreshAccessToken('rt-1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.accessToken).toBe('fresh-access');
  });

  it('starts a new refresh after the previous one ends', async () => {
    await seedExpiredSession();
    fetchMock.mockResolvedValueOnce(tokenResponse('access-2', 'rt-2'));
    await getValidAccessToken();

    await saveTokens({
      accessToken: 'access-2',
      refreshToken: 'rt-2',
      idToken: null,
      expiresAt: Date.now() - 1_000,
    });
    fetchMock.mockResolvedValueOnce(tokenResponse('access-3', 'rt-3'));
    const token = await getValidAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(token).toBe('access-3');
  });
});

describe('M1 — only 400 and 401 from the token endpoint clear the tokens', () => {
  let events: AuthEvent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    events = [];
    unsubscribe = subscribeAuthEvents(e => events.push(e));
  });

  afterEach(() => unsubscribe());

  it.each([500, 503, 429])(
    'keeps the tokens on a %i and reports a transient failure',
    async status => {
      await seedExpiredSession();
      fetchMock.mockResolvedValue(jsonResponse(status, {error: 'busy'}));

      const token = await getValidAccessToken();

      expect(token).toBeNull();
      const stored = await loadTokens();
      expect(stored?.refreshToken).toBe('rt-1');
      expect(events).toEqual([{type: 'refresh-failed', status}]);
    },
  );

  it('keeps the tokens on a network error', async () => {
    await seedExpiredSession();
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    const token = await getValidAccessToken();

    expect(token).toBeNull();
    expect((await loadTokens())?.refreshToken).toBe('rt-1');
    expect(events).toEqual([{type: 'refresh-failed', status: 0}]);
  });

  it.each([400, 401])(
    'clears the tokens on a %i and reports an expired session',
    async status => {
      await seedExpiredSession();
      fetchMock.mockResolvedValue(
        jsonResponse(status, {error: 'invalid_grant'}),
      );

      const token = await getValidAccessToken();

      expect(token).toBeNull();
      expect(await loadTokens()).toBeNull();
      expect(events).toEqual([{type: 'session-expired'}]);
    },
  );

  it('refreshes again after a transient failure', async () => {
    await seedExpiredSession();
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {}));
    fetchMock.mockResolvedValueOnce(tokenResponse('access-2', 'rt-2'));

    expect(await getValidAccessToken()).toBeNull();
    expect(await getValidAccessToken()).toBe('access-2');

    expect(events).toEqual([
      {type: 'refresh-failed', status: 503},
      {type: 'refreshed'},
    ]);
  });
});

describe('M2 — refresh after a 401 from the QF API', () => {
  it('refreshes a token that has not expired by the local clock', async () => {
    // QF revoked the access token on the server; locally it is still valid.
    await saveTokens({
      accessToken: 'revoked-access',
      refreshToken: 'rt-1',
      idToken: null,
      expiresAt: Date.now() + 60_000,
    });
    fetchMock.mockResolvedValue(tokenResponse('access-2', 'rt-2'));

    // Before M2, the 401 retry got 'revoked-access' again from here.
    expect(await getValidAccessToken()).toBe('revoked-access');
    expect(await refreshAfterUnauthorized()).toBe('access-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between parallel 401s', async () => {
    await saveTokens({
      accessToken: 'revoked-access',
      refreshToken: 'rt-1',
      idToken: null,
      expiresAt: Date.now() + 60_000,
    });
    fetchMock.mockResolvedValue(tokenResponse('access-2', 'rt-2'));

    const results = await Promise.all([
      refreshAfterUnauthorized(),
      refreshAfterUnauthorized(),
      refreshAfterUnauthorized(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['access-2', 'access-2', 'access-2']);
  });

  it('returns null without a request when no session exists', async () => {
    expect(await refreshAfterUnauthorized()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('M4 — a refresh from an earlier session does not write', () => {
  function deferredFetch() {
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise(r => {
          resolve = r;
        }),
    );
    return (value: unknown) => resolve(value);
  }

  it('does not sign back in when a sign-out happens during a refresh', async () => {
    await seedExpiredSession();
    const respond = deferredFetch();

    const pending = getValidAccessToken();
    await new Promise(r => setTimeout(r, 0)); // the request is in flight
    await signOut();
    respond(tokenResponse('late-access', 'late-rt'));

    expect(await pending).toBeNull();
    expect(await loadTokens()).toBeNull();
  });

  it('does not delete the tokens of a new session after a late 400', async () => {
    await seedExpiredSession();
    const respond = deferredFetch();

    const pending = getValidAccessToken();
    await new Promise(r => setTimeout(r, 0));
    // A sign-out and a new sign-in happen while the old refresh is open.
    await signOut();
    await saveTokens({
      accessToken: 'account-b-access',
      refreshToken: 'account-b-rt',
      idToken: null,
      expiresAt: Date.now() + 60_000,
    });
    respond(jsonResponse(400, {error: 'invalid_grant'}));

    expect(await pending).toBeNull();
    expect((await loadTokens())?.accessToken).toBe('account-b-access');
  });
});
