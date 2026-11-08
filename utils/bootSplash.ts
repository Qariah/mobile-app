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
import {bootMark} from '../services/diagnostics/bootMarks';

export const preventAutoHideAsync = ExpoSplashScreen.preventAutoHideAsync;

// Qariah (A10s plan F1) — boot work that the first screen does not need waits
// for the splash to go: whenSplashHidden() settles once the first hide has
// finished, so that work cannot hold the splash (services/qariahBoot.ts).
let markSplashHidden: () => void = () => undefined;
const splashHidden = new Promise<void>(resolve => {
  markSplashHidden = resolve;
});

export function whenSplashHidden(): Promise<void> {
  return splashHidden;
}

export function hideAsync(): Promise<void> {
  bootMark('splash-hide-call'); // Lite step 1c: lab timing marks.
  dismissBootOverlay();
  const hidden = ExpoSplashScreen.hideAsync();
  hidden.then(
    () => {
      bootMark('splash-hidden');
      markSplashHidden();
    },
    () => markSplashHidden(),
  );
  return hidden;
}
