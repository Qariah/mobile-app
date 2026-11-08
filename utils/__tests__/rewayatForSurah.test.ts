import type {Reciter, Rewayat} from '@/data/reciterData';
import {findRewayatForSurah, rewayatHasSurah} from '../rewayatForSurah';

function rewayat(id: string, list: (number | null)[]): Rewayat {
  return {
    id,
    reciter_id: 'r1',
    name: id,
    style: 'murattal',
    server: 's',
    surah_total: list.length,
    surah_list: list,
    source_type: 'r2',
    created_at: 'x',
  };
}

function reciter(rewayatList: Rewayat[]): Reciter {
  return {
    id: 'r1',
    name: 'r1',
    date: null,
    image_url: null,
    rewayat: rewayatList,
  };
}

// Shaped like the catalog case of issue #732: Al-Fatihah (1) is only in the
// last rewayah, not in the first.
const hafs = rewayat('hafs', [61, 62, 114]);
const doori = rewayat('doori', [82]);
const bazzi = rewayat('bazzi', [1]);
const multi = reciter([hafs, doori, bazzi]);

describe('rewayatHasSurah', () => {
  it('reads the surah list', () => {
    expect(rewayatHasSurah(hafs, 61)).toBe(true);
    expect(rewayatHasSurah(hafs, 1)).toBe(false);
  });

  it('skips null entries', () => {
    expect(rewayatHasSurah(rewayat('x', [null, 2]), 2)).toBe(true);
    expect(rewayatHasSurah(rewayat('x', [null, 2]), 1)).toBe(false);
  });

  it('counts a rewayah with no list as complete', () => {
    const noList = {...hafs, surah_list: undefined} as unknown as Rewayat;
    expect(rewayatHasSurah(noList, 1)).toBe(true);
  });

  it('counts a rewayah with an empty list as having no surah', () => {
    // An empty list names no surah, so it has none. Only a MISSING list means
    // all 114, as `getAvailableSurahs` in `utils/track.ts` reads it.
    expect(rewayatHasSurah(rewayat('empty', []), 1)).toBe(false);
  });
});

describe('findRewayatForSurah', () => {
  it('takes the default (first) rewayah when it has the surah', () => {
    expect(findRewayatForSurah(multi, 62)?.id).toBe('hafs');
  });

  it('takes another rewayah when the first lacks the surah', () => {
    expect(findRewayatForSurah(multi, 1)?.id).toBe('bazzi');
    expect(findRewayatForSurah(multi, 82)?.id).toBe('doori');
  });

  it('gives undefined when no rewayah has the surah', () => {
    expect(findRewayatForSurah(multi, 2)).toBeUndefined();
    expect(findRewayatForSurah(reciter([]), 1)).toBeUndefined();
  });

  it('skips a rewayah with an empty list', () => {
    const emptyFirst = reciter([rewayat('empty', []), rewayat('b', [1])]);
    expect(findRewayatForSurah(emptyFirst, 1)?.id).toBe('b');
    expect(
      findRewayatForSurah(reciter([rewayat('empty', [])]), 1),
    ).toBeUndefined();
  });

  it('honours the requested rewayah when it has the surah', () => {
    const both = reciter([rewayat('a', [1, 2]), rewayat('b', [1])]);
    expect(findRewayatForSurah(both, 1, 'b')?.id).toBe('b');
  });

  it('falls back from a requested rewayah that lacks the surah', () => {
    expect(findRewayatForSurah(multi, 1, 'hafs')?.id).toBe('bazzi');
  });

  it('ignores a requested rewayah that the reciter does not have', () => {
    expect(findRewayatForSurah(multi, 61, 'nope')?.id).toBe('hafs');
  });
});
