// @ai
// TECH_DEBT #256 — `editPost()` edits a QuranReflect post in place.
//
// The contract comes from the vendor client (`@quranjs/api` 3.2.0): the
// operation `postsControllerEdit` is `PATCH /v1/posts/{id}` with user auth.
// QF's REST reference "Edit post" takes the changed fields at the top level
// (`{body}`), not wrapped in `post` as "Create post" is. When QF cannot edit
// the post in place (no SDK operation, 403, 404, 405, 501), `editPost`
// returns false and leaves a Sentry breadcrumb, so the caller falls back to
// create-then-delete. Any other error throws. The SDK is a mock; no test
// calls QF.

const mockEdit = jest.fn();
let mockRaw: Record<string, unknown> = {};

jest.mock('@/services/auth/sdkClient', () => ({
  getQfSdk: () => ({quranReflect: {v1: {raw: mockRaw}}}),
}));

const mockRefresh = jest.fn();
jest.mock('@/services/auth/qfOAuth', () => ({
  refreshAfterUnauthorized: () => mockRefresh(),
}));

const mockAddBreadcrumb = jest.fn();
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  captureMessage: jest.fn(),
}));

import {editPost} from '../notes';

/** The SDK's error for a non-2xx answer: `Error("{status} {statusText}")`. */
function httpError(status: number, text: string): Error {
  return new Error(`${status} ${text}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEdit.mockReset();
  mockRaw = {postsControllerEdit: mockEdit};
});

describe('editPost — edit in place', () => {
  it('sends PATCH /v1/posts/{id} with a flat {body} and returns true', async () => {
    mockEdit.mockResolvedValueOnce({success: true, post: {id: 42}});

    await expect(editPost('42', 'Edited reflection')).resolves.toBe(true);

    expect(mockEdit).toHaveBeenCalledTimes(1);
    expect(mockEdit).toHaveBeenCalledWith({
      path: {id: '42'},
      body: {body: 'Edited reflection'},
    });
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });

  it('refreshes once on a 401 and retries the edit', async () => {
    mockEdit
      .mockRejectedValueOnce(httpError(401, 'Unauthorized'))
      .mockResolvedValueOnce({success: true});
    mockRefresh.mockResolvedValueOnce({accessToken: 'new'});

    await expect(editPost('42', 'Edited reflection')).resolves.toBe(true);

    expect(mockEdit).toHaveBeenCalledTimes(2);
  });
});

describe('editPost — fallback when the edit is not available', () => {
  it.each([
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [405, 'Method Not Allowed'],
    [501, 'Not Implemented'],
  ])('returns false and leaves a breadcrumb on a %i', async (status, text) => {
    mockEdit.mockRejectedValueOnce(httpError(status, text));

    await expect(editPost('42', 'Edited reflection')).resolves.toBe(false);

    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'notes-sync',
        level: 'warning',
        data: {reason: String(status)},
      }),
    );
  });

  it('returns false without a request when the SDK has no edit operation', async () => {
    mockRaw = {};

    await expect(editPost('42', 'Edited reflection')).resolves.toBe(false);

    expect(mockEdit).not.toHaveBeenCalled();
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({data: {reason: 'no-sdk-operation'}}),
    );
  });
});

describe('editPost — other errors throw', () => {
  it.each([
    [400, 'Bad Request'],
    [422, 'Unprocessable Entity'],
    [500, 'Internal Server Error'],
  ])('throws on a %i', async (status, text) => {
    mockEdit.mockRejectedValueOnce(httpError(status, text));

    await expect(editPost('42', 'Edited reflection')).rejects.toMatchObject({
      name: 'QfApiError',
      status,
    });
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });

  it('throws on a network error', async () => {
    mockEdit.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(editPost('42', 'Edited reflection')).rejects.toMatchObject({
      status: 0,
    });
  });

  it('throws when no session is left after a 401', async () => {
    mockEdit.mockRejectedValueOnce(httpError(401, 'Unauthorized'));
    mockRefresh.mockResolvedValueOnce(null);

    await expect(editPost('42', 'Edited reflection')).rejects.toMatchObject({
      name: 'QfAuthRequiredError',
    });
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });
});
