// @ai
//
// scripts/lib/pipeline-switch.mjs — the pause switch of the scheduled runs.
// ---------------------------------------------------------------------------
// Two kinds of label on the pinned "Daily card" issue stop scheduled runs:
//
//   pipeline-paused   stops every task (the owner's stop for the whole pipeline)
//   off:<task>        stops one task (the weekly retro adds it when the task is
//                     over its failure budget, scripts/lib/failure-budget.mjs)
//
// The owner, or a session on the owner's word, adds or removes a label in the
// GitHub app or on the web. `scripts/run-start.sh` reads the labels before a
// run starts (scripts/pipeline-switch.mjs). The logic here is pure, so the
// tests need no GitHub.

export const PAUSE_LABEL = 'pipeline-paused';
export const OFF_PREFIX = 'off:';

// The task ids of scripts/run-start.sh. The switch accepts an unknown id too
// (a new task stops with `pipeline-paused` before it is listed here).
export const TASKS = [
  'triage',
  'drafts',
  'autoSprint',
  'auditor',
  'promoter',
  'steward',
  'upstreamSteward',
  'retro',
];

export function offLabel(task) {
  return `${OFF_PREFIX}${task}`;
}

/**
 * @param {string[]} labels the label names on the Daily card
 * @param {string} task the run-start task id
 * @returns {{stop: boolean, label: string|null, reason: string}}
 */
export function switchFor(labels, task) {
  const names = new Set((labels || []).map(l => String(l).trim()));
  if (names.has(PAUSE_LABEL))
    return {
      stop: true,
      label: PAUSE_LABEL,
      reason: `the label \`${PAUSE_LABEL}\` is on the Daily card: every scheduled run stops`,
    };
  if (names.has(offLabel(task)))
    return {
      stop: true,
      label: offLabel(task),
      reason: `the label \`${offLabel(task)}\` is on the Daily card: this task stops`,
    };
  return {stop: false, label: null, reason: 'no pause label on the Daily card'};
}
