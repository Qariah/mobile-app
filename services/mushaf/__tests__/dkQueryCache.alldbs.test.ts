// @ai Qariah (Lite mode plan, section 7h) — the query cache of the Mushaf DBs.
/**
 * LOCAL-ONLY for the service part (skipped unless BAYAAN_OVERLAY_DB_DIR is
 * set; needs Node >= 22.13 for node:sqlite):
 *
 *   BAYAAN_OVERLAY_DB_DIR=bundled npx jest dkQueryCache.alldbs --watchAll=false
 *
 * The real DigitalKhattDataService on the real bundled DBs: a load from a
 * copy whose md5 matches its asset stores the verse index and the page lines;
 * the next load (a new service, as after a relaunch) reads neither query and
 * serves the same text, pages and verses. A copy whose md5 does not match
 * never writes or uses the cache, and a damaged entry falls back to the query.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// A store that keeps buffers. The global setup mock has no getBuffer, and the
// library's own mock drops a buffer in Jest (its `instanceof ArrayBuffer`
// check fails across the test realm).
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    const values = new Map<string, unknown>();
    return {
      getBuffer: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
      remove: (key: string) => values.delete(key),
      clearAll: () => values.clear(),
      getAllKeys: () => [...values.keys()],
      getString: () => undefined,
      getNumber: () => undefined,
      getBoolean: () => undefined,
      contains: (key: string) => values.has(key),
      addOnValueChangedListener: () => ({remove: () => undefined}),
    };
  },
}));
jest.mock('expo-sqlite', () =>
  jest
    .requireActual('@/services/mushaf/__fixtures__/bundledDkSqlite')
    .bundledDkSqliteModule(),
);
const mockMd5 = {match: true};
jest.mock('expo-file-system/legacy', () => {
  const {REWAYAH_DATA_MD5} = jest.requireActual(
    '@/services/mushaf/rewayahDataManifest',
  ) as {REWAYAH_DATA_MD5: Record<string, string>};
  const assetOf = (base: string): string =>
    base === 'dk_words'
      ? 'digital-khatt-v2.db'
      : base === 'dk_layout'
        ? 'digital-khatt-15-lines.db'
        : `${base}.db`;
  return {
    documentDirectory: 'file:///data/user/0/app.test/files/',
    readDirectoryAsync: async () => [],
    getInfoAsync: async (uri: string) => {
      const name = decodeURIComponent(uri.split('/').pop() ?? '');
      const base = name.replace(/\.db$/, '').replace(/\.[0-9a-f]{8}$/, '');
      return {
        exists: true,
        md5: mockMd5.match ? REWAYAH_DATA_MD5[assetOf(base)] : '0'.repeat(32),
      };
    },
  };
});

import {DigitalKhattDataService} from '../DigitalKhattDataService';
import {
  clearDkQueries,
  decodeLineRows,
  decodeVerseRows,
  encodeLineRows,
  encodeVerseRows,
  readDkQuery,
  writeDkQuery,
} from '../dkQueryCache';
import {
  hasNodeSqlite,
  type BundledDkSqliteFake,
} from '../__fixtures__/bundledDkSqlite';
import {
  useMushafSettingsStore,
  type RewayahId,
} from '@/store/mushafSettingsStore';

describe('the query cache encodings', () => {
  it('keeps every verse row', () => {
    const rows = [
      {surah: 1, ayah: 1, first: 1, last: 4},
      {surah: 114, ayah: 6, first: 83665, last: 83668},
    ];
    expect(decodeVerseRows(encodeVerseRows(rows))).toEqual(rows);
  });

  it('keeps every line field, empty text and NULL included', () => {
    const rows = [
      {
        page_number: 1,
        line_number: 1,
        line_type: 'surah_name',
        is_centered: 1,
        first_word_id: '',
        last_word_id: '',
        surah_number: 1,
      },
      {
        page_number: 1,
        line_number: 2,
        line_type: 'ayah',
        is_centered: 0,
        first_word_id: 1,
        last_word_id: 5,
        surah_number: null,
      },
    ];
    const encoded = encodeLineRows(rows);
    expect(encoded).not.toBeNull();
    expect(decodeLineRows(encoded!)).toEqual(rows);
  });

  it('refuses a line it cannot keep exactly', () => {
    const line = {
      page_number: 1,
      line_number: 1,
      line_type: 'ayah',
      is_centered: 0,
      first_word_id: 1,
      last_word_id: 5,
      surah_number: '',
    };
    expect(encodeLineRows([{...line, line_type: 'other'}])).toBeNull();
    expect(encodeLineRows([{...line, is_centered: 0.5}])).toBeNull();
    expect(encodeLineRows([{...line, surah_number: 'x'}])).toBeNull();
    expect(encodeLineRows([{...line, extra: 1}])).toBeNull();
  });

  it('keeps one entry for each base and removes the other copies', () => {
    clearDkQueries();
    writeDkQuery(
      'verses',
      'dk_words',
      'dk_words.aaaaaaaa.db',
      Int32Array.of(1),
    );
    writeDkQuery(
      'verses',
      'dk_words',
      'dk_words.bbbbbbbb.db',
      Int32Array.of(2),
    );
    writeDkQuery('lines', 'dk_words', 'dk_words.aaaaaaaa.db', Int32Array.of(3));
    expect(
      readDkQuery('verses', 'dk_words', 'dk_words.aaaaaaaa.db'),
    ).toBeNull();
    expect(
      Array.from(readDkQuery('verses', 'dk_words', 'dk_words.bbbbbbbb.db')!),
    ).toEqual([2]);
    expect(
      Array.from(readDkQuery('lines', 'dk_words', 'dk_words.aaaaaaaa.db')!),
    ).toEqual([3]);
    clearDkQueries();
  });
});

const fake = (): BundledDkSqliteFake =>
  (jest.requireMock('expo-sqlite') as {__fake: BundledDkSqliteFake}).__fake;

const run =
  process.env.BAYAAN_OVERLAY_DB_DIR && hasNodeSqlite()
    ? describe
    : describe.skip;

/** What a reader reads from a loaded service, on sample words and pages. */
function snapshot(dk: DigitalKhattDataService) {
  const pages = [1, 2, 50, 300, 582, 604];
  return {
    words: [1, 2, 37, 6439, 41000, 83668].map(id => [
      dk.getWordText(id),
      dk.getWordInfo(id),
    ]),
    verses: ['1:1', '2:255', '36:1', '114:6'].map(key => [
      dk.getVerseWords(key),
      dk.getPageForVerse(key),
    ]),
    lines: pages.map(page => dk.getPageLines(page)),
    surahStartPages: dk.getSurahStartPages(),
    pageToSurah: dk.getPageToSurah(),
  };
}

