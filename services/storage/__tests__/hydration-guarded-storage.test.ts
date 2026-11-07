/**
 * Regression guard for GitHub #457 — a write that arrives while the hydrating
 * read is IN FLIGHT must not be dropped, and must not be reported as the #329
 * data-loss condition.
 *
 * The first cut of the guard had one boolean, so "the read has not come back
 * yet" and "the read failed" were indistinguishable. Production showed what
 * that costs: `persist-write-suppressed` fired 1097 times across 220 users in
 * 24 h while `persist-read-failed` sat at exactly ZERO. Every one of those was
 * the boot race, and every one of them silently dropped a write.
 *
 * Before the fix, "replays a write that arrived while the hydrating read was in
 * flight" FAILED — the value never reached storage at all.
 *
 * The failed-read half is asserted here too, against the same adapter, because
 * the whole point is that the two cases must now diverge: the #329 protection
 * has to survive the fix that makes the benign case stop losing data. The
 * end-to-end destructive case stays in
 * `services/player/store/__tests__/hydration-failure-destructive.test.ts`.
 *
 * @ai Authored with AI assistance.
 */

import {
  createHydrationGuardedStateStorage,
  mergeDeferredWrite,
} from '../hydrationGuardedStorage';

// The Sentry SDK registers a module-level setInterval at import time, which
// keeps the jest worker alive and forces a hard exit.
jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// `burnt` ships untransformed ESM and is outside jest-expo's transform
// allowlist, so the real toast helper (reached via the write-failure notice)
// throws at parse time.
jest.mock('@/utils/toastUtils', () => ({showToast: jest.fn()}));

const Sentry = require('@sentry/react-native');

const KEY = 'test-storage';

/** The on-disk shape zustand's JSON layer produces. */
function blob(state: Record<string, unknown>, version = 0): string {
  return JSON.stringify({state, version});
}

function storedState(disk: Record<string, string>): unknown {
  return JSON.parse(disk[KEY]).state;
}

/**
 * A raw storage whose READ is held open until the test releases it — the boot
 * race, made deterministic. Everything the app does between store creation and
 * that release is what #457 is about.
 */
