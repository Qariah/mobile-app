// @ai-generated
// Qariah (Sprint 48): the catalog refill signal for components.
import {useSyncExternalStore} from 'react';
import {getRecitersVersion, subscribeRecitersUpdated} from '@/data/reciterData';

/**
 * A number that changes each time `RECITERS` is filled again
 * (`populateReciters` in services/dataService.ts). Use it as a `useMemo`
 * dependency for data derived from `RECITERS`: the array is refilled in
 * place, so its reference never changes, and `useReciterStore`'s
 * `isInitialized` changes only on the first fill.
 */
export function useRecitersVersion(): number {
  return useSyncExternalStore(
    subscribeRecitersUpdated,
    getRecitersVersion,
    getRecitersVersion,
  );
}
