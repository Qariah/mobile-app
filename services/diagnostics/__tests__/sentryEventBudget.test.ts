/**
 * Guards the per-process, per-signature Sentry emit budget.
 *
 * This is not tidy-up. An uncapped handled class (QARIAHV2-17, 10,852 events
 * from 130 users) exhausted the project's error quota and Sentry accepted ZERO
 * error events for six days, while crash-free percentages stayed green because
 * sessions ingest when errors do not. QARIAHV2-20 (#329) then repeated the
 * shape, with ONE device contributing 394 of 521 events. These tests pin the
 * four properties that make a cap safe to run over every event in the app.
 */

import type {ErrorEvent} from '@sentry/react-native';
import {
  applyPerProcessEventBudget,
  eventSignature,
  __resetEventBudgetForTests,
  MAX_EVENTS_PER_SIGNATURE_PER_PROCESS,
} from '../sentryEventBudget';

/** An AsyncStorage out-of-space rejection in the QARIAHV2-20 shape. The file
 *  name differs per occurrence, which is exactly what normalization absorbs. */
function storageEvent(fileName: string): ErrorEvent {
  return {
    level: 'error',
    exception: {
      values: [
        {
          type: 'Error',
          value:
            `Failed to write value.Error Domain=NSCocoaErrorDomain Code=640 ` +
            `"You can't save the file "${fileName}" because the volume "User" is out of space."`,
          stacktrace: {
            frames: [
              {module: 'native', function: 'map'},
              {
                module: '@react-native-async-storage/async-storage/src/helpers',
                function: 'convertError',
              },
            ],
          },
        },
      ],
    },
  } as ErrorEvent;
}

/** AsyncStorage names its per-key files with an MD5-like hex string — that is
 *  the part that varies between occurrences in the real QARIAHV2-20 events
 *  (`9316fe21d9d219e9adf5c1bfd27fa84d`), alongside the constant `manifest.json`.
 *  Both collapse; an arbitrary alphabetic name would not, and should not. */
function hexName(i: number): string {
  return i.toString(16).padStart(32, '0');
}

function messageEvent(message: string, level = 'warning'): ErrorEvent {
  return {level, message} as unknown as ErrorEvent;
}

beforeEach(() => {
  __resetEventBudgetForTests();
});

