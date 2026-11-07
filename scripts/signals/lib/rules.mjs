// @ai
//
// scripts/signals/lib/rules.mjs
// -----------------------------
// The rules that every snapshot number obeys (planning/signals-phase1-design.md,
// "Rules"). Each section builds its counts with these helpers, so the rules live
// in one place:
//
//   cell(n)              a count of installs, users or devices: 1 to 4 → "<5"
//   eventCell(e, inst)   an event count, suppressed when its installs are 1 to 4
//   rate(num, den)       {num, den, value, lowN}
//   LA calendar          laDate, addDays, dayRange, weekStart, laDaySQL
//   findSmallCells(obj)  the second guard: any 1–4 count left in a finished file
//
// The schema (scripts/signals/schema.mjs) is the first guard: its `cell` type
// accepts only 0, an integer of 5 or more, or "<5".

import {OWNER_TZ} from '../../lib/run-health.mjs';

export {OWNER_TZ};
export const SMALL = '<5';
export const LOW_N_MAX = 29;

/**
 * A count of installs, users or devices. 1 to 4 becomes "<5"; 0 stays 0.
 * null and undefined stay null (the schema decides whether null is allowed).
 */
export function cell(n) {
  if (n === null || n === undefined) return null;
  if (n === SMALL) return SMALL;
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0)
    throw new Error(`cell(): not a count: ${n}`);
  const i = Math.round(v);
  return i >= 1 && i <= 4 ? SMALL : i;
}

/**
 * An event count. It is suppressed when the installs behind it are 1 to 4.
 * An event count of 1 to 4 is also "<5": it always comes from 1 to 4 installs
 * (test plan T-SCH-06), so the schema type `eventCell` rejects 1 to 4 too.
 */
export function eventCell(events, installs) {
  if (events === null || events === undefined) return null;
  if (cell(installs) === SMALL) return SMALL;
  const v = Number(events);
  if (!Number.isFinite(v) || v < 0)
    throw new Error(`eventCell(): not a count: ${events}`);
  return cell(v);
}

const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * A rate with its n. `value` is null when either side is "<5" or den is 0.
 * `lowN` is true when den is 5 to 29.
 */
export function rate(num, den) {
  const n = num === SMALL ? null : Number(num);
  const d = den === SMALL ? null : Number(den);
  const out = {
    num: num === SMALL ? SMALL : cell(n),
    den: den === SMALL ? SMALL : cell(d),
    value: null,
    lowN: d !== null && d >= 5 && d <= LOW_N_MAX,
  };
  if (out.num !== SMALL && out.den !== SMALL && d > 0) out.value = round(n / d);
  return out;
}

// ---------------------------------------------------------------------------
// The LA calendar. Dates are 'YYYY-MM-DD' strings; arithmetic is done on the
// calendar date only (UTC midnight), so a daylight-saving change cannot move it.
// ---------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date in America/Los_Angeles of an instant. */
export function laDate(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OWNER_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

const toUtc = d => {
  if (!ISO.test(d)) throw new Error(`not a YYYY-MM-DD date: ${d}`);
  return Date.parse(`${d}T00:00:00Z`);
};

export function addDays(d, n) {
  return new Date(toUtc(d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Every date from `from` to `to`, both included. */
export function dayRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The Monday of the week that holds d. */
export function weekStart(d) {
  const dow = new Date(toUtc(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

/** HogQL: the LA calendar date of an event. */
export const laDaySQL = (col = 'timestamp') =>
  `toDate(toTimeZone(${col}, '${OWNER_TZ}'))`;

/**
 * HogQL: a predicate for LA days from..to. The UTC bound keeps one day of
 * margin, so the scan stays small and no LA day is cut.
 */
export const laDaysWhere = (from, to, col = 'timestamp') =>
  `${col} >= toDateTime('${addDays(from, -1)} 00:00:00') AND ${col} < toDateTime('${addDays(to, 2)} 00:00:00') ` +
  `AND ${laDaySQL(col)} >= toDate('${from}') AND ${laDaySQL(col)} <= toDate('${to}')`;

// ---------------------------------------------------------------------------
// The ingestion cut-off. PostHog keeps adding events with old timestamps (the
// DAU of 2026-10-17 read 697 at 19:54 UTC the next day and 701 seven hours
// later). So every events query also keeps only the events that PostHog
// received (`created_at`) by `asOf`: 11:00 in Los Angeles on the run date, or
// the run time when that is earlier. 11:00 LA is before the 19:30 UTC run in
// summer and in winter, so a rerun of the same date gives the same numbers.
// ---------------------------------------------------------------------------

export const AS_OF_LA_HOUR = 11;

/** The UTC instant of an LA wall-clock time on an LA date. */
export function laWallToUtc(d, hour = 0) {
  // Try both possible offsets (PDT -7, PST -8) and keep the one that maps back.
  for (const off of [7, 8]) {
    const t = new Date(`${d}T${String(hour + off).padStart(2, '0')}:00:00Z`);
    if (Number.isNaN(t.getTime())) continue;
    if (laDate(t) === d && laHour(t) === hour) return t;
  }
  throw new Error(`laWallToUtc(): no instant for ${d} ${hour}:00`);
}

const laHour = t =>
  Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: OWNER_TZ,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(t),
  );

/** The ingestion cut-off of a run, as an ISO string. */
export function asOfFor(date, now = new Date()) {
  const fixed = laWallToUtc(date, AS_OF_LA_HOUR);
  return (now < fixed ? now : fixed).toISOString();
}

/** HogQL: events that PostHog received by asOf (an ISO string). */
export const asOfSQL = iso =>
  `created_at <= toDateTime('${iso.slice(0, 19).replace('T', ' ')}')`;

// ---------------------------------------------------------------------------
// The second guard. A key that names a count of people must never hold 1 to 4.
// Arrays take the key of the array (`dau: [..]`). Event counts and rates are
// not people counts, so their keys do not match.
// ---------------------------------------------------------------------------

export const COUNT_KEY =
  /(^|_)(installs?|users?|people|listeners|readers|openers|completers|devices|dau|wau|mau|cohort|enrolled|matured|newInstalls|activeUsers)$|(Installs|Users|Devices|People)$/;

/** Paths of every integer 1–4 under a people-count key. */
export function findSmallCells(value, path = '$', key = '') {
  const out = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) =>
      out.push(...findSmallCells(v, `${path}[${i}]`, key)),
    );
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value))
      out.push(...findSmallCells(v, `${path}.${k}`, k));
  } else if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 4 &&
    COUNT_KEY.test(key)
  ) {
    out.push(path);
  }
  return out;
}
