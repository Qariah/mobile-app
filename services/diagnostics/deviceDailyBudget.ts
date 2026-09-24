// @ai
// services/diagnostics/deviceDailyBudget.ts
// -----------------------------------------
// A small PER-DEVICE, PER-UTC-DAY, PER-KEY emit counter, kept in MMKV.
//
// Generalised from `consumeDailyBudget` in memoryWatch.ts (which stays as it
// is — a separate change owns that file). The same rule applies here:
//
// FAILS CLOSED. If the store cannot be opened, read reliably, or written, the
// caller must NOT emit. An uncapped emitter is what spent the whole Sentry
// error quota for six days in 2026-08 (QARIAHV2-17), so "cannot count" must
// mean "do not emit", never "emit freely". A corrupt record for today starts
// the day fresh, because the next write still records the spend.
//
// Telemetry only. Nothing in this module throws.

import {createMMKV, type MMKV} from 'react-native-mmkv';

// Same 'analytics' store the memory probe uses; the key prefix keeps the two
// apart, so a budget here can never spend the probe's budget.
const KEY_PREFIX = 'daily-budget:';

// Lazy and guarded: MMKV native init throws on the iOS Simulator (no app-group
// container). undefined = not tried yet; null = init failed (fail closed).
let _mmkv: MMKV | null | undefined;
function store(): MMKV | null {
  if (_mmkv !== undefined) return _mmkv;
  try {
    _mmkv = createMMKV({id: 'analytics'});
  } catch {
    _mmkv = null;
  }
  return _mmkv;
}

// A failed write is cached the same way as a failed init. A storage-full device
// then does not repeat read + write on every call. It stays closed until the
// next process start.
let writesBroken = false;

interface DayCount {
  day: string; // UTC YYYY-MM-DD
  count: number;
}

/** UTC, so the reset lines up with Sentry's and PostHog's daily buckets and
 *  never moves with a timezone change or DST. */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Claim one emit for `key` from today's budget of `cap`.
 *
 * Returns true when the caller may emit (the spend is already recorded).
 * Returns false when today's budget is spent, when `cap` is not a positive
 * number, or when the store cannot be used (fail closed).
 */
export function consumeDeviceDailyBudget(
  key: string,
  cap: number,
  now: number = Date.now(),
): boolean {
  try {
    if (!(cap > 0)) return false;
    const mmkv = store();
    if (!mmkv || writesBroken) return false; // fail closed
    const storageKey = KEY_PREFIX + key;
    const today = utcDay(now);
    let raw: string | undefined;
    try {
      raw = mmkv.getString(storageKey);
    } catch {
      return false; // @ai cannot read the count — fail closed, never emit freely
    }
    let used = 0;
    try {
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DayCount> | null;
        // A record for an earlier day resets the budget.
        if (
          parsed &&
          parsed.day === today &&
          typeof parsed.count === 'number' &&
          parsed.count >= 0
        ) {
          used = parsed.count;
        }
      }
    } catch {
      // A corrupt record: start today fresh. The write below still records it.
    }
    if (used >= cap) return false;
    const next: DayCount = {day: today, count: used + 1};
    try {
      mmkv.set(storageKey, JSON.stringify(next));
    } catch {
      writesBroken = true; // cannot record the spend — fail closed, stay closed
      return false;
    }
    return true;
  } catch {
    return false; // any unexpected failure: do not emit
  }
}

/** Test seam — drops the memoised MMKV handle and the broken-write latch. */
export function __resetDeviceDailyBudgetForTests(): void {
  _mmkv = undefined;
  writesBroken = false;
}
