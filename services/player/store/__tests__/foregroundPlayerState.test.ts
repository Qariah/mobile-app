import {AppState} from 'react-native';
import {usePlayerStore} from '../playerStore';
import {
  selectForegroundPosition,
  selectForegroundQueue,
} from '../foregroundPlayerState';

jest.mock('../playerStore', () => {
  const {create} = require('zustand');
  return {
    usePlayerStore: create(() => ({
      playback: {position: 0},
      queue: {tracks: [], currentIndex: 0},
    })),
  };
});

const setPosition = (position: number) =>
  usePlayerStore.setState(state => ({
    playback: {...state.playback, position},
  }));

const changeAppState = (nextState: string) => {
  (AppState.addEventListener as jest.Mock).mock.calls
    .filter(([type]) => type === 'change')
    .forEach(([, listener]) => listener(nextState));
};

describe('selectForegroundPosition', () => {
  it('follows the store while the app is active', () => {
    setPosition(10);
    expect(selectForegroundPosition(usePlayerStore.getState())).toBe(10);
  });

  it('holds the position in the background, and the store stays live', () => {
    setPosition(20);
    changeAppState('background');
    setPosition(90);
    expect(usePlayerStore.getState().playback.position).toBe(90);
    expect(selectForegroundPosition(usePlayerStore.getState())).toBe(20);
    changeAppState('active');
  });

  it('notifies subscribers with the live position on return', () => {
    setPosition(30);
    changeAppState('background');
    setPosition(120);
    const seen: number[] = [];
    const unsubscribe = usePlayerStore.subscribe(state =>
      seen.push(selectForegroundPosition(state)),
    );
    changeAppState('active');
    unsubscribe();
    expect(seen).toEqual([120]);
  });

  it('does not notify on a return with nothing held', () => {
    const listener = jest.fn();
    const unsubscribe = usePlayerStore.subscribe(listener);
    changeAppState('active');
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('selectForegroundQueue', () => {
  const setIndex = (currentIndex: number) =>
    usePlayerStore.setState(state => ({
      queue: {...state.queue, currentIndex},
    }));

  it('holds the queue in the background, and the store stays live', () => {
    setIndex(1);
    changeAppState('background');
    setIndex(2);
    expect(usePlayerStore.getState().queue.currentIndex).toBe(2);
    expect(selectForegroundQueue(usePlayerStore.getState()).currentIndex).toBe(
      1,
    );
    changeAppState('active');
  });

  it('notifies subscribers with the live queue on return', () => {
    setIndex(3);
    changeAppState('background');
    setIndex(4);
    const seen: number[] = [];
    const unsubscribe = usePlayerStore.subscribe(state =>
      seen.push(selectForegroundQueue(state).currentIndex),
    );
    changeAppState('active');
    unsubscribe();
    expect(seen).toEqual([4]);
  });
});
