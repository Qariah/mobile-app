// @ai
// TECH_DEBT #369 — `publishNote()` counts each Reflection that QuranReflect
// accepts (owner, 2026-11-12: "just count every time we publish to QF").
//
// One `reflection_published` event after a publish that returns a post id;
// none when the call fails or QF returns no post id. The event carries no
// property (the event tests in services/analytics check that). The SDK is a
// mock; no test calls QF.

const mockPublish = jest.fn();
jest.mock('@/services/auth/sdkClient', () => ({
  getQfSdk: () => ({auth: {v1: {notes: {publish: mockPublish}}}}),
}));

jest.mock('@/services/auth/qfOAuth', () => ({
  refreshAfterUnauthorized: jest.fn(),
}));

jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

const mockTrackReflectionPublished = jest.fn();
jest.mock('@/services/analytics/qariahEvents', () => ({
  qariahAnalytics: {
    trackReflectionPublished: () => mockTrackReflectionPublished(),
  },
}));

import {publishNote} from '../notes';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('publishNote counts each accepted publish', () => {
  it('sends one event when QF returns a post id', async () => {
    mockPublish.mockResolvedValueOnce({postId: 4711});
    await expect(publishNote('note-1', 'text')).resolves.toBe('4711');
    expect(mockTrackReflectionPublished).toHaveBeenCalledTimes(1);
  });

  it('sends one event for the wrapped response shape too', async () => {
    mockPublish.mockResolvedValueOnce({data: {postId: 'p-9'}});
    await expect(publishNote('note-2', 'text')).resolves.toBe('p-9');
    expect(mockTrackReflectionPublished).toHaveBeenCalledTimes(1);
  });

  it('sends no event when QF returns no post id', async () => {
    mockPublish.mockResolvedValueOnce({});
    await expect(publishNote('note-3', 'text')).rejects.toThrow(/postId/);
    expect(mockTrackReflectionPublished).not.toHaveBeenCalled();
  });

  it('sends no event when the publish call fails', async () => {
    mockPublish.mockRejectedValueOnce(new Error('500 Internal Server Error'));
    await expect(publishNote('note-4', 'text')).rejects.toThrow();
    expect(mockTrackReflectionPublished).not.toHaveBeenCalled();
  });
});
