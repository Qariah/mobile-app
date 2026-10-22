// @ai-generated
// Qariah (Sprint 48): the cards of the "Newly Added" Listen row. The plan:
// the recitations of the last 30 days, at least 10 cards, at most 20, and at
// most 3 for each reciter. The cap runs on the FULL dated list, so an older
// recitation of another reciter takes the place of each capped card.
import {
  NEWLY_ADDED_MIN_CARDS,
  NEWLY_ADDED_PER_RECITER,
  NEWLY_ADDED_ROW_LIMIT,
  NEWLY_ADDED_WINDOW_DAYS,
  getNewlyAddedRow,
  newlyAddedRecitationKey,
  selectNewlyAddedRow,
} from '../newlyAddedRow';
import type {NewlyAddedRecitation} from '@/data/reciterCollections';
import type {Reciter, Rewayat} from '@/data/reciterData';

// A fixed "today": 2026-10-20 (UTC). The 30-day cutoff is 2026-09-20.
const NOW = new Date('2026-10-20T12:00:00Z');

/** A reciter with one rewayah; each surah has its own `added_at`. */
function reciter(
  id: string,
  name: string,
  entries: {surah: number; addedAt: string}[],
): Reciter {
  const rewayah: Rewayat = {
    id: `${id}-rw`,
    reciter_id: id,
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: entries.length,
    surah_list: entries.map(s => s.surah),
    source_type: 'test',
    created_at: '2026-01-01',
    surah_metadata: entries.map(s => ({
      surah: s.surah,
      is_full: true,
      added_at: s.addedAt,
    })),
  };
  return {id, name, date: null, image_url: null, rewayat: [rewayah]};
}

/** Surahs `from..to`, all added on `addedAt`. */
function surahs(from: number, to: number, addedAt: string) {
  return Array.from({length: to - from + 1}, (_, i) => ({
    surah: from + i,
    addedAt,
  }));
}

const keys = (list: NewlyAddedRecitation[]) =>
  list.map(newlyAddedRecitationKey);

function countPerReciter(list: NewlyAddedRecitation[]) {
  const counts = new Map<string, number>();
  for (const r of list) {
    counts.set(r.reciter.id, (counts.get(r.reciter.id) ?? 0) + 1);
  }
  return counts;
}

