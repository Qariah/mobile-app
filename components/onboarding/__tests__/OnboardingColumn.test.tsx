// @ai Sprint 52 Task 7: the onboarding column is a centred column of at most
// 560 pt on a tablet, and unchanged on a phone.
import React from 'react';
import {StyleSheet, Text} from 'react-native';
import {render} from '@testing-library/react-native';

// @ai Sprint 52: the card width constant lives in the action sheet module,
// which pulls in reanimated; Jest needs only the numbers.
jest.mock('@/components/sheets/AdaptiveActionSheet', () => ({
  SHEET_MAX_WIDTH: 560,
  SHEET_MAX_HEIGHT: 760,
}));
let mockIsTablet = false;
jest.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({isTablet: mockIsTablet}),
}));

import {OnboardingColumn} from '../OnboardingColumn';

function columnStyle() {
  const screen = render(
    <OnboardingColumn>
      <Text>hi</Text>
    </OnboardingColumn>,
  );
  return StyleSheet.flatten(
    screen.getByTestId('onboarding-column').props.style,
  );
}

describe('OnboardingColumn', () => {
  it('on a tablet: centred, at most 560 pt', () => {
    mockIsTablet = true;
    const style = columnStyle();
    expect(style.maxWidth).toBe(560);
    expect(style.alignSelf).toBe('center');
    expect(style.width).toBe('100%');
  });

  it('on a phone: fills the screen, no width cap', () => {
    mockIsTablet = false;
    const style = columnStyle();
    expect(style.maxWidth).toBeUndefined();
    expect(style.alignSelf).toBeUndefined();
    expect(style.flex).toBe(1);
  });
});
