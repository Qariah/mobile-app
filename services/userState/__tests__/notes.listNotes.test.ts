// @ai
// TECH_DEBT #244 (Stage-2 review) — `listNotes()` follows the QF cursor.
//
// `GET /auth/v1/notes` is cursor-paginated. One call read only the first
// page, so the notes restore lost every note after it. The request params are
// `limit` + `cursor`, as QF's own client types them
// (quran.com-frontend-next `GetAllNotesQueryParams`) and as the QF "Get all
// notes" page documents them. The general `first` / `after` params are for
// other endpoints. The SDK is a mock; no test calls QF.

const mockList = jest.fn();

jest.mock('@/services/auth/sdkClient', () => ({
  getQfSdk: () => ({auth: {v1: {notes: {list: mockList}}}}),
}));

jest.mock('@/services/auth/qfOAuth', () => ({
  refreshAfterUnauthorized: jest.fn(),
}));

jest.mock('@sentry/react-native', () => ({captureMessage: jest.fn()}));

import {listAllNotes, listNotes} from '../notes';

function page(ids: string[], endCursor: string | null, hasNextPage: boolean) {
  return {
    data: ids.map(id => ({id, body: id, ranges: ['1:1-1:1']})),
    pagination: {endCursor, hasNextPage},
  };
}

beforeEach(() => {
  mockList.mockReset();
});

describe('listNotes — cursor pagination', () => {
  it('sends limit, then limit + cursor, while hasNextPage is true', async () => {
    mockList
      .mockResolvedValueOnce(page(['n1', 'n2'], 'c1', true))
      .mockResolvedValueOnce(page(['n3', 'n4'], 'c2', true))
      .mockResolvedValueOnce(page(['n5'], null, false));

    const notes = await listNotes();

    expect(notes.map(n => n.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(mockList.mock.calls.map(c => c[0])).toEqual([
      {limit: 50},
      {limit: 50, cursor: 'c1'},
      {limit: 50, cursor: 'c2'},
    ]);
  });

  it('sends no first or after param', async () => {
    mockList
      .mockResolvedValueOnce(page(['n1'], 'c1', true))
      .mockResolvedValueOnce(page(['n2'], null, false));

    await listNotes();

    for (const [query] of mockList.mock.calls) {
      expect(query).not.toHaveProperty('first');
      expect(query).not.toHaveProperty('after');
      expect(
        Object.keys(query).every(k => k === 'limit' || k === 'cursor'),
      ).toBe(true);
    }
  });

  it('reads one page when the response has no pagination', async () => {
    mockList.mockResolvedValueOnce({data: [{id: 'n1', body: '', ranges: []}]});

    const notes = await listNotes();

    expect(notes).toHaveLength(1);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('stops when a page adds no new note (a cursor that does not move)', async () => {
    mockList
      .mockResolvedValueOnce(page(['n1'], 'c1', true))
      .mockResolvedValue(page(['n1'], 'c2', true));

    const notes = await listNotes();

    expect(notes.map(n => n.id)).toEqual(['n1']);
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('stops at the page cap (100 pages x 50 = 5000 notes)', async () => {
    let n = 0;
    mockList.mockImplementation(async () => {
      n += 1;
      return page([`n${n}`], `c${n}`, true);
    });

    const notes = await listNotes();

    expect(mockList).toHaveBeenCalledTimes(100);
    expect(notes).toHaveLength(100);
  });
});

// @ai The restore sets its done flag after a listing. A listing that stopped
// while QF still said "more pages" must say so, or the rest is lost for good.
describe('listAllNotes — completeness', () => {
  // A fresh module per test, so its once-per-process Sentry latch is unset.
  function fresh(): {
    listAll: typeof listAllNotes;
    captureMessage: jest.Mock;
  } {
    jest.resetModules();
    return {
      listAll: require('../notes').listAllNotes,
      captureMessage: require('@sentry/react-native').captureMessage,
    };
  }

  it('is complete when the last page has no next page', async () => {
    const {listAll, captureMessage} = fresh();
    mockList
      .mockResolvedValueOnce(page(['n1'], 'c1', true))
      .mockResolvedValueOnce(page(['n2'], null, false));

    const listing = await listAll();

    expect(listing.complete).toBe(true);
    expect(listing.notes.map(n => n.id)).toEqual(['n1', 'n2']);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('is incomplete when hasNextPage is true and no cursor comes', async () => {
    const {listAll, captureMessage} = fresh();
    mockList.mockResolvedValueOnce(page(['n1'], null, true));

    const listing = await listAll();

    expect(listing).toEqual({
      notes: [expect.objectContaining({id: 'n1'})],
      complete: false,
    });
    expect(captureMessage).toHaveBeenCalledWith(
      'qf-notes-list-truncated',
      expect.objectContaining({
        fingerprint: ['qf-notes-list-truncated'],
      }),
    );
  });

  it('is incomplete at the page cap, and reports to Sentry once', async () => {
    const {listAll, captureMessage} = fresh();
    let n = 0;
    mockList.mockImplementation(async () => {
      n += 1;
      return page([`n${n}`], `c${n}`, true);
    });

    const first = await listAll();
    n = 1000;
    const second = await listAll();

    expect(first.complete).toBe(false);
    expect(second.complete).toBe(false);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});
