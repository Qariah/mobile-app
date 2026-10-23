// @ai-generated
// Qariah (Sprint 50, TECH_DEBT #70): the download path. `downloadSurah` gets
// its remote URL from `fetchAudioUrl`, so a download of a suffixed partial
// uses the suffixed URL. The local file name does not change.
import * as FileSystem from 'expo-file-system/legacy';
import branding from '@/config/branding';
import {fetchAudioUrl} from '@/services/dataService';
import {downloadSurah} from '@/services/downloadService';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({exists: false})),
  createDownloadResumable: jest.fn(() => ({
    downloadAsync: async () => ({headers: {'Content-Length': '10'}}),
  })),
}));

// dataService imports the player store only for clearStoredData. Its import
// loads the native audio player.
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {getState: () => ({cleanup: jest.fn()})},
}));
jest.mock('@/store/reciterStore', () => ({
  useReciterStore: {
    getState: () => ({refreshDefaultReciter: jest.fn()}),
    setState: jest.fn(),
  },
}));

// The bundled catalog is the only catalog in a test (no network, empty
// AsyncStorage). Surah 2: a suffixed partial. Surah 18: a legacy partial.
jest.mock('../../assets/data/catalog.json', () => [
  {
    id: 'r-1',
    name: 'Reciter',
    slug: 'reciter',
    date: null,
    image_url: null,
    rewayat: [
      {
        id: 'rw-1',
        reciter_id: 'r-1',
        name: 'Hafs',
        style: 'murattal',
        server: 'https://cdn.example/reciters/reciter/hafs',
        surah_total: 3,
        surah_list: [1, 2, 18],
        source_type: 'qariah',
        created_at: '2026-01-01',
        surah_metadata: [
          {
            surah: 2,
            is_full: false,
            range: {from: 1, to: 16},
            audio_path: 'suffixed',
          },
          {surah: 18, is_full: false, range: {from: 1, to: 10}},
        ],
      },
    ],
  },
]);

const SERVER = 'https://cdn.example/reciters/reciter/hafs';

// dataService and downloadService log each call. No test may read the
// network catalog: dataService must use the mocked bundled one.
const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn(() =>
    Promise.reject(new Error('no network in tests')),
  ) as unknown as typeof fetch;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterAll(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('fetchAudioUrl (the download URL)', () => {
  it('keeps the unsuffixed URL for a full surah and a legacy partial', async () => {
    await expect(fetchAudioUrl(1, 'r-1', 'rw-1')).resolves.toBe(
      `${SERVER}/001.mp3`,
    );
    await expect(fetchAudioUrl(18, 'r-1', 'rw-1')).resolves.toBe(
      `${SERVER}/018.mp3`,
    );
  });

  it('gives the suffixed URL for a partial with audio_path: suffixed', async () => {
    await expect(fetchAudioUrl(2, 'r-1', 'rw-1')).resolves.toBe(
      `${SERVER}/002-1-16.mp3`,
    );
    await expect(fetchAudioUrl(2, 'r-1')).resolves.toBe(
      `${SERVER}/002-1-16.mp3`,
    );
  });

  it('puts the media proxy host on the suffixed URL too (Sprint 28 seam)', async () => {
    const before = branding.audioStreamProxy;
    branding.audioStreamProxy = {
      enabled: true,
      host: 'media.example',
      legacyHost: 'cdn.example',
    };
    try {
      await expect(fetchAudioUrl(2, 'r-1', 'rw-1')).resolves.toBe(
        'https://media.example/reciters/reciter/hafs/002-1-16.mp3',
      );
      await expect(fetchAudioUrl(1, 'r-1', 'rw-1')).resolves.toBe(
        'https://media.example/reciters/reciter/hafs/001.mp3',
      );
    } finally {
      branding.audioStreamProxy = before;
    }
  });
});

describe('downloadSurah', () => {
  it('downloads a suffixed partial from its suffixed URL to the same local file name', async () => {
    const result = await downloadSurah(2, 'r-1', 'rw-1');
    expect(FileSystem.createDownloadResumable).toHaveBeenLastCalledWith(
      `${SERVER}/002-1-16.mp3`,
      'file:///docs/002_r-1_rw-1.mp3',
      {},
      undefined,
    );
    expect(result.filePath).toBe('002_r-1_rw-1.mp3');
  });

  it('downloads a legacy partial from the unsuffixed URL', async () => {
    const result = await downloadSurah(18, 'r-1', 'rw-1');
    expect(FileSystem.createDownloadResumable).toHaveBeenLastCalledWith(
      `${SERVER}/018.mp3`,
      'file:///docs/018_r-1_rw-1.mp3',
      {},
      undefined,
    );
    expect(result.filePath).toBe('018_r-1_rw-1.mp3');
  });
});
