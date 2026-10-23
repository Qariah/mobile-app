// @ai-generated
// Tests for scripts/catalog-added-at.mjs (Sprint 48 Task 6). Run with
// node --test (CI: .github/workflows/test.yml "Script tests"). The pure core
// runs on a 4-version fixture history; loadHistory runs on a fake fetch and a
// temporary cache folder. No test uses the network.
/* global Response, structuredClone, globalThis -- Node 18+ globals: the fake fetch builds its answers with Response */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import transform, {
  ALLOWED_FIELDS,
  ALLOWED_REWAYAH_FIELDS,
  cacheDir,
  computeAddedAt,
  formatReport,
  isIsoDate,
  loadHistory,
  newestStamped,
  prepareHistory,
  rangeKey,
  runStart,
  utcDate,
  versionUrl,
} from '../catalog-added-at.mjs';

const RA = 'aaaaaaaa-0000-5000-8000-000000000001';
const RB = 'bbbbbbbb-0000-5000-8000-000000000002';
const RC = 'cccccccc-0000-5000-8000-000000000003';
const D1 = '2026-05-16';
const D2 = '2026-05-18';
const D3 = '2026-06-01';
const D4 = '2026-09-22';
const TODAY = '2026-10-20';

const partial = (surah, from, to) => ({
  surah,
  is_full: false,
  range: {from, to},
});
const full = surah => ({surah, is_full: true});

function rewayah(id, surahList, meta, extra = {}) {
  return {
    id,
    reciter_id: 'x',
    name: `Rewayah ${id}`,
    style: 'murattal',
    server: `https://cdn.example.com/${id}`,
    surah_total: surahList.length,
    surah_list: surahList,
    source_type: 'r2',
    created_at: '2020-01-02T03:04:05.000Z',
    ...(meta === undefined ? {} : {surah_metadata: meta}),
    ...extra,
  };
}

const reciter = (id, slug, rewayat) => ({
  id,
  name: slug.toUpperCase(),
  name_arabic: 'اسم',
  date: null,
  image_url: `https://cdn.example.com/${slug}.jpg`,
  recitationsCount: rewayat.length,
  rewayat,
  country: 'Egypt',
  bio_en: 'A bio.',
  slug,
});

// W1 (reciter A): no surah_metadata in v1 (range unknown); surah 3 is new in
// v2; the range of surah 2 changes in v3 (1-10 → 1-20).
const w1 = {
  1: rewayah('w1', [1, 2], undefined),
  2: rewayah('w1', [1, 2, 3], [partial(2, 1, 10)]),
  3: rewayah('w1', [1, 2, 3], [partial(2, 1, 20)]),
};
// W4 (reciter B): the same in every version, with an orphan row (surah 9).
// Its created_at is later than v1, so it cannot date the rows that v1 has.
const w4Rows = [full(1), partial(4, 1, 5), partial(9, 1, 3)];
const w4 = () =>
  rewayah(
    'w4',
    [1, 2, 4, 7],
    w4Rows.map(r => ({...r})),
    {created_at: '2026-07-01T00:00:00.000Z'},
  );
// W5 (reciter B): surah 6 is listed in v1, not in v2, then again from v3.
// Its rows have a second row for the same surah.
const w5Rows = [full(6), partial(6, 1, 2)];
const w5 = list =>
  rewayah('w5', list, list.length ? w5Rows.map(r => structuredClone(r)) : []);
// W6 (reciter C): every row already has a date.
const w6 = () => rewayah('w6', [1], [{...full(1), added_at: '2026-01-01'}]);
// W7 (reciter B): in every version, with no created_at.
const w7 = () => {
  const w = rewayah('w7', [3], []);
  delete w.created_at;
  return w;
};

function version(n) {
  const w1n = w1[Math.min(n, 3)];
  return [
    reciter(RA, 'reciter-a', [structuredClone(w1n)]),
    reciter(RB, 'reciter-b', [w4(), w5(n === 2 ? [] : [6]), w7()]),
    reciter(RC, 'reciter-c', [w6()]),
  ];
}

const HISTORY = [
  {version: 1, date: D1, reciters: version(1)},
  {version: 2, date: D2, reciters: version(2)},
  {version: 3, date: D3, reciters: version(3)},
  {version: 4, date: D4, reciters: version(4)},
];

