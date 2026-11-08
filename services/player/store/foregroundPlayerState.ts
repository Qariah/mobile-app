// @ai Qariah: the playback position and the queue that the UI reads.
//
// While the app is in the background, Android holds every UI change that JS
// sends and applies all of them in one frame on return. A long listen then
// freezes the return, up to an ANR. A track change costs the most, because the
// full player mounts a new verse list for it. The store stays live for the car,
// the widgets and session restore. The UI reads it through these selectors,
// which hold each value until the app is active again.
import {AppState} from 'react-native';
import {usePlayerStore} from './playerStore';

type PlayerQueue = ReturnType<typeof usePlayerStore.getState>['queue'];

let held: {position: number; queue: PlayerQueue} | null = null;

AppState.addEventListener('change', nextState => {
  if (nextState === 'background') {
    const {playback, queue} = usePlayerStore.getState();
    held = {position: playback.position, queue};
  } else if (nextState === 'active' && held !== null) {
    held = null;
    // A new state makes each subscribed selector read the live values now.
    usePlayerStore.setState(state => ({playback: {...state.playback}}));
  }
});

export function selectForegroundPosition(state: {
  playback: {position: number};
}): number {
  return held ? held.position : state.playback.position;
}

export function selectForegroundQueue(state: {
  queue: PlayerQueue;
}): PlayerQueue {
  return held ? held.queue : state.queue;
}
