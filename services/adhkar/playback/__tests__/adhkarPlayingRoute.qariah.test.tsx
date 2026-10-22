// @ai
// Qariah (Sprint 47 Pass C, Task 4): app/adhkar-playing.tsx with the shipping
// flags (`adhkar` off). A qariah://adhkar-playing link has no adhkar session
// and no Adhkar screen to open, so the route only leaves itself for the tabs.
// Upstream's behaviour (adhkar on) is in adhkarPlayingRoute.test.tsx.
import React from 'react';
import {act, create} from 'react-test-renderer';

const mockNavigation = {
  canGoBack: jest.fn(() => true),
  goBack: jest.fn(),
  dispatch: jest.fn(),
};
const mockContainer = {dispatch: jest.fn()};
const mockWait = jest.fn((_timeoutMs: number) => Promise.resolve());
const mockOpen = jest.fn<boolean, [unknown, unknown]>(() => false);

jest.mock('expo-router', () => ({
  useNavigation: () => mockNavigation,
  useNavigationContainerRef: () => mockContainer,
}));
jest.mock('@/services/adhkar/playback/sessionPersistence', () => ({
  waitForSessionRestore: (timeoutMs: number) => mockWait(timeoutMs),
}));
jest.mock('@/services/adhkar/playback/openPlayingDhikr', () => ({
  ...jest.requireActual('@/services/adhkar/playback/openPlayingDhikr'),
  openPlayingDhikr: (navigation: unknown, current: unknown) =>
    mockOpen(navigation, current),
}));

import {featureFlags} from '@/config/featureFlags';
import AdhkarPlayingRoute from '@/app/adhkar-playing';

// The route leaves a frame after it mounts. The test queues the frame
// callbacks and runs them itself: a real 50 ms wait for a real frame failed
// now and then on a busy CI worker (TECH_DEBT #312).
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function runFrames(): void {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigation.canGoBack.mockReturnValue(true);
  frames.clear();
  jest
    .spyOn(global, 'requestAnimationFrame')
    .mockImplementation((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(id => {
    if (id != null) frames.delete(id);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('(precondition) Qariah ships the adhkar feature off', () => {
  expect(featureFlags.adhkar).toBe(false);
});

it('goes back without waiting for a session or opening the Adhkar screen', async () => {
  await act(async () => {
    create(<AdhkarPlayingRoute />);
  });
  act(() => {
    runFrames();
  });
  expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  expect(mockWait).not.toHaveBeenCalled();
  expect(mockOpen).not.toHaveBeenCalled();
  expect(mockContainer.dispatch).not.toHaveBeenCalled();
});

it('swaps itself for the tabs when it is the only route', async () => {
  mockNavigation.canGoBack.mockReturnValue(false);
  await act(async () => {
    create(<AdhkarPlayingRoute />);
  });
  act(() => {
    runFrames();
  });
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(mockNavigation.dispatch).toHaveBeenCalledWith({
    type: 'REPLACE',
    payload: {name: '(tabs)'},
  });
  expect(mockContainer.dispatch).not.toHaveBeenCalled();
});

it('does not navigate when it unmounts before the frame', async () => {
  let renderer: ReturnType<typeof create> | null = null;
  await act(async () => {
    renderer = create(<AdhkarPlayingRoute />);
  });
  await act(async () => {
    renderer?.unmount();
  });
  act(() => {
    runFrames();
  });
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
});
