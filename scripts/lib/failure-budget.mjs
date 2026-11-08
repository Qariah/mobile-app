// @ai
//
// scripts/lib/failure-budget.mjs — the failure budget of each scheduled task.
// ---------------------------------------------------------------------------
// The weekly retro (.claude/routines/qariah-weekly-retro.md) runs
// scripts/failure-budget.mjs. It reads the `run-health` lines on the Daily card
// for the last 14 days and splits them into two 7-day windows that end
// yesterday.
//
//   bad        a FAILED or STOPPED-LIMIT line
//   over       a window in which half or more of a task's lines are bad
//   missed     a day with no line for a daily task (the run died before
//              run-end.sh, or the Mac was off): report only, never bad
//   silent     a daily task with no line in a whole window: report only
//   turn off   over in BOTH windows → the retro adds the label `off:<task>`
//              to the Daily card and files one owner-queue item
//
// A SKIPPED line is a healthy line (nothing to do, or the pause switch). The
// Steward and the retro are never turned off: the Steward answers the queue,
// and the retro is the only run that turns a task on or off.
// The logic here is pure; the CLI does the GitHub reads and writes.

import {OFF_PREFIX, offLabel} from './pipeline-switch.mjs';

export const BAD = new Set(['FAILED', 'STOPPED-LIMIT']);
export const EXEMPT = new Set(['steward', 'retro']);
// Tasks that must post a line every day. A silent window for one of these
// means the task did not run at all.
export const DAILY = ['triage', 'drafts', 'autoSprint', 'auditor', 'steward'];

const LINE_RE =
  /^run-health task=(\S+) date=(\d{4}-\d{2}-\d{2}) status=(\S+)(?: build=(\S+))?/;

/** @returns {{task:string,date:string,status:string,build:string|null}[]} */
export function parseRunHealth(bodies) {
  const out = [];
  for (const body of bodies || []) {
    for (const raw of String(body).split('\n')) {
      const m = raw.trim().match(LINE_RE);
      if (m)
        out.push({
          task: m[1],
          date: m[2],
          status: m[3],
          build: m[4] && m[4] !== 'none' ? m[4] : null,
        });
    }
  }
  return out;
}

/** YYYY-MM-DD + n days (n may be negative). */
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The two windows: older = today-14..today-8, newer = today-7..today-1. */
export function windowsFor(today) {
  return {
    older: {from: addDays(today, -14), to: addDays(today, -8)},
    newer: {from: addDays(today, -7), to: addDays(today, -1)},
  };
}

function tally(lines, w) {
  const by = new Map();
  for (const l of lines) {
    if (l.date < w.from || l.date > w.to) continue;
    const t = by.get(l.task) || {runs: 0, bad: 0, statuses: {}, dates: new Set()};
    t.runs++;
    t.dates.add(l.date);
    if (BAD.has(l.status)) t.bad++;
    t.statuses[l.status] = (t.statuses[l.status] || 0) + 1;
    by.set(l.task, t);
  }
  return by;
}

export function isOver(t) {
  return Boolean(t && t.bad >= 1 && t.bad * 2 >= t.runs);
}

/**
 * @param {{task:string,date:string,status:string}[]} lines
 * @param {{today:string, labels?:string[]}} o labels = the Daily card labels
 */
export function judgeBudget(lines, {today, labels = []}) {
  const w = windowsFor(today);
  const older = tally(lines, w.older);
  const newer = tally(lines, w.newer);
  const offNow = new Set(
    labels.filter(l => l.startsWith(OFF_PREFIX)).map(l => l.slice(OFF_PREFIX.length)),
  );
  const tasks = [...new Set([...older.keys(), ...newer.keys(), ...DAILY])].sort();
  const rows = tasks.map(task => {
    const empty = () => ({runs: 0, bad: 0, statuses: {}, dates: new Set()});
    const a = older.get(task) || empty();
    const b = newer.get(task) || empty();
    // A day with no line: the run died before run-end.sh (a usage limit, a crash),
    // or the Mac was off. Reported, never counted as bad: an off Mac is no reason
    // to turn a task off.
    for (const x of [a, b]) {
      x.missed = DAILY.includes(task) ? 7 - x.dates.size : null;
      x.dates = [...x.dates].sort();
    }
    const silent = DAILY.includes(task)
      ? [a.runs === 0 && 'older', b.runs === 0 && 'newer'].filter(Boolean)
      : [];
    const overBoth = isOver(a) && isOver(b);
    let verdict = 'ok';
    if (offNow.has(task)) verdict = 'off';
    else if (overBoth && EXEMPT.has(task)) verdict = 'over-exempt';
    else if (overBoth) verdict = 'turn-off';
    else if (isOver(b)) verdict = 'over-once';
    else if (silent.length) verdict = 'silent';
    return {task, older: a, newer: b, silent, verdict, label: offLabel(task)};
  });
  return {
    today,
    windows: w,
    rows,
    turnOff: rows.filter(r => r.verdict === 'turn-off').map(r => r.task),
  };
}

const VERDICT_TEXT = {
  ok: 'OK',
  off: 'OFF (label on the card)',
  'over-exempt': 'over budget twice (never turned off)',
  'turn-off': 'TURN OFF (over budget twice)',
  'over-once': 'over budget this week',
  silent: 'no line in a window',
};

/** Markdown table for the retro file. */
export function budgetTable(r) {
  const head = [
    `Windows: ${r.windows.older.from} to ${r.windows.older.to}, then ${r.windows.newer.from} to ${r.windows.newer.to}.`,
    '',
    '| Task | Bad / lines (older) | Bad / lines (newer) | Days with no line | Verdict |',
    '|---|---|---|---|---|',
  ];
  const miss = x => (x.older.missed === null ? '-' : `${x.older.missed}, ${x.newer.missed}`);
  const rows = r.rows.map(
    x =>
      `| ${x.task} | ${x.older.bad} / ${x.older.runs} | ${x.newer.bad} / ${x.newer.runs} | ${miss(x)} | ${VERDICT_TEXT[x.verdict]} |`,
  );
  return [...head, ...rows].join('\n');
}

/** The owner-queue body for a task that the retro turned off. */
export function offItemBody(row, {card, cause = '', fix = ''}) {
  const n = w => `${w.bad} of ${w.runs}`;
  return [
    `The weekly retro turned off the scheduled task \`${row.task}\`.`,
    '',
    `It failed ${n(row.older)} runs in the week before last and ${n(row.newer)} runs last week (a FAILED or STOPPED-LIMIT line on the Daily card). Its runs now stop at \`run-start.sh\` and post SKIPPED.`,
    '',
    `Cause: ${cause || 'not found by the retro; see the failed run reports.'}`,
    `Fix: ${fix || 'none yet.'}`,
    '',
    `To turn it on again: remove the label \`${row.label}\` from the Daily card #${card}, or tell any Claude session "turn on ${row.task}". The next firing then runs.`,
  ].join('\n');
}
