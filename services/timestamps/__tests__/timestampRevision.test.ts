// @ai-generated
/**
 * Qariah (issue #846): a phone fetches a corrected timing file.
 *
 * The catalog row carries `timestamps_rev` (one number, or one number for each
 * surah). The revision goes into the SQLite cache and into the file URL
 * (`?v=2&r=<n>`). A missing field keeps the behavior before the change.
 *
 * The suites below run the real TimestampService, TimestampFetchService and
 * TimestampDatabaseService against real SQL: `expo-sqlite` is replaced by
 * node:sqlite (Node 22.13 or later). One in-memory database stands for each
 * file name and survives `jest.isolateModules`, so a new module registry is a
 * new app launch with the same files on the phone.
 */
import type {Reciter, Rewayat} from '@/data/reciterData';
import type {AyahTimestamp} from '@/types/timestamps';
import {
  timestampFileQuery,
  timestampRevisionFor,
  toAyahTimestamp,
} from '../timestampRevision';

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
  };
  close(): void;
}

// The SQLite files on the phone, by name.
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
const REWAYAT_ID = 'fixture-timing-revision-rewayat';
// The URL after the RFC-015 CDN base. The base comes from the environment
// (EXPO_PUBLIC_TIMESTAMP_CDN_BASE), so the checks compare the rest of the URL.
function fileUrl(surah: number, query: string): string {
  return `/${REWAYAT_ID}/${String(surah).padStart(3, '0')}.json?${query}`;
}

// The file as it first went live, and the file after the ops team moved the
// edge between ayah 1 and ayah 2.
function firstFile(surah: number): AyahTimestamp[] {
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

function correctedFile(surah: number): AyahTimestamp[] {
  return [
    {
      surahNumber: surah,
      ayahNumber: 1,
      timestampFrom: 0,
      timestampTo: 4600,
      durationMs: 4600,
    },
    {
      surahNumber: surah,
      ayahNumber: 2,
      timestampFrom: 4600,
      timestampTo: 9000,
      durationMs: 4400,
    },
  ];
}

function catalog(
  rev: Rewayat['timestamps_rev'] | undefined,
  surahList: number[] = [1, 2],
): Reciter[] {
  const rewayat: Rewayat = {
    id: REWAYAT_ID,
    reciter_id: 'fixture-timing-revision-reciter',
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
      id: 'fixture-timing-revision-reciter',
      name: 'Timing revision fixture',
      date: null,
      image_url: null,
      rewayat: [rewayat],
    },
  ];
}

type Service = (typeof import('../TimestampService'))['timestampService'];

// A new app launch: new modules (empty memory caches), the same SQLite files.
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
    expect(url).toMatch(/^https:\/\/[^/]+\//);
    return url.slice(url.indexOf(`/${REWAYAT_ID}/`));
  });
}

function cachedRev(surah: number): unknown {
  return mockSqliteFiles
    .get(DB_NAME)
    ?.prepare(
      'SELECT rev FROM cached_surahs WHERE rewayat_id = ? AND surah_number = ?',
    )
    .get(REWAYAT_ID, surah)?.rev;
}

