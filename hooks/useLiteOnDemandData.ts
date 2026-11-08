// @ai Qariah (Lite mode) — a Mushaf screen starts the Mushaf data load.
//
// Every phone loads the Mushaf data after the splash; Lite mode waits 3 s
// more, so its first screen can finish (services/qariahBoot.ts). A Mushaf
// screen opened in that time starts the load itself through this hook.
// Outside Lite mode it does nothing. Tajweed loads on demand on every phone
// (hooks/useTajweedOnDemand.ts). The full player starts the load from its
// "Show text" button (components/lite/LitePlayerTextCard.tsx).
import {useEffect} from 'react';
import {useSegments} from 'expo-router';
import {isLiteMode} from '@/services/lite/liteMode';
import {startMushafDataLoad} from '@/services/lite/startMushafDataLoad';

/** Route segments whose screens read the Mushaf data. */
const MUSHAF_SEGMENTS: ReadonlySet<string> = new Set([
  '(b.surahs)', // the Mushaf tab
  'mushaf', // the reader
  'quran', // quran/[surah] links
  'bookmarks', // opens the reader at a saved page
  'mushaf-settings',
  'reading-theme',
]);

export function needsMushafData(segments: readonly string[]): boolean {
  return segments.some(segment => MUSHAF_SEGMENTS.has(segment));
}

export function useLiteOnDemandData(): void {
  const lite = isLiteMode();
  const segments = useSegments();
  const wantsMushaf = lite && needsMushafData(segments);
  useEffect(() => {
    if (wantsMushaf) startMushafDataLoad();
  }, [wantsMushaf]);
}
