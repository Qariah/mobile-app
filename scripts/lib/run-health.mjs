// @ai
//
// scripts/lib/run-health.mjs
// --------------------------
// The pure decision logic of the run-health watchdog (scripts/run-health.mjs,
// .github/workflows/run-health.yml). No I/O here, so
// scripts/__tests__/run-health.test.mjs covers every rule.
//
// Measure outputs, never the scheduler status (planning/claude-cloud-migration-
// plan.md §11). A scheduled run that dies still shows "succeeded" in the
// scheduler. So the watchdog reads what each run must leave behind:
//   - the triage card, a comment with the marker `<!-- daily-card date=D ... -->`
//     (scripts/daily-card.mjs --post-issue), by 22:00 UTC on date D;
//   - one line `run-health task=<t> date=<D> status=<s> ...` for each run
//     (scripts/run-end.sh). DONE and SKIPPED are good. Anything else is not.
//
// Dates are the owner's calendar date (America/Los_Angeles), the same date that
// run-end.sh and the card marker write.

export const OWNER_TZ = 'America/Los_Angeles';
export const GOOD_STATUSES = ['DONE', 'SKIPPED'];
export const CARD_DEADLINE_UTC = '22:00';

// When each scheduled run starts (owner's time zone). The run must end before
// start + runLimits.<task>.maxWallMinutes + END_SLACK_MINUTES. The watchdog checks
// a task for the newest date whose end has passed, so a long run (the 3pm
// auto-sprint can run past midnight UTC) is checked the next day, not missed.
// Keep these in step with the scheduled tasks and the routine
// (docs/operations/automation-inventory.md).
export const SCHEDULE = {
  triage: '13:07', // cloud routine qariah-daily-triage
  drafts: '13:00', // local task qariah-daily-triage-fix-loop
  autoSprint: '15:00', // local task qariah-daily-auto-sprint
};
export const END_SLACK_MINUTES = 30;

/** `run-health task=x date=y status=z ...` → {task, date, status, ...} or null. */
export function parseRunHealthLine(body) {
  const line = String(body || '')
    .split('\n')
    .map(l => l.trim())
    .find(l => l.startsWith('run-health '));
  if (!line) return null;
  const out = {};
  for (const m of line.matchAll(/(\w+)=(\S+)/g)) out[m[1]] = m[2];
  return out.task && out.date && out.status ? out : null;
}

/** `<!-- daily-card date=D ... -->` → D, or null. */
export function parseCardDate(body) {
  const m = String(body || '').match(
    /<!-- daily-card date=(\d{4}-\d{2}-\d{2})\b/,
  );
  return m ? m[1] : null;
}

/** The UTC instant of wall-clock `hhmm` on `date` in `tz`. */
export function zonedToUtc(date, hhmm, tz = OWNER_TZ) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map(p => [p.type, p.value]),
  );
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return guess - (asIfUtc - guess);
}

