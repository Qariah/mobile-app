// @ai
// Regression tests for the full-player play/pause control (review of d16b73bb,
// L1). The control sets a local optimistic "playing" flag before it awaits
// play(). When play() returns with no audio (an early tap that got no player,
// or a play that a stop cancelled), the store playback state does not change,
// so the re-sync effect does not run, and the store play() catches its own
// errors, so the handler's catch does not run. The control then stayed on
// Pause with no audio. After the await, the control must read the store state.

import React from 'react';
import {render, fireEvent, act} from '@testing-library/react-native';

const mockState = {
  playback: {state: 'paused', position: 0},
  queue: {tracks: [{id: 't1'}, {id: 't2'}], currentIndex: 0},
  loading: {trackLoading: false},
};

const mockActions = {
  play: jest.fn(),
  pause: jest.fn(),
  skipToNext: jest.fn(),
  skipToPrevious: jest.fn(),
  seekTo: jest.fn(),
};

jest.mock('@/services/player/store/playerStore', () => {
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const usePlayerStore = selector => selector(mockState);
  usePlayerStore.getState = () => mockState;
  return {usePlayerStore};
});

jest.mock('@/hooks/usePlayerActions', () => ({
  usePlayerActions: () => mockActions,
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {colors: {text: '#111111', textSecondary: '#666666'}},
    isDarkMode: false,
  }),
}));

jest.mock('react-native-size-matters', () => ({
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  moderateScale: value => value,
}));

jest.mock('@/components/Icons', () => {
  const {View} = require('react-native');
  // @ts-expect-error jest.mock() factory: TS annotations are banned by babel-jest
  const icon = testID => {
    const Icon = () => <View testID={testID} />;
    Icon.displayName = testID;
    return Icon;
  };
  return {
    PlayIcon: icon('icon-play'),
    PauseIcon: icon('icon-pause'),
    PreviousIcon: icon('icon-previous'),
    NextIcon: icon('icon-next'),
    SeekForwardIcon: icon('icon-seek-forward'),
    SeekBackwardIcon: icon('icon-seek-backward'),
  };
});

import {Controls} from '../Controls';

describe('Controls play/pause optimistic state (review L1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.playback.state = 'paused';
  });

  it('shows Play again when play() returns with no audio and the store state stays paused', async () => {
    // The store play() resolves, but the service did not play: no state change.
    mockActions.play.mockResolvedValue(undefined);
    const {getByTestId, queryByTestId} = render(<Controls />);
    expect(getByTestId('icon-play')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('icon-play'));
    });

    expect(mockActions.play).toHaveBeenCalledTimes(1);
    expect(queryByTestId('icon-pause')).toBeNull();
    expect(getByTestId('icon-play')).toBeTruthy();
  });

  it('(safety) keeps Pause when play() starts audio and the store state is playing', async () => {
    mockActions.play.mockImplementation(async () => {
      mockState.playback.state = 'playing';
    });
    const {getByTestId, queryByTestId} = render(<Controls />);

    await act(async () => {
      fireEvent.press(getByTestId('icon-play'));
    });

    expect(getByTestId('icon-pause')).toBeTruthy();
    expect(queryByTestId('icon-play')).toBeNull();
  });
});
