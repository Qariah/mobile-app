// @ai
/**
 * The QF sync side effects of two inherited player stores, kept out of the
 * store files so that they stay close to upstream Bayaan (divergence batch C3,
 * PLY-S8). Before, the stores called the push helpers themselves.
 *
 * - Favourites: `addFavoriteReciter` (only when the reciter was not already a
 *   favourite) and `removeFavoriteReciter` (always) push the full id list.
 *   `toggleFavoriteReciter` calls them through `get()`, so it pushes too.
 * - Recently played: `startNewChain` (an explicit play) pushes a reading
 *   session. Auto-advance and progress writes (`updateActiveChain`,
 *   `updateProgress`) do not push.
 *
 * The push helpers are the auth-gated, buffered ones in `syncBus.ts`: they do
 * nothing for a signed-out user.
 *
 * Why this module wraps the actions and does not `subscribe` to the state: a
 * state listener cannot tell these writes from others. The persist hydration
 * and `reset()` also change `favoriteReciterIds`, and they must not push.
 * `startNewChain` and `updateActiveChain` can make the same change to
 * `recentTracks`, and only the first one pushes.
 *
 * The v1 restore adds favourites in bulk with one push
 * (`addFavoriteRecitersBatch` in `v1Restore.ts`).
 *
 * `UserStateContext.tsx` calls `installPlayerStoreSync()` when it loads. That
 * is before `UserStateProvider` can set the auth snapshot, and the push
 * helpers do nothing before that, so no push is lost.
 */

import {useFavoriteRecitersStore} from '@/services/player/store/favoriteRecitersStore';
import {useRecentlyPlayedStore} from '@/services/player/store/recentlyPlayedStore';
import {enqueueFavoritesSync, enqueueReadingSessionSync} from './syncBus';

let installed = false;

/** Wraps the store actions with their QF pushes. Runs once; later calls do nothing. */
export function installPlayerStoreSync(): void {
  if (installed) return;
  installed = true;

  const {addFavoriteReciter, removeFavoriteReciter} =
    useFavoriteRecitersStore.getState();
  useFavoriteRecitersStore.setState({
    addFavoriteReciter: reciter => {
      const before = useFavoriteRecitersStore.getState().favoriteReciterIds;
      addFavoriteReciter(reciter);
      const after = useFavoriteRecitersStore.getState().favoriteReciterIds;
      // The store keeps the same array when the reciter is already there.
      if (after !== before) enqueueFavoritesSync(after);
    },
    removeFavoriteReciter: reciterId => {
      removeFavoriteReciter(reciterId);
      enqueueFavoritesSync(
        useFavoriteRecitersStore.getState().favoriteReciterIds,
      );
    },
  });

  const {startNewChain} = useRecentlyPlayedStore.getState();
  useRecentlyPlayedStore.setState({
    startNewChain: (reciter, surah, progress, duration, rewayatId) => {
      startNewChain(reciter, surah, progress, duration, rewayatId);
      enqueueReadingSessionSync({
        reciterId: reciter.id,
        surahNumber: surah.id,
        ayahNumber: 1,
      });
    },
  });
}
