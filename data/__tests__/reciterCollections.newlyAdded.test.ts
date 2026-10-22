// @ai-generated
// Qariah (Sprint 48): getNewlyAddedRecitations picks the newest recitations
// (one surah of one rewayah of one reciter) by `surah_metadata[].added_at`.
// The tests use fixture reciters and a fixed `now`, not the real catalog.
import {
  getNewlyAddedRecitations,
  type NewlyAddedRecitation,
} from '../reciterCollections';
import type {Reciter, Rewayat, SurahMetadata} from '../reciterData';

// A fixed "today": 2026-10-20 (UTC). With a 30-day window the cutoff is 2026-09-20.
const NOW = new Date('2026-10-20T12:00:00Z');

function rewayah(
  id: string,
  surahList: (number | null)[],
  surahMetadata?: SurahMetadata[],
): Rewayat {
  return {
    id,
    reciter_id: 'unused',
    name: `Rewayah ${id}`,
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: surahList.length,
    surah_list: surahList,
    source_type: 'test',
    created_at: '2026-01-01',
    ...(surahMetadata ? {surah_metadata: surahMetadata} : {}),
  };
}

function reciter(id: string, name: string, rewayat: Rewayat[]): Reciter {
  return {id, name, date: null, image_url: null, rewayat};
}

const dated = (surah: number, added_at: string): SurahMetadata => ({
  surah,
  is_full: true,
  added_at,
});

/** `id/rewayah/surah/addedAt` for a short, readable assertion. */
function summary(list: NewlyAddedRecitation[]): string[] {
  return list.map(
    r => `${r.reciter.id}/${r.rewayah.id}/${r.surah}/${r.addedAt}`,
  );
}