describe('per-process event budget', () => {
  it('delivers the default cap of 1 and drops the rest of the same signature', () => {
    expect(MAX_EVENTS_PER_SIGNATURE_PER_PROCESS).toBe(1);

    const first = applyPerProcessEventBudget(storageEvent(hexName(0)));
    expect(first).not.toBeNull();

    // The 2nd..100th copy of an already-reported condition carries nothing new.
    for (let i = 1; i < 100; i++) {
      expect(applyPerProcessEventBudget(storageEvent(hexName(i)))).toBeNull();
    }
  });

  it('keeps a DIFFERENT signature deliverable — the cap must not hide a second class', () => {
    expect(applyPerProcessEventBudget(storageEvent(hexName(1)))).not.toBeNull();
    // A read-permission failure is a different condition from out-of-space, and
    // Sentry files it separately; the budget must not merge the two.
    const readFailure = {
      level: 'error',
      exception: {
        values: [
          {
            type: 'Error',
            value:
              'Failed to read storage file.Error Domain=NSCocoaErrorDomain Code=257 ' +
              '"The file could not be opened because you do not have permission to view it."',
            stacktrace: {
              frames: [
                {
                  module:
                    '@react-native-async-storage/async-storage/src/helpers',
                  function: 'convertError',
                },
              ],
            },
          },
        ],
      },
    } as ErrorEvent;
    expect(applyPerProcessEventBudget(readFailure)).not.toBeNull();
    expect(
      applyPerProcessEventBudget(messageEvent('memory-pressure')),
    ).not.toBeNull();
  });

  it('NEVER limits fatal, however many arrive and however spent the budget is', () => {
    // Spend the budget on this signature first.
    applyPerProcessEventBudget(messageEvent('boom', 'error'));
    expect(
      applyPerProcessEventBudget(messageEvent('boom', 'error')),
    ).toBeNull();

    // The identical signature at fatal still gets through, every time.
    for (let i = 0; i < 50; i++) {
      expect(
        applyPerProcessEventBudget(messageEvent('boom', 'fatal')),
      ).not.toBeNull();
    }
  });

  it('delivers again in a fresh process', () => {
    expect(applyPerProcessEventBudget(storageEvent(hexName(1)))).not.toBeNull();
    expect(applyPerProcessEventBudget(storageEvent(hexName(2)))).toBeNull();

    __resetEventBudgetForTests(); // stands in for the next app launch
    expect(applyPerProcessEventBudget(storageEvent(hexName(3)))).not.toBeNull();
  });

  it('preserves the distinct-USER count: every device still reports on every launch', () => {
    // 15 devices each hitting the condition 35 times, as QARIAHV2-20 did.
    let deliveredPerDevice = 0;
    for (let device = 0; device < 15; device++) {
      __resetEventBudgetForTests(); // a different device = a different process
      let deliveredHere = 0;
      for (let i = 0; i < 35; i++) {
        if (applyPerProcessEventBudget(storageEvent(hexName(i))) !== null) {
          deliveredHere++;
        }
      }
      expect(deliveredHere).toBe(1);
      deliveredPerDevice += deliveredHere;
    }
    // 525 events collapse to 15 — one per device, so 15 users still read as 15.
    expect(deliveredPerDevice).toBe(15);
  });

  it('moves the frequency signal onto the next delivered event instead of losing it', () => {
    applyPerProcessEventBudget(storageEvent(hexName(0))); // delivered, seq 1
    for (let i = 1; i <= 391; i++) {
      applyPerProcessEventBudget(storageEvent(hexName(i)));
    }

    // The device's eventual crash carries what the loop cost.
    const crash = applyPerProcessEventBudget(
      messageEvent('WatchdogTermination', 'fatal'),
    );
    expect(crash?.tags?.suppressed_in_process).toBe('391');
  });

  it('stamps the delivery sequence, and adds no suppression tag when nothing was dropped', () => {
    const ev = applyPerProcessEventBudget(storageEvent(hexName(1)));
    expect(ev?.tags?.process_seq).toBe('1');
    expect(ev?.tags?.suppressed_in_process).toBeUndefined();
  });

  it('preserves tags the earlier beforeSend filters already set', () => {
    const ev = applyPerProcessEventBudget({
      level: 'warning',
      message: 'memory-pressure',
      tags: {scope: 'memory-probe', source: 'trim'},
    } as unknown as ErrorEvent);
    expect(ev?.tags?.scope).toBe('memory-probe');
    expect(ev?.tags?.source).toBe('trim');
  });

  it('honours an explicit fingerprint as the budget key', () => {
    const a = {
      level: 'error',
      message: 'one thing',
      fingerprint: ['qf-best-effort-sync'],
    } as unknown as ErrorEvent;
    const b = {
      level: 'error',
      message: 'a completely different message',
      fingerprint: ['qf-best-effort-sync'],
    } as unknown as ErrorEvent;
    expect(applyPerProcessEventBudget(a)).not.toBeNull();
    expect(applyPerProcessEventBudget(b)).toBeNull();
  });

  it('FAILS OPEN on an event with nothing groupable', () => {
    // The memory probe's own daily budget fails CLOSED, because it guards one
    // known-noisy emitter. This runs over every class including novel crashes,
    // so an unrecognised shape must be delivered, not dropped.
    for (let i = 0; i < 5; i++) {
      expect(
        applyPerProcessEventBudget({level: 'error'} as ErrorEvent),
      ).not.toBeNull();
    }
  });

  it('respects an explicit wider cap', () => {
    expect(
      applyPerProcessEventBudget(storageEvent(hexName(1)), 3),
    ).not.toBeNull();
    expect(
      applyPerProcessEventBudget(storageEvent(hexName(2)), 3),
    ).not.toBeNull();
    const third = applyPerProcessEventBudget(storageEvent(hexName(3)), 3);
    expect(third?.tags?.process_seq).toBe('3');
    expect(applyPerProcessEventBudget(storageEvent(hexName(4)), 3)).toBeNull();
  });
});

describe('eventSignature', () => {
  it('collapses per-occurrence file names and error codes into one key', () => {
    expect(
      eventSignature(storageEvent('9316fe21d9d219e9adf5c1bfd27fa84d')),
    ).toBe(eventSignature(storageEvent('0be4c1aa77bb41f0a9e3d2c5e6f70811')));
  });

  it('does not collapse two genuinely different conditions', () => {
    expect(eventSignature(messageEvent('memory-pressure'))).not.toBe(
      eventSignature(messageEvent('persist-write-failed')),
    );
  });

  it('returns null when there is nothing to group on', () => {
    expect(eventSignature({level: 'error'} as ErrorEvent)).toBeNull();
  });
});

describe('persist-* captures (one fingerprint, one store tag)', () => {
  function persistEvent(store: string): ErrorEvent {
    return {
      level: 'warning',
      message: 'persist-write-failed',
      fingerprint: ['persist-write-failed'],
      tags: {scope: 'persist', store},
    } as unknown as ErrorEvent;
  }

  it('delivers one report per store, not one for all 17 stores', () => {
    // A full volume fails every store in the same moment. Sentry must still
    // learn WHICH stores lost writes (hydrationGuardedStorage latches per store).
    expect(applyPerProcessEventBudget(persistEvent('loved'))).not.toBeNull();
    expect(
      applyPerProcessEventBudget(persistEvent('favoriteReciters')),
    ).not.toBeNull();
    expect(applyPerProcessEventBudget(persistEvent('loved'))).toBeNull();
  });

  it('keys a fingerprinted event without a store tag on the fingerprint alone', () => {
    const e = {
      level: 'warning',
      message: 'qf-best-effort-sync',
      fingerprint: ['qf-best-effort-sync'],
    } as unknown as ErrorEvent;
    expect(eventSignature(e)).toBe('fp:qf-best-effort-sync');
    expect(eventSignature(persistEvent('loved'))).toBe(
      'fp:persist-write-failed|store:loved',
    );
  });
});
