// @ai-generated
// Qariah (#847, option C): the cards of the "Follow Along" Listen row.
import type {Reciter, Rewayat} from '@/data/reciterData';
import type {SurahCoverage} from '@/utils/followAlongCoverage';
import {
  FOLLOW_ALONG_MIN_QARIAHS,
  FOLLOW_ALONG_ROW_LIMIT,
  followAlongRecitationKey,
  seededShuffle,
  selectFollowAlongRecitations,
} from '../followAlongRow';

/** A rule from a table: rewayah id -> the surahs with timings. */
function coverage(table: Record<string, number[]>): SurahCoverage {
  return (id, surah) => table[id]?.includes(surah) ?? false;
}

function rewayah(
  id: string,
  surahs: number[],
  partial: Record<number, {from: number; to: number}> = {},
): Rewayat {
  return {
    id,
    reciter_id: id,
    name: "Hafs A'n Assem",
    style: 'murattal',
    server: 'https://example.invalid/audio',
    surah_total: surahs.length,
    surah_list: surahs,
    source_type: 'test',
    created_at: '2026-01-01',
    surah_metadata: Object.entries(partial).map(([surah, range]) => ({
      surah: Number(surah),
      is_full: false,
      range,
    })),
  };
}

function qariah(id: string, ...rewayat: Rewayat[]): Reciter {
  return {id, name: id, date: null, image_url: null, rewayat};
}

const wardatun = qariah(
  'wardatun',
  rewayah('rw-wardatun', [1, 3, 36, 50, 70], {3: {from: 1, to: 20}}),
);
const anwar = qariah(
  'anwar',
  rewayah('rw-anwar', [1, 2, 50], {2: {from: 1, to: 5}}),
);
const zaynab = qariah('zaynab', rewayah('rw-zaynab', [67, 114]));
const maria = qariah('maria', rewayah('rw-maria', [18, 55]));
const muna = qariah('muna', rewayah('rw-muna', [46]));

const CATALOG = [wardatun, anwar, zaynab, maria, muna];