describe('timestampRevisionFor (the catalog field)', () => {
  const row = (rev: unknown) =>
    ({timestamps_rev: rev}) as Pick<Rewayat, 'timestamps_rev'>;

  it('is 0 when the field is missing or null', () => {
    expect(timestampRevisionFor({}, 1)).toBe(0);
    expect(timestampRevisionFor(row(null), 1)).toBe(0);
  });

  it('one number applies to every surah of the row', () => {
    expect(timestampRevisionFor(row(3), 1)).toBe(3);
    expect(timestampRevisionFor(row(3), 114)).toBe(3);
  });

  it('an object gives each surah its own revision; a surah not in it is 0', () => {
    const rev = row({'1': 2, '36': 5});
    expect(timestampRevisionFor(rev, 1)).toBe(2);
    expect(timestampRevisionFor(rev, 36)).toBe(5);
    expect(timestampRevisionFor(rev, 2)).toBe(0);
  });

  it('ignores a value that is not an integer of 0 or more', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, '3', true, [2]]) {
      expect(timestampRevisionFor(row(bad), 1)).toBe(0);
      expect(timestampRevisionFor(row({'1': bad}), 1)).toBe(0);
    }
  });

  it('is null when the catalog has no row for the rewayah', () => {
    expect(timestampRevisionFor(undefined, 1)).toBeNull();
  });

  it('puts a revision above 0 in the URL query, and keeps the URL of today for 0', () => {
    expect(timestampFileQuery(2, 0)).toBe('v=2');
    expect(timestampFileQuery(2, 3)).toBe('v=2&r=3');
  });

  it('toAyahTimestamp keeps the five ayah fields only', () => {
    const withWords = {
      ...firstFile(1)[0],
      words: [{word: 1, start_ms: 0, end_ms: 900}],
    };
    expect(toAyahTimestamp(withWords)).toEqual(firstFile(1)[0]);
    expect(toAyahTimestamp(withWords)).not.toHaveProperty('words');
  });
});

const describeSqlite = hasNodeSqlite() ? describe : describe.skip;

