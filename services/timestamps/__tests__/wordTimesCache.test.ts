// @ai-generated
/**
 * Qariah (#847, word highlight B): the word times (`segments`) go through
 * the SQLite timing cache, and the cache of an older build (which dropped
 * them) is fetched once again.
 *
 * The real TimestampService, TimestampFetchService and
 * TimestampDatabaseService run against real SQL (node:sqlite in place of
 * expo-sqlite, Node 22.13 or later), as in timestampRevision.test.ts. A new
 * module registry is a new app launch with the same SQLite file.
 */
import type {Reciter, Rewayat} from '@/data/reciterData';
import type {AyahTimestamp, WordSegment} from '@/types/timestamps';

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
  };
  close(): void;
}

const mockSqliteFiles = new Map<string, SqliteDb>();

jest.mock('expo-sqlite', () => {
  const {DatabaseSync} = require('node:sqlite') as {
    DatabaseSync: new (file: string) => SqliteDb;
  };
  const file = (name: string): SqliteDb => {
    let db = mockSqliteFiles.get(name);
    if (!db) {
      db = new DatabaseSync(':memory:');
      mockSqliteFiles.set(name, db);
    }
    return db;
  };
  return {
    openDatabaseAsync: async (name: string) => {
      const db = file(name);
      return {
        execAsync: async (sql: string) => db.exec(sql),
        getAllAsync: async (sql: string, params: unknown[] = []) =>
          db.prepare(sql).all(...params),
        getFirstAsync: async (sql: string, params: unknown[] = []) =>
          db.prepare(sql).get(...params) ?? null,
        runAsync: async (sql: string, params: unknown[] = []) =>
          db.prepare(sql).run(...params),
        withTransactionAsync: async (fn: () => Promise<void>) => {
          db.exec('BEGIN');
          try {
            await fn();
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        },
        closeAsync: async () => undefined,
      };
    },
    deleteDatabaseAsync: async (name: string) => {
      mockSqliteFiles.get(name)?.close();
      mockSqliteFiles.delete(name);
    },
  };
});

function hasNodeSqlite(): boolean {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

const DB_NAME = 'timestamps_v4.db';
const REWAYAT_ID = 'fixture-word-times-rewayat';

function fileUrl(surah: number, query: string): string {
  return `/${REWAYAT_ID}/${String(surah).padStart(3, '0')}.json?${query}`;
}

const AYAH_1_WORDS: WordSegment[] = [
  [0, 0, 900],
  [1, 900, 2000],
  [0, 2100, 3000], // a repeat of word 1
  [2, 3000, 4000],
];
const AYAH_2_WORDS: WordSegment[] = [
  [0, 4000, 6000],
  [1, 6000, 9000],
];

function plainFile(surah: number): AyahTimestamp[] {
  return [
    {
      surahNumber: surah,
      ayahNumber: 1,
      timestampFrom: 0,
      timestampTo: 4000,
      durationMs: 4000,
    },
    {
      surahNumber: surah,
      ayahNumber: 2,
      timestampFrom: 4000,
      timestampTo: 9000,
      durationMs: 5000,
    },
  ];
}

function wordFile(surah: number): AyahTimestamp[] {
  const [a, b] = plainFile(surah);
  return [
    {...a, segments: AYAH_1_WORDS},
    {...b, segments: AYAH_2_WORDS},
  ];
}

function catalog(
  surahList: number[] = [1, 2],
  rev?: Rewayat['timestamps_rev'],
): Reciter[] {
  const rewayat: Rewayat = {
    id: REWAYAT_ID,
    reciter_id: 'fixture-word-times-reciter',
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: 2,
    surah_list: [1, 2],
    source_type: 'catalog',
    created_at: '2026-01-01',
    has_timestamps: true,
    timestamps_surah_list: surahList,
  };
  if (rev !== undefined) rewayat.timestamps_rev = rev;
  return [
    {
      id: 'fixture-word-times-reciter',
      name: 'Word times fixture',
      date: null,
      image_url: null,
      rewayat: [rewayat],
    },
  ];
}

type Service = (typeof import('../TimestampService'))['timestampService'];

async function launch(reciters: Reciter[]): Promise<Service> {
  let service: Service | undefined;
  jest.isolateModules(() => {
    const {RECITERS} = require('@/data/reciterData') as {
      RECITERS: Reciter[];
    };
    RECITERS.push(...reciters);
    service = (require('../TimestampService') as {timestampService: Service})
      .timestampService;
  });
  if (!service) throw new Error('TimestampService did not load');
  await service.initialize();
  return service;
}

const fetchMock = jest.fn();

function serve(body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => JSON.parse(JSON.stringify(body)) as unknown,
  });
}