describe('selectFollowAlongRecitations', () => {
  it('has no card while fewer than 3 qariahs have follow-along', () => {
    expect(FOLLOW_ALONG_MIN_QARIAHS).toBe(3);
    const two = coverage({'rw-wardatun': [36, 70], 'rw-anwar': [50]});
    expect(selectFollowAlongRecitations(two, {reciters: CATALOG})).toEqual([]);
  });

  it('counts qariahs, not surahs: many surahs of 2 qariahs give no card', () => {
    const many = coverage({
      'rw-wardatun': [1, 36, 50, 70],
      'rw-zaynab': [67, 114],
    });
    expect(selectFollowAlongRecitations(many, {reciters: CATALOG})).toEqual([]);
  });

  it('shows the row from 3 qariahs on, one card for each qariah', () => {
    const three = coverage({
      'rw-wardatun': [36, 70],
      'rw-anwar': [50],
      'rw-zaynab': [67, 114],
    });
    const cards = selectFollowAlongRecitations(three, {reciters: CATALOG});
    expect(cards.map(c => c.reciter.id)).toEqual([
      'wardatun',
      'anwar',
      'zaynab',
    ]);
  });

  it('keeps the catalog order with no seed, and the first covered surah of each qariah', () => {
    const covers = coverage({
      'rw-wardatun': [70, 36],
      'rw-anwar': [50],
      'rw-zaynab': [114, 67],
      'rw-maria': [55],
    });
    const cards = selectFollowAlongRecitations(covers, {reciters: CATALOG});
    expect(cards.map(followAlongRecitationKey)).toEqual([
      'wardatun|rw-wardatun|36',
      'anwar|rw-anwar|50',
      'zaynab|rw-zaynab|67',
      'maria|rw-maria|55',
    ]);
  });

  it('lists only the surahs with timings, never another surah of the qariah', () => {
    const covers = coverage({
      'rw-wardatun': [70],
      'rw-anwar': [50],
      'rw-zaynab': [114],
      'rw-maria': [55],
      'rw-muna': [46],
    });
    for (let seed = 0; seed < 50; seed++) {
      for (const card of selectFollowAlongRecitations(covers, {
        reciters: CATALOG,
        seed,
      })) {
        expect(covers(card.rewayah.id, card.surah)).toBe(true);
      }
    }
  });

  it('leaves out a surah with timings that the rewayah does not list', () => {
    const covers = coverage({
      'rw-wardatun': [99],
      'rw-anwar': [50],
      'rw-zaynab': [67],
      'rw-maria': [55],
    });
    const cards = selectFollowAlongRecitations(covers, {reciters: CATALOG});
    expect(cards.map(c => c.reciter.id)).toEqual(['anwar', 'zaynab', 'maria']);
  });

  it('prefers a complete recitation to a partial one, and keeps the range of a partial one', () => {
    const covers = coverage({
      'rw-wardatun': [3, 36], // 3 is partial, 36 is complete
      'rw-anwar': [2], // only a partial one
      'rw-zaynab': [67],
    });
    for (const seed of [undefined, 1, 2, 3, 99]) {
      const cards = selectFollowAlongRecitations(covers, {
        reciters: CATALOG,
        seed,
      });
      const byQariah = new Map(cards.map(c => [c.reciter.id, c]));
      expect(byQariah.get('wardatun')?.surah).toBe(36);
      expect(byQariah.get('wardatun')?.range).toBeUndefined();
      expect(byQariah.get('anwar')?.surah).toBe(2);
      expect(byQariah.get('anwar')?.range).toEqual({from: 1, to: 5});
    }
  });

  it('shuffles with the session seed: the same seed gives the same row', () => {
    const covers = coverage({
      'rw-wardatun': [1, 36, 70],
      'rw-anwar': [1, 50],
      'rw-zaynab': [67, 114],
      'rw-maria': [18, 55],
      'rw-muna': [46],
    });
    const a = selectFollowAlongRecitations(covers, {
      reciters: CATALOG,
      seed: 7,
    });
    const b = selectFollowAlongRecitations(covers, {
      reciters: CATALOG,
      seed: 7,
    });
    expect(a.map(followAlongRecitationKey)).toEqual(
      b.map(followAlongRecitationKey),
    );
    // Still one card for each qariah.
    expect(new Set(a.map(c => c.reciter.id)).size).toBe(5);
    expect(a).toHaveLength(5);
    // Some seed gives another order than the catalog order.
    const orders = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map(seed =>
        selectFollowAlongRecitations(covers, {reciters: CATALOG, seed})
          .map(c => c.reciter.id)
          .join(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('has at most 10 cards', () => {
    expect(FOLLOW_ALONG_ROW_LIMIT).toBe(10);
    const many = Array.from({length: 14}, (_, i) =>
      qariah(`q${i}`, rewayah(`rw-q${i}`, [1])),
    );
    const covers: SurahCoverage = () => true;
    expect(selectFollowAlongRecitations(covers, {reciters: many})).toHaveLength(
      10,
    );
    expect(
      selectFollowAlongRecitations(covers, {reciters: many, seed: 3}),
    ).toHaveLength(10);
  });

  it('takes one card for a qariah with two rewayat', () => {
    const twoRewayat = qariah(
      'two',
      rewayah('rw-two-a', [1]),
      rewayah('rw-two-b', [2]),
    );
    const covers = coverage({
      'rw-two-a': [1],
      'rw-two-b': [2],
      'rw-anwar': [50],
      'rw-zaynab': [67],
    });
    const cards = selectFollowAlongRecitations(covers, {
      reciters: [twoRewayat, anwar, zaynab],
    });
    expect(cards.map(followAlongRecitationKey)).toEqual([
      'two|rw-two-a|1',
      'anwar|rw-anwar|50',
      'zaynab|rw-zaynab|67',
    ]);
  });

  it('skips bad catalog rows', () => {
    const covers: SurahCoverage = () => true;
    const bad = [
      null,
      {id: 5},
      qariah('ok-1', rewayah('rw-1', [1])),
      {...qariah('no-rewayat', rewayah('x', [1])), rewayat: undefined},
      qariah('ok-2', rewayah('rw-2', [1])),
      qariah('ok-3', rewayah('rw-3', [1])),
    ] as unknown as Reciter[];
    expect(
      selectFollowAlongRecitations(covers, {reciters: bad}).map(
        c => c.reciter.id,
      ),
    ).toEqual(['ok-1', 'ok-2', 'ok-3']);
  });
});

describe('seededShuffle', () => {
  it('is the generator of the Listen tab: a fixed seed gives a fixed order', () => {
    expect(seededShuffle([1, 2, 3, 4, 5], 42)).toEqual(
      seededShuffle([1, 2, 3, 4, 5], 42),
    );
    expect([...seededShuffle([1, 2, 3, 4, 5], 42)].sort()).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});
