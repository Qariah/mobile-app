// @ai-generated
// Qariah (Sprint 47 Task 10, TECH_DEBT #282): the link routes hand off to the
// one Mushaf reader with dismissTo (pop back to an open reader, or replace
// the link route), never with a replace that stacks a second reader.
import React from 'react';
import {act, create} from 'react-test-renderer';

const mockRouter = {dismissTo: jest.fn(), replace: jest.fn()};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  // The screen is focused while it is mounted.
  useFocusEffect: (effect: () => void) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));

import {ReaderLinkRedirect} from '@/components/mushaf/ReaderLinkRedirect';

beforeEach(() => {
  mockRouter.dismissTo.mockClear();
  mockRouter.replace.mockClear();
});

it('dismisses to the reader with the link params', () => {
  act(() => {
    create(<ReaderLinkRedirect params={{page: '60'}} />);
  });
  expect(mockRouter.dismissTo).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismissTo).toHaveBeenCalledWith({
    pathname: '/mushaf',
    params: {page: '60'},
  });
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

it('hands off once, though the route re-renders with a new params object', () => {
  let renderer: ReturnType<typeof create> | null = null;
  act(() => {
    renderer = create(
      <ReaderLinkRedirect params={{surah: '18', ayah: '10', page: '294'}} />,
    );
  });
  act(() => {
    renderer?.update(
      <ReaderLinkRedirect params={{surah: '18', ayah: '10', page: '294'}} />,
    );
  });
  expect(mockRouter.dismissTo).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismissTo).toHaveBeenCalledWith({
    pathname: '/mushaf',
    params: {surah: '18', ayah: '10', page: '294'},
  });
});
