// @ai-generated
// Qariah (Sprint 50, TECH_DEBT #70): the audio URL of a recitation, and the
// two play paths that build it (the queue and the Mushaf player).
import type {Reciter, Rewayat, SurahMetadata} from '@/data/reciterData';
import {RECITERS} from '@/data/reciterData';
import {
  recitationAudioUrl,
  suffixedAudioRange,
} from '@/utils/recitationAudioUrl';
import {generateAudioUrl} from '@/utils/audioUtils';
import {resolveMushafAudioUrl} from '@/utils/mushafAudioUtils';

// audioUtils imports the download store and the download service only for
// generateSmartAudioUrl. Their imports load the native audio player.
jest.mock('@/services/player/store/downloadStore', () => ({
  useDownloadStore: {getState: () => ({})},
}));
jest.mock('@/services/downloadService', () => ({
  resolveFilePath: (p: string) => p,
}));

const SERVER = 'https://cdn.example/reciters/x/hafs';

function rewaya(surah_metadata?: SurahMetadata[]): Rewayat {
  return {
    id: 'rw-1',
    reciter_id: 'r-1',
    name: 'Hafs',
    style: 'murattal',
    server: SERVER,
    surah_total: 4,
    surah_list: [1, 2, 18, 114],
    source_type: 'qariah',
    created_at: '2026-01-01',
    surah_metadata,
  };
}

// Surah 2: a suffixed partial (the ops console upload). Surah 18: a legacy
// partial (no audio_path). Surah 114: a complete row.
const METADATA: SurahMetadata[] = [
  {surah: 2, is_full: false, range: {from: 1, to: 16}, audio_path: 'suffixed'},
  {surah: 18, is_full: false, range: {from: 1, to: 10}},
  {surah: 114, is_full: true},
];

describe('recitationAudioUrl', () => {
  it('keeps the unsuffixed URL for a surah with no metadata', () => {
    expect(recitationAudioUrl(rewaya(), 1)).toBe(`${SERVER}/001.mp3`);
    expect(recitationAudioUrl(rewaya(METADATA), 1)).toBe(`${SERVER}/001.mp3`);
  });

  it('keeps the unsuffixed URL for a complete surah', () => {
    expect(recitationAudioUrl(rewaya(METADATA), 114)).toBe(`${SERVER}/114.mp3`);
  });

  it('keeps the unsuffixed URL for a legacy partial (no audio_path)', () => {
    expect(recitationAudioUrl(rewaya(METADATA), 18)).toBe(`${SERVER}/018.mp3`);
  });

  it('gives the suffixed URL for a partial with audio_path: suffixed', () => {
    expect(recitationAudioUrl(rewaya(METADATA), 2)).toBe(
      `${SERVER}/002-1-16.mp3`,
    );
  });

  it('accepts the surah as a string, padded or not', () => {
    expect(recitationAudioUrl(rewaya(METADATA), '2')).toBe(
      `${SERVER}/002-1-16.mp3`,
    );
    expect(recitationAudioUrl(rewaya(METADATA), '002')).toBe(
      `${SERVER}/002-1-16.mp3`,
    );
    expect(recitationAudioUrl(rewaya(METADATA), '18')).toBe(
      `${SERVER}/018.mp3`,
    );
  });

  it('does not pad the ayah numbers (the ops console key has no padding)', () => {
    const meta: SurahMetadata[] = [
      {
        surah: 3,
        is_full: false,
        range: {from: 7, to: 7},
        audio_path: 'suffixed',
      },
    ];
    expect(recitationAudioUrl(rewaya(meta), 3)).toBe(`${SERVER}/003-7-7.mp3`);
  });

  it('uses the legacy URL when a suffixed row cannot name a file', () => {
    const meta = [
      {surah: 4, is_full: true, audio_path: 'suffixed'},
      {surah: 5, is_full: false, audio_path: 'suffixed'},
      {
        surah: 6,
        is_full: false,
        range: {from: 9, to: 2},
        audio_path: 'suffixed',
      },
    ] as SurahMetadata[];
    expect(recitationAudioUrl(rewaya(meta), 4)).toBe(`${SERVER}/004.mp3`);
    expect(recitationAudioUrl(rewaya(meta), 5)).toBe(`${SERVER}/005.mp3`);
    expect(recitationAudioUrl(rewaya(meta), 6)).toBe(`${SERVER}/006.mp3`);
    expect(suffixedAudioRange(meta, 6)).toBeUndefined();
  });

  it('uses the first row when a surah has two rows', () => {
    const suffixedFirst: SurahMetadata[] = [
      {
        surah: 2,
        is_full: false,
        range: {from: 1, to: 16},
        audio_path: 'suffixed',
      },
      {
        surah: 2,
        is_full: false,
        range: {from: 17, to: 30},
        audio_path: 'suffixed',
      },
    ];
    expect(recitationAudioUrl(rewaya(suffixedFirst), 2)).toBe(
      `${SERVER}/002-1-16.mp3`,
    );
    const legacyFirst: SurahMetadata[] = [
      {surah: 2, is_full: false, range: {from: 1, to: 16}},
      {
        surah: 2,
        is_full: false,
        range: {from: 17, to: 30},
        audio_path: 'suffixed',
      },
    ];
    expect(recitationAudioUrl(rewaya(legacyFirst), 2)).toBe(
      `${SERVER}/002.mp3`,
    );
  });

  it('keeps a server with a trailing slash byte for byte (legacy URL)', () => {
    const slashed = {...rewaya(METADATA), server: `${SERVER}/`};
    // The old builders made `${server}/${NNN}.mp3`, so the slash doubles.
    expect(recitationAudioUrl(slashed, 18)).toBe(`${SERVER}//018.mp3`);
    expect(recitationAudioUrl(slashed, 114)).toBe(`${SERVER}//114.mp3`);
  });

  it('gives the legacy URL and does not throw on bad surah_metadata', () => {
    const bad: unknown[] = [
      null,
      {},
      'x',
      [null],
      [null, {surah: 2, is_full: false, range: {from: 1, to: 16}}],
      [
        undefined,
        {surah: 2, is_full: false, range: null, audio_path: 'suffixed'},
      ],
    ];
    for (const surah_metadata of bad) {
      const rw = {
        ...rewaya(),
        surah_metadata: surah_metadata as SurahMetadata[],
      };
      expect(() => recitationAudioUrl(rw, 2)).not.toThrow();
      expect(recitationAudioUrl(rw, 2)).toBe(`${SERVER}/002.mp3`);
    }
    // A null entry before the suffixed row does not hide that row.
    const nullFirst = [
      null,
      {
        surah: 2,
        is_full: false,
        range: {from: 1, to: 16},
        audio_path: 'suffixed',
      },
    ] as SurahMetadata[];
    expect(recitationAudioUrl(rewaya(nullFirst), 2)).toBe(
      `${SERVER}/002-1-16.mp3`,
    );
  });
});