/** The owner's calendar date at instant `ms`. */
export function ownerDate(ms, tz = OWNER_TZ) {
  return new Date(ms).toLocaleDateString('en-CA', {timeZone: tz});
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * The newest date whose run of `task` must have ended by `now`.
 * @param {string} task
 * @param {number} now ms
 * @param {number} maxWallMinutes runLimits.<task>.maxWallMinutes
 */
export function dueDate(task, now, maxWallMinutes) {
  let date = ownerDate(now);
  for (let i = 0; i < 3; i++) {
    const end =
      zonedToUtc(date, SCHEDULE[task]) +
      (maxWallMinutes + END_SLACK_MINUTES) * 60000;
    if (end <= now) return date;
    date = addDays(date, -1);
  }
  return date;
}

/**
 * Decide which expected outputs are missing or bad.
 *
 * @param {object} o
 * @param {number} o.now ms
 * @param {{triage:number, drafts:number, autoSprint:number}} o.maxWallMinutes
 * @param {?{body:string, createdAt:string}[]} o.mainComments comments on
 *   "Daily card", or null when that issue does not exist
 * @param {?{body:string, createdAt:string}[]} o.shadowComments comments on
 *   "Daily card (shadow)", or null when that issue does not exist
 * @param {?string} [o.mainCreatedAt]   when "Daily card" was created
 * @param {?string} [o.shadowCreatedAt] when "Daily card (shadow)" was created
 * @param {boolean} o.triageRunsInCloud policy switch (docs/operations/auto-sprint-policy.json)
 *
 * A run whose end came before its issue existed is not checked: the first
 * run ever creates the issue.
 * @returns {{checks:{task:string, date:string, ok:boolean, text:string, key:string}[]}}
 */
export function evaluateRunHealth({
  now,
  maxWallMinutes,
  mainComments = [],
  shadowComments = null,
  mainCreatedAt = null,
  shadowCreatedAt = null,
  triageRunsInCloud = false,
}) {
  const checks = [];
  const push = (task, date, ok, text) =>
    checks.push({task, date, ok, text, key: `${task}:${date}`});

  // Where the cloud triage routine writes. Before cutover (triageRunsInCloud
  // false) it runs in shadow mode and writes to "Daily card (shadow)". When
  // that issue does not exist yet, the routine has not started: not a fault.
  const mainWhere = '"Daily card"';
  let triageComments = mainComments || [];
  let triageWhere = mainWhere;
  let triageStarted = mainComments !== null;
  let triageCreatedAt = mainCreatedAt;
  if (!triageRunsInCloud) {
    triageComments = shadowComments || [];
    triageWhere = '"Daily card (shadow)"';
    triageStarted = shadowComments !== null;
    triageCreatedAt = shadowCreatedAt;
  }
  const before = (ms, createdAt) =>
    Boolean(createdAt) && ms < Date.parse(createdAt);

  const lineFor = (comments, task, date) =>
    comments
      .map(c => ({...parseRunHealthLine(c.body), createdAt: c.createdAt}))
      .filter(l => l.task === task && l.date === date)
      .pop() || null;

  // 1. The triage card, by 22:00 UTC on its date.
  const cardDate = ownerDate(now);
  const deadline = Date.parse(`${cardDate}T${CARD_DEADLINE_UTC}:00Z`);
  if (!triageStarted) {
    push(
      'triage',
      cardDate,
      true,
      `triage: not started yet (no ${triageWhere} issue), so not checked.`,
    );
  } else if (now >= deadline && !before(deadline, triageCreatedAt)) {
    const cards = triageComments.filter(
      c => parseCardDate(c.body) === cardDate,
    );
    const onTime = cards.find(c => Date.parse(c.createdAt) <= deadline);
    if (onTime)
      push(
        'card',
        cardDate,
        true,
        `card ${cardDate}: posted on ${triageWhere}.`,
      );
    else if (cards.length)
      push(
        'card',
        cardDate,
        false,
        `The triage card for ${cardDate} came late, at ${cards[0].createdAt.slice(11, 16)} UTC (the limit is ${CARD_DEADLINE_UTC} UTC).`,
      );
    else
      push(
        'card',
        cardDate,
        false,
        `No triage card for ${cardDate} on ${triageWhere} by ${CARD_DEADLINE_UTC} UTC. The cloud routine did not run, or it stopped before the card.`,
      );
  }

  // 2. One run-health line for each run.
  for (const task of ['triage', 'drafts', 'autoSprint']) {
    const isTriage = task === 'triage';
    const started = isTriage ? triageStarted : mainComments !== null;
    const where = isTriage ? triageWhere : mainWhere;
    if (!started) {
      if (!isTriage)
        push(
          task,
          ownerDate(now),
          true,
          `${task}: not started yet (no ${where} issue), so not checked.`,
        );
      continue;
    }
    const date = dueDate(task, now, maxWallMinutes[task]);
    const end =
      zonedToUtc(date, SCHEDULE[task]) +
      (maxWallMinutes[task] + END_SLACK_MINUTES) * 60000;
    if (before(end, isTriage ? triageCreatedAt : mainCreatedAt)) {
      push(
        task,
        date,
        true,
        `task=${task} date=${date}: before the ${where} issue existed, so not checked.`,
      );
      continue;
    }
    const comments = isTriage ? triageComments : mainComments;
    const l = lineFor(comments, task, date);
    if (!l)
      push(
        task,
        date,
        false,
        `No run-health line for task=${task} date=${date} on ${where}. The run did not start, died before its end, or could not post its line.`,
      );
    else if (!GOOD_STATUSES.includes(l.status))
      push(
        task,
        date,
        false,
        `task=${task} date=${date} ended with status ${l.status} (toolCalls=${l.toolCalls || '?'}, minutes=${l.minutes || '?'}).`,
      );
    else push(task, date, true, `task=${task} date=${date}: ${l.status}.`);
  }
  return {checks};
}

/** The marker that stops a second report of the same fault. */
export const alertMarker = key => `<!-- run-health-alert ${key} -->`;
