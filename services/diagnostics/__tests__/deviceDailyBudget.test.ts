// @ai
/**
 * Guards the per-device, per-UTC-day emit budget. It fails CLOSED: when it
 * cannot count, the caller must not emit.
 */

const mockStorage = new Map<string, string>();
let mockInitThrows = false;
let mockSetThrows = false;
let mockGetThrows = false;
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    if (mockInitThrows) throw new Error('no app-group container');
    return {
      getString: (k: string) => {
        if (mockGetThrows) throw new Error('read failed');
        return mockStorage.get(k);
      },
      set: (k: string, v: string) => {
        if (mockSetThrows) throw new Error('disk full');
        mockStorage.set(k, v);
      },
    };
  },
}));

import {
  consumeDeviceDailyBudget,
  __resetDeviceDailyBudgetForTests,
} from '../deviceDailyBudget';

const DAY1 = Date.UTC(2026, 8, 13, 10, 0, 0);
const DAY2 = Date.UTC(2026, 8, 14, 0, 0, 1);

describe('consumeDeviceDailyBudget', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockInitThrows = false;
    mockSetThrows = false;
    mockGetThrows = false;
    __resetDeviceDailyBudgetForTests();
  });

  it('allows up to the cap, then refuses', () => {
    expect(consumeDeviceDailyBudget('k', 2, DAY1)).toBe(true);
    expect(consumeDeviceDailyBudget('k', 2, DAY1)).toBe(true);
    expect(consumeDeviceDailyBudget('k', 2, DAY1)).toBe(false);
  });

  it('keeps separate counts for separate keys', () => {
    expect(consumeDeviceDailyBudget('a', 1, DAY1)).toBe(true);
    expect(consumeDeviceDailyBudget('a', 1, DAY1)).toBe(false);
    expect(consumeDeviceDailyBudget('b', 1, DAY1)).toBe(true);
  });

  it('resets on a new UTC day', () => {
    expect(consumeDeviceDailyBudget('k', 1, DAY1)).toBe(true);
    expect(consumeDeviceDailyBudget('k', 1, DAY1)).toBe(false);
    expect(consumeDeviceDailyBudget('k', 1, DAY2)).toBe(true);
  });

  it('refuses a cap of zero or less', () => {
    expect(consumeDeviceDailyBudget('k', 0, DAY1)).toBe(false);
    expect(consumeDeviceDailyBudget('k', -1, DAY1)).toBe(false);
  });

  it('fails closed when the store cannot be opened', () => {
    mockInitThrows = true;
    expect(consumeDeviceDailyBudget('k', 5, DAY1)).toBe(false);
  });

  it('fails closed when the spend cannot be written, and stays closed', () => {
    mockSetThrows = true;
    expect(consumeDeviceDailyBudget('k', 5, DAY1)).toBe(false);
    mockSetThrows = false;
    expect(consumeDeviceDailyBudget('k', 5, DAY1)).toBe(false);
  });

  it('starts the day fresh on a corrupt record, and still records the spend', () => {
    mockStorage.set('daily-budget:k', '{not json');
    expect(consumeDeviceDailyBudget('k', 1, DAY1)).toBe(true);
    expect(consumeDeviceDailyBudget('k', 1, DAY1)).toBe(false);
  });

  it('fails closed, and never throws, when the read throws', () => {
    mockGetThrows = true;
    expect(() => consumeDeviceDailyBudget('k', 1, DAY1)).not.toThrow();
    expect(consumeDeviceDailyBudget('k', 1, DAY1)).toBe(false);
    expect(mockStorage.has('daily-budget:k')).toBe(false);
  });
});
