import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {Reciter} from '@/data/reciterData';
// @ai Qariah-only: auth-gated QF sync side-effect. No-op for unauthenticated
// users (upstream-equivalent behavior). See services/userState/syncBus.ts.
import {enqueueFavoritesSync} from '@/services/userState';
import {guardedJSONStorage} from '@/services/storage/hydrationGuardedStorage';

interface FavoriteReciterWithTimestamp extends Reciter {
  favoritedAt: number;
}

interface FavoriteRecitersState {
  favoriteReciterIds: string[];
  favoriteReciters: Record<string, FavoriteReciterWithTimestamp>;
  addFavoriteReciter: (reciter: Reciter) => void;
  /**
   * Sprint 13 (TECH_DEBT #52) — bulk-add favorites with a SINGLE sync
   * enqueue at the end. The Sprint 11 v1-restore path adds N reciters in
   * a loop; without this batch path each `addFavoriteReciter` call would
   * enqueue its own `enqueueFavoritesSync(nextIds)`. Functional impact
   * was small (sync queue dedupes by latest-state-wins), but the burst
   * was wasteful + noisy in Sentry breadcrumbs.
   *
   * Returns the count of reciters newly added (skips duplicates already
   * in the favorites list).
   */
  addFavoriteRecitersBatch: (reciters: Reciter[]) => number;
  removeFavoriteReciter: (reciterId: string) => void;
  toggleFavoriteReciter: (reciter: Reciter) => void;
  isFavoriteReciter: (reciterId: string) => boolean;
  getFavoriteReciter: (
    reciterId: string,
  ) => FavoriteReciterWithTimestamp | undefined;
  getFavoriteReciters: () => FavoriteReciterWithTimestamp[];
  reset: () => void;
}

export const useFavoriteRecitersStore = create<FavoriteRecitersState>()(
  persist(
    (set, get) => ({
      favoriteReciterIds: [],
      favoriteReciters: {},

      addFavoriteReciter: (reciter: Reciter) => {
        let nextIds: string[] | null = null;
        set(state => {
          if (state.favoriteReciterIds.includes(reciter.id)) {
            return state;
          }

          const reciterWithTimestamp: FavoriteReciterWithTimestamp = {
            ...reciter,
            favoritedAt: Date.now(),
          };

          nextIds = [...state.favoriteReciterIds, reciter.id];
          return {
            favoriteReciterIds: nextIds,
            favoriteReciters: {
              ...state.favoriteReciters,
              [reciter.id]: reciterWithTimestamp,
            },
          };
        });
        // @ai Qariah-only: mirror to QF preferences if signed in.
        if (nextIds) enqueueFavoritesSync(nextIds);
      },

      addFavoriteRecitersBatch: (reciters: Reciter[]) => {
        let nextIds: string[] | null = null;
        let added = 0;
        set(state => {
          const existing = new Set(state.favoriteReciterIds);
          const now = Date.now();
          const additions: Record<string, FavoriteReciterWithTimestamp> = {};
          const addedIds: string[] = [];
          for (const r of reciters) {
            if (existing.has(r.id)) continue;
            existing.add(r.id);
            additions[r.id] = {...r, favoritedAt: now};
            addedIds.push(r.id);
          }
          if (addedIds.length === 0) return state;
          added = addedIds.length;
          nextIds = [...state.favoriteReciterIds, ...addedIds];
          return {
            favoriteReciterIds: nextIds,
            favoriteReciters: {...state.favoriteReciters, ...additions},
          };
        });
        // @ai Qariah-only: ONE sync enqueue covering all batched additions.
        if (nextIds) enqueueFavoritesSync(nextIds);
        return added;
      },

      removeFavoriteReciter: (reciterId: string) => {
        let nextIds: string[] | null = null;
        set(state => {
          nextIds = state.favoriteReciterIds.filter(id => id !== reciterId);
          return {
            favoriteReciterIds: nextIds,
            favoriteReciters: Object.fromEntries(
              Object.entries(state.favoriteReciters).filter(
                ([id]) => id !== reciterId,
              ),
            ),
          };
        });
        // @ai Qariah-only: mirror to QF preferences if signed in.
        if (nextIds) enqueueFavoritesSync(nextIds);
      },

      toggleFavoriteReciter: (reciter: Reciter) => {
        const state = get();
        if (state.isFavoriteReciter(reciter.id)) {
          state.removeFavoriteReciter(reciter.id);
        } else {
          state.addFavoriteReciter(reciter);
        }
      },

      isFavoriteReciter: (reciterId: string) => {
        return get().favoriteReciterIds.includes(reciterId);
      },

      getFavoriteReciter: (reciterId: string) => {
        return get().favoriteReciters[reciterId];
      },

      getFavoriteReciters: () => {
        const state = get();
        return Object.values(state.favoriteReciters);
      },

      reset: () => {
        set({
          favoriteReciterIds: [],
          favoriteReciters: {},
        });
      },
    }),
    {
      name: 'player-favorite-reciters-storage',
      storage: guardedJSONStorage('player-favorite-reciters-storage'),
    },
  ),
);
