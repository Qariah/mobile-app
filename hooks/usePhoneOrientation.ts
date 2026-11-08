// @ai-generated
import {useEffect} from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import {useResponsive} from '@/hooks/useResponsive';

/**
 * Phones are portrait except on screens that allow landscape (the Mushaf).
 * Tablets turn freely everywhere and are never locked (ipad-standards §11).
 *
 * - `'portrait'` (the app root): lock phones to portrait.
 * - `'free'` (a screen that allows landscape): unlock phones while the
 *   screen is mounted, and lock them to portrait again when it unmounts.
 */
export function usePhoneOrientation(mode: 'portrait' | 'free'): void {
  const {isTablet} = useResponsive();
  useEffect(() => {
    if (isTablet) return;
    if (mode === 'free') {
      ScreenOrientation.unlockAsync()?.catch(ignoreGoneActivity);
      return () => {
        ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.PORTRAIT_UP,
        )?.catch(ignoreGoneActivity);
      };
    }
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    )?.catch(ignoreGoneActivity);
  }, [isTablet, mode]);
}

// @ai Qariah (QARIAHV2-C, #54): each call rejects when an OEM killed the
// Activity; that is benign. `?.`: tests stub the calls.
function ignoreGoneActivity(): void {}
