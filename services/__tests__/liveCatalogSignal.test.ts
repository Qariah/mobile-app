// @ai-generated
// Qariah (Sprint 48, S48.6): `services/liveCatalogSignal.ts` tells whether
// the catalog in memory came from the network in this process.
import {getRecitersVersion, markRecitersUpdated} from '@/data/reciterData';
import {
  __resetLiveCatalogSignalForTests,
  isLiveCatalogInMemory,
  markLiveCatalogLoaded,
  subscribeLiveCatalogLoaded,
} from '../liveCatalogSignal';

beforeEach(() => {
  __resetLiveCatalogSignalForTests();
});

describe('liveCatalogSignal', () => {
  it('is false until a network fill', () => {
    markRecitersUpdated(); // a cache or bundled fill
    expect(isLiveCatalogInMemory()).toBe(false);
  });

  it('is true after a network fill, until the next fill of another source', () => {
    markRecitersUpdated(); // the network fill
    markLiveCatalogLoaded();
    expect(isLiveCatalogInMemory()).toBe(true);
    const version = getRecitersVersion();
    markRecitersUpdated(); // a later cache or seed fill
    expect(getRecitersVersion()).toBe(version + 1);
    expect(isLiveCatalogInMemory()).toBe(false);
    markRecitersUpdated();
    markLiveCatalogLoaded();
    expect(isLiveCatalogInMemory()).toBe(true);
  });

  it('calls the subscribers after each network fill, and a throw does not break the fill', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeLiveCatalogLoaded(listener);
    subscribeLiveCatalogLoaded(() => {
      throw new Error('listener');
    });
    expect(() => markLiveCatalogLoaded()).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    markLiveCatalogLoaded();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