describeSqlite('timing revision through the SQLite cache', () => {
  beforeEach(() => {
    for (const db of mockSqliteFiles.values()) db.close();
    mockSqliteFiles.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('no revision: the cache of an older build stays valid after the update', async () => {
    // #847: the build also tries once to fetch the file again for its word
    // times (an older build dropped them). Here that fetch fails, and the
    // cached file is shown.
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    // The cache as a build before #846 wrote it: no rev column.
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
    for (const t of firstFile(1)) {
      old
        .prepare('INSERT INTO ayah_timestamps VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          REWAYAT_ID,
          1,
          t.ayahNumber,
          t.timestampFrom,
          t.timestampTo,
          t.durationMs,
        );
    }
    old
      .prepare('INSERT INTO cached_surahs VALUES (?, ?, ?, ?)')
      .run(REWAYAT_ID, 1, 'r2', 1);
    mockSqliteFiles.set(DB_NAME, old);

    const service = await launch(catalog(undefined));

    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      firstFile(1),
    );
    expect(fetchedUrls()).toEqual([fileUrl(1, 'v=2')]); // #847: no r
    expect(cachedRev(1)).toBe(0);
    warn.mockRestore();
  });

  it('no revision: an uncached surah is fetched at the URL of today (?v=2, no r)', async () => {
    serve(firstFile(2));
    const service = await launch(catalog(undefined));

    expect(await service.getTimestampsForSurah(REWAYAT_ID, 2)).toEqual(
      firstFile(2),
    );
    expect(fetchedUrls()).toEqual([fileUrl(2, 'v=2')]);
    expect(cachedRev(2)).toBe(0);
  });

  it('a higher revision fetches the file again and shows the new file; the next launch uses the cache', async () => {
    serve(firstFile(1));
    let service = await launch(catalog(1));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      firstFile(1),
    );

    // The ops team corrects the file and writes revision 2.
    serve(correctedFile(1));
    service = await launch(catalog(2));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      correctedFile(1),
    );
    expect(cachedRev(1)).toBe(2);

    service = await launch(catalog(2));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      correctedFile(1),
    );

    expect(fetchedUrls()).toEqual([
      fileUrl(1, 'v=2&r=1'),
      fileUrl(1, 'v=2&r=2'),
    ]);
  });

  it('the same revision uses the cache, in memory and in SQLite', async () => {
    serve(firstFile(1));
    let service = await launch(catalog(3));
    await service.getTimestampsForSurah(REWAYAT_ID, 1);
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      firstFile(1),
    );

    service = await launch(catalog(3));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      firstFile(1),
    );
    expect(fetchedUrls()).toEqual([fileUrl(1, 'v=2&r=3')]);
  });

  it('a revision that changes while the app runs fetches the file again', async () => {
    const reciters = catalog(1);
    serve(firstFile(1));
    const service = await launch(reciters);
    await service.getTimestampsForSurah(REWAYAT_ID, 1);

    // A catalog refresh in the background brings revision 2.
    reciters[0].rewayat[0].timestamps_rev = 2;
    serve(correctedFile(1));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      correctedFile(1),
    );
    expect(fetchedUrls()).toEqual([
      fileUrl(1, 'v=2&r=1'),
      fileUrl(1, 'v=2&r=2'),
    ]);
  });

  it('the number shape: one revision for each surah of the row', async () => {
    serve(firstFile(1));
    serve(firstFile(2));
    const service = await launch(catalog(4));
    await service.getTimestampsForSurah(REWAYAT_ID, 1);
    await service.getTimestampsForSurah(REWAYAT_ID, 2);

    expect(fetchedUrls()).toEqual([
      fileUrl(1, 'v=2&r=4'),
      fileUrl(2, 'v=2&r=4'),
    ]);
  });

  it('the object shape: each surah has its own revision, and a surah not in it keeps the URL of today', async () => {
    serve(firstFile(1));
    serve(firstFile(2));
    let service = await launch(catalog({'1': 2}));
    await service.getTimestampsForSurah(REWAYAT_ID, 1);
    await service.getTimestampsForSurah(REWAYAT_ID, 2);

    // Only surah 2 is corrected.
    serve(correctedFile(2));
    service = await launch(catalog({'1': 2, '2': 1}));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      firstFile(1),
    );
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 2)).toEqual(
      correctedFile(2),
    );

    expect(fetchedUrls()).toEqual([
      fileUrl(1, 'v=2&r=2'),
      fileUrl(2, 'v=2'),
      fileUrl(2, 'v=2&r=1'),
    ]);
  });

  it('with no network, a newer revision keeps the older file, and the next call tries again', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    serve(firstFile(1));
    let service = await launch(catalog(1));
    await service.getTimestampsForSurah(REWAYAT_ID, 1);

    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    service = await launch(catalog(2));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      firstFile(1),
    );
    expect(cachedRev(1)).toBe(1);

    serve(correctedFile(1));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      correctedFile(1),
    );
    expect(fetchedUrls()).toEqual([
      fileUrl(1, 'v=2&r=1'),
      fileUrl(1, 'v=2&r=2'),
      fileUrl(1, 'v=2&r=2'),
    ]);
    warn.mockRestore();
  });

  it('a new revision with the surah gone from timestamps_surah_list stops the old file', async () => {
    serve(firstFile(1));
    let service = await launch(catalog(1));
    await service.getTimestampsForSurah(REWAYAT_ID, 1);

    service = await launch(catalog(2, [2]));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('before the catalog loads, the cached file of any revision is used', async () => {
    serve(firstFile(1));
    let service = await launch(catalog(3));
    await service.getTimestampsForSurah(REWAYAT_ID, 1);

    service = await launch([]);
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      firstFile(1),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a file whose ayat carry an extra words key parses; the app keeps the five ayah fields', async () => {
    serve(
      correctedFile(1).map(t => ({
        ...t,
        words: [
          {word: 1, start_ms: t.timestampFrom, end_ms: t.timestampFrom + 700},
          {word: 2, start_ms: t.timestampFrom + 700, end_ms: t.timestampTo},
        ],
      })),
    );
    let service = await launch(catalog(1));
    const result = await service.getTimestampsForSurah(REWAYAT_ID, 1);
    expect(result).toEqual(correctedFile(1));
    for (const t of result ?? []) expect(t).not.toHaveProperty('words');

    service = await launch(catalog(1));
    expect(await service.getTimestampsForSurah(REWAYAT_ID, 1)).toEqual(
      correctedFile(1),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
