// @ai-generated
// Qariah (Sprint 50, Task 15, TECH_DEBT #236): the adhkar index screen
// app/(tabs)/(a.home)/adhkar/index.tsx checks the `adhkar` feature flag. The
// check must not run before the hooks of the screen. React does not always
// throw for that defect: a component that calls no hook in an update render
// drops the effect list of the previous render, so the cleanup of its effects
// never runs. The test renders the screen with the flag on, with the flag
// off, and through a change in both directions. It checks that nothing throws
// and that the cleanup of a hook effect runs when the flag goes off. It lives
// outside app/ because every file there is bundled as a route.
import React from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

const mockFlags: {adhkar: boolean} = {adhkar: true};
const mockHookCleanup = jest.fn();

jest.mock('@/config/featureFlags', () => {
  const actual = jest.requireActual('@/config/featureFlags');
  return {
    ...actual,
    isFeatureEnabled: (key: string) =>
      key === 'adhkar' ? mockFlags.adhkar : actual.isFeatureEnabled(key),
  };
});

jest.mock('expo-router', () => ({
  // The screen calls this hook. The mock hook has an effect, as a real hook
  // can have one, and it records the cleanup of that effect.
  useRouter: () => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => mockHookCleanup, []);
    return {push: jest.fn()};
  },
}));
jest.mock('@/components/AdhkarView', () => {
  const {Text: RNText} = jest.requireActual('react-native');
  return {AdhkarView: () => <RNText>adhkar-view</RNText>};
});

import {featureFlags} from '@/config/featureFlags';
import AdhkarIndexScreen from '@/app/(tabs)/(a.home)/adhkar/index';

// A host that renders the screen with a flag value that changes between renders.
function Host({tick}: {tick: number}) {
  return (
    <>
      <Text>{`tick-${tick}`}</Text>
      <AdhkarIndexScreen />
    </>
  );
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  mockFlags.adhkar = true;
  mockHookCleanup.mockClear();
  // React logs a hooks-order error before it throws. Keep the output clean.
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('adhkar index screen: the adhkar flag guard runs after the hooks', () => {
  it('(precondition) Qariah ships the adhkar feature off', () => {
    expect(featureFlags.adhkar).toBe(false);
  });

  it('renders the screen with the flag on', () => {
    const screen = render(<Host tick={0} />);
    expect(screen.getByText('adhkar-view')).toBeTruthy();
  });

  it('renders nothing for the screen with the flag off', () => {
    mockFlags.adhkar = false;
    const screen = render(<Host tick={0} />);
    expect(screen.queryByText('adhkar-view')).toBeNull();
    expect(screen.getByText('tick-0')).toBeTruthy();
  });

  it('does not throw when the flag goes from on to off between two renders', () => {
    const screen = render(<Host tick={0} />);
    expect(screen.getByText('adhkar-view')).toBeTruthy();
    expect(mockHookCleanup).not.toHaveBeenCalled();

    mockFlags.adhkar = false;
    expect(() => screen.rerender(<Host tick={1} />)).not.toThrow();
    expect(screen.queryByText('adhkar-view')).toBeNull();
    expect(screen.getByText('tick-1')).toBeTruthy();
    // The hidden screen must release its effects.
    expect(mockHookCleanup).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the flag goes from off to on between two renders', () => {
    mockFlags.adhkar = false;
    const screen = render(<Host tick={0} />);
    expect(screen.queryByText('adhkar-view')).toBeNull();

    mockFlags.adhkar = true;
    expect(() => screen.rerender(<Host tick={1} />)).not.toThrow();
    expect(screen.getByText('adhkar-view')).toBeTruthy();
  });
});