describe('the play paths', () => {
  const reciter: Reciter = {
    id: 'r-1',
    name: 'Reciter',
    date: null,
    image_url: null,
    rewayat: [rewaya(METADATA)],
  };

  afterEach(() => {
    RECITERS.splice(0, RECITERS.length);
  });

  it('generateAudioUrl (the queue, the restore) gives the same URLs', () => {
    expect(generateAudioUrl(reciter, '1', 'rw-1')).toBe(`${SERVER}/001.mp3`);
    expect(generateAudioUrl(reciter, '18', 'rw-1')).toBe(`${SERVER}/018.mp3`);
    expect(generateAudioUrl(reciter, '2', 'rw-1')).toBe(
      `${SERVER}/002-1-16.mp3`,
    );
    // No rewayah id: the first rewayah.
    expect(generateAudioUrl(reciter, '2')).toBe(`${SERVER}/002-1-16.mp3`);
  });

  it('resolveMushafAudioUrl (the Mushaf player) gives the same URLs', () => {
    RECITERS.splice(0, RECITERS.length, reciter);
    expect(resolveMushafAudioUrl('rw-1', 114)).toBe(`${SERVER}/114.mp3`);
    expect(resolveMushafAudioUrl('rw-1', 18)).toBe(`${SERVER}/018.mp3`);
    expect(resolveMushafAudioUrl('rw-1', 2)).toBe(`${SERVER}/002-1-16.mp3`);
  });

  it('keeps a server with a trailing slash byte for byte on both play paths', () => {
    const slashed: Reciter = {
      ...reciter,
      rewayat: [{...rewaya(METADATA), server: `${SERVER}/`}],
    };
    expect(generateAudioUrl(slashed, '18', 'rw-1')).toBe(`${SERVER}//018.mp3`);
    RECITERS.splice(0, RECITERS.length, slashed);
    expect(resolveMushafAudioUrl('rw-1', 1)).toBe(`${SERVER}//001.mp3`);
  });

  it('gives the legacy URL on both play paths when surah_metadata is null', () => {
    const noMeta: Reciter = {
      ...reciter,
      rewayat: [
        {
          ...rewaya(),
          surah_metadata: null as unknown as SurahMetadata[],
        },
      ],
    };
    expect(generateAudioUrl(noMeta, '2', 'rw-1')).toBe(`${SERVER}/002.mp3`);
    RECITERS.splice(0, RECITERS.length, noMeta);
    expect(resolveMushafAudioUrl('rw-1', 2)).toBe(`${SERVER}/002.mp3`);
  });
});
