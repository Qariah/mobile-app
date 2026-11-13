// @ai-generated
/**
 * Qariah (#847, word highlight B): the word the Mushaf marks for an audio
 * position, and when the audio poll runs faster.
 *
 * The real tracker, unitWords, lineWordSpans and the Hafs verse units run
 * over a small fake page 440 (Ya-Sin 36:10 and 36:11); the player store and
 * MushafAudioService are stand-ins.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/services/mushaf/DigitalKhattDataService', () => {
  const actual = jest.requireActual(
    '@/services/mushaf/DigitalKhattDataService',
  );
  const {createFakeDKService} = jest.requireActual(
    '@/services/mushaf/__fixtures__/rewayahOverlayFixture',
  );
  const fake = createFakeDKService();
  fake.getLayoutIdentityKey = () => `${fake.rewayah}@fixture`;
  return {...actual, digitalKhattDataService: fake};
});

jest.mock('@/services/mushaf/RewayahVerseUnitsService', () => ({
  rewayahVerseUnitsService: jest
    .requireActual('@/services/mushaf/__fixtures__/verseUnitsServiceStub')
    .verseUnitsServiceStub({peek: () => null}),
}));

const mockPlayer: {
  state: Record<string, unknown>;
  listeners: Set<(s: unknown, prev: unknown) => void>;
} = {state: {}, listeners: new Set()};
jest.mock('@/store/mushafPlayerStore', () => ({
  useMushafPlayerStore: {
    getState: () => mockPlayer.state,
    subscribe: (listener: (s: unknown, prev: unknown) => void) => {
      mockPlayer.listeners.add(listener);
      return () => mockPlayer.listeners.delete(listener);
    },
  },
}));

const mockAudio = {
  timestamps: [] as unknown[],
  surah: 36,
  position: 0,
  tick: null as ((positionMs: number) => void) | null,
  intervals: [] as (number | null)[],
};
jest.mock('../MushafAudioService', () => ({
  mushafAudioService: {
    getTimestamps: () => mockAudio.timestamps,
    getCurrentSurah: () => mockAudio.surah,
    getCurrentPositionMs: () => mockAudio.position,
    setOnTrackingTick: (cb: ((positionMs: number) => void) | null) => {
      mockAudio.tick = cb;
    },
    setTrackingIntervalMs: (ms: number | null) => {
      mockAudio.intervals.push(ms);
    },
  },
}));

const mockLite = {on: false};
jest.mock('@/services/lite/liteMode', () => ({
  isLiteMode: () => mockLite.on,
}));

import {digitalKhattDataService} from '@/services/mushaf/DigitalKhattDataService';
import type {FakeDKService} from '@/services/mushaf/__fixtures__/rewayahOverlayFixture';
import {mushafVerseMapService} from '@/services/mushaf/MushafVerseMapService';
import {useMushafWordMarkStore} from '@/store/mushafWordMarkStore';
import type {AyahTimestamp, WordSegment} from '@/types/timestamps';
import type {DKLine} from '@/services/mushaf/DigitalKhattDataService';
import type {RewayahId} from '@/services/rewayah/RewayahIdentity';
import {
  holdMushafWordTracking,
  WORD_MAP_CHECKED_REWAYAT,
  WORD_TRACKING_INTERVAL_MS,
  wordMarkAt,
} from '../mushafWordTracker';

const dk = digitalKhattDataService as unknown as FakeDKService;

/** One audio poll, as MushafAudioService calls the tracker. */
function tick(positionMs: number): void {
  if (!mockAudio.tick) throw new Error('the tracker is not on the poll');
  mockAudio.tick(positionMs);
}

// Page 440: line 1 = 36:10 words 1-4; line 2 = 36:10 words 5-8 and its
// marker, then 36:11 words 1-2; line 3 = 36:11 word 3 and its marker. The
// texts stand for the words (w1 ...): only their lengths matter here.
const MARKER_10 = '\u06DD\u0661\u0660'; // the marker of verse 10
const MARKER_11 = '\u06DD\u0661\u0661'; // the marker of verse 11
const WORDS: [number, string, string][] = [
  [100, '36:10:1', 'w1'],
  [101, '36:10:2', 'w2'],
  [102, '36:10:3', 'w3'],
  [103, '36:10:4', 'w4'],
  [104, '36:10:5', 'w5'],
  [105, '36:10:6', 'w6'],
  [106, '36:10:7', 'w7'],
  [107, '36:10:8', 'w8'],
  [108, '36:10:9', MARKER_10],
  [109, '36:11:1', 'x1'],
  [110, '36:11:2', 'x2'],
  [111, '36:11:3', 'x3'],
  [112, '36:11:4', MARKER_11],
];
const line = (n: number, first: number, last: number): DKLine => ({
  page_number: 440,
  line_number: n,
  line_type: 'ayah',
  is_centered: 0,
  first_word_id: first,
  last_word_id: last,
  surah_number: 36,
});
const LINES: DKLine[] = [
  line(1, 100, 103),
  line(2, 104, 110),
  line(3, 111, 112),
];

