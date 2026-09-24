// @ai
// services/diagnostics/sentryEventBudget.ts
// -----------------------------------------
// PER-PROCESS, PER-SIGNATURE emit budget for Sentry error events. Runs as the
// last step of the `beforeSend` hook in app/_layout.tsx.
//
// WHY THIS EXISTS: on 2026-08-26 the project's Sentry ERROR quota was exhausted
// and stayed exhausted for six days (through 08-31), during which ZERO error
// events were accepted. Sessions kept ingesting, so every crash-free percentage
// over a window covering those days reads green while the crash instrument is
// dark — the failure is invisible in exactly the dashboard used to judge it.
// It recovered on 09-01 on the monthly quota rollover, not because emission fell.
//
// One handled class caused it: `QARIAHV2-17 onMemoryPressure` was 10,852 events
// from 130 users over 14d — ~84 EACH, 87% of all project volume. A second class
// has since repeated the shape: `QARIAHV2-20` (AsyncStorage out-of-space, #329)
// reached 521 events from 16 users, of which ONE device contributed 394.
//
// THE COMMON SHAPE, and the thing this module caps: a device that enters a retry
// loop re-reports one already-known condition tens or hundreds of times. Copies
// 2..394 carry no information copy 1 did not, and they are paid for out of the
// same quota as the fatals. That is the trade this refuses — real crash
// visibility spent on duplicates of a bug that is already filed.
//
// WHY PER PROCESS, NOT PER EVENT-RATE: a fixed events-per-minute limiter would
// still let a crash-looping device spend all day at the ceiling, and it would
// distort the reach signal (a burst on one device could crowd out the single
// event that proves a second device is affected). Per process per signature
// keeps the answer to "how many DISTINCT users see this" exactly correct: every
// affected device still delivers its first occurrence on every launch, so
// Sentry's distinct-user count is unchanged. 15 affected users still read as 15.
// This follows the precedent already used for persisted-store failures — report
// a given condition once per store per process (services/storage, PR #331) —
// generalised to the SDK chokepoint so it also covers classes nobody has
// instrumented by hand yet.
//
// FATAL IS NEVER LIMITED. Crashes, ANRs and watchdog terminations bypass the
// budget entirely and are never counted against it. This module exists to
// PROTECT that traffic, so it must never be the reason a crash goes unreported.
//
// FREQUENCY IS NOT LOST, IT MOVES. Every suppressed event increments a counter
// that is stamped onto the next event this process DOES deliver, as the
// `suppressed_in_process` tag. So the retry loop stays visible — and it lands on
// the device's eventual crash, which is where "this process suppressed 391
// storage errors before dying" is worth the most. It costs no extra quota.
//
// FAILS OPEN, deliberately, and the opposite way to the memory probe's own daily
// budget. That budget guards ONE known-noisy emitter, so "cannot count" must mean
// "do not emit". This runs over EVERY event including novel crash classes, so an
// event whose shape yields no signature is DELIVERED. A mis-keyed drop here would
// hide the next unknown fatal, which is a worse failure than some extra volume.

import type {ErrorEvent} from '@sentry/react-native';

/**
 * How many events of one signature this process may deliver.
 *
 * 1 = report each distinct condition once per app launch per device. Raise it
 * (here or via EXPO_PUBLIC_SENTRY_EVENT_CAP at publish time) when a class needs
 * repeat samples to diagnose; there is no value that silences a class, because
 * the floor is clamped to 1.
 */
const DEFAULT_CAP = 1;

/** Build-time override, so a noisy investigation can widen the cap without a
 *  code change. Clamped to [1, 50]: 0 would silence classes outright, which is
 *  the one outcome worse than the quota risk this module exists to avoid. */