function fetchedUrls(): string[] {
  return fetchMock.mock.calls.map(call => {
    const url = String(call[0]);
    return url.slice(url.indexOf(`/${REWAYAT_ID}/`));
  });
}

function timingDb(): SqliteDb {
  const file = mockSqliteFiles.get(DB_NAME);
  if (!file) throw new Error('no timing database');
  return file;
}

function columns(table: string): string[] {
  return timingDb()
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map(c => String(c.name));
}

/**
 * The cache as a build before this change wrote it. `withRev`: the #846
 * build (a `rev` column); else a build before #846.
 */
function olderBuildCache(withRev: boolean, surahs: number[] = [1]) {
  const {DatabaseSync} = require('node:sqlite') as {
    DatabaseSync: new (file: string) => SqliteDb;
  };
  const old = new DatabaseSync(':memory:');
  old.exec(`
    CREATE TABLE ayah_timestamps (
      rewayat_id TEXT NOT NULL, surah_number INTEGER NOT NULL,
      ayah_number INTEGER NOT NULL, timestamp_from INTEGER NOT NULL,
      timestamp_to INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
      PRIMARY KEY (rewayat_id, surah_number, ayah_number));
    CREATE TABLE cached_surahs (
      rewayat_id TEXT NOT NULL, surah_number INTEGER NOT NULL,
      source TEXT NOT NULL, fetched_at INTEGER NOT NULL,
      PRIMARY KEY (rewayat_id, surah_number));
  `);
  if (withRev) {
    old.exec(
      'ALTER TABLE cached_surahs ADD COLUMN rev INTEGER NOT NULL DEFAULT 0',
    );
  }
  for (const surah of surahs) {
    for (const t of plainFile(surah)) {
      old
        .prepare('INSERT INTO ayah_timestamps VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          REWAYAT_ID,
          surah,
          t.ayahNumber,
          t.timestampFrom,
          t.timestampTo,
          t.durationMs,
        );
    }
    old
      .prepare(
        'INSERT INTO cached_surahs (rewayat_id, surah_number, source, fetched_at) VALUES (?, ?, ?, ?)',
      )
      .run(REWAYAT_ID, surah, 'r2', 1);
  }
  mockSqliteFiles.set(DB_NAME, old);
}

const describeSqlite = hasNodeSqlite() ? describe : describe.skip;

