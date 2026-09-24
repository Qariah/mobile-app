// @ai
// Unit tests for the #53 boot-hang timeout helper. The device-verifiable half
// of the fix (the splash force-reveal + gate deadline) is exercised on a real
// Android device; this covers the deterministic semantics the device can't:
// that a never-settling init resolves to INIT_TIMED_OUT, that pre-deadline
// behavior is unchanged, and that late rejections don't become unhandled.

import {raceInitTimeout, INIT_TIMED_OUT} from '../initTimeout';

describe('raceInitTimeout (#53 boot-hang guard)', () => {
  it('resolves with the value when the promise settles before the deadline', async () => {
    await expect(raceInitTimeout(Promise.resolve('ok'), 1000)).resolves.toBe(
      'ok',
    );
  });

  it('rejects when the promise rejects before the deadline (error semantics preserved)', async () => {
    await expect(
      raceInitTimeout(Promise.reject(new Error('boom')), 1000),
    ).rejects.toThrow('boom');
  });

  it('resolves with INIT_TIMED_OUT when the promise never settles', async () => {
    const never = new Promise<never>(() => {});
    await expect(raceInitTimeout(never, 50)).resolves.toBe(INIT_TIMED_OUT);
  });

  it('resolves with INIT_TIMED_OUT when the promise settles after the deadline', async () => {
    const slow = new Promise<string>(resolve =>
      setTimeout(() => resolve('late'), 200),
    );
    await expect(raceInitTimeout(slow, 50)).resolves.toBe(INIT_TIMED_OUT);
    // Let the late resolution land — nothing should throw.
    await new Promise(resolve => setTimeout(resolve, 250));
  });

  it('swallows a post-deadline rejection instead of surfacing it unhandled', async () => {
    let rejectLate!: (e: Error) => void;
    const slow = new Promise<string>((_, reject) => {
      rejectLate = reject;
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(raceInitTimeout(slow, 50)).resolves.toBe(INIT_TIMED_OUT);
      rejectLate(new Error('late failure'));
      // Give the unhandled-rejection hook a macrotask to fire if it would.
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a sequential chain of bounded awaits completes even when one wedges (AppInitializer shape)', async () => {
    const order: string[] = [];
    const services = [
      {
        name: 'db',
        init: () => Promise.resolve().then(() => void order.push('db')),
      },
      {name: 'wedged', init: () => new Promise<void>(() => {})},
      {
        name: 'playlist',
        init: () => Promise.resolve().then(() => void order.push('playlist')),
      },
    ];
    for (const s of services) {
      const r = await raceInitTimeout(s.init(), 50);
      if (r === INIT_TIMED_OUT) order.push(`${s.name}:timed-out`);
    }
    expect(order).toEqual(['db', 'wedged:timed-out', 'playlist']);
  });
});
