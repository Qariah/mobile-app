/**
 * NON-PEOPLE — the one definition of "this event is our own traffic, not a user".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The production PostHog project carries Qariah's own traffic: boot-gate
 * hardware, CI emulators and dev simulators. It is roughly 13% of all 3.2.0
 * users. `daily-card.mjs` excluded it correctly. `rollout-engagement.mjs`
 * excluded NOTHING and carried a prose caveat telling the reader to do the
 * exclusion by hand — which nobody can do against a rendered percentage.
 *
 * The cost, measured on 2026-09-18: rollout-engagement raised three alerts, and
 * all three were its own CI. Build 1901 read "LOW ACTIVATION — 12% of 25 matured
 * users" when those 25 users were 16 iOS simulators, 6 Android emulators and 3
 * OnePlus 8 Pro — zero real users. Builds 1769 and 1930 raised ZERO-VALUE COHORT
 * on cohorts that were 11-of-13 and 16-of-18 lab. A reader who believed the tool
 * would have gone looking for a product failure in automation exiting after
 * onboarding.
 *
 * TWO CLASSES, AND MISSING EITHER ONE INVENTS FAILURES
 * ----------------------------------------------------
 *   1. PHYSICAL test hardware — the boot-gate Pixel 3 and OnePlus 8 Pro. The
 *      clean uninstall/reinstall each run mints a fresh person_id every cycle,
 *      so one machine becomes many "users".
 *   2. EMULATORS AND SIMULATORS — sdk_gphone* / Simulator iOS. Dev and CI
 *      machines, and the reason this list is PATTERN-based rather than the two
 *      exact names the rollout config documents.
 *
 * A name match is coarse — someone really can own a Pixel 3. Tagging internal
 * runs with a person property at init is the actual fix (TECH_DEBT #222). Until
 * then, be greedy: under-counting real users is far cheaper than reporting
 * phantom failures.
 *
 * THE THIRD STATE
 * ---------------
 * Excluding lab traffic is necessary but not sufficient. An internal build often
 * has NO organic users at all, and "0% got value" on an empty organic population
 * is not a measurement — it is a division by nothing. Callers must distinguish:
 *
 *   organic > 0, low value  → a real signal. Alert.
 *   organic == 0            → `not measurable`. Never a percentage, never an alert.
 *   lab traffic             → build health (did it launch, did the flow finish,
 *                             did it crash), which `qariah-boot-gate-verify` and
 *                             the `.maestro/` suites answer directly and better
 *                             than any engagement funnel can. Not an engagement
 *                             signal: automation has no intent, so a Maestro flow
 *                             exiting after onboarding is not a product failure.
 *
 * `isLabDevice()` exists for that split — classify rows in JS when you need both
 * lanes as separate populations; use `labExclusionSQL()` in the query when you
 * only want people.
 */

/** Exact `$device_name` values that are always our hardware. */
export const LAB_EXACT = ['Pixel 3', 'OnePlus8Pro'];

/** ILIKE patterns for emulators and simulators (dev + CI machines). */
export const LAB_PATTERNS = ['%sdk_gphone%', '%simulator%', '%emulator%'];

/**
 * Quote a list of values as HogQL string literals.
 * Values reach HogQL as literals even when they come from config, so quote
 * defensively — a stray apostrophe would otherwise break or reshape a query.
 */
export const sqlList = xs =>
  xs.map(x => `'${String(x).replace(/'/g, "''")}'`).join(', ');

/**
 * A HogQL predicate that is TRUE for real people only.
 *
 * A NULL `$device_name` counts as organic: the property is missing on some
 * event shapes, and dropping those rows would under-count real users far more
 * than it removes lab noise.
 */
export const labExclusionSQL = () =>
  `(properties.$device_name IS NULL OR (
      properties.$device_name NOT IN (${sqlList(LAB_EXACT)})
      AND ${LAB_PATTERNS.map(p => `properties.$device_name NOT ILIKE '${p}'`).join(' AND ')}
    ))`;

/**
 * True when a `$device_name` value belongs to our own hardware.
 *
 * This is the JS mirror of `labExclusionSQL()`, and the two MUST agree — the
 * card queries in SQL while rollout-engagement classifies in JS, so a mirror
 * that drifts re-creates the exact split this module exists to end.
 *
 * Both SQL wildcards are honoured. `%` is any run of characters and `_` is
 * ANY SINGLE CHARACTER — the second one is the trap. An earlier mirror stripped
 * `%` and used `String.includes()`, which made `_` a literal underscore and left
 * the SQL side strictly broader: `sdkXgphone64` read as lab in the card and as a
 * real person in rollout-engagement. No such name exists in the data today, and
 * a 500-value comparison against live PostHog found no mismatch — this closes the
 * gap before a device name arrives that opens it.
 */
export const isLabDevice = name => {
  if (name === null || name === undefined) return false;
  const s = String(name);
  if (LAB_EXACT.includes(s)) return true;
  return LAB_PATTERNS.some(p => likeToRegExp(p).test(s));
};

/**
 * Translate a SQL LIKE/ILIKE pattern into an anchored, case-insensitive RegExp.
 * Regex metacharacters in the pattern are escaped first, so only `%` and `_`
 * keep their wildcard meaning — exactly as the SQL engine reads them.
 */
const likeToRegExp = pattern => {
  const body = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  return new RegExp(`^${body}$`, 'i');
};
