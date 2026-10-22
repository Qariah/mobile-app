// @ai-generated
// Qariah (Sprint 48, S48.6): the lazy MMKV instance of the notification engine
// (`notificationsStorage`, MMKV id `qariah-notifications`).
//
// A file of its own, with no top-level import of `../catalogDiff`: a top-level
// import puts the root `__mocks__/react-native-mmkv.js` in Jest's main mock
// registry, and `jest.doMock` in an isolated registry then gets that cached
// mock, not its factory.

const SNAPSHOT_KEY = 'qariah-notif-catalog-snapshot';
describe('notificationsStorage (the MMKV instance)', () => {
  afterEach(() => {
    jest.dontMock('react-native-mmkv');
  });

  it('works through the default MMKV (the Jest in-memory instance)', () => {
    jest.isolateModules(() => {
      const mod: typeof import('../catalogDiff') = require('../catalogDiff');
      expect(mod.notificationsStorage.isAvailable?.()).toBe(true);
      const store = mod.createCatalogSnapshotStore();
      expect(store.save(new Set(['r1|w1|1||']))).toBe(true);
      expect(store.load()).toEqual(new Set(['r1|w1|1||']));
    });
  });

  it('when MMKV throws at creation: not available, silent, and opened only once', () => {
    const createMMKV = jest.fn(() => {
      throw new Error('no App Group container');
    });
    jest.isolateModules(() => {
      jest.doMock('react-native-mmkv', () => ({createMMKV}));
      const mod: typeof import('../catalogDiff') = require('../catalogDiff');
      const storage = mod.notificationsStorage;
      expect(storage.isAvailable?.()).toBe(false);
      expect(storage.getString(SNAPSHOT_KEY)).toBeUndefined();
      expect(() => storage.set(SNAPSHOT_KEY, 'x')).not.toThrow();
      expect(() => storage.remove(SNAPSHOT_KEY)).not.toThrow();

      const store = mod.createCatalogSnapshotStore();
      expect(store.isAvailable()).toBe(false);
      expect(store.save(new Set(['r1|w1|1||']))).toBe(false);
      expect(store.load()).toBeNull();
      expect(createMMKV).toHaveBeenCalledTimes(1);
    });
  });
});