/** The live catalog: v4, plus rewayat that no version has, and a date already set. */
function liveCatalog() {
  const live = version(4);
  live[0].rewayat.push(
    rewayah('w2', [5], undefined, {created_at: '2021-06-07T23:59:59.000Z'}),
    rewayah('w3', [7], undefined, {created_at: 'not a date'}),
  );
  live[1].rewayat[0].surah_metadata[0].added_at = '2026-10-19';
  return live;
}

const run = (live = liveCatalog(), history = HISTORY) =>
  computeAddedAt(live, history, {today: TODAY});

const rowsOf = (reciters, reciterIndex, rewayahId) =>
  reciters[reciterIndex].rewayat.find(w => w.id === rewayahId).surah_metadata;

test('a recitation new in v2 gets the v2 date (a complete surah gets an is_full row)', () => {
  const {reciters} = run();
  assert.deepEqual(rowsOf(reciters, 0, 'w1')[2], {
    surah: 3,
    is_full: true,
    added_at: D2,
  });
});

test('a range change in v3 is a new recitation: the v3 date', () => {
  const {reciters} = run();
  assert.deepEqual(rowsOf(reciters, 0, 'w1')[1], {
    ...partial(2, 1, 20),
    added_at: D3,
  });
});

test('a row in every version since v1 (range unknown in v1) gets the older rewayah created_at', () => {
  const {reciters} = run();
  assert.deepEqual(rowsOf(reciters, 0, 'w1')[0], {
    surah: 1,
    is_full: true,
    added_at: '2020-01-02',
  });
  // The full rows of W1, in surah order: rows from v2 and v3 keep the
  // version date.
  assert.deepEqual(
    rowsOf(reciters, 0, 'w1').map(r => [r.surah, r.added_at]),
    [
      [1, '2020-01-02'],
      [2, D3],
      [3, D2],
    ],
  );
});

test('a row in every version since v1 gets the v1 date when created_at is later than v1', () => {
  const {reciters} = run();
  assert.deepEqual(
    rowsOf(reciters, 1, 'w4')
      .filter(r => r.surah !== 1 && r.surah !== 9)
      .map(r => [r.surah, r.added_at]),
    [
      [2, D1],
      [4, D1],
      [7, D1],
    ],
  );
});

test('a row in every version since v1 gets the v1 date when created_at is missing', () => {
  const {reciters} = run();
  assert.deepEqual(rowsOf(reciters, 1, 'w7'), [
    {surah: 3, is_full: true, added_at: D1},
  ]);
});

test('a created_at on the day of v1 is not later than v1: it is used', () => {
  const rec = () => [
    reciter(RA, 'reciter-a', [
      rewayah('w8', [1], [], {created_at: '2026-05-16T23:00:00.000Z'}),
    ]),
  ];
  const {reciters, report} = computeAddedAt(
    rec(),
    [
      {version: 1, date: D1, reciters: rec()},
      {version: 2, date: D2, reciters: rec()},
    ],
    {today: TODAY},
  );
  assert.equal(reciters[0].rewayat[0].surah_metadata[0].added_at, D1);
  assert.equal(report.oldestFromCreatedAt, 1);
  assert.equal(report.stamped[0].source, 'v1 created_at');
});

test('a surah that the catalog removed and then lists again is new from its return', () => {
  const {reciters, report} = run();
  const rows = rowsOf(reciters, 1, 'w5');
  assert.deepEqual(rows[0], {...full(6), added_at: D3});
  // The second row of the same surah is left alone.
  assert.deepEqual(rows[1], partial(6, 1, 2));
  assert.equal(report.duplicateRows, 1);
});

test('a recitation that no version has gets its rewayah created_at (UTC date)', () => {
  const {reciters} = run();
  assert.deepEqual(rowsOf(reciters, 0, 'w2'), [
    {surah: 5, is_full: true, added_at: '2021-06-07'},
  ]);
});

test('an invalid created_at falls back to the date of the oldest version', () => {
  const {reciters, report} = run();
  assert.deepEqual(rowsOf(reciters, 0, 'w3'), [
    {surah: 7, is_full: true, added_at: D1},
  ]);
  assert.equal(report.fromOldestVersion, 1);
});

