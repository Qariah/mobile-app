/**
 * Qariah (Sprint 48): the trending leaderboard fetch must not run while the
 * Listen "Trending This Week" row is off (owner decision 2026-10-18). The
 * hook takes an `enabled` option; when it is false the hook does no MMKV read
 * and no network fetch, and returns an empty list.
 */
import React from 'react';
import {act, create} from 'react-test-renderer';

// The hook creates its MMKV instance at import time, so the mock instance
// lives inside the factory and the test reads it back from the mocked module.
jest.mock('react-native-mmkv', () => {
  const instance = {
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
  };
  return {createMMKV: () => instance, __instance: instance};
});

jest.mock('@/data/reciterData', () => ({
  RECITERS: [{id: 'r1', name: 'Reciter One'}],
}));

jest.mock('@/config/branding', () => ({
  __esModule: true,
  default: {stats: {topRecitersUrl: 'https://stats.example.test/top.json'}},
}));

import {useTrendingReciters} from '@/hooks/useTrendingReciters';

const mockMmkv = (
  jest.requireMock('react-native-mmkv') as {
    __instance: Record<'getString' | 'getNumber' | 'set', jest.Mock>;
  }
).__instance;

type HookResult = ReturnType<typeof useTrendingReciters>;

function Probe({
  options,
  onResult,
}: {
  options: Parameters<typeof useTrendingReciters>[0];
  onResult: (result: HookResult) => void;
}): null {
  onResult(useTrendingReciters(options));
  return null;
}

const payload = {
  windowDays: 7,
  generatedAt: '2026-10-18T00:00:00Z',
  reciters: [{reciterId: 'r1', plays: 10}],
};

let fetchMock: jest.Mock;

beforeEach(() => {
  mockMmkv.getString.mockReset();
  mockMmkv.getNumber.mockReset();
  mockMmkv.set.mockReset();
  fetchMock = jest.fn(() =>
    Promise.resolve({ok: true, json: () => Promise.resolve(payload)}),
  );
  (global as unknown as {fetch: jest.Mock}).fetch = fetchMock;
});

async function render(options: Parameters<typeof useTrendingReciters>[0]) {
  let latest: HookResult | null = null;
  await act(async () => {
    create(
      <Probe
        options={options}
        onResult={result => {
          latest = result;
        }}
      />,
    );
  });
  return () => latest as unknown as HookResult;
}

it('does not fetch, read the cache or return reciters when enabled is false', async () => {
  // A stored payload exists, so a cache read would show reciters.
  mockMmkv.getString.mockReturnValue(JSON.stringify(payload));
  const result = await render({limit: 10, enabled: false});
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mockMmkv.getString).not.toHaveBeenCalled();
  expect(mockMmkv.getNumber).not.toHaveBeenCalled();
  expect(result().reciters).toEqual([]);
  expect(result().loading).toBe(false);
});

it('does not fetch when enabled is false, even with forceRefresh', async () => {
  await render({enabled: false, forceRefresh: true});
  expect(fetchMock).not.toHaveBeenCalled();
});

it('still fetches by default when the cache is empty (the control case)', async () => {
  const result = await render({limit: 10});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(
    'https://stats.example.test/top.json',
  );
  expect(result().reciters.map(r => r.id)).toEqual(['r1']);
});
