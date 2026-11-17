// @ai
//
// scripts/lib/v1-restore-watch.mjs — the rules of the v1 restore watch
// (TECH_DEBT #137, closed 2026-11-13).
//
// The v1 restore reads a public file named by an email hash. On 2026-11-13 the
// owner accepted that risk while people still use the restore (19 restores in
// the 30 days to 2026-11-13), and asked for a look again when the restores fall
// below RETIRE_BELOW in 30 days. Then the decision is to retire the v1 restore.
//
// A restore is one person with a `v1_restore_merged` event that had v1 data
// (`candidate_total > 0`), the same rule as scripts/signals/sections/restore.mjs
// (`mergesWithCandidates`). Lab devices are excluded.

export const WINDOW_DAYS = 30;
export const RETIRE_BELOW = 5;
// Fewer checks than this in the window means that PostHog has no data (an
// ingestion gap, the event quota), not that nobody restores: file nothing.
export const MIN_CHECKS = 50;
export const RETIRE_KEY = 'v1-restore-retire';
// After the owner answers (the item is closed), the watch files nothing for
// this many days, so a `keep v1 restore` answer is not asked again each day.
export const SNOOZE_DAYS = 90;

/**
 * The newest closed item with this key that closed within SNOOZE_DAYS of now,
 * from slim issues (scripts/lib/triage-common.mjs listIssues), or null.
 */
export function recentAnswer(
  issues,
  {now = new Date(), key = RETIRE_KEY} = {},
) {
  const marker = new RegExp(
    `<!--\\s*owner-queue:${key.replace(/[.]/g, '\\.')}\\s*-->`,
  );
  const floor = now.getTime() - SNOOZE_DAYS * 86400000;
  const hits = (issues || [])
    .filter(
      i => i.state === 'closed' && i.closedAt && marker.test(i.body || ''),
    )
    .filter(i => Date.parse(i.closedAt) >= floor)
    .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
  return hits[0] || null;
}

/** The HogQL count of checks and restores in the window. */
export function watchQuery({labSQL, days = WINDOW_DAYS}) {
  if (!labSQL) throw new Error('watchQuery needs labSQL');
  if (!Number.isInteger(days) || days < 1)
    throw new Error('days must be a positive integer');
  return `SELECT
  uniqExactIf(person_id, event = 'v1_restore_checked') AS checked,
  uniqExactIf(person_id, event = 'v1_restore_merged'
    AND ifNull(toFloat(properties.candidate_total), 0) > 0) AS restored
FROM events
WHERE event IN ('v1_restore_checked', 'v1_restore_merged')
  AND timestamp >= now() - INTERVAL ${days} DAY
  AND ${labSQL}`;
}

/** The first row of the query as {checked, restored}. */
export function rowToCounts(rows) {
  const [checked, restored] = rows?.[0] ?? [0, 0];
  return {checked: Number(checked) || 0, restored: Number(restored) || 0};
}

/**
 * The state of the watch:
 *   no-data  too few checks to judge (files nothing)
 *   keep     restores at RETIRE_BELOW or more (files nothing)
 *   retire   restores below RETIRE_BELOW (files one owner-queue decision)
 */
export function decide({checked, restored}) {
  if (checked < MIN_CHECKS) {
    return {
      state: 'no-data',
      reason: `${checked} people ran the v1 check in ${WINDOW_DAYS} days, below ${MIN_CHECKS}; PostHog may have no data`,
    };
  }
  if (restored >= RETIRE_BELOW) {
    return {
      state: 'keep',
      reason: `${restored} restores in ${WINDOW_DAYS} days (${checked} checks); the owner looks again below ${RETIRE_BELOW}`,
    };
  }
  return {
    state: 'retire',
    reason: `${restored} restores in ${WINDOW_DAYS} days (${checked} checks), below ${RETIRE_BELOW}`,
    key: RETIRE_KEY,
    kind: 'decision',
    priority: 'P2',
    title: `Retire the v1 restore? ${restored} restores in ${WINDOW_DAYS} days`,
    reply: 'Reply `retire v1 restore` or `keep v1 restore`',
  };
}

/** The owner-queue body for the retire state: impact first. */
export function renderBody({checked, restored}) {
  return [
    `**Impact:** ${restored} people got their v1 favorites back in the last ${WINDOW_DAYS} days (${checked} people ran the v1 check). The restore reads a public file named by an email hash (TECH_DEBT #137, in \`TECH_DEBT_ARCHIVE.md\`).`,
    '',
    `**Whose decision:** the owner's. On 2026-11-13 the owner accepted the risk while people use the restore, and asked for this look when the restores fall below ${RETIRE_BELOW} in ${WINDOW_DAYS} days.`,
    '',
    '**Recommendation:** retire the v1 restore: remove the check from the app in the next build, then delete the bucket when no supported build reads it.',
    '',
    '**Replies:**',
    "- `retire v1 restore`: a session removes the v1 check from the app in the next build and plans the bucket delete (the delete is the owner's).",
    `- \`keep v1 restore\`: nothing changes. This item closes, and the watch asks again after ${SNOOZE_DAYS} days at the earliest.`,
    '',
    `Source: \`node scripts/v1-restore-watch.mjs\` (rules in \`scripts/lib/v1-restore-watch.mjs\`).`,
  ].join('\n');
}