// 36:10 as Zaynab Talha recites it: words 1-6, back to word 3, then 7-8.
const SEGMENTS_10: WordSegment[] = [
  [0, 82715, 85720],
  [1, 86280, 87440],
  [2, 87680, 90480],
  [3, 90720, 91080],
  [4, 91320, 91680],
  [5, 91920, 94120],
  [2, 95160, 97960],
  [3, 98240, 98600],
  [4, 98880, 99200],
  [5, 99440, 101680],
  [6, 101960, 102200],
  [7, 102560, 105520],
];
const AYAH_10: AyahTimestamp = {
  surahNumber: 36,
  ayahNumber: 10,
  timestampFrom: 82715,
  timestampTo: 105520,
  durationMs: 22805,
  segments: SEGMENTS_10,
};
const AYAH_11: AyahTimestamp = {
  surahNumber: 36,
  ayahNumber: 11,
  timestampFrom: 106000,
  timestampTo: 115000,
  durationMs: 9000,
};

function numbering(reciterRewayah: RewayahId | null = 'hafs') {
  return {
    surah: 36,
    mode: 'hafs',
    reciterRewayah,
    reason: 'fixture',
    numbersVersesOf: () => false,
  };
}

function playing(
  entryAyah: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    playbackState: 'playing',
    currentSurah: 36,
    _entryAyah: entryAyah,
    basmalaIntroSurah: null,
    _numbering: numbering(),
    numberingMode: 'hafs',
    currentVerseKeys: [`36:${entryAyah}`],
    currentReciterVerseKey: `36:${entryAyah}`,
    timestamps: mockAudio.timestamps,
    ...over,
  };
}

beforeAll(() => {
  mushafVerseMapService.clear();
  dk.loadData({rewayah: 'hafs', words: WORDS, lines: LINES});
});

beforeEach(() => {
  mockAudio.timestamps = [AYAH_10, AYAH_11];
  mockAudio.surah = 36;
  mockAudio.position = 0;
  mockAudio.intervals = [];
  mockLite.on = false;
  mockPlayer.state = playing(10);
  useMushafWordMarkStore.setState({mark: null});
});

