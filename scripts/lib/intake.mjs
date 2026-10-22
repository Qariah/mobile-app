// @ai
//
// scripts/lib/intake.mjs
// ----------------------
// The intake line of the daily card. It answers one question: does new work
// still enter the queue? The loop could not tell "quiet" from "starved" before
// (planning/retro-automation-jobs-2026-09-27.md §3.3): on 09-17 it read an
// empty queue as real while the collectors were dead.
//
//   flowing — a collector filed or updated an issue in the last 26 h
//   quiet   — the collectors ran (Diagnostics Watch succeeded), nothing new
//   starved — no successful collector run in the last 26 h
//
// This file is pure (no I/O), so scripts/__tests__/intake.test.mjs covers it.
// scripts/daily-card.mjs reads GitHub and calls classifyIntake().

export const INTAKE_WINDOW_HOURS = 26;

// The primary label of each collector lane in .github/workflows/diagnostics-watch.yml.
export const COLLECTOR_LABELS = [
  'sentry',
  'posthog',
  'play-store',
  'app-store',
  'testflight',
  'release-health',
];

// Issues that a bot comments on but that are not intake.
const NOT_INTAKE_LABELS = ['ops', 'run-health', 'triage-digest'];

const names = labels =>
  (labels || []).map(l => (typeof l === 'string' ? l : l.name));

const hoursAgo = (iso, now) =>
  Math.round((now - new Date(iso).getTime()) / 3_600_000);

/**
 * @param {object} o
 * @param {number} o.now  ms since epoch
 * @param {{created_at:string, status:string, conclusion:?string, html_url?:string}[]} [o.runs]
 *   recent Diagnostics Watch runs, newest first
 * @param {{number:number, labels:(string|{name:string})[], createdAt:string}[]} [o.issues]
 *   issues updated in the window (any state)
 * @param {{issueNumber:number}[]} [o.botComments]
 *   comments by github-actions[bot] in the window
 * @param {number} [o.windowHours]
 * @returns {{state:'flowing'|'quiet'|'starved', filed:number, updated:number, line:string}}
 */
export function classifyIntake({
  now,
  runs = [],
  issues = [],
  botComments = [],
  windowHours = INTAKE_WINDOW_HOURS,
}) {
  const cutoff = now - windowHours * 3_600_000;
  const isCollector = i => {
    const n = names(i.labels);
    return (
      n.some(l => COLLECTOR_LABELS.includes(l)) &&
      !n.some(l => NOT_INTAKE_LABELS.includes(l))
    );
  };
  const collectorIssues = issues.filter(isCollector);
  const filedSet = new Set(
    collectorIssues
      .filter(i => new Date(i.createdAt).getTime() >= cutoff)
      .map(i => i.number),
  );
  const known = new Set(collectorIssues.map(i => i.number));
  const updatedSet = new Set(
    botComments
      .map(c => c.issueNumber)
      .filter(n => known.has(n) && !filedSet.has(n)),
  );
  const filed = filedSet.size;
  const updated = updatedSet.size;

  const inWindow = runs.filter(
    r => new Date(r.created_at).getTime() >= cutoff && r.status === 'completed',
  );
  const good = inWindow.find(r => r.conclusion === 'success');

  if (filed || updated) {
    return {
      state: 'flowing',
      filed,
      updated,
      line: `Intake: flowing — collectors filed ${filed} and updated ${updated} issues in the last ${windowHours} h.`,
    };
  }
  if (good) {
    return {
      state: 'quiet',
      filed,
      updated,
      line: `Intake: quiet — Diagnostics Watch ran ${hoursAgo(good.created_at, now)} h ago and found nothing new.`,
    };
  }
  const last = runs[0];
  let why = 'no run found';
  if (inWindow.length) {
    const r = inWindow[0];
    why = `the last run in ${windowHours} h ended "${r.conclusion || r.status}"${r.html_url ? ` (${r.html_url})` : ''}`;
  } else if (last) {
    why = `no run in ${windowHours} h; the last one started ${hoursAgo(last.created_at, now)} h ago`;
  }
  return {
    state: 'starved',
    filed,
    updated,
    line: `Intake: starved — the collectors did not run: ${why}. An empty queue means nothing today.`,
  };
}
