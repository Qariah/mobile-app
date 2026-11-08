// @ai Qariah (Lite option firstScreen) — draw only the first screen of Listen
// before the splash hides, and the other rows right after.
//
// On a Samsung A10s the first Listen render took about 1 s of JS and its
// mount about 0.9 s of UI-thread work, all before the splash could go
// (planning/lite-mode-design.md, step 1c).
import {useEffect, useState} from 'react';
import {isLiteOption} from '@/services/lite/liteMode';
import {whenSplashHidden} from '@/utils/bootSplash';

/** Rows below the top grid that fill the first screen of the A10s. */
export const LITE_FIRST_SCREEN_ROWS = 2;

/** True until the splash has hidden and its first frame has drawn. */
export function useLiteFirstScreenOnly(): boolean {
  const [limited, setLimited] = useState(() => isLiteOption('firstScreen'));
  useEffect(() => {
    if (!limited) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    whenSplashHidden().then(() => {
      if (!cancelled) timer = setTimeout(() => setLimited(false), 250);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [limited]);
  return limited;
}
