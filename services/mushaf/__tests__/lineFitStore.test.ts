// @ai Qariah (Lite mode plan, section 7h) — line fits kept across launches.
const mockVersion: {value: unknown} = {
  value: {semanticVersion: '3.2.2', buildNumber: 3780},
};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {extra: {version: mockVersion.value}};
    },
  },
}));
// One native store for each id, as MMKV keeps it across handles. The map is
// created inside the factory: modules call createMMKV while they load.
jest.mock('react-native-mmkv', () => {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    __stores: stores,
    createMMKV: ({id}: {id: string} = {id: 'default'}) => {
      if (!stores.has(id)) stores.set(id, new Map());
      const values = stores.get(id)!;
      return {
        getString: (key: string) => values.get(key),
        getNumber: (key: string) => values.get(key),
        getBoolean: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
        remove: (key: string) => values.delete(key),
        contains: (key: string) => values.has(key),
        getAllKeys: () => [...values.keys()],
        clearAll: () => values.clear(),
        addOnValueChangedListener: () => ({remove: () => undefined}),
      };
    },
  };
});
const fitStore = (): Map<string, unknown> | undefined =>
  (
    jest.requireMock('react-native-mmkv') as {
      __stores: Map<string, Map<string, unknown>>;
    }
  ).__stores.get('mushaf-line-fits');

import {
  readStoredLineFit,
  resetLineFitStoreForTests,
  storeLineFit,
} from '../lineFitStore';
import {
  clearLineFits,
  getLineFit,
  setLineFit,
} from '@/components/mushaf/skia/justifiedSpace';

const KEY = 'DigitalKhattV2|23.4|360|1|240|300|3:jt=1,;|بِسْمِ ٱللَّهِ';

beforeEach(() => {
  fitStore()?.clear();
  mockVersion.value = {semanticVersion: '3.2.2', buildNumber: 3780};
  resetLineFitStoreForTests();
  clearLineFits();
});

it('keeps a fit for the next launch of the same build', () => {
  storeLineFit(KEY, {wordSize: 21.873456, spaceExtra: -0.125});
  resetLineFitStoreForTests(); // a relaunch
  expect(readStoredLineFit(KEY)).toEqual({
    wordSize: 21.873456,
    spaceExtra: -0.125,
  });
  expect(readStoredLineFit(`${KEY}x`)).toBeUndefined();
});

it('starts empty for another build', () => {
  storeLineFit(KEY, {wordSize: 20, spaceExtra: 1});
  mockVersion.value = {semanticVersion: '3.2.2', buildNumber: 3781};
  resetLineFitStoreForTests();
  expect(readStoredLineFit(KEY)).toBeUndefined();
});

it('keeps nothing without a build version', () => {
  mockVersion.value = undefined;
  storeLineFit(KEY, {wordSize: 20, spaceExtra: 1});
  expect(readStoredLineFit(KEY)).toBeUndefined();
  expect(fitStore()?.size ?? 0).toBe(0);
});

it('never stores or serves a value that is not a usable fit', () => {
  storeLineFit(KEY, {wordSize: Number.NaN, spaceExtra: 1});
  expect(readStoredLineFit(KEY)).toBeUndefined();
  storeLineFit(KEY, {wordSize: 0, spaceExtra: 1});
  expect(readStoredLineFit(KEY)).toBeUndefined();
});

it('justifiedSpace serves a stored fit after a relaunch', () => {
  setLineFit(KEY, {wordSize: 22.5, spaceExtra: 0.75});
  clearLineFits(); // the session cache of a new launch is empty
  resetLineFitStoreForTests();
  expect(getLineFit(KEY)).toEqual({wordSize: 22.5, spaceExtra: 0.75});
  expect(getLineFit('another line')).toBeUndefined();
});