run('the query cache in the data service (local only)', () => {
  let spies: jest.SpyInstance[] = [];
  beforeAll(() => {
    spies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
    ];
  });
  afterAll(() => {
    for (const spy of spies) spy.mockRestore();
    useMushafSettingsStore.setState({rewayah: 'hafs'});
  });
  beforeEach(() => {
    clearDkQueries();
    mockMd5.match = true;
  });

  const reads = (base: string) => fake().reads.filter(b => b === base).length;

  it.each<[RewayahId, string]>([
    ['hafs', 'dk_words'],
    ['warsh', 'dk_words_warsh'],
  ])(
    '%s: the second load reads no query and serves the same data',
    async (rewayah, base) => {
      useMushafSettingsStore.setState({rewayah});
      const first = new DigitalKhattDataService();
      const before = {words: reads(base), layout: reads('dk_layout')};
      await first.initialize();
      expect(reads(base) - before.words).toBe(1);
      expect(reads('dk_layout') - before.layout).toBe(1);
      const expected = snapshot(first);

      const second = new DigitalKhattDataService();
      const again = {words: reads(base), layout: reads('dk_layout')};
      await second.initialize();
      expect(second.rewayah).toBe(rewayah);
      expect(reads(base) - again.words).toBe(0);
      expect(reads('dk_layout') - again.layout).toBe(0);
      expect(snapshot(second)).toEqual(expected);
    },
  );

  it('a copy whose md5 does not match never writes or uses the cache', async () => {
    useMushafSettingsStore.setState({rewayah: 'hafs'});
    mockMd5.match = false;
    const first = new DigitalKhattDataService();
    await first.initialize();
    const expected = snapshot(first);
    const before = {words: reads('dk_words'), layout: reads('dk_layout')};
    const second = new DigitalKhattDataService();
    await second.initialize();
    expect(reads('dk_words') - before.words).toBe(1);
    expect(reads('dk_layout') - before.layout).toBe(1);
    expect(snapshot(second)).toEqual(expected);
  });

  it('a damaged entry falls back to the query', async () => {
    useMushafSettingsStore.setState({rewayah: 'hafs'});
    const first = new DigitalKhattDataService();
    await first.initialize();
    const expected = snapshot(first);
    // Out-of-order verse rows and a line with no type code: both fail the
    // checks that a query result passes.
    const name = (base: string) =>
      Array.from(fake().files).find(file => file.startsWith(`${base}.`))!;
    writeDkQuery(
      'verses',
      'dk_words',
      name('dk_words'),
      Int32Array.of(1, 1, 9, 9, 1, 2, 5, 5),
    );
    writeDkQuery(
      'lines',
      'dk_layout',
      name('dk_layout'),
      new Int32Array(7).fill(9),
    );
    const before = {words: reads('dk_words'), layout: reads('dk_layout')};
    const second = new DigitalKhattDataService();
    await second.initialize();
    expect(reads('dk_words') - before.words).toBe(1);
    expect(reads('dk_layout') - before.layout).toBe(1);
    expect(snapshot(second)).toEqual(expected);
  });
});
