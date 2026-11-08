// @ai Qariah — the tajweed data loads when the reader has tajweed on, after
// the splash; never at boot.
//
// The load (an 8.7 MB JSON, 207,933 regex passes, three copies of the data)
// held the JS thread for 3.4 s at every cold start on a Samsung A10s, for a
// setting that is off by default (planning/a10s-performance-review-2026-10-27.md).
// The tajweed surfaces read useTajweedStore and draw plain text until it is
// loaded.
import {useEffect} from 'react';
import {useMushafSettingsStore} from '@/store/mushafSettingsStore';
import {useTajweedStore} from '@/store/tajweedStore';
import {whenSplashHidden} from '@/utils/bootSplash';

// Required when the load starts, not at import (an 8.7 MB JSON).
function startTajweedLoad(): void {
  const {preloadTajweedData} =
    require('@/utils/tajweedLoader') as typeof import('@/utils/tajweedLoader');
  preloadTajweedData();
}

export function useTajweedOnDemand(): void {
  const showTajweed = useMushafSettingsStore(s => s.showTajweed);
  useEffect(() => {
    if (!showTajweed) return;
    let cancelled = false;
    whenSplashHidden().then(() => {
      if (cancelled) return;
      const {indexedTajweedData, isLoading} = useTajweedStore.getState();
      if (!indexedTajweedData && !isLoading) startTajweedLoad();
    });
    return () => {
      cancelled = true;
    };
  }, [showTajweed]);
}
