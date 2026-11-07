// @ai-generated
// Qariah (Sprint 51, GitHub #532): the surah-filtered recitation list puts the
// complete recitations first, then the partial ones.
import type {SurahMetadata} from '@/data/reciterData';
import {
  completeRecitationsFirst,
  isPartialRecitation,
} from '@/utils/surahMetadata';

const MULK = 67;

type Row = {key: string; rewaya: {surah_metadata?: SurahMetadata[]}};

function row(key: string, surah_metadata?: SurahMetadata[]): Row {
  return {key, rewaya: {surah_metadata}};
}

const partialMulk: SurahMetadata = {
  surah: MULK,
  is_full: false,
  range: {from: 1, to: 15},
};
const fullMulk: SurahMetadata = {surah: MULK, is_full: true};
const partialOther: SurahMetadata = {
  surah: 2,
  is_full: false,
  range: {from: 1, to: 5},
};

describe('isPartialRecitation', () => {
  it('is false when the rewayah has no surah_metadata', () => {
    expect(isPartialRecitation({}, MULK)).toBe(false);
  });

  it('is false for an explicit complete row', () => {
    expect(isPartialRecitation({surah_metadata: [fullMulk]}, MULK)).toBe(false);
  });

  it('is true for is_full: false on the same surah', () => {
    expect(isPartialRecitation({surah_metadata: [partialMulk]}, MULK)).toBe(
      true,
    );
  });

  it('reads only the entry of the given surah', () => {
    expect(isPartialRecitation({surah_metadata: [partialOther]}, MULK)).toBe(
      false,
    );
  });

  // Bad catalog data must not crash Browse: the check runs for every row.
  it('skips a null entry and still reads the others', () => {
    const surah_metadata = [null, partialMulk] as unknown as SurahMetadata[];
    expect(isPartialRecitation({surah_metadata}, MULK)).toBe(true);
  });

  it('is false when surah_metadata is not an array', () => {
    const surah_metadata = {
      surah: MULK,
      is_full: false,
    } as unknown as SurahMetadata[];
    expect(isPartialRecitation({surah_metadata}, MULK)).toBe(false);
  });
});

describe('completeRecitationsFirst', () => {
  it('puts the complete rows first and keeps the order in each group', () => {
    const rows = [
      row('p1', [partialMulk]),
      row('c1'),
      row('p2', [partialMulk]),
      row('c2', [fullMulk]),
      row('c3', [partialOther]),
      row('p3', [partialOther, partialMulk]),
    ];
    expect(completeRecitationsFirst(rows, MULK).map(r => r.key)).toEqual([
      'c1',
      'c2',
      'c3',
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('keeps the order when every row is complete', () => {
    const rows = [row('a'), row('b', [fullMulk]), row('c')];
    expect(completeRecitationsFirst(rows, MULK).map(r => r.key)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('does not change the input array', () => {
    const rows = [row('p', [partialMulk]), row('c')];
    completeRecitationsFirst(rows, MULK);
    expect(rows.map(r => r.key)).toEqual(['p', 'c']);
  });

  it('returns an empty list for no rows', () => {
    expect(completeRecitationsFirst([], MULK)).toEqual([]);
  });
});