test('an existing added_at is kept; an orphan row is left alone; new rows go in surah order', () => {
  const {reciters} = run();
  assert.deepEqual(rowsOf(reciters, 1, 'w4'), [
    {...full(1), added_at: '2026-10-19'},
    {surah: 2, is_full: true, added_at: D1},
    {...partial(4, 1, 5), added_at: D1},
    {surah: 7, is_full: true, added_at: D1},
    partial(9, 1, 3),
  ]);
});

test('the report counts each kind of row', () => {
  const {report} = run();
  assert.equal(report.fromHistory, 3); // W1 surahs 2 and 3, W5 surah 6
  assert.equal(report.oldestFromCreatedAt, 1); // W1 surah 1
  assert.equal(report.oldestAtOldestDate, 4); // W4 surahs 2, 4, 7; W7 surah 3
  assert.equal(report.fromCreatedAt, 1); // W2
  assert.equal(report.fromOldestVersion, 1); // W3
  assert.equal(report.rowsAdded, 7);
  assert.equal(report.alreadyDated, 2);
  assert.equal(report.alreadyDatedInvalid, 0);
  assert.equal(report.orphanRows, 1);
  assert.equal(report.duplicateRows, 1);
  assert.deepEqual(report.stampedByVersion, {1: 5, 2: 1, 3: 2});
  assert.deepEqual(report.oldestVersion, {version: 1, date: D1});
  assert.deepEqual(report.newestVersion, {version: 4, date: D4});
});

