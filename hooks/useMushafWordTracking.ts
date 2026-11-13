// @ai-generated
/**
 * Qariah (#847, word highlight B): holds the word tracker
 * (services/audio/mushafWordTracker.ts) while the Mushaf screen shows the
 * page renderers, the screen has the focus and the app is in the
 * foreground. Only then can the audio poll run faster for a timed ayah.
 *
 * In the background the tracker is released: Android holds every UI change
 * from JS while the activity is paused and applies all of them in one frame
 * on return (CLAUDE.md, RN / UI gotchas), so no mark changes there.
 */
import {useEffect, useState} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from 'expo-router';
import {holdMushafWordTracking} from '@/services/audio/mushafWordTracker';

export function useMushafWordTracking(enabled: boolean): void {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background',
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setForeground(state !== 'background');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !focused || !foreground) return;
    return holdMushafWordTracking();
  }, [enabled, focused, foreground]);
}
