// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16 review L2): "the cold-start Mushaf restore
// is done".
//
// `app/_layout.tsx` restores the last Mushaf screen at a cold start: it
// pushes `/mushaf`, then sets `mushafRestoreHandled` (also when there is no
// restore, and at its 4-second deadline). A Qariah effect there calls
// `markMushafRestoreHandled()` when that state becomes true. A cold-start
// notification tap waits for it (`whenMushafRestoreHandled`), so the restore
// push cannot land on top of the screen that the tap opens.
//
// No imports: `app/_layout.tsx` loads this module at startup.

let handled = false;
const waiters = new Set<() => void>();

/** The restore is done (or there was none). Once for each process. */
export function markMushafRestoreHandled(): void {
  if (handled) return;
  handled = true;
  const pending = [...waiters];
  waiters.clear();
  pending.forEach(waiter => waiter());
}

export function isMushafRestoreHandled(): boolean {
  return handled;
}

/**
 * Resolves `true` when the restore is done, or `false` after `timeoutMs`
 * (then the caller goes on). Never rejects.
 */
export function whenMushafRestoreHandled(timeoutMs: number): Promise<boolean> {
  if (handled) return Promise.resolve(true);
  return new Promise(resolve => {
    const waiter = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      waiters.delete(waiter);
      resolve(handled);
    }, timeoutMs);
    waiters.add(waiter);
  });
}

/** Tests only. */
export function __resetMushafRestoreSignalForTests(): void {
  handled = false;
  waiters.clear();
}
