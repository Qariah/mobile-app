// @ai-generated
// Qariah (Sprint 48): the catalog refill signal. `markRecitersUpdated` bumps
// the version and calls each subscriber; `useRecitersVersion` reads it.
import {
  getRecitersVersion,
  markRecitersUpdated,
  subscribeRecitersUpdated,
} from '../reciterData';

describe('subscribeRecitersUpdated', () => {
  it('calls a subscriber on each refill, after the version changed, until it unsubscribes', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeRecitersUpdated(() =>
      seen.push(getRecitersVersion()),
    );
    const start = getRecitersVersion();
    markRecitersUpdated();
    markRecitersUpdated();
    expect(seen).toEqual([start + 1, start + 2]);

    unsubscribe();
    markRecitersUpdated();
    expect(seen).toHaveLength(2);
    expect(getRecitersVersion()).toBe(start + 3);
  });

  it('lets a subscriber unsubscribe while the subscribers are called', () => {
    const calls: string[] = [];
    const unsubscribeA = subscribeRecitersUpdated(() => {
      calls.push('a');
      unsubscribeA();
    });
    const unsubscribeB = subscribeRecitersUpdated(() => calls.push('b'));
    markRecitersUpdated();
    markRecitersUpdated();
    expect(calls).toEqual(['a', 'b', 'b']);
    unsubscribeB();
  });
});
