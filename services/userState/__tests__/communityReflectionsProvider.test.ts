// Qariah's RFC-018 provider (services/userState/communityReflectionsProvider.ts):
// the AyahReflection -> CommunityReflection mapping, and one shared request
// per ayah for the inline card and the action-sheet popup.

const mockList = jest.fn();
const mockCapture = jest.fn();

jest.mock('../communityReflections', () => ({
  listCommunityReflectionsByAyah: (...args: unknown[]) => mockList(...args),
}));
jest.mock('@sentry/react-native', () => ({
  captureException: (...args: unknown[]) => mockCapture(...args),
}));

import {
  __resetCommunityReflectionsCache,
  qariahCommunityReflectionsProvider,
  quranReflectPostUrl,
  toCommunityReflection,
} from '../communityReflectionsProvider';
import type {AyahReflection} from '../communityReflections';

function reflection(overrides: Partial<AyahReflection> = {}): AyahReflection {
  return {
    id: 42,
    body: 'A reflection',
    author: {id: 7, name: 'Aisha', username: 'aisha_r', verified: true},
    likesCount: 3,
    commentsCount: 1,
    isLiked: false,
    publishedAt: '2026-05-28T10:00:00Z',
    languageName: 'English',
    ...overrides,
  };
}

beforeEach(() => {
  mockList.mockReset();
  mockCapture.mockReset();
  __resetCommunityReflectionsCache();
});

describe('toCommunityReflection', () => {
  it('maps the QF feed shape onto the RFC-018 shape', () => {
    expect(toCommunityReflection(reflection())).toEqual({
      id: '42',
      author: {name: 'Aisha', handle: 'aisha_r', verified: true},
      body: 'A reflection',
      likesCount: 3,
      commentsCount: 1,
      publishedAt: '2026-05-28T10:00:00Z',
      url: 'https://quranreflect.com/posts/42',
      language: 'en',
    });
  });

  it('falls back to the username, then Anonymous, for the author name', () => {
    expect(
      toCommunityReflection(
        reflection({author: {id: 1, username: 'only_handle'}}),
      ).author,
    ).toEqual({name: 'only_handle', handle: 'only_handle', verified: false});
    expect(toCommunityReflection(reflection({author: {id: 1}})).author).toEqual(
      {name: 'Anonymous', handle: '', verified: false},
    );
  });

  it('builds the post permalink from the id', () => {
    expect(quranReflectPostUrl('abc')).toBe(
      'https://quranreflect.com/posts/abc',
    );
  });
});

describe('qariahCommunityReflectionsProvider', () => {
  it('shares one request per ayah and locale', async () => {
    mockList.mockResolvedValue([reflection()]);
    const [a, b] = await Promise.all([
      qariahCommunityReflectionsProvider(2, 255),
      qariahCommunityReflectionsProvider(2, 255, 'en'),
    ]);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(2, 255, 'en');
    expect(a).toBe(b);
    expect(a.map(r => r.id)).toEqual(['42']);
  });

  it('forgets a failed request, reports it, and retries on the next call', async () => {
    mockList.mockRejectedValueOnce(new Error('network request failed'));
    await expect(qariahCommunityReflectionsProvider(1, 1)).rejects.toThrow(
      'network request failed',
    );
    expect(mockCapture).toHaveBeenCalledWith(expect.any(Error), {
      tags: {source: 'communityReflectionsProvider', verseKey: '1:1'},
    });

    mockList.mockResolvedValueOnce([]);
    await expect(qariahCommunityReflectionsProvider(1, 1)).resolves.toEqual([]);
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});