function gatedStorage(seed?: string) {
  const disk: Record<string, string> = {};
  if (seed !== undefined) disk[KEY] = seed;

  let releaseRead: (() => void) | undefined;
  let rejectRead: ((error: unknown) => void) | undefined;

  const base = {
    getItem: jest.fn(
      (key: string) =>
        new Promise<string | null>((resolve, reject) => {
          // Snapshot at CALL time: AsyncStorage is FIFO, so a read issued
          // before a write returns the pre-write bytes.
          const snapshot = disk[key] ?? null;
          releaseRead = () => resolve(snapshot);
          rejectRead = reject;
        }),
    ),
    setItem: jest.fn(async (key: string, value: string) => {
      disk[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete disk[key];
    }),
  };

  return {
    disk,
    base,
    resolveRead: () => releaseRead?.(),
    failRead: (error: unknown) => rejectRead?.(error),
  };
}

/** Let the read's continuation and any replayed write settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function capturedMessages(): string[] {
  return Sentry.captureMessage.mock.calls.map((call: unknown[]) => call[0]);
}

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // The guard logs in __DEV__ on every deferred or suppressed write; silence it
  // here rather than letting it flood the runner output.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('a write while the hydrating read is in flight', () => {
  it('replays the write once the read resolves, without losing stored keys', async () => {
    // The stored blob predates the field the user is about to set — the
    // ordinary shape after an app update adds one.
    const gate = gatedStorage(blob({favourites: ['alpha', 'beta']}));
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);

    // A pre-hydration write: the store is still at its DEFAULTS plus this one
    // change, which is why it cannot simply be written verbatim.
    await storage.setItem(KEY, blob({favourites: [], lastPlayed: 'surah-2'}));

    // Nothing has touched storage yet. Before the fix this was also true —
    // and stayed true forever.
    expect(gate.base.setItem).not.toHaveBeenCalled();

    gate.resolveRead();
    await read;
    await settle();

    // THE ASSERTION: the stored favourites survive (storage wins, exactly as
    // zustand's merge decides in memory) AND the pre-hydration change is on
    // disk instead of being silently dropped.
    expect(storedState(gate.disk)).toEqual({
      favourites: ['alpha', 'beta'],
      lastPlayed: 'surah-2',
    });
  });

  it('spends no Sentry event on it — an in-flight read is not a failure', async () => {
    const gate = gatedStorage(blob({favourites: ['alpha']}));
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);
    await storage.setItem(KEY, blob({favourites: [], lastPlayed: 'surah-2'}));
    gate.resolveRead();
    await read;
    await settle();

    // 1097 events/day across 220 users, none of them a real failure, is what
    // this line exists to stop.
    expect(capturedMessages()).not.toContain('persist-write-suppressed');
    expect(capturedMessages()).toHaveLength(0);
    // A breadcrumb is enough: it rides along on any event that does fire.
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({category: 'persist', level: 'info'}),
    );
  });

  it('replays verbatim on a fresh install, where the read resolves null', async () => {
    const gate = gatedStorage();
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);
    await storage.setItem(KEY, blob({favourites: ['gamma']}));
    gate.resolveRead();
    await read;
    await settle();

    // Nothing to merge, so nothing to lose — and a first-run user's very first
    // action is exactly the one most likely to race hydration.
    expect(storedState(gate.disk)).toEqual({favourites: ['gamma']});
  });

  it('keeps only the LAST deferred write — each one is a full snapshot', async () => {
    const gate = gatedStorage();
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);
    await storage.setItem(KEY, blob({favourites: ['gamma']}));
    await storage.setItem(KEY, blob({favourites: ['gamma', 'delta']}));
    gate.resolveRead();
    await read;
    await settle();

    expect(gate.base.setItem).toHaveBeenCalledTimes(1);
    expect(storedState(gate.disk)).toEqual({favourites: ['gamma', 'delta']});
  });

  it('writes nothing when the deferred write adds no key storage lacks', async () => {
    // The common case at boot. Storage already holds every key, so zustand's
    // merge discards the pre-hydration change in memory too — writing would
    // only spend boot I/O to store what is already there.
    const gate = gatedStorage(blob({favourites: ['alpha'], lastPlayed: 's1'}));
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);
    await storage.setItem(KEY, blob({favourites: [], lastPlayed: null}));
    gate.resolveRead();
    await read;
    await settle();

    expect(gate.base.setItem).not.toHaveBeenCalled();
    expect(storedState(gate.disk)).toEqual({
      favourites: ['alpha'],
      lastPlayed: 's1',
    });
  });

  it('does not replay across a pending migration', async () => {
    // A version mismatch means zustand is about to run `migrate`, and that is
    // the one path where it re-persists the merged state by itself. A
    // pre-migration snapshot must not be written over a migrating store.
    const gate = gatedStorage(blob({favourites: ['alpha']}, 1));
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);
    await storage.setItem(KEY, blob({favourites: [], extra: 'x'}, 2));
    gate.resolveRead();
    await read;
    await settle();

    expect(gate.base.setItem).not.toHaveBeenCalled();
    expect(gate.disk[KEY]).toBe(blob({favourites: ['alpha']}, 1));
  });

  it('does not replay over an unparseable blob, and the next write still self-heals', async () => {
    const gate = gatedStorage('{not json');
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);
    await storage.setItem(KEY, blob({favourites: ['gamma']}));
    gate.resolveRead();
    await read;
    await settle();

    expect(gate.base.setItem).not.toHaveBeenCalled();

    // The gate is open (the read RESOLVED), so zustand's own self-healing
    // write still lands. Nothing is locked read-only.
    await storage.setItem(KEY, blob({favourites: ['delta']}));
    expect(storedState(gate.disk)).toEqual({favourites: ['delta']});
  });

  it('drops a deferred write when clearStorage runs before the read resolves', async () => {
    const gate = gatedStorage(blob({favourites: ['alpha']}));
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);
    await storage.setItem(KEY, blob({favourites: [], extra: 'x'}));
    await storage.removeItem(KEY);
    gate.resolveRead();
    await read;
    await settle();

    // A deliberate clear must not be undone by a replay landing after it.
    expect(gate.base.setItem).not.toHaveBeenCalled();
    expect(gate.disk[KEY]).toBeUndefined();
  });
});

describe('a write after the hydrating read FAILED (the #329 condition)', () => {
  const readError = Object.assign(
    new Error(
      'Failed to read storage file.Error Domain=NSCocoaErrorDomain Code=257',
    ),
    {code: '257', domain: 'NSCocoaErrorDomain'},
  );

  it('discards the deferred write instead of replaying it', async () => {
    // The held snapshot is the store's DEFAULTS. Replaying it here is
    // precisely the permanent, silent loss #329 was filed about.
    const gate = gatedStorage(blob({favourites: ['alpha', 'beta']}));
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);
    await storage.setItem(KEY, blob({favourites: [], extra: 'x'}));
    gate.failRead(readError);
    await expect(read).rejects.toBe(readError);
    await settle();

    expect(gate.base.setItem).not.toHaveBeenCalled();
    expect(storedState(gate.disk)).toEqual({favourites: ['alpha', 'beta']});
    expect(capturedMessages()).toContain('persist-read-failed');
  });

  it('keeps refusing later writes, and reports that once', async () => {
    const gate = gatedStorage(blob({favourites: ['alpha']}));
    const storage = createHydrationGuardedStateStorage(KEY, gate.base);

    const read = storage.getItem(KEY);
    gate.failRead(readError);
    await expect(read).rejects.toBe(readError);

    await storage.setItem(KEY, blob({favourites: ['gamma']}));
    await storage.setItem(KEY, blob({favourites: ['gamma', 'delta']}));

    expect(gate.base.setItem).not.toHaveBeenCalled();
    expect(storedState(gate.disk)).toEqual({favourites: ['alpha']});
    // Still exactly one event per store per process — and now it means
    // something, because it can only fire after a real read failure.
    expect(
      capturedMessages().filter(m => m === 'persist-write-suppressed'),
    ).toHaveLength(1);
  });
});

describe('mergeDeferredWrite', () => {
  it('lets storage win every key it has, and keeps the rest', () => {
    // This is zustand's own default merge, `{...currentState, ...persisted}`,
    // reproduced on the raw string so the replay can never cost a stored value.
    const merged = mergeDeferredWrite(
      blob({a: 'deferred', b: 'deferred'}),
      blob({a: 'stored'}),
    );

    expect(JSON.parse(merged as string)).toEqual({
      state: {a: 'stored', b: 'deferred'},
      version: 0,
    });
  });

  it('returns null for the cases it cannot prove safe', () => {
    // No replay: already correct on disk.
    expect(mergeDeferredWrite(blob({a: 1}), blob({a: 2}))).toBeNull();
    // No replay: a migration is pending.
    expect(
      mergeDeferredWrite(blob({a: 1, b: 2}, 2), blob({a: 1}, 1)),
    ).toBeNull();
    // No replay: unparseable, or not the shape zustand writes.
    expect(mergeDeferredWrite(blob({a: 1, b: 2}), '{not json')).toBeNull();
    expect(mergeDeferredWrite(blob({a: 1, b: 2}), '[]')).toBeNull();
    expect(
      mergeDeferredWrite(blob({a: 1, b: 2}), JSON.stringify({state: 7})),
    ).toBeNull();
  });

  it('replays verbatim when storage holds nothing', () => {
    expect(mergeDeferredWrite(blob({a: 1}), null)).toBe(blob({a: 1}));
  });
});
