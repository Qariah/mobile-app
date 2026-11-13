// @ai-generated
/**
 * Qariah (#847, word highlight B): finds the word the reciter recites and
 * writes it to useMushafWordMarkStore.
 *
 * The audio position comes from MushafAudioService's tracking poll. The
 * poll runs every 200 ms (its default) and finds the ayah. While the Mushaf
 * shows (useMushafWordTracking holds this tracker) and a timed ayah plays,
 * the poll runs every WORD_TRACKING_INTERVAL_MS: a word of 240 ms needs a
 * read every 50–100 ms. Each poll first reports the ayah to the player store,
 * then calls this tracker, so the ayah and its word change in the same tick.
 * The tracker also runs when the player store changes (pause, a seek, a new
 * surah, stop) and when the shown text or its verse units change.
 *
 * A word is marked only when all of these are true:
 *  - an ayah plays or is paused (not the intro, not idle or loading);
 *  - its timing entry has word times (`segments`);
 *  - the Mushaf shows the reciter's own rewayah, and the entries are that
 *    rewayah's verses (for Hafs, a Hafs-numbered set): the word index then
 *    counts the words of that verse unit;
 *  - the rewayah's Mushaf words matched the timing pipeline's text in the
 *    word-map check (WORD_MAP_CHECKED_REWAYAT);
 *  - every word index is below the unit's word count in the shown text
 *    (segmentsFitWordCount);
 *  - the unit is in the follow-along band the page renderers paint.
 * Otherwise there is no mark, and the page shows the ayah tint as before.
 */
import {mushafAudioService} from './MushafAudioService';
import {useMushafPlayerStore} from '@/store/mushafPlayerStore';
import {setWordMark, type WordMark} from '@/store/mushafWordMarkStore';
import {digitalKhattDataService} from '@/services/mushaf/DigitalKhattDataService';
import {
  mushafVerseMapService,
  type ShownVerseUnits,
} from '@/services/mushaf/MushafVerseMapService';
import {rewayahVerseUnitsService} from '@/services/mushaf/RewayahVerseUnitsService';
import {unitWords, type UnitWord} from '@/services/mushaf/unitWords';
import type {RewayahId} from '@/services/rewayah/RewayahIdentity';
import {isLiteMode} from '@/services/lite/liteMode';
import {
  currentWordIndex,
  segmentsFitWordCount,
} from '@/services/timestamps/wordSegments';
import {binarySearchAyah} from '@/utils/timestampUtils';
import {playbackBandUnitKeys} from '@/components/mushaf/skia/verseHighlightLayers';
import type {AyahTimestamp} from '@/types/timestamps';

/** The poll period while a timed ayah plays and the Mushaf shows. */
export const WORD_TRACKING_INTERVAL_MS = 80;

/**
 * Rewayat whose Mushaf words equal the words of the timing pipeline's text
 * (`recitation-timings/data/text/<rewayah>/`), ayah by ayah: the word-map
 * check of 2026-11-12 found 0 differences in all seven. Qunbul has no
 * pipeline text, so it keeps the ayah tint.
 */
export const WORD_MAP_CHECKED_REWAYAT: ReadonlySet<RewayahId> = new Set([
  'hafs',
  'shubah',
  'al-bazzi',
  'warsh',
  'qalun',
  'al-duri-abi-amr',
  'al-susi',
]);

/**
 * Lite mode gets the word mark too. The Galaxy A10s (Lite mode) measurement
 * of 2026-11-12 is in the PR; set this to false to keep the ayah tint only.
 */
export const WORD_MARK_IN_LITE_MODE = true;

type PlayerState = ReturnType<typeof useMushafPlayerStore.getState>;

// ── The words of a unit, kept for the last few units ─────────────────────

const WORDS_CACHE_SIZE = 4;
const wordsCache = new Map<string, UnitWord[]>();

function wordsOf(shown: ShownVerseUnits, unitKey: string): UnitWord[] {
  const key = [
    digitalKhattDataService.getLayoutIdentityKey(),
    rewayahVerseUnitsService.getVersion(),
    shown.rewayah,
    unitKey,
  ].join('|');
  const cached = wordsCache.get(key);
  if (cached) return cached;
  const words = unitWords(shown, unitKey, digitalKhattDataService);
  wordsCache.set(key, words);
  if (wordsCache.size > WORDS_CACHE_SIZE) {
    const oldest = wordsCache.keys().next().value;
    if (oldest !== undefined) wordsCache.delete(oldest);
  }
  return words;
}

const entryIndexes = new WeakMap<
  readonly AyahTimestamp[],
  Map<number, AyahTimestamp>
>();

function entryOf(
  timestamps: readonly AyahTimestamp[],
  ayahNumber: number,
): AyahTimestamp | undefined {
  let index = entryIndexes.get(timestamps);
  if (!index) {
    index = new Map();
    for (const t of timestamps) {
      if (!index.has(t.ayahNumber)) index.set(t.ayahNumber, t);
    }
    entryIndexes.set(timestamps, index);
  }
  return index.get(ayahNumber);
}

