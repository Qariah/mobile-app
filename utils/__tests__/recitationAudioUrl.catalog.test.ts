// @ai-generated
// Qariah (Sprint 50, TECH_DEBT #70): the bundled catalog keeps its URLs.
// For every listed surah of every rewayah whose entry has no `audio_path`,
// all three builders give exactly `${server}/${NNN}.mp3`, the URL that the
// builders gave before Sprint 50.
import type {Reciter, Rewayat} from '@/data/reciterData';
import {RECITERS} from '@/data/reciterData';
import {generateAudioUrl} from '@/utils/audioUtils';
import {resolveMushafAudioUrl} from '@/utils/mushafAudioUtils';
import {fetchAudioUrl} from '@/services/dataService';

// audioUtils imports the download store and the download service only for
// generateSmartAudioUrl; dataService imports the player store only for
// clearStoredData. Their imports load the native audio player.
jest.mock('@/services/player/store/downloadStore', () => ({
  useDownloadStore: {getState: () => ({})},
}));
jest.mock('@/services/downloadService', () => ({
  resolveFilePath: (p: string) => p,
}));
jest.mock('@/services/player/store/playerStore', () => ({
  usePlayerStore: {getState: () => ({cleanup: jest.fn()})},
}));
jest.mock('@/store/reciterStore', () => ({
  useReciterStore: {
    getState: () => ({refreshDefaultReciter: jest.fn()}),
    setState: jest.fn(),
  },
}));

const catalog: Reciter[] = require('../../assets/data/catalog.json');

type Case = {reciter: Reciter; rewayat: Rewayat; surah: number; url: string};

function legacyCases(): Case[] {
  const cases: Case[] = [];
  for (const reciter of catalog) {
    for (const rewayat of reciter.rewayat) {
      for (const surah of rewayat.surah_list ?? []) {
        if (surah == null) continue;
        const first = rewayat.surah_metadata?.find(m => m?.surah === surah);
        if (first?.audio_path !== undefined) continue;
        const url = `${rewayat.server}/${surah.toString().padStart(3, '0')}.mp3`;
        cases.push({reciter, rewayat, surah, url});
      }
    }
  }
  return cases;
}

const CASES = legacyCases();

// No test may read the network catalog: dataService must use the bundled one.
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
  RECITERS.splice(0, RECITERS.length);
});

describe('the bundled catalog keeps its legacy audio URLs', () => {
  it('has many legacy surahs to check', () => {
    expect(CASES.length).toBeGreaterThan(1000);
  });

  it('generateAudioUrl gives `${server}/${NNN}.mp3` for each one', () => {
    const wrong = CASES.filter(
      c => generateAudioUrl(c.reciter, String(c.surah), c.rewayat.id) !== c.url,
    ).map(c => c.url);
    expect(wrong).toEqual([]);
  });

  it('resolveMushafAudioUrl gives `${server}/${NNN}.mp3` for each one', () => {
    RECITERS.splice(0, RECITERS.length, ...catalog);
    const wrong = CASES.filter(
      c => resolveMushafAudioUrl(c.rewayat.id, c.surah) !== c.url,
    ).map(c => c.url);
    expect(wrong).toEqual([]);
  });

  it('fetchAudioUrl (the download) gives `${server}/${NNN}.mp3` for each one', async () => {
    const wrong: string[] = [];
    for (const c of CASES) {
      const url = await fetchAudioUrl(c.surah, c.reciter.id, c.rewayat.id);
      if (url !== c.url) wrong.push(`${c.url} -> ${url}`);
    }
    expect(wrong).toEqual([]);
  });
});
