// @ai
/**
 * #217 review — the watchdog record of one process (its build and stall count)
 * must reach the next cold start once, must survive a stall or a death in the
 * new process before it is reported, and must fail closed.
 */

const mockStorage = new Map<string, string>();
let mockInitThrows = false;
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
        mockStorage.set(k, v);
      },
      remove: (k: string) => mockStorage.delete(k),
    };
  },
}));

let mockBuild = '1950';
jest.mock('../debugId', () => ({
  readVersionInfo: () => ({semanticVersion: '3.2.2', buildNumber: mockBuild}),
}));

import {
  persistMainThreadStallCount,
  startMainThreadStallRecord,
  takePreviousProcessStallRecord,
  __resetMainThreadStallCountForTests,
} from '../mainThreadStallCount';

/** A new process: module state resets, stored records stay. */
function newProcess(build?: string): void {
  if (build) mockBuild = build;
  __resetMainThreadStallCountForTests();
}

beforeEach(() => {
  mockStorage.clear();
  mockInitThrows = false;
  mockGetThrows = false;
  newProcess('1950');
});

describe('mainThreadStallCount', () => {
  it('carries the build and the last count of a process to the next process, once', () => {
    startMainThreadStallRecord();
    persistMainThreadStallCount(1);
    persistMainThreadStallCount(3);
    newProcess();
    expect(takePreviousProcessStallRecord()).toEqual({
      build: '1950',
      stalls: 3,
    });
    expect(takePreviousProcessStallRecord()).toBeNull();
  });

  it('reports a process where the watchdog ran with no stall as 0', () => {
    startMainThreadStallRecord();
    newProcess();
    expect(takePreviousProcessStallRecord()).toEqual({
      build: '1950',
      stalls: 0,
    });
  });

  it('returns null when the watchdog did not run in the previous process', () => {
    expect(takePreviousProcessStallRecord()).toBeNull();
  });

  it('reports the old build after an update, not the new one', () => {
    startMainThreadStallRecord();
    persistMainThreadStallCount(2);
    newProcess('1960');
    expect(takePreviousProcessStallRecord()).toEqual({
      build: '1950',
      stalls: 2,
    });
  });

  it('does not let a stall of the new process overwrite the unreported record', () => {
    startMainThreadStallRecord();
    persistMainThreadStallCount(4);
    newProcess();
    // The new process starts the watchdog and stalls before cold_start_began.
    startMainThreadStallRecord();
    persistMainThreadStallCount(1);
    expect(takePreviousProcessStallRecord()).toEqual({
      build: '1950',
      stalls: 4,
    });
    // The new process's own record waits for the process after it.
    newProcess();
    expect(takePreviousProcessStallRecord()).toEqual({
      build: '1950',
      stalls: 1,
    });
  });

  it('keeps the unreported record in storage when the new process dies before it reports', () => {
    startMainThreadStallRecord();
    persistMainThreadStallCount(5);
    newProcess();
    // The new process stalls, then dies before cold_start_began.
    startMainThreadStallRecord();
    persistMainThreadStallCount(1);
    newProcess();
    // The next process still gets a record: the newer one wins.
    expect(takePreviousProcessStallRecord()).toEqual({
      build: '1950',
      stalls: 1,
    });
  });

  it('ignores a corrupt stored record', () => {
    mockStorage.set('diag:main-thread-stalls:current', '{not json');
    expect(takePreviousProcessStallRecord()).toBeNull();
  });

  it('fails closed, and never throws, when the store cannot be opened', () => {
    mockInitThrows = true;
    expect(() => startMainThreadStallRecord()).not.toThrow();
    expect(() => persistMainThreadStallCount(2)).not.toThrow();
    expect(takePreviousProcessStallRecord()).toBeNull();
  });

  it('fails closed, and never throws, when the read throws', () => {
    startMainThreadStallRecord();
    newProcess();
    mockGetThrows = true;
    expect(() => takePreviousProcessStallRecord()).not.toThrow();
    expect(takePreviousProcessStallRecord()).toBeNull();
  });
});