describe('getNewlyAddedRecitations', () => {
  it('returns only the recitations inside the window when minCount is met', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah(
          'a1',
          [1, 2, 3],
          [
            dated(1, '2026-10-19'),
            dated(2, '2026-09-20'), // the cutoff day itself is inside
            dated(3, '2026-09-19'), // one day older: outside
          ],
        ),
      ]),
    ];
    const result = getNewlyAddedRecitations({
      reciters,
      now: NOW,
      minCount: 1,
    });
    expect(summary(result)).toEqual(['a/a1/1/2026-10-19', 'a/a1/2/2026-09-20']);
  });

  it('uses a 30-day window and a minCount of 10 by default', () => {
    const surahs = Array.from({length: 12}, (_, i) => i + 1);
    const rows = surahs.map(s =>
      // Surah 1 is in the window; the other eleven are far older.
      dated(
        s,
        s === 1 ? '2026-10-01' : `2026-01-${String(s).padStart(2, '0')}`,
      ),
    );
    const result = getNewlyAddedRecitations({
      reciters: [reciter('a', 'Aisha', [rewayah('a1', surahs, rows)])],
      now: NOW,
    });
    expect(result).toHaveLength(10);
    expect(result[0].surah).toBe(1);
  });

  it('fills up to minCount with the next newest when the window has fewer', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah(
          'a1',
          [1, 2, 3, 4, 5],
          [
            dated(1, '2026-10-10'), // in the window
            dated(2, '2026-08-01'),
            dated(3, '2026-07-01'),
            dated(4, '2026-06-01'),
            dated(5, '2026-05-01'),
          ],
        ),
      ]),
    ];
    const result = getNewlyAddedRecitations({
      reciters,
      now: NOW,
      minCount: 3,
    });
    expect(summary(result)).toEqual([
      'a/a1/1/2026-10-10',
      'a/a1/2/2026-08-01',
      'a/a1/3/2026-07-01',
    ]);
  });

  it('returns the whole window when it holds more than minCount', () => {
    const surahs = [1, 2, 3, 4];
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah(
          'a1',
          surahs,
          surahs.map(s => dated(s, `2026-10-0${s}`)),
        ),
      ]),
    ];
    const result = getNewlyAddedRecitations({
      reciters,
      now: NOW,
      minCount: 2,
    });
    expect(result).toHaveLength(4);
  });

  it('returns every dated recitation when there are fewer than minCount in all', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah('a1', [1, 2], [dated(1, '2020-01-01'), dated(2, '2021-01-01')]),
      ]),
    ];
    const result = getNewlyAddedRecitations({reciters, now: NOW});
    expect(summary(result)).toEqual(['a/a1/2/2021-01-01', 'a/a1/1/2020-01-01']);
  });

  it('sorts by date (newest first), then reciter name A to Z, then surah number', () => {
    const reciters = [
      reciter('z', 'Zainab', [rewayah('z1', [7], [dated(7, '2026-10-15')])]),
      reciter('b', 'Basma', [
        rewayah(
          'b1',
          [9, 3, 5],
          [
            dated(9, '2026-10-15'),
            dated(3, '2026-10-15'),
            dated(5, '2026-10-18'), // newest: first
          ],
        ),
      ]),
      reciter('a', 'Aisha', [rewayah('a1', [2], [dated(2, '2026-10-15')])]),
    ];
    const result = getNewlyAddedRecitations({reciters, now: NOW});
    expect(summary(result)).toEqual([
      'b/b1/5/2026-10-18',
      'a/a1/2/2026-10-15', // same date: Aisha before Basma before Zainab
      'b/b1/3/2026-10-15', // same date and reciter: surah 3 before surah 9
      'b/b1/9/2026-10-15',
      'z/z1/7/2026-10-15',
    ]);
  });

  it('skips a listed surah that has no surah_metadata row', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        // Surah 2 is a complete surah with no row; surah 3 has no metadata at all.
        rewayah('a1', [1, 2], [dated(1, '2026-10-10')]),
        rewayah('a2', [3]),
      ]),
    ];
    const result = getNewlyAddedRecitations({reciters, now: NOW});
    expect(summary(result)).toEqual(['a/a1/1/2026-10-10']);
  });

  it('ignores an orphan row: a dated row for a surah that is not listed', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah(
          'a1',
          [1],
          [
            dated(1, '2026-10-10'),
            dated(114, '2026-10-19'), // not in surah_list: the ops console left it behind
          ],
        ),
      ]),
    ];
    const result = getNewlyAddedRecitations({reciters, now: NOW});
    expect(summary(result)).toEqual(['a/a1/1/2026-10-10']);
  });

  it('skips a row without added_at, and a row whose added_at is not YYYY-MM-DD', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah(
          'a1',
          [1, 2, 3, 4],
          [
            {surah: 1, is_full: true}, // no added_at
            dated(2, '2026-10-1'), // short
            dated(3, 'yesterday'),
            dated(4, '2026-10-12'),
          ],
        ),
      ]),
    ];
    const result = getNewlyAddedRecitations({reciters, now: NOW});
    expect(summary(result)).toEqual(['a/a1/4/2026-10-12']);
  });

  it('skips a null entry of surah_list', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah('a1', [null, 1], [dated(1, '2026-10-10')]),
      ]),
    ];
    const result = getNewlyAddedRecitations({reciters, now: NOW});
    expect(summary(result)).toEqual(['a/a1/1/2026-10-10']);
  });

  it('passes the range of a partial row through, and leaves it off a full row', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah(
          'a1',
          [2, 3],
          [
            {
              surah: 2,
              is_full: false,
              range: {from: 1, to: 50},
              added_at: '2026-10-12',
            },
            dated(3, '2026-10-11'),
          ],
        ),
      ]),
    ];
    const [partial, full] = getNewlyAddedRecitations({reciters, now: NOW});
    expect(partial.surah).toBe(2);
    expect(partial.range).toEqual({from: 1, to: 50});
    expect(full.surah).toBe(3);
    expect(full).not.toHaveProperty('range');
  });

  it('returns the reciter and the rewayah objects of the catalog', () => {
    const rw = rewayah('a1', [1], [dated(1, '2026-10-10')]);
    const rc = reciter('a', 'Aisha', [rw]);
    const [item] = getNewlyAddedRecitations({reciters: [rc], now: NOW});
    expect(item.reciter).toBe(rc);
    expect(item.rewayah).toBe(rw);
  });

  it('lists each recitation once, even when surah_list or surah_metadata repeats a surah', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah('a1', [1, 1], [dated(1, '2026-10-10'), dated(1, '2026-10-12')]),
      ]),
    ];
    const result = getNewlyAddedRecitations({reciters, now: NOW});
    expect(summary(result)).toEqual(['a/a1/1/2026-10-10']); // the first dated row wins
  });

  it('keeps the same surah of two rewayat as two recitations', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah('a1', [1], [dated(1, '2026-10-10')]),
        rewayah('a2', [1], [dated(1, '2026-10-10')]),
      ]),
    ];
    const result = getNewlyAddedRecitations({reciters, now: NOW});
    expect(summary(result)).toEqual(['a/a1/1/2026-10-10', 'a/a2/1/2026-10-10']);
  });

  it('uses `now` for the window, so the result is deterministic', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah('a1', [1, 2], [dated(1, '2026-10-10'), dated(2, '2026-06-01')]),
      ]),
    ];
    const options = {reciters, minCount: 0};
    // 2026-10-20: surah 1 is 10 days old, so it is in the window; surah 2 is not.
    expect(summary(getNewlyAddedRecitations({...options, now: NOW}))).toEqual([
      'a/a1/1/2026-10-10',
    ]);
    // 2026-06-10: surah 1 is in the future of `now` and surah 2 is 9 days old.
    expect(
      summary(
        getNewlyAddedRecitations({
          ...options,
          now: new Date('2026-06-10T00:00:00Z'),
        }),
      ),
    ).toEqual(['a/a1/1/2026-10-10', 'a/a1/2/2026-06-01']);
    // 2027-06-01: both are older than 30 days; with minCount 0 the list is empty.
    expect(
      getNewlyAddedRecitations({
        ...options,
        now: new Date('2027-06-01T00:00:00Z'),
      }),
    ).toEqual([]);
  });

  it('compares UTC dates: the cutoff day is inside the window whatever the time of day', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah('a1', [1, 2], [dated(1, '2026-10-13'), dated(2, '2026-10-12')]),
      ]),
    ];
    // 7-day window at 2026-10-20 00:00:01Z: the cutoff is 2026-10-13.
    const early = getNewlyAddedRecitations({
      reciters,
      now: new Date('2026-10-20T00:00:01Z'),
      windowDays: 7,
      minCount: 0,
    });
    expect(summary(early)).toEqual(['a/a1/1/2026-10-13']);
    // The same cutoff at 23:59:59Z.
    const late = getNewlyAddedRecitations({
      reciters,
      now: new Date('2026-10-20T23:59:59Z'),
      windowDays: 7,
      minCount: 0,
    });
    expect(summary(late)).toEqual(['a/a1/1/2026-10-13']);
  });

  it('gives an empty window, not a throw, for an invalid `now`', () => {
    const reciters = [
      reciter('a', 'Aisha', [rewayah('a1', [1], [dated(1, '2026-10-10')])]),
    ];
    expect(
      getNewlyAddedRecitations({
        reciters,
        now: new Date('not a date'),
        minCount: 0,
      }),
    ).toEqual([]);
  });

  it('gives an empty window, not a throw, when windowDays puts the cutoff outside the Date range', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah(
          'a1',
          [1, 2, 3],
          [
            dated(1, '2026-10-12'),
            dated(2, '2026-10-10'),
            dated(3, '2026-10-08'),
          ],
        ),
      ]),
    ];
    for (const windowDays of [1e12, Infinity, NaN]) {
      // No throw, and no window; minCount still applies.
      expect(
        getNewlyAddedRecitations({reciters, now: NOW, windowDays, minCount: 0}),
      ).toEqual([]);
      expect(
        summary(
          getNewlyAddedRecitations({
            reciters,
            now: NOW,
            windowDays,
            minCount: 2,
          }),
        ),
      ).toEqual(['a/a1/1/2026-10-12', 'a/a1/2/2026-10-10']);
    }
  });

  it('returns an empty array for no reciters, and for reciters with no rewayat', () => {
    expect(getNewlyAddedRecitations({reciters: [], now: NOW})).toEqual([]);
    const bare = {id: 'x', name: 'X', date: null, image_url: null} as Reciter;
    expect(getNewlyAddedRecitations({reciters: [bare], now: NOW})).toEqual([]);
  });

  it('does not change the reciters it reads', () => {
    const reciters = [
      reciter('a', 'Aisha', [
        rewayah('a1', [1, 2], [dated(2, '2026-10-12'), dated(1, '2026-10-10')]),
      ]),
    ];
    const before = JSON.stringify(reciters);
    getNewlyAddedRecitations({reciters, now: NOW});
    expect(JSON.stringify(reciters)).toBe(before);
  });

  it('runs on the real bundled catalog and returns an array', () => {
    const catalog: Reciter[] = require('../../assets/data/catalog.json');
    const result = getNewlyAddedRecitations({reciters: catalog, now: NOW});
    // The bundled catalog may have no `added_at` yet, so an empty array is fine.
    expect(Array.isArray(result)).toBe(true);
    for (const item of result) {
      expect(item.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isInteger(item.surah)).toBe(true);
      expect(item.rewayah.surah_list).toContain(item.surah);
    }
  });

  it('runs on the in-memory RECITERS by default', () => {
    // RECITERS is empty in a unit test, so the result is an empty array.
    expect(getNewlyAddedRecitations()).toEqual([]);
  });
});
