// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16 review L2): the "Mushaf restore is done"
// signal that a cold-start notification tap waits for.
import {
  __resetMushafRestoreSignalForTests,
  isMushafRestoreHandled,
  markMushafRestoreHandled,
  whenMushafRestoreHandled,
} from '../mushafRestoreSignal';

beforeEach(() => {
  __resetMushafRestoreSignalForTests();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('mushafRestoreSignal', () => {
  it('resolves true when the restore is marked, at once after that', async () => {
    const waiting = whenMushafRestoreHandled(10_000);
    expect(isMushafRestoreHandled()).toBe(false);
    markMushafRestoreHandled();
    await expect(waiting).resolves.toBe(true);
    await expect(whenMushafRestoreHandled(10_000)).resolves.toBe(true);
  });

  it('resolves false after the time limit (the tap goes on)', async () => {
    const waiting = whenMushafRestoreHandled(1000);
    jest.advanceTimersByTime(1000);
    await expect(waiting).resolves.toBe(false);
  });

  it('marks once', async () => {
    markMushafRestoreHandled();
    markMushafRestoreHandled();
    expect(isMushafRestoreHandled()).toBe(true);
  });
});