describe('wordMarkAt (the word at a position)', () => {
  it('93.0 s of 36:10: word 6, the first time, on line 2', () => {
    expect(wordMarkAt(93000)).toEqual({
      unitKey: '36:10',
      wordIndex: 5,
      pageNumber: 440,
      lineIndex: 1,
      start: 3, // 'w5 w6 …': w6
      end: 4,
      textIdentity: 'hafs@fixture',
    });
  });

  it('96.0 s of 36:10: the repeat, word 3 again, on line 1', () => {
    expect(wordMarkAt(96000)).toMatchObject({
      wordIndex: 2,
      lineIndex: 0,
      start: 6, // 'w1 w2 w3 w4': w3
      end: 7,
    });
  });

  it('word order: each word in turn', () => {
    const at = (ms: number) => wordMarkAt(ms)?.wordIndex;
    expect([83000, 87000, 89000, 91000, 91500, 92000].map(at)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect([102000, 103000].map(at)).toEqual([6, 7]);
  });

  it('a gap between two words: the last word stays marked', () => {
    expect(wordMarkAt(86000)?.wordIndex).toBe(0);
    expect(wordMarkAt(94500)?.wordIndex).toBe(5);
  });

  it('paused: the mark stays where it is', () => {
    mockPlayer.state = playing(10, {playbackState: 'paused'});
    expect(wordMarkAt(96000)?.wordIndex).toBe(2);
  });

  it('a position in another entry (a seek that has not landed): the first word of the shown entry', () => {
    expect(wordMarkAt(110000)?.wordIndex).toBe(0);
    expect(wordMarkAt(1000)?.wordIndex).toBe(0);
  });

  it('no segments: no mark (the ayah tint shows)', () => {
    mockPlayer.state = playing(11);
    expect(wordMarkAt(108000)).toBeNull();
  });

  it('a count mismatch: no mark (the ayah tint shows)', () => {
    mockAudio.timestamps = [
      {...AYAH_10, segments: [...SEGMENTS_10, [8, 105520, 106000]]},
      AYAH_11,
    ];
    mockPlayer.state = playing(10);
    expect(wordMarkAt(93000)).toBeNull();
  });

  it('no mark when idle, loading, in the intro, or for another surah', () => {
    for (const over of [
      {playbackState: 'idle'},
      {playbackState: 'loading'},
      {basmalaIntroSurah: 36},
    ]) {
      mockPlayer.state = playing(10, over);
      expect(wordMarkAt(93000)).toBeNull();
    }
    mockPlayer.state = playing(10);
    mockAudio.surah = 37;
    expect(wordMarkAt(93000)).toBeNull();
  });

  it('no mark when the reciter recites another rewayah than the Mushaf shows', () => {
    mockPlayer.state = playing(10, {_numbering: numbering('warsh')});
    expect(wordMarkAt(93000)).toBeNull();
    mockPlayer.state = playing(10, {_numbering: numbering(null)});
    expect(wordMarkAt(93000)).toBeNull();
  });

  it('no mark for a unit outside the follow-along band', () => {
    mockPlayer.state = playing(10, {currentVerseKeys: ['36:11']});
    expect(wordMarkAt(93000)).toBeNull();
  });

  it('Lite mode keeps the word mark (the A10s measurement)', () => {
    mockLite.on = true;
    expect(wordMarkAt(93000)?.wordIndex).toBe(5);
  });

  it('word marks only for the rewayat the word-map check matched', () => {
    expect([...WORD_MAP_CHECKED_REWAYAT].sort()).toEqual(
      [
        'al-bazzi',
        'al-duri-abi-amr',
        'al-susi',
        'hafs',
        'qalun',
        'shubah',
        'warsh',
      ].sort(),
    );
    expect(WORD_MAP_CHECKED_REWAYAT.has('qunbul')).toBe(false);
  });
});

describe('holdMushafWordTracking (the Mushaf shows)', () => {
  it('a timed ayah raises the poll rate; an untimed one and the release restore it', () => {
    mockAudio.position = 93000;
    const release = holdMushafWordTracking();
    expect(useMushafWordMarkStore.getState().mark?.wordIndex).toBe(5);
    expect(mockAudio.intervals).toEqual([WORD_TRACKING_INTERVAL_MS]);

    // The poll: the repeat.
    tick(96000);
    expect(useMushafWordMarkStore.getState().mark?.wordIndex).toBe(2);

    // The poll reports 36:11 (no word times): the ayah tint, the default rate.
    const prev = mockPlayer.state;
    mockPlayer.state = playing(11);
    tick(108000);
    expect(useMushafWordMarkStore.getState().mark).toBeNull();
    expect(mockAudio.intervals.at(-1)).toBeNull();

    // A store change (back to 36:10, paused) computes the mark again.
    mockPlayer.state = playing(10, {playbackState: 'paused'});
    mockAudio.position = 99500;
    for (const listener of mockPlayer.listeners) {
      listener(mockPlayer.state, prev);
    }
    expect(useMushafWordMarkStore.getState().mark?.wordIndex).toBe(5);

    release();
    expect(mockAudio.tick).toBeNull();
    expect(mockAudio.intervals.at(-1)).toBeNull();
    expect(mockPlayer.listeners.size).toBe(0);
  });

  it('two holders: the tracker stops with the last release', () => {
    const a = holdMushafWordTracking();
    const b = holdMushafWordTracking();
    a();
    a(); // a second call does nothing
    expect(mockAudio.tick).not.toBeNull();
    b();
    expect(mockAudio.tick).toBeNull();
  });

  it('no store change for the same word', () => {
    mockAudio.position = 93000;
    const release = holdMushafWordTracking();
    const calls: unknown[] = [];
    const unsubscribe = useMushafWordMarkStore.subscribe(s => calls.push(s));
    tick(93080);
    tick(93160);
    expect(calls).toHaveLength(0);
    tick(95200);
    expect(calls).toHaveLength(1);
    unsubscribe();
    release();
  });
});