describeSqlite('word times through the SQLite timing cache', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    for (const file of mockSqliteFiles.values()) file.close();
    mockSqliteFiles.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('a fetched file keeps its word times, in memory and in SQLite', async () => {
    serve(wordFile(1));
    let service = await launch(catalog());
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      wordFile(1),
    );

    // The next launch reads them from SQLite, with no fetch.
    service = await launch(catalog());
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      wordFile(1),
    );
    expect(fetchedUrls()).toEqual([fileUrl(1, 'v=2')]);
    expect(
      timingDb()
        .prepare(
          'SELECT word_times FROM cached_surahs WHERE rewayat_id = ? AND surah_number = ?',
        )
        .get(REWAYAT_ID, 1)?.word_times,
    ).toBe(1);
  });

  it('a file in word order is kept in time order; invalid segments are dropped', async () => {
    const [a, b] = plainFile(1);
    serve([
      {
        ...a,
        segments: [
          [2, 3000, 4000],
          [0, 0, 900],
          [0, 2100, 3000],
          [1, 900, 2000],
          [3, 500, 400],
          ['x', 0, 10],
        ],
      },
      {...b, segments: 'not a list'},
    ]);
    const service = await launch(catalog());
    const result = await service.getTimestampsForSurah(REWAYAT_ID, 1);
    expect(result?.[0].segments).toEqual(AYAH_1_WORDS);
    expect(result?.[1]).toEqual(b);
    expect(result?.[1]).not.toHaveProperty('segments');
  });

  for (const withRev of [false, true]) {
    const build = withRev ? 'the #846 build' : 'a build before #846';
    it(`migration: the cache of ${build} stays valid and gets the new columns`, async () => {
      olderBuildCache(withRev);
      fetchMock.mockRejectedValue(new TypeError('Network request failed'));
      const service = await launch(catalog());

      expect(columns('ayah_timestamps')).toContain('segments');
      expect(columns('cached_surahs')).toEqual(
        expect.arrayContaining(['rev', 'word_times']),
      );
      // No network: the older file is shown.
      expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
        plainFile(1),
      );
    });
  }

  it('refetch: a cached file of an older build is fetched once again, and the next launch uses the cache', async () => {
    olderBuildCache(true, [1, 2]);
    serve(wordFile(1));
    let service = await launch(catalog());
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      wordFile(1),
    );

    // The same launch: the memory cache.
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      wordFile(1),
    );
    // A new launch: the SQLite cache, with the word times.
    service = await launch(catalog());
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      wordFile(1),
    );
    expect(fetchedUrls()).toEqual([fileUrl(1, 'v=2')]);
  });

  it('refetch once: a file that has no word times is not fetched again', async () => {
    olderBuildCache(true);
    serve(plainFile(1)); // the live file has no word times yet
    let service = await launch(catalog());
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      plainFile(1),
    );

    service = await launch(catalog());
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      plainFile(1),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetch with no network: the older file, and the next call tries again', async () => {
    olderBuildCache(true);
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const service = await launch(catalog());
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      plainFile(1),
    );

    serve(wordFile(1));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      wordFile(1),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no refetch before the catalog loads: the cached file is used', async () => {
    olderBuildCache(true);
    const service = await launch([]);
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      plainFile(1),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no refetch when the catalog does not cover the surah', async () => {
    olderBuildCache(true);
    const service = await launch(catalog([2]));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      plainFile(1),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the #846 contract stays: a revision is in the URL and in the rev column', async () => {
    olderBuildCache(true);
    serve(wordFile(1));
    const service = await launch(catalog([1, 2], 3));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      wordFile(1),
    );
    expect(fetchedUrls()).toEqual([fileUrl(1, 'v=2&r=3')]);
    expect(
      timingDb()
        .prepare(
          'SELECT rev, word_times FROM cached_surahs WHERE rewayat_id = ? AND surah_number = ?',
        )
        .get(REWAYAT_ID, 1),
    ).toEqual({rev: 3, word_times: 1});
  });

  it('a damaged segments column gives no word times, not an error', async () => {
    serve(wordFile(1));
    let service = await launch(catalog());
    await service.getTimestampsForSurah(REWAYAT_ID, 1);
    timingDb()
      .prepare(
        'UPDATE ayah_timestamps SET segments = ? WHERE rewayat_id = ? AND ayah_number = 1',
      )
      .run('[[0, 0,', REWAYAT_ID);

    service = await launch(catalog());
    const result = await service.getTimestampsForSurah(REWAYAT_ID, 1);
    expect(result?.[0]).toEqual(plainFile(1)[0]);
    expect(result?.[1].segments).toEqual(AYAH_2_WORDS);
  });

  describe('the test build (EXPO_PUBLIC_QARIAH_WORD_TIMES_TEST=1)', () => {
    const ZAYNAB = 'f543c610-837d-5fc5-825f-0b51752aa3a4';
    const wordTimes = () =>
      timingDb()
        .prepare(
          'SELECT word_times FROM cached_surahs WHERE rewayat_id = ? AND surah_number = 36',
        )
        .get(ZAYNAB)?.word_times;
    afterEach(() => {
      delete process.env.EXPO_PUBLIC_QARIAH_WORD_TIMES_TEST;
    });

    it('loads the test file over the cache, and a later store build of this version loads the real file again', async () => {
      // A store build caches the bundled Ya-Sin (no word times).
      let service = await launch([]);
      let result = await service.getTimestampsForSurah(ZAYNAB, 36);
      expect(result?.some(t => t.segments)).toBe(false);
      expect(wordTimes()).toBe(1);

      // The test build: the test file, with word times, over the cache.
      process.env.EXPO_PUBLIC_QARIAH_WORD_TIMES_TEST = '1';
      service = await launch([]);
      result = await service.getTimestampsForSurah(ZAYNAB, 36);
      expect(result?.[9].segments?.[6]).toEqual([2, 95160, 97960]);
      expect(wordTimes()).toBe(0);

      // A store build again: the test file does not stay.
      delete process.env.EXPO_PUBLIC_QARIAH_WORD_TIMES_TEST;
      service = await launch([]);
      result = await service.getTimestampsForSurah(ZAYNAB, 36);
      expect(result?.some(t => t.segments)).toBe(false);
      expect(wordTimes()).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled(); // bundled: no network
    });
  });
});
