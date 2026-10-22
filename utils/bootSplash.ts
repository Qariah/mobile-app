// @ai
// utils/bootSplash.ts
// -------------------
// Qariah (ANR WS-C, hypothesis H1) — one seam for "hide the boot splash".
//
// A drop-in for the two `expo-splash-screen` calls app/_layout.tsx uses, so
// the upstream file changes by one import line only:
//
//   import * as SplashScreen from '@/utils/bootSplash';
//
// hideAsync() removes the native boot overlay (Android, non-blocking splash
// treatment) and then calls expo-splash-screen's hideAsync() exactly as
// before. In "control" mode, on iOS and on web, the overlay call is a no-op, so
// the behaviour is today's behaviour. See
// modules/qariah-boot-splash/android/.../QariahBootSplash.kt.

import * as ExpoSplashScreen from 'expo-splash-screen';
import {dismissBootOverlay} from '../modules/qariah-boot-splash';

export const preventAutoHideAsync = ExpoSplashScreen.preventAutoHideAsync;

export function hideAsync(): Promise<void> {
  dismissBootOverlay();
  return ExpoSplashScreen.hideAsync();
}