describe('getNewlyAddedRow (with the real getNewlyAddedRecitations)', () => {
  it('uses the plan: 30 days, at least 10 cards, at most 20, at most 3 for each reciter', () => {
    expect(NEWLY_ADDED_WINDOW_DAYS).toBe(30);
    expect(NEWLY_ADDED_MIN_CARDS).toBe(10);
    expect(NEWLY_ADDED_ROW_LIMIT).toBe(20);
    expect(NEWLY_ADDED_PER_RECITER).toBe(3);
  });

  it('fills up to 10 with older recitations of other reciters when one reciter has the 17 newest', () => {
    const reciters = [
      reciter('a', 'Aisha', surahs(1, 17, '2026-10-19')),
      reciter('b', 'Bushra', surahs(1, 2, '2026-08-01')), // outside the window
      reciter('c', 'Fatima', surahs(1, 2, '2026-07-01')),
      reciter('d', 'Huda', surahs(1, 2, '2026-06-01')),
      reciter('e', 'Maryam', surahs(1, 3, '2026-05-01')),
    ];
    const row = getNewlyAddedRow({now: NOW, reciters});
    expect(keys(row)).toEqual([
      'a|a-rw|1',
      'a|a-rw|2',
      'a|a-rw|3',
      'b|b-rw|1',
      'b|b-rw|2',
      'c|c-rw|1',
      'c|c-rw|2',
      'd|d-rw|1',
      'd|d-rw|2',
      'e|e-rw|1',
    ]);
  });

  it('shows 20 cards with the cap when the window holds 30 or more recitations of many reciters', () => {
    // 10 reciters with 3 recitations each, and one with 6: 36 recitations,
    // all inside the window, at different dates.
    const reciters = Array.from({length: 10}, (_, i) =>
      reciter(`r${i}`, `Reciter ${i}`, [
        {surah: 1, addedAt: `2026-10-${String(19 - i).padStart(2, '0')}`},
        {surah: 2, addedAt: `2026-10-${String(19 - i).padStart(2, '0')}`},
        {surah: 3, addedAt: '2026-09-25'},
      ]),
    );
    reciters.push(reciter('big', 'Big', surahs(1, 6, '2026-10-20')));
    const row = getNewlyAddedRow({now: NOW, reciters});
    expect(row).toHaveLength(20);
    expect(Math.max(...countPerReciter(row).values())).toBe(3);
    expect(countPerReciter(row).get('big')).toBe(3);
    const dates = row.map(r => r.addedAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(row.every(r => r.addedAt >= '2026-09-20')).toBe(true);
  });

  it('shows every capped recitation of the window when there are 10 to 20, and no older ones', () => {
    const reciters = [
      reciter('a', 'Aisha', surahs(1, 8, '2026-10-10')), // 3 after the cap
      ...Array.from({length: 9}, (_, i) =>
        reciter(`r${i}`, `Reciter ${i}`, surahs(1, 1, '2026-10-01')),
      ),
      reciter('old', 'Old', surahs(1, 5, '2025-01-01')),
    ];
    const row = getNewlyAddedRow({now: NOW, reciters});
    expect(row).toHaveLength(12);
    expect(row.some(r => r.reciter.id === 'old')).toBe(false);
  });

  it('shows every capped recitation when the catalog has fewer than 10', () => {
    const reciters = [
      reciter('a', 'Aisha', surahs(1, 6, '2025-01-01')),
      reciter('b', 'Bushra', surahs(1, 2, '2024-01-01')),
    ];
    const row = getNewlyAddedRow({now: NOW, reciters});
    expect(keys(row)).toEqual([
      'a|a-rw|1',
      'a|a-rw|2',
      'a|a-rw|3',
      'b|b-rw|1',
      'b|b-rw|2',
    ]);
  });

  it('is empty for an empty catalog or a catalog with no added_at', () => {
    expect(getNewlyAddedRow({now: NOW, reciters: []})).toEqual([]);
    const undated = reciter('a', 'Aisha', []);
    undated.rewayat[0].surah_list = [1, 2];
    expect(getNewlyAddedRow({now: NOW, reciters: [undated]})).toEqual([]);
  });
});

describe('selectNewlyAddedRow', () => {
  function item(reciterId: string, surah: number, addedAt: string) {
    const rewayah = {id: `${reciterId}-rw`} as Rewayat;
    const r = {id: reciterId, name: reciterId, rewayat: [rewayah]};
    return {
      reciter: r as unknown as Reciter,
      rewayah,
      surah,
      addedAt,
    } satisfies NewlyAddedRecitation;
  }

  it('counts the cap across the rewayat of one reciter', () => {
    const otherRewayah = {id: 'a-rw2'} as Rewayat;
    const input = [
      item('a', 1, '2026-10-19'),
      item('a', 2, '2026-10-19'),
      {...item('a', 3, '2026-10-18'), rewayah: otherRewayah},
      item('a', 4, '2026-10-18'), // the fourth card of "a": skipped
      item('b', 1, '2026-10-17'),
    ];
    expect(keys(selectNewlyAddedRow(input, {now: NOW}))).toEqual([
      'a|a-rw|1',
      'a|a-rw|2',
      'a|a-rw2|3',
      'b|b-rw|1',
    ]);
  });

  it('keeps the order of the list it gets', () => {
    const input = [
      item('x', 1, '2026-10-19'),
      item('x', 2, '2026-10-18'),
      item('y', 1, '2026-10-17'),
      item('x', 3, '2026-10-16'),
      item('x', 4, '2026-10-15'), // skipped
      item('z', 1, '2026-10-14'),
    ];
    expect(keys(selectNewlyAddedRow(input, {now: NOW}))).toEqual([
      'x|x-rw|1',
      'x|x-rw|2',
      'y|y-rw|1',
      'x|x-rw|3',
      'z|z-rw|1',
    ]);
  });

  it('gives an empty window for an invalid now, and still fills to the minimum', () => {
    const input = Array.from({length: 15}, (_, i) =>
      item(`r${i}`, 1, '2026-10-19'),
    );
    const row = selectNewlyAddedRow(input, {now: new Date(Number.NaN)});
    expect(row).toHaveLength(10);
  });
});
