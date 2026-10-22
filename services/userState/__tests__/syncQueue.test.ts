// @ai
// TECH_DEBT #244 (M2) — the first tests for services/userState/syncQueue.ts.
//
// Before M2, a 401 retry reused the same access token, got a second 401, and
// the queue marked the row permanent (attempts = 3 in one shot). A server-side
// token revoke therefore dropped every queued write. These tests run the real
// queue and the real `withQfCall`; the database, the SDK call and the token
// refresh are mocks.

import type {SyncQueueRow} from '../db';

const mockRows: SyncQueueRow[] = [];
const mockMarkWriteComplete = jest.fn((_id: string) => Promise.resolve());
const mockMarkWriteFailed = jest.fn((_id: string, _error: string) =>
  Promise.resolve(),
);

jest.mock('../db', () => ({
  dequeueWrites: jest.fn(async () => mockRows.splice(0, mockRows.length)),
  markWriteComplete: (id: string) => mockMarkWriteComplete(id),
  markWriteFailed: (id: string, error: string) =>
    mockMarkWriteFailed(id, error),
}));

// Each test sets the behaviour of the QF SDK call through this mock.
const mockSdkCall = jest.fn();

jest.mock('../preferences', () => {
  const {withQfCall} = jest.requireActual('../qfErrors');
  return {
    setPreference: jest.fn((_key: string, _value: string) =>
      withQfCall('/preferences', () => mockSdkCall()),
    ),
  };
});

// The other resources pull in the QF SDK; the tests do not use them.
jest.mock('../readingSessions', () => ({upsertReadingSession: jest.fn()}));
jest.mock('../bookmarks', () => ({
  addBookmark: jest.fn(),
  deleteBookmark: jest.fn(),
}));
jest.mock('../collections', () => ({
  createCollection: jest.fn(),
  deleteCollection: jest.fn(),
}));

const mockRefreshAfterUnauthorized = jest.fn<Promise<string | null>, []>();

jest.mock('@/services/auth/qfOAuth', () => ({
  refreshAfterUnauthorized: () => mockRefreshAfterUnauthorized(),
}));

const mockEnsureAccountVerified = jest.fn();

jest.mock('../accountCleanup', () => ({
  ensureAccountVerified: () => mockEnsureAccountVerified(),
}));

import {dequeueWrites} from '../db';
import {flushSyncQueue} from '../syncQueue';

function queuePreferenceWrite(): void {
  mockRows.push({
    id: 'row-1',
    resource: 'preference',
    operation: 'update',
    payload: JSON.stringify({key: 'qariah:favoriteReciterIds', value: '[]'}),
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  });
}

beforeEach(() => {
  mockRows.length = 0;
  mockMarkWriteComplete.mockClear();
  mockMarkWriteFailed.mockClear();
  mockSdkCall.mockReset();
  mockRefreshAfterUnauthorized.mockReset();
  mockEnsureAccountVerified.mockResolvedValue({
    kind: 'ok',
    accountHash: 'hash-a',
    change: 'same',
  });
  (dequeueWrites as jest.Mock).mockClear();
});

describe('M2 — a 401 does not make a queued write permanent', () => {
  it('keeps the write retryable when the 401 stays after a refresh', async () => {
    queuePreferenceWrite();
    mockSdkCall.mockRejectedValue(new Error('401 Unauthorized'));
    mockRefreshAfterUnauthorized.mockResolvedValue('access-2');

    const result = await flushSyncQueue('test');

    expect(mockRefreshAfterUnauthorized).toHaveBeenCalledTimes(1);
    expect(mockSdkCall).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({retryable: 1, permanent: 0});
    // One attempt used, not all three.
    expect(mockMarkWriteFailed).toHaveBeenCalledTimes(1);
  });

  it('pauses the queue and keeps the attempts when no session is left', async () => {
    queuePreferenceWrite();
    mockSdkCall.mockRejectedValue(new Error('401 Unauthorized'));
    mockRefreshAfterUnauthorized.mockResolvedValue(null);

    const result = await flushSyncQueue('test');

    expect(result).toMatchObject({authPaused: true, permanent: 0});
    expect(mockMarkWriteFailed).not.toHaveBeenCalled();
    expect(mockMarkWriteComplete).not.toHaveBeenCalled();
  });

  it('sends the write with the refreshed token after a server-side revoke', async () => {
    queuePreferenceWrite();
    mockSdkCall
      .mockRejectedValueOnce(new Error('401 Unauthorized'))
      .mockResolvedValueOnce(undefined);
    mockRefreshAfterUnauthorized.mockResolvedValue('access-2');

    const result = await flushSyncQueue('test');

    expect(result).toMatchObject({succeeded: 1, permanent: 0});
    expect(mockMarkWriteComplete).toHaveBeenCalledWith('row-1');
  });

  it('still marks a 400 permanent', async () => {
    queuePreferenceWrite();
    mockSdkCall.mockRejectedValue(new Error('400 Bad Request'));

    const result = await flushSyncQueue('test');

    expect(result).toMatchObject({permanent: 1});
    expect(mockMarkWriteFailed).toHaveBeenCalledTimes(3);
    expect(mockRefreshAfterUnauthorized).not.toHaveBeenCalled();
  });
});

describe('M4 — the queue waits for the account check', () => {
  it('sends nothing until the check passes', async () => {
    queuePreferenceWrite();
    mockEnsureAccountVerified.mockResolvedValue({
      kind: 'error',
      stage: 'userinfo',
      detail: 'network',
    });

    const result = await flushSyncQueue('test');

    expect(result).toMatchObject({authPaused: true, attempted: 0});
    expect(dequeueWrites).not.toHaveBeenCalled();
    expect(mockSdkCall).not.toHaveBeenCalled();
  });
});
