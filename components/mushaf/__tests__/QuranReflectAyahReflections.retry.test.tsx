// @ai-generated
/**
 * TECH_DEBT #388: an errored verse fetches its reflections again when it
 * mounts after the back-off (30 s, doubled after each failure, at most
 * 5 min), and not before.
 */
import React from 'react';
import {act, render} from '@testing-library/react-native';

const mockProvider = jest.fn();

jest.mock('@/config/branding', () => ({
  __esModule: true,
  default: {
    communityReflectionsProvider: (...args: unknown[]) => mockProvider(...args),
  },
}));
jest.mock('@/services/userState/communityReflectionsProvider', () => ({
  quranReflectVerseUrl: () => 'https://example.test/verse',
}));
jest.mock('@/utils/openExternalUrl', () => ({openExternalUrl: jest.fn()}));
jest.mock('@expo/vector-icons', () => ({Feather: () => null}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      isDarkMode: false,
      colors: {
        text: '#111111',
        textSecondary: '#666666',
        background: '#ffffff',
        card: '#ffffff',
        border: '#dddddd',
      },
    },
    isDarkMode: false,
  }),
}));

import {
  QuranReflectAyahReflections,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  retryDelayMs,
} from '../QuranReflectAyahReflections';

/** Mounts the card, lets the fetch settle, and unmounts it. */
async function mountOnce(surahNumber: number, ayahNumber: number) {
  const view = render(
    <QuranReflectAyahReflections
      surahNumber={surahNumber}
      ayahNumber={ayahNumber}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-14T12:00:00Z'));
  mockProvider.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('retryDelayMs', () => {
  it('waits 30 s, then doubles, to at most 5 min', () => {
    expect(RETRY_BASE_MS).toBe(30_000);
    expect(RETRY_MAX_MS).toBe(300_000);
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(4)).toBe(240_000);
    expect(retryDelayMs(5)).toBe(300_000);
    expect(retryDelayMs(12)).toBe(300_000);
  });
});

describe('an errored verse', () => {
  it('fetches again on a mount 30 s or more after the error, not before', async () => {
    mockProvider.mockRejectedValue(new Error('offline'));
    (await mountOnce(26, 1)).unmount();
    expect(mockProvider).toHaveBeenCalledTimes(1);

    // Before the wait: a mount shows the error state and does not fetch.
    jest.advanceTimersByTime(RETRY_BASE_MS - 1);
    const early = await mountOnce(26, 1);
    expect(early.toJSON()).toBeNull();
    early.unmount();
    expect(mockProvider).toHaveBeenCalledTimes(1);

    // At 30 s: the mount fetches again.
    jest.advanceTimersByTime(1);
    (await mountOnce(26, 1)).unmount();
    expect(mockProvider).toHaveBeenCalledTimes(2);
    expect(mockProvider).toHaveBeenLastCalledWith(26, 1, 'en');

    // A second failure doubles the wait: 59 s is too soon, 60 s is not.
    jest.advanceTimersByTime(2 * RETRY_BASE_MS - 1);
    (await mountOnce(26, 1)).unmount();
    expect(mockProvider).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    (await mountOnce(26, 1)).unmount();
    expect(mockProvider).toHaveBeenCalledTimes(3);
  });

  it('shows the card after a retry succeeds, and fetches no more', async () => {
    mockProvider.mockRejectedValueOnce(new Error('offline'));
    (await mountOnce(26, 62)).unmount();

    mockProvider.mockResolvedValueOnce([
      {
        id: '1',
        author: {name: 'Author', handle: 'author', verified: false},
        body: 'A reflection',
        likesCount: 3,
        commentsCount: 0,
        publishedAt: '2026-11-01T00:00:00Z',
        url: 'https://example.test/r/1',
        language: 'en',
      },
    ]);
    jest.advanceTimersByTime(RETRY_BASE_MS);
    const view = await mountOnce(26, 62);
    expect(mockProvider).toHaveBeenCalledTimes(2);
    expect(view.toJSON()).not.toBeNull();
    view.unmount();

    // A loaded verse never fetches again in the session.
    jest.advanceTimersByTime(RETRY_MAX_MS * 2);
    (await mountOnce(26, 62)).unmount();
    expect(mockProvider).toHaveBeenCalledTimes(2);
  });

  it('does not fetch a loading verse twice', async () => {
    let settle: (value: unknown) => void = () => undefined;
    mockProvider.mockReturnValueOnce(
      new Promise(resolve => {
        settle = resolve;
      }),
    );
    const first = await mountOnce(67, 1);
    const second = await mountOnce(67, 1);
    expect(mockProvider).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle([]);
      await Promise.resolve();
    });
    first.unmount();
    second.unmount();
  });
});