// ── The mark for a position ──────────────────────────────────────────────

/** The unit whose words the entry's word indices count, or null. */
function wordUnitKey(s: PlayerState, shown: ShownVerseUnits): string | null {
  const numbering = s._numbering;
  if (!numbering || numbering.mode === 'disabled') return null;
  if (numbering.surah !== s.currentSurah) return null;
  if (numbering.reciterRewayah !== shown.rewayah) return null;
  const sameVerses =
    shown.rewayah === 'hafs'
      ? numbering.mode === 'hafs' || numbering.numbersVersesOf('hafs')
      : numbering.numbersVersesOf(shown.rewayah);
  if (!sameVerses) return null;
  const unitKey = shown.unitKeyByRef(s.currentSurah, s._entryAyah);
  if (!unitKey) return null;
  // Only a unit whose ayah tint the page renderers would paint.
  const band = playbackBandUnitKeys(shown, {
    hafsKeys: s.currentVerseKeys,
    mode: s.numberingMode,
    reciterRewayah: numbering.reciterRewayah,
    entryKey: s.currentReciterVerseKey,
  });
  return band.includes(unitKey) ? unitKey : null;
}

/** The word to mark at `positionMs`, or null for the ayah tint. */
export function wordMarkAt(positionMs: number): WordMark | null {
  if (!WORD_MARK_IN_LITE_MODE && isLiteMode()) return null;
  const s = useMushafPlayerStore.getState();
  if (s.playbackState !== 'playing' && s.playbackState !== 'paused') {
    return null;
  }
  if (s.basmalaIntroSurah !== null) return null;
  if (s._entryAyah <= 0 || s.currentSurah <= 0) return null;
  if (mushafAudioService.getCurrentSurah() !== s.currentSurah) return null;

  const timestamps = mushafAudioService.getTimestamps();
  const entry = entryOf(timestamps, s._entryAyah);
  const segments = entry?.segments;
  if (!entry || !segments || segments.length === 0) return null;

  const shown = mushafVerseMapService.getShownVerseUnits();
  if (!shown || !WORD_MAP_CHECKED_REWAYAT.has(shown.rewayah)) return null;
  const unitKey = wordUnitKey(s, shown);
  if (!unitKey) return null;

  const words = wordsOf(shown, unitKey);
  if (!segmentsFitWordCount(segments, words.length)) return null;

  // A position in another entry (a seek that has not landed yet): the
  // reciter is at the start of the entry the player shows.
  const at =
    binarySearchAyah(timestamps as AyahTimestamp[], positionMs) === entry
      ? positionMs
      : entry.timestampFrom;
  const wordIndex = currentWordIndex(segments, at);
  const word = wordIndex === null ? undefined : words[wordIndex];
  if (wordIndex === null || !word) return null;
  return {
    unitKey,
    wordIndex,
    pageNumber: word.pageNumber,
    lineIndex: word.lineIndex,
    start: word.start,
    end: word.end,
    textIdentity: digitalKhattDataService.getLayoutIdentityKey(),
  };
}

function update(positionMs: number): void {
  let mark: WordMark | null = null;
  try {
    mark = wordMarkAt(positionMs);
  } catch (error) {
    // Never break playback over the mark: show the ayah tint instead.
    if (__DEV__) console.warn('[MushafWordTracker] no mark:', error);
    mark = null;
  }
  setWordMark(mark);
  mushafAudioService.setTrackingIntervalMs(
    mark ? WORD_TRACKING_INTERVAL_MS : null,
  );
}

function refresh(): void {
  update(mushafAudioService.getCurrentPositionMs());
}

// ── Holders (the Mushaf screens that show) ───────────────────────────────

let holders = 0;
let unsubscribes: (() => void)[] = [];

function begin(): void {
  mushafAudioService.setOnTrackingTick(update);
  unsubscribes = [
    useMushafPlayerStore.subscribe((s, prev) => {
      if (
        s.playbackState !== prev.playbackState ||
        s._entryAyah !== prev._entryAyah ||
        s.currentSurah !== prev.currentSurah ||
        s.basmalaIntroSurah !== prev.basmalaIntroSurah ||
        s._numbering !== prev._numbering ||
        s.currentVerseKeys !== prev.currentVerseKeys ||
        s.timestamps !== prev.timestamps
      ) {
        refresh();
      }
    }),
    digitalKhattDataService.subscribeCacheChanges(refresh),
    rewayahVerseUnitsService.subscribe(refresh),
  ];
  refresh();
}

function end(): void {
  mushafAudioService.setOnTrackingTick(null);
  mushafAudioService.setTrackingIntervalMs(null);
  for (const unsubscribe of unsubscribes) unsubscribe();
  unsubscribes = [];
  // The mark stays as it is: the page under another screen keeps its
  // look, and the next begin() computes it again.
}

/**
 * Tracks the word while the caller holds it (the Mushaf shows, the app is
 * in the foreground). Returns the release function.
 */
export function holdMushafWordTracking(): () => void {
  holders += 1;
  if (holders === 1) begin();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) end();
  };
}