test('every listed surah has a row with a YYYY-MM-DD added_at', () => {
  const {reciters} = run();
  for (const r of reciters) {
    for (const w of r.rewayat) {
      for (const surah of w.surah_list) {
        const row = w.surah_metadata.find(m => m.surah === surah);
        assert.ok(row, `${w.id} surah ${surah} has a row`);
        assert.match(row.added_at, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(isIsoDate(row.added_at));
      }
    }
  }
});

test('ids, order and every other field stay the same; the input is not changed', () => {
  const live = liveCatalog();
  const before = structuredClone(live);
  const {reciters} = run(live);
  assert.deepEqual(live, before, 'the input is not changed');
  assert.deepEqual(
    reciters.map(r => r.id),
    before.map(r => r.id),
  );
  reciters.forEach((r, i) => {
    const {rewayat: a, ...restAfter} = r;
    const {rewayat: b, ...restBefore} = before[i];
    assert.deepEqual(restAfter, restBefore);
    assert.deepEqual(
      a.map(w => w.id),
      b.map(w => w.id),
    );
    a.forEach((w, j) => {
      const {surah_metadata: rowsAfter, ...wAfter} = w;
      const {surah_metadata: rowsBefore = [], ...wBefore} = b[j];
      assert.deepEqual(wAfter, wBefore);
      // The old rows are still there, in order, each one with at most an
      // added `added_at`.
      const kept = rowsAfter.filter(row =>
        rowsBefore.some(
          old => old.surah === row.surah && rangeKey(old) === rangeKey(row),
        ),
      );
      assert.equal(kept.length, rowsBefore.length);
      kept.forEach((row, k) => {
        const old = rowsBefore[k];
        const {added_at: addedAfter, ...rowRest} = row;
        const {added_at: addedBefore, ...oldRest} = old;
        assert.deepEqual(rowRest, oldRest);
        if (addedBefore !== undefined) assert.equal(addedAfter, addedBefore);
      });
    });
  });
  // A reciter with nothing to stamp is the same object.
  assert.equal(reciters[2], live[2]);
  // Only the rewayat field differs from the input (ALLOWED_FIELDS).
  assert.deepEqual(ALLOWED_FIELDS, ['rewayat']);
});

test('a second run changes nothing', () => {
  const first = run().reciters;
  const second = run(structuredClone(first));
  assert.deepEqual(second.reciters, first);
  assert.equal(second.report.fromHistory, 0);
  assert.equal(second.report.rowsAdded, 0);
  // 10 stamped + 2 that had a date: the first row of each listed surah.
  assert.equal(second.report.alreadyDated, 12);
});

test('rangeKey follows the ops console: partial only with is_full false and a range', () => {
  assert.equal(rangeKey(undefined), 'full');
  assert.equal(rangeKey(full(1)), 'full');
  assert.equal(rangeKey(partial(2, 1, 10)), '1-10');
  assert.equal(
    rangeKey({surah: 2, is_full: true, range: {from: 1, to: 10}}),
    'full',
  );
  assert.equal(rangeKey({surah: 2, range: {from: 1, to: 10}}), 'full');
  assert.equal(rangeKey({surah: 2, is_full: false}), 'full');
});

test('runStart walks back from the newest version and stops at a gap', () => {
  const versions = HISTORY.map(v => ({
    version: v.version,
    date: v.date,
    index: prepareHistory([
      {version: v.version, lastModified: v.date, body: v.reciters},
    ]).versions[0].index,
  }));
  assert.equal(runStart(versions, `${RA}|w1`, 2, '1-20').version, 3);
  assert.equal(runStart(versions, `${RA}|w1`, 1, 'full').version, 1);
  assert.equal(runStart(versions, `${RB}|w5`, 6, 'full').version, 3);
  assert.equal(runStart(versions, `${RA}|w1`, 2, '1-10'), null);
  assert.equal(runStart(versions, `${RA}|nope`, 1, 'full'), null);
});

test('newestStamped and formatReport list the newest recitations first', () => {
  const {report} = run();
  const newest = newestStamped(report);
  assert.deepEqual(
    newest.map(s => [s.date, s.rewayahId, s.surah]),
    [
      [D3, 'w1', 2],
      [D3, 'w5', 6],
      [D2, 'w1', 3],
      [D1, 'w3', 7],
      [D1, 'w4', 2],
      [D1, 'w4', 4],
      [D1, 'w4', 7],
      [D1, 'w7', 3],
      ['2021-06-07', 'w2', 5],
      ['2020-01-02', 'w1', 1],
    ],
  );
  const lines = formatReport(report, {
    read: 4,
    first: 1,
    last: 4,
    missing: [],
    undated: [],
    clamped: [],
  });
  assert.match(lines[0], /version date \(run starts after v1\) 3;/);
  assert.match(
    lines[0],
    /since v1 \(older than the history\): from rewayah created_at 1, at the v1 date \(created_at missing, invalid or later\) 4;/,
  );
  assert.match(
    lines[0],
    /no run: from created_at 1, from the oldest version date 1$/,
  );
  assert.match(lines[1], /rows added for complete surahs 7/);
  assert.match(lines[1], /orphan rows 1/);
  assert.match(lines[2], /4 versions read \(v1-v4\), missing 0/);
  assert.match(lines.at(-1), /^newest stamped: 2026-06-01 aaaaaaaa/);
  assert.match(lines.at(-1), /surah 2 ayat 1-20 \[v3\]/);
  assert.match(lines.at(-1), /surah 1 \[v1 created_at\]$/);
  assert.match(lines.at(-1), /surah 3 \[v1 date\];/);
});

test('utcDate and isIsoDate', () => {
  assert.equal(utcDate('Sat, 16 May 2026 14:45:54 GMT'), D1);
  assert.equal(utcDate('2026-05-16T23:59:59-02:00'), '2026-05-17');
  assert.equal(utcDate('nope'), null);
  assert.equal(utcDate(undefined), null);
  assert.equal(isIsoDate('2026-02-29'), false);
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.equal(isIsoDate('2026-5-1'), false);
});

test('prepareHistory dates by Last-Modified, then updated_at; skips undated; re-dates a later re-upload', () => {
  const body = version(1);
  const prepared = prepareHistory([
    {version: 3, lastModified: 'Mon, 01 Jun 2026 05:36:30 GMT', body},
    {version: 1, lastModified: 'Sat, 16 May 2026 14:45:54 GMT', body},
    // A re-upload after v3 has a later Last-Modified than v3.
    {version: 2, lastModified: 'Tue, 22 Sep 2026 10:00:00 GMT', body},
    {
      version: 4,
      lastModified: null,
      body: {updated_at: '2026-09-22T10:47:45Z', reciters: body},
    },
    {version: 5, lastModified: null, body},
  ]);
  assert.deepEqual(
    prepared.versions.map(v => [v.version, v.date]),
    [
      [1, D1],
      [2, D3],
      [3, D3],
      [4, D4],
    ],
  );
  assert.deepEqual(prepared.undated, [5]);
  assert.deepEqual(prepared.clamped, [{version: 2, from: D4, to: D3}]);
  // An object body with `reciters` is indexed too.
  assert.ok(prepared.versions[3].index.has(`${RA}|w1`));
});

test('computeAddedAt accepts a prepared history', () => {
  const raw = HISTORY.map(v => ({
    version: v.version,
    lastModified: `${v.date}T12:00:00Z`,
    body: v.reciters,
  }));
  const viaRaw = computeAddedAt(liveCatalog(), prepareHistory(raw), {
    today: TODAY,
  });
  assert.deepEqual(viaRaw.reciters, run().reciters);
});

test('a created_at later than today is not used', () => {
  const live = [
    reciter(RA, 'reciter-a', [
      rewayah('w9', [1], [], {created_at: '2027-01-01T00:00:00Z'}),
    ]),
  ];
  const {reciters, report} = run(live);
  assert.deepEqual(reciters[0].rewayat[0].surah_metadata, [
    {surah: 1, is_full: true, added_at: D1},
  ]);
  assert.equal(report.fromOldestVersion, 1);
});

test('versionUrl and cacheDir: the environment first, then .env.local', () => {
  const root = mkdtempSync(
    path.join(process.env.TMPDIR || tmpdir(), 'catalog-added-at-env-'),
  );
  try {
    assert.equal(versionUrl({}, root), null);
    assert.equal(
      versionUrl(
        {
          EXPO_PUBLIC_CATALOG_URL:
            'https://cdn.example.com/catalog/catalog-v1.json',
        },
        root,
      ),
      'https://cdn.example.com/catalog/catalog-version.json',
    );
    assert.equal(
      versionUrl(
        {
          EXPO_PUBLIC_CATALOG_VERSION_URL: 'https://cdn.example.com/v.json',
          EXPO_PUBLIC_CATALOG_URL:
            'https://cdn.example.com/catalog/catalog-v1.json',
        },
        root,
      ),
      'https://cdn.example.com/v.json',
    );
    writeFileSync(
      path.join(root, '.env.local'),
      'EXPO_PUBLIC_CATALOG_URL="https://cdn.example.com/c/catalog-v1.json"\nCATALOG_HISTORY_CACHE=/var/cache/x\n',
    );
    assert.equal(
      versionUrl({}, root),
      'https://cdn.example.com/c/catalog-version.json',
    );
    assert.equal(cacheDir({}, root), '/var/cache/x');
    assert.match(
      cacheDir({}, path.join(root, 'none')),
      /claude\/\.scratch\/sprint-48\/catalog\/history$/,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('loadHistory reads the pointer, skips a 404, caches each version, limits concurrency', async () => {
  const dir = mkdtempSync(
    path.join(process.env.TMPDIR || tmpdir(), 'catalog-added-at-cache-'),
  );
  const origin = 'https://cdn.example.com';
  const pointer = {
    version: 4,
    updated_at: '2026-09-22T10:47:45Z',
    url: `${origin}/catalog/history/v4.json`,
  };
  let inFlight = 0;
  let maxInFlight = 0;
  const calls = [];
  const fakeFetch = async url => {
    calls.push(url);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--;
    if (url === `${origin}/catalog/catalog-version.json`) {
      return new Response(JSON.stringify(pointer), {status: 200});
    }
    const k = Number(/\/catalog\/history\/v(\d+)\.json$/.exec(url)?.[1]);
    if (k === 1) return new Response('not found', {status: 404});
    if (k >= 2 && k <= 4) {
      return new Response(JSON.stringify(version(k)), {
        status: 200,
        headers: {'last-modified': `${[D1, D2, D3, D4][k - 1]}T12:00:00Z`},
      });
    }
    return new Response('?', {status: 500});
  };
  try {
    const first = await loadHistory({
      fetchImpl: fakeFetch,
      url: `${origin}/catalog/catalog-version.json`,
      dir,
      concurrency: 2,
    });
    assert.equal(first.versionDoc.version, 4);
    assert.deepEqual(first.missing, [1]);
    assert.deepEqual(
      first.raw.map(r => r.version),
      [2, 3, 4],
    );
    assert.equal(first.raw[0].lastModified, `${D2}T12:00:00Z`);
    assert.ok(
      maxInFlight <= 2,
      `at most 2 requests at a time (saw ${maxInFlight})`,
    );
    assert.ok(existsSync(path.join(dir, 'v2.json')));
    assert.equal(
      JSON.parse(readFileSync(path.join(dir, 'v2.meta.json'), 'utf8'))
        .lastModified,
      `${D2}T12:00:00Z`,
    );
    assert.ok(!existsSync(path.join(dir, 'v1.json')), 'a 404 is not cached');

    // The second load reads v2-v4 from the cache.
    calls.length = 0;
    const second = await loadHistory({
      fetchImpl: fakeFetch,
      url: `${origin}/catalog/catalog-version.json`,
      dir,
    });
    assert.deepEqual(second.raw, first.raw);
    assert.deepEqual(
      calls.map(u => u.replace(origin, '')),
      ['/catalog/catalog-version.json', '/catalog/history/v1.json'],
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('loadHistory names no host in an error, and stops after its tries', async () => {
  const dir = mkdtempSync(
    path.join(process.env.TMPDIR || tmpdir(), 'catalog-added-at-err-'),
  );
  let tries = 0;
  await assert.rejects(
    loadHistory({
      fetchImpl: async () => {
        tries++;
        return new Response('no', {status: 503});
      },
      url: 'https://cdn.example.com/catalog/catalog-version.json',
      dir,
      timeoutMs: 1000,
    }),
    error => {
      assert.match(
        error.message,
        /^<origin>\/catalog\/catalog-version\.json: HTTP 503$/,
      );
      return true;
    },
  );
  assert.equal(tries, 3);
  rmSync(dir, {recursive: true, force: true});
});

test('the default export is the transform of catalog-r2-mutate.mjs', () => {
  assert.equal(typeof transform, 'function');
});

test('the transform declares the rewayah field that it changes (TECH_DEBT #326)', async () => {
  const dir = mkdtempSync(
    path.join(process.env.TMPDIR || tmpdir(), 'catalog-added-at-transform-'),
  );
  const origin = 'https://cdn.example.com';
  const saved = {
    fetch: globalThis.fetch,
    url: process.env.EXPO_PUBLIC_CATALOG_VERSION_URL,
    cache: process.env.CATALOG_HISTORY_CACHE,
  };
  const restoreEnv = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  globalThis.fetch = async url => {
    if (url === `${origin}/catalog/catalog-version.json`) {
      return new Response(
        JSON.stringify({
          version: 4,
          updated_at: '2026-09-22T10:47:45Z',
          url: `${origin}/catalog/history/v4.json`,
        }),
        {status: 200},
      );
    }
    const k = Number(/\/catalog\/history\/v(\d+)\.json$/.exec(url)?.[1]);
    return new Response(JSON.stringify(version(k)), {
      status: 200,
      headers: {'last-modified': `${[D1, D2, D3, D4][k - 1]}T12:00:00Z`},
    });
  };
  process.env.EXPO_PUBLIC_CATALOG_VERSION_URL = `${origin}/catalog/catalog-version.json`;
  process.env.CATALOG_HISTORY_CACHE = dir;
  try {
    // The live catalog must equal the newest history version (v4).
    const result = await transform(version(4));
    assert.deepEqual(result.allowedFields, ALLOWED_FIELDS);
    assert.deepEqual(result.allowedRewayahFields, ALLOWED_REWAYAH_FIELDS);
    assert.deepEqual(ALLOWED_REWAYAH_FIELDS, ['surah_metadata']);
  } finally {
    globalThis.fetch = saved.fetch;
    restoreEnv('EXPO_PUBLIC_CATALOG_VERSION_URL', saved.url);
    restoreEnv('CATALOG_HISTORY_CACHE', saved.cache);
    rmSync(dir, {recursive: true, force: true});
  }
});
