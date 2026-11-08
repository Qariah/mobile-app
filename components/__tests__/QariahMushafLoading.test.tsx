// @ai Qariah — the reader's loading state says what happens on a long wait
// (planning/lite-mode-design.md, section 7c).
import React from 'react';
import {act, render, screen} from '@testing-library/react-native';
import {QariahMushafLoading} from '../QariahMushafLoading';

describe('QariahMushafLoading', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows only a spinner for 3 s, then one line of text', () => {
    render(<QariahMushafLoading color="#000" />);
    act(() => jest.advanceTimersByTime(2999));
    expect(screen.queryByTestId('mushaf-loading-text')).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByTestId('mushaf-loading-text')).toBeTruthy();
  });
});
