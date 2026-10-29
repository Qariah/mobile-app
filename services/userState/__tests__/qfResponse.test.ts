// @ai
// SEM-S9 (divergence batch C3): the shared QF list unwrap keeps the
// `r.a ?? r.b ?? []` order of the copies that it replaced.
import {unwrapQfList} from '../qfResponse';

describe('unwrapQfList', () => {
  it('returns an array response as it is', () => {
    const list = [{id: 1}];
    expect(unwrapQfList(list, ['data'])).toBe(list);
  });

  it('returns the first key that is not null or undefined', () => {
    expect(unwrapQfList({notes: [1], data: [2]}, ['notes', 'data'])).toEqual([
      1,
    ]);
    expect(unwrapQfList({notes: null, data: [2]}, ['notes', 'data'])).toEqual([
      2,
    ]);
    // An empty array is not nullish, so it wins, as `??` does.
    expect(unwrapQfList({data: [], posts: [3]}, ['data', 'posts'])).toEqual([]);
  });

  it('returns an empty array for an unknown shape', () => {
    expect(unwrapQfList({other: [1]}, ['data'])).toEqual([]);
    expect(unwrapQfList(null, ['data'])).toEqual([]);
    expect(unwrapQfList('text', ['data'])).toEqual([]);
  });
});
