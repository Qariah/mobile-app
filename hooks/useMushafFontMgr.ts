// Single source of truth for the Mushaf font manager in render code.
//
// Before: each Skia-rendering component called `useFonts(...)` with the
// surah-name TTFs as a "fallback" alongside reading the preloaded
// `mushafPreloadService.fontMgr`. The useFonts call ran on every mount
// even when the preload service was already initialized, and at first-
// render many <SurahDivider> instances would mount simultaneously and
// contend for typeface creation — surfacing as "Couldn't create typeface
// for SurahNameV4" exceptions captured by Sentry.
//
// This hook is the real fix. It reads `mushafPreloadService.fontMgr`
// synchronously and subscribes, so callers re-render when the service
// publishes a provider.
//
// @ai
// The hook loads no fonts. `useFonts` cannot do this: Rules of Hooks make it
// run on every mount, and each run reads the font files again and disposes
// nothing. SkiaPage mounts once per page, so those discarded copies (8.8 MB
// per mount) were the main memory growth of the reader. A failed load recovers
// in the service, so the readers that use the service directly recover too.

import {useSyncExternalStore} from 'react';
import type {SkTypefaceFontProvider} from '@shopify/react-native-skia';
import {mushafPreloadService} from '@/services/mushaf/MushafPreloadService';

// @ai-start
function subscribe(listener: () => void): () => void {
  return mushafPreloadService.subscribe(listener);
}

function getFontMgr(): SkTypefaceFontProvider | null {
  return mushafPreloadService.fontMgr;
}

// Single subscription per hook instance (Osman review MEDIUM): the snapshot
// is the provider, so a notification that does not change it does not
// re-render the caller.
export function useMushafFontMgr(): SkTypefaceFontProvider | null {
  return useSyncExternalStore(subscribe, getFontMgr, getFontMgr);
}
// @ai-end
