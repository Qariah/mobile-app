// @ai
//
// scripts/lib/triage-lab-gate.mjs
// -------------------------------
// Keeps our own test hardware out of the Sentry triage bot's MESSAGE issues.
//
// WHY
// ---
// `scripts/sentry-triage.mjs` lets a short list of warning-level messages pass
// its level gate (MESSAGE_ALLOWLIST: `deeplink-dropped`, `splash-hide-timeout`,
// `boot-not-completed`, ...). The agent test phone (the lab Pixel 3) runs the
// internal betas with `environment=production`, so it sends those messages in
// bulk. GitHub #646 (Sentry QARIAHV2-3S, `deeplink-dropped`) was filed as high
// severity and `user-impacting`: all 72 of its events came from lab devices
// (71 from the Pixel 3, 1 from the OnePlus 8 Pro). Sprint 48 adds notification-tap
// tests on those devices, so it makes more of them.
//
// THE RULE
// --------
//   - A MESSAGE issue (level below `error`) whose events ALL come from lab
//     devices is skipped: no issue, no label.
//   - A message issue with SOME lab events is filed as before. Sentry's tag
//     API gives no per-device user count, so the issue body carries a
//     "lab devices: n of m events" line instead of a corrected user count.
//   - A crash (`fatal` or `error`) is NEVER gated. A crash on a lab device is
//     still a real crash.
//
// "Lab device" is `isLabDevice()` from ./lab-exclusion.mjs, the one definition
// that the daily card and the engagement report use. The Sentry `device` tag
// carries the same strings as PostHog's `$device_name` ("Pixel 3",
// "OnePlus8Pro"); QARIAHV2-3S showed exactly those two values on 2026-10-20.
//
// UNKNOWN IS NOT LAB. An empty tag, a missing tag, a failed fetch, or events
// that the tag values do not account for (Sentry returns only the top 10 values,
// and an event can lack the tag) all count as NOT lab. A wrong skip hides a real
// user problem. A wrong file only repeats today's behaviour.
//
// Pure functions, except `applyLabGate`, which calls the `fetchDevice` function
// that its caller passes in. The module makes no network call itself.

import {isLabDevice} from './lab-exclusion.mjs';

/** Levels that mean a crash. A crash is never lab-gated. */
export const CRASH_LEVELS = ['fatal', 'error'];

/** A finite number above zero, else 0. Sentry sends some counts as strings. */
const count = x => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * True when the lab gate applies to this issue: an allow-listed MESSAGE signal
 * whose level is below `error`.
 * @param {{level?: string}} issue
 * @param {boolean} allowListed  the issue matches MESSAGE_ALLOWLIST
 */
export const isLabGated = (issue, allowListed) =>
  Boolean(allowListed) && !CRASH_LEVELS.includes(issue?.level);

/**
 * Split a tag breakdown into lab events and all events.
 * @param {Array<{value: string, count: number|string}>} values  tag top values
 * @param {number|string} [total]  every event of the issue, when known. Events
 *   that `values` do not account for count towards the total and never as lab.
 * @returns {{lab: number, total: number}}
 */
export function labShare(values, total) {
  let lab = 0;
  let counted = 0;
  for (const v of Array.isArray(values) ? values : []) {
    const n = count(v?.count);
    counted += n;
    if (n > 0 && isLabDevice(v.value)) lab += n;
  }
  return {lab, total: Math.max(counted, count(total))};
}

/**
 * True only when every known event comes from a lab device.
 * An empty, missing or unreadable breakdown is NOT lab-only.
 * @param {Array<{value: string, count: number|string}>} values
 * @param {number|string} [total]  see labShare
 */
export function labOnly(values, total) {
  const s = labShare(values, total);
  return s.total > 0 && s.lab === s.total;
}

/**
 * Drop the lab-only message issues from a list of fresh issues.
 *
 * @param {object[]} issues  Sentry issues ({shortId, count, level, ...})
 * @param {object} o
 * @param {(issue: object) => boolean} o.gated  true when the gate applies
 * @param {(issue: object) => Promise<{values: Array, total?: number}>} o.fetchDevice
 *   the `device` tag breakdown of the issue. A throw means "unknown".
 * @param {(line: string) => void} [o.log]
 * @returns {Promise<{
 *   kept: object[],
 *   shares: Map<string, {lab: number, total: number}>,
 *   skipped: Array<{shortId: string, total: number}>,
 * }>}  `shares` holds the gated issues that stay and have lab events.
 */
export async function applyLabGate(issues, {gated, fetchDevice, log}) {
  const kept = [];
  const shares = new Map();
  const skipped = [];
  for (const i of issues) {
    if (!gated(i)) {
      kept.push(i);
      continue;
    }
    let share = null;
    try {
      const t = await fetchDevice(i);
      share = labShare(t?.values, Math.max(count(t?.total), count(i.count)));
    } catch {
      // Unknown is not lab: keep the issue and file it as before.
    }
    if (share && share.total > 0 && share.lab === share.total) {
      if (log)
        log(`  · skip ${i.shortId}: lab devices only (${share.total} events)`);
      skipped.push({shortId: i.shortId, total: share.total});
      continue;
    }
    if (share && share.lab > 0) shares.set(i.shortId, share);
    kept.push(i);
  }
  return {kept, shares, skipped};
}
