// @ai-generated
// Qariah (TECH_DEBT #303): data/countryCollections.ts must not open MMKV when
// it is imported. i18n/qariahCatalog.ts loads i18n/language.ts, which runs
// createMMKV() at import time. The country data takes the catalog helper with
// a lazy require() inside getAllCountries(), so only a call opens MMKV.
import type {Reciter} from '@/data/reciterData';

type CountryCollections = typeof import('@/data/countryCollections');
type ReciterData = typeof import('@/data/reciterData');

function reciterIn(country: string | null, id: string): Reciter {
  return {id, name: `Reciter ${id}`, country} as unknown as Reciter;
}

describe('data/countryCollections lazy i18n import', () => {
  afterEach(() => {
    jest.dontMock('react-native-mmkv');
    jest.resetModules();
  });

  it('does not open MMKV when it is imported', () => {
    const createMMKV = jest.fn(() => {
      throw new Error('MMKV was opened at import');
    });
    jest.doMock('react-native-mmkv', () => ({createMMKV}));

    let loaded: CountryCollections | undefined;
    jest.isolateModules(() => {
      expect(() => {
        loaded = require('@/data/countryCollections');
      }).not.toThrow();
    });

    expect(loaded?.getAllCountries).toBeInstanceOf(Function);
    expect(createMMKV).not.toHaveBeenCalled();
  });

  it('opens MMKV on the first call and still returns the country names', () => {
    const createMMKV = jest.fn(
      (config: unknown) =>
        require('react-native-mmkv/lib/createMMKV/createMockMMKV').createMockMMKV(
          config,
        ) as unknown,
    );
    jest.doMock('react-native-mmkv', () => ({createMMKV}));

    jest.isolateModules(() => {
      const {RECITERS} = require('@/data/reciterData') as ReciterData;
      const {getAllCountries} =
        require('@/data/countryCollections') as CountryCollections;
      expect(createMMKV).not.toHaveBeenCalled();

      RECITERS.splice(
        0,
        RECITERS.length,
        reciterIn('Egypt', '1'),
        reciterIn('Saudi Arabia', '2'),
        reciterIn('Egypt', '3'),
        reciterIn(null, '4'),
      );

      expect(
        getAllCountries().map(c => [c.id, c.name, c.reciterCount]),
      ).toEqual([
        ['egypt', 'Egypt', 2],
        ['saudi-arabia', 'Saudi Arabia', 1],
      ]);
      expect(createMMKV).toHaveBeenCalled();
    });
  });
});
