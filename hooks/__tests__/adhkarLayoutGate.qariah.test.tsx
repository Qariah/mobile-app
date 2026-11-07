// @ai-generated
// Qariah (Sprint 47 Task 10): app/(tabs)/(a.home)/adhkar/_layout.tsx with
// the shipping flags (`adhkar` off). A qariah://adhkar/... link or the
// /adhkar App Link reaches the hidden adhkar stack; the layout renders no
// adhkar screen and leaves for the Home screen. With the flag on, upstream's
// stack renders as before. Lives outside app/ because every file there is
// bundled as a route.
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

const mockNavigation = {
  canGoBack: jest.fn(() => true),
  goBack: jest.fn(),
  dispatch: jest.fn(),
};
const mockFlags: {adhkar?: boolean} = {};

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual('react');
  function Stack({children}: {children: unknown}) {
    return ReactActual.createElement('AdhkarStack', null, children);
  }
  Stack.Screen = function Screen() {
    return null;
  };
  return {
    Stack,
    useNavigation: () => mockNavigation,
    useRouter: () => ({back: jest.fn()}),
  };
});
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({theme: {colors: {text: '#111', background: '#fff'}}}),
}));
jest.mock('@/hooks/useGlassProps', () => ({USE_GLASS: false}));
jest.mock('@/config/featureFlags', () => {
  const actual = jest.requireActual('@/config/featureFlags');
  return {
    ...actual,
    isFeatureEnabled: (key: string) =>
      key === 'adhkar' && mockFlags.adhkar !== undefined
        ? mockFlags.adhkar
        : actual.isFeatureEnabled(key),
  };
});

import {featureFlags} from '@/config/featureFlags';
import AdhkarLayout from '@/app/(tabs)/(a.home)/adhkar/_layout';

// The layout leaves a frame after it mounts.
function nextFrame(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 50));
}

async function mount(): Promise<ReactTestRenderer> {
  const mounted: {renderer?: ReactTestRenderer} = {};
  await act(async () => {
    mounted.renderer = create(<AdhkarLayout />);
  });
  if (!mounted.renderer) throw new Error('not mounted');
  return mounted.renderer;
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  delete mockFlags.adhkar;
  mockNavigation.canGoBack.mockReturnValue(true);
  // react-test-renderer prints a deprecation notice under React 19.
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

it('(precondition) Qariah ships the adhkar feature off', () => {
  expect(featureFlags.adhkar).toBe(false);
});

it('renders no adhkar screen and goes back to the Home screen', async () => {
  const renderer = await mount();
  expect(renderer.toJSON()).toBeNull();
  await act(async () => {
    await nextFrame();
  });
  expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
});

it('replaces itself with the Home screen when nothing is underneath', async () => {
  mockNavigation.canGoBack.mockReturnValue(false);
  await mount();
  await act(async () => {
    await nextFrame();
  });
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(mockNavigation.dispatch).toHaveBeenCalledWith({
    type: 'REPLACE',
    payload: {name: 'index'},
  });
});

it('does not navigate when it unmounts before the frame', async () => {
  // Fake timers: on a slow machine the real frame could fire inside mount(),
  // before the unmount (Sprint 50: 1 failure in 3 runs under load).
  jest.useFakeTimers();
  try {
    const renderer = await mount();
    await act(async () => {
      renderer.unmount();
    });
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
  } finally {
    jest.useRealTimers();
  }
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
});

it('with the flag on, renders the upstream adhkar stack and stays', async () => {
  mockFlags.adhkar = true;
  const renderer = await mount();
  await act(async () => {
    await nextFrame();
  });
  expect(renderer.root.findAllByType('AdhkarStack' as never)).toHaveLength(1);
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
});