function resolveCap(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_CAP;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

export const MAX_EVENTS_PER_SIGNATURE_PER_PROCESS = resolveCap(
  process.env.EXPO_PUBLIC_SENTRY_EVENT_CAP,
);

/** Delivered count per signature, for this process only. Never persisted: the
 *  budget is meant to reset on every launch so a returning device re-reports. */
const delivered = new Map<string, number>();
let totalSuppressed = 0;

/** Digits and hex/UUID runs are per-occurrence noise (error codes keep their
 *  meaning, but file names, addresses and ids do not group). Collapsing them is
 *  what makes 394 copies from one device share a signature. */
function normalize(text: string): string {
  return text
    .replace(/[0-9a-f]{8,}/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .slice(0, 120);
}

function messageText(event: ErrorEvent): string | undefined {
  const m: unknown = event.message;
  if (typeof m === 'string' && m.length > 0) return m;
  if (m != null && typeof m === 'object') {
    const formatted = (m as {formatted?: unknown}).formatted;
    if (typeof formatted === 'string' && formatted.length > 0) return formatted;
    const raw = (m as {message?: unknown}).message;
    if (typeof raw === 'string' && raw.length > 0) return raw;
  }
  return undefined;
}

/**
 * A stable per-condition key, chosen to track how Sentry itself groups issues so
 * the cap never merges two classes into one (which would hide the quieter one).
 *
 * Returns null when the event carries nothing groupable — see "fails open".
 */
export function eventSignature(event: ErrorEvent): string | null {
  // An explicit fingerprint is the app stating what the condition IS; honour it
  // over anything inferred. Both the qf-best-effort-sync collapse in
  // app/_layout.tsx and the persist-* captures set one.
  const fp = event.fingerprint;
  if (Array.isArray(fp) && fp.length > 0) {
    // The persist-* captures share ONE fingerprint across all 17 stores (one
    // Sentry issue) and name the store in a `store` tag. Each store already
    // reports once per process at source, so key on the store as well:
    // otherwise the first store to fail spends the budget and the other 16
    // never say that they lost data.
    const store = event.tags?.store;
    return typeof store === 'string' && store.length > 0
      ? `fp:${fp.join('|')}|store:${store}`
      : `fp:${fp.join('|')}`;
  }

  const ex = event.exception?.values?.[0];
  if (ex) {
    const frames = ex.stacktrace?.frames;
    const top =
      frames && frames.length > 0 ? frames[frames.length - 1] : undefined;
    const where = top
      ? `${top.module ?? top.filename ?? ''}:${top.function ?? ''}`
      : '';
    const what = typeof ex.value === 'string' ? normalize(ex.value) : '';
    const key = `ex:${ex.type ?? ''}|${where}|${what}`;
    // Guard against an exception entry so empty it would key everything alike.
    if (key !== 'ex:||') return key;
  }

  const msg = messageText(event);
  if (msg) return `msg:${normalize(msg)}`;

  return null;
}

/**
 * Apply the per-process budget. Returns the event to deliver, or null to drop.
 *
 * Pure with respect to Sentry: it only reads/stamps the event object and this
 * module's counters, so it is safe to call from inside `beforeSend`.
 */
export function applyPerProcessEventBudget(
  event: ErrorEvent,
  cap: number = MAX_EVENTS_PER_SIGNATURE_PER_PROCESS,
): ErrorEvent | null {
  // Crashes are never rate-limited and never consume budget.
  if (event.level === 'fatal') return stamp(event);

  const sig = eventSignature(event);
  if (sig === null) return stamp(event); // fails open — see the header

  const sent = delivered.get(sig) ?? 0;
  if (sent >= cap) {
    totalSuppressed += 1;
    return null;
  }
  delivered.set(sig, sent + 1);
  // Which delivery of this signature this is, mirroring the memory probe's
  // `daily_seq`. Always 1 while the cap is 1; it earns its keep if the cap is
  // ever widened, by showing whether the limit is the binding constraint.
  return stamp(event, sent + 1);
}

/** Attach the process-level suppression state to an outgoing event. */
function stamp(event: ErrorEvent, seq?: number): ErrorEvent {
  const tags: Record<string, unknown> = {...(event.tags ?? {})};
  if (seq !== undefined) tags.process_seq = String(seq);
  // Only when non-zero: a `0` on every healthy event is noise, and its absence
  // already means "nothing was dropped for this process".
  if (totalSuppressed > 0) tags.suppressed_in_process = String(totalSuppressed);
  event.tags = tags as ErrorEvent['tags'];
  return event;
}

/** Test seam — clears this process's budget, standing in for a fresh launch. */
export function __resetEventBudgetForTests(): void {
  delivered.clear();
  totalSuppressed = 0;
}
