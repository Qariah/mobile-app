// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16 review L1): the tap router starts only for
// the arm `notify`; a holdout user never loads `expo-notifications` through it.
import React from 'react';
import {render} from '@testing-library/react-native';

const mockStartRouter = jest.fn();
const mockIsHoldout = jest.fn(() => false);
const mockAssigned = jest.fn();

jest.mock('posthog-react-native', () => ({usePostHog: () => null}));
jest.mock('expo-router', () => ({
  useRouter: () => ({push: jest.fn(), navigate: jest.fn()}),
  useNavigationContainerRef: () => ({current: null}),
}));
jest.mock('../holdout', () => ({
  isNotificationsHoldout: () => mockIsHoldout(),
}));
jest.mock('../backgroundTask', () => ({
  onNotificationsHoldoutAssigned: (arm: string) => mockAssigned(arm),
}));
jest.mock('../holdoutEnrollment', () => ({
  startHoldoutEnrollment: () => () => undefined,
}));
jest.mock('../tapRouter', () => ({
  startNotificationTapRouter: (...args: unknown[]) => mockStartRouter(...args),
  openNotificationTap: jest.fn(),
}));

import {
  handleHoldoutAssigned,
  useQariahNotifications,
} from '../useQariahNotifications';

function Host(): null {
  useQariahNotifications();
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useQariahNotifications (the tap router and the arm)', () => {
  it('the arm notify: starts the tap router', () => {
    mockIsHoldout.mockReturnValue(false);
    render(<Host />);
    expect(mockStartRouter).toHaveBeenCalledTimes(1);
  });

  it('the holdout (or an unknown arm in a release): no tap router', () => {
    mockIsHoldout.mockReturnValue(true);
    render(<Host />);
    expect(mockStartRouter).not.toHaveBeenCalled();
  });

  it('an arm written later: notify starts the router, holdout does not', () => {
    mockIsHoldout.mockReturnValue(true);
    render(<Host />);
    handleHoldoutAssigned({arm: 'holdout', enrollment: 'flag'}, true);
    expect(mockStartRouter).not.toHaveBeenCalled();
    expect(mockAssigned).toHaveBeenCalledWith('holdout');
    handleHoldoutAssigned({arm: 'notify', enrollment: 'flag'}, true);
    expect(mockStartRouter).toHaveBeenCalledTimes(1);
    expect(mockAssigned).toHaveBeenCalledWith('notify');
  });

  it('a stored arm is not new: no sync, but the router starts', () => {
    mockIsHoldout.mockReturnValue(true);
    render(<Host />);
    handleHoldoutAssigned({arm: 'notify', enrollment: 'flag'}, false);
    expect(mockAssigned).not.toHaveBeenCalled();
    expect(mockStartRouter).toHaveBeenCalledTimes(1);
  });
});
