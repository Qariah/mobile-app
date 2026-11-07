// @ai Qariah (GitHub #557): the surah that plays when the queue ends.
import {isSurahRun, nextSurahId} from '../nextSurah';

describe('nextSurahId (#557)', () => {
  it('gives the next surah when the rewayah has it', () => {
    expect(nextSurahId(78, [77, 78, 79, 80])).toBe(79);
  });

  it('skips the surahs that the rewayah does not have', () => {
    expect(nextSurahId(1, [1, 18, 36, 67])).toBe(18);
  });

  it('gives null after the rewayah last surah', () => {
    expect(nextSurahId(114, [1, 112, 113, 114])).toBeNull();
    expect(nextSurahId(67, [1, 18, 36, 67])).toBeNull();
  });

  it('gives null when the list is empty', () => {
    expect(nextSurahId(1, [])).toBeNull();
  });

  it('does not depend on the order of the list, and ignores null entries', () => {
    expect(nextSurahId(2, [114, null, 5, 3, 1])).toBe(3);
  });

  it('skips the surahs that the queue already holds', () => {
    expect(nextSurahId(2, [1, 2, 3, 4, 5], new Set([3, 4]))).toBe(5);
  });

  it('gives null when the queue holds every later surah (a queue that wrapped)', () => {
    // The reciter profile queued 78..114 then 1..77; 77 ended.
    const all = Array.from({length: 114}, (_, i) => i + 1);
    expect(nextSurahId(77, all, new Set(all))).toBeNull();
  });

  it('continues after a surah that is not in the list', () => {
    // A surah played from another source; the next one that the rewayah has.
    expect(nextSurahId(10, [1, 12, 20])).toBe(12);
  });
});

describe('isSurahRun (#557, PR #700 review)', () => {
  const all = Array.from({length: 114}, (_, i) => i + 1);

  it('a single surah is a run', () => {
    expect(isSurahRun([36], all)).toBe(true);
  });

  it('consecutive surahs of the rewayah are a run, across surahs it does not have', () => {
    expect(isSurahRun([1, 18, 36], [1, 18, 36, 67])).toBe(true);
  });

  it('the reciter profile queue (78 to 114, then 1 to 77) is a run', () => {
    const queue = [...all.slice(77), ...all.slice(0, 77)];
    expect(isSurahRun(queue, all)).toBe(true);
  });

  it('a playlist of one reciter (36, 55, 56, 67) is not a run', () => {
    expect(isSurahRun([36, 55, 56, 67], all)).toBe(false);
  });

  it('a sorted (descending) list and a repeated surah are not runs', () => {
    expect(isSurahRun([3, 2, 1], all)).toBe(false);
    expect(isSurahRun([2, 2], all)).toBe(false);
  });
});
