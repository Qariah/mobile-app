// @ai
//
// scripts/lib/pipeline-status.mjs
// -------------------------------
// The pure logic of scripts/pipeline-status.mjs: one status of the whole
// pipeline (docs/operations/feedback-graph.md), computed with no model. No I/O
// here; scripts/__tests__/pipeline-status.test.mjs covers every rule.
//
// Inputs (the CLI reads them with REST `gh api`):
//   comments     the comments on the pinned "Daily card" issue (the newest 21 days)
//   issues       the open issues (no pull requests)
//   closedQueue  the `owner-queue` issues that closed in the last 7 days
//   pulls        the open pull requests
//   rollout      docs/operations/active-rollout.json on the trunk
//   policy       docs/operations/auto-sprint-policy.json on the trunk
//   workflows    {file: [runs]}: the scheduled runs of the collect workflows
//
// The verdict of a stage:
//   OK       the stage ran on its last due day, and nothing in front of it is stuck
//   IDLE     the stage ran and had nothing to do (a SKIPPED run), or no rollout is in flight
//   LATE     its last due run failed or is missing, or its output is older than its target
//   STUCK    its last two due runs failed or are missing
//   WAITS    it waits for a person or a store (a READY build, a store review, production 100%)
//   BACKLOG  the queue in front of it is over its limit
// The overall line: RED = a STUCK stage or an open P0 item for the owner;
// AMBER = a LATE or a BACKLOG stage, or a Steward that failed twice; else GREEN.

import {
  addDays,
  END_SLACK_MINUTES,
  GOOD_STATUSES,
  ownerDate,
  parseCardDate,
  parseRunHealthLine,
  zonedToUtc,
} from './run-health.mjs';
import {candidates, parseEvents} from './promotion-approval.mjs';
import {
  LABEL as QUEUE_LABEL,
  parseQueueIssue,
  sortQueue,
} from './owner-queue.mjs';

export const SCHEMA_VERSION = 1;
const HOUR = 36e5;
const DAY = 864e5;

// When each daily run starts (owner's time zone). Keep these in step with the
// scheduled tasks and the routines (docs/operations/automation-inventory.md).
export const DAILY = {
  triage: '13:07', // cloud routine qariah-daily-triage
  drafts: '13:00', // Mac task qariah-daily-triage-fix-loop
  autoSprint: '15:00', // Mac task qariah-daily-auto-sprint
  auditor: '21:30', // Mac task qariah-release-auditor
};

export const TASK_NAMES = {
  triage: 'Triage (cloud)',
  drafts: 'Fix loop',
  autoSprint: 'Auto-sprint',
  auditor: 'Auditor',
  promoter: 'Promoter',
  steward: 'Steward',
  upstreamSteward: 'Upstream Steward',
  retro: 'Weekly retro',
  scoper: 'Scoper',
};
const taskName = t => TASK_NAMES[t] || t;

// The scheduled workflows of stage 1, by file.
export const COLLECT_WORKFLOWS = {
  'diagnostics-watch.yml': 'Diagnostics Watch',
  'signals-snapshot.yml': 'Signals snapshot',
};
// A daily workflow with no run for this long has stopped (Actions off, billing).
const COLLECT_STALE_HOURS = 30;

export const LIMITS = {
  investigateUntouchedDays: 14,
  investigateUntouched: 20, // BACKLOG at this many
  loopDrafts: 10, // BACKLOG over this many
  ownerWaitDays: 3, // a bottleneck line when an item waits longer
};

const isGood = s => GOOD_STATUSES.includes(s);
const labelsOf = x =>
  (x.labels || []).map(l => (typeof l === 'string' ? l : l.name));
/** "1 issue", "2 issues". */
export const plural = (n, one, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
/** "20 h ago" under two days, else "3 days ago". */
export function ago(iso, now) {
  const h = Math.max(0, Math.floor((now - Date.parse(iso)) / HOUR));
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}
const ageDays = (iso, now) =>
  iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / DAY)) : null;
const short = iso => (iso ? iso.slice(5, 10) : '');
const hhmmPT = iso =>
  iso
    ? new Date(iso).toLocaleTimeString('en-GB', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

// ---------------------------------------------------------------------------
// Run lines
// ---------------------------------------------------------------------------

/**
 * The `run-health` lines of the card comments by `owner`, oldest first, with
 * duplicates removed (one run that posted its line twice).
 * → [{task, date, status, build, toolCalls, minutes, at, url}]
 */
export function parseRunLines(comments, {owner}) {
  const want = String(owner || '').toLowerCase();
  const out = [];
  for (const c of comments || []) {
    const login = String(c.user?.login || '').toLowerCase();
    if (want && login !== want) continue;
    const l = parseRunHealthLine(c.body);
    if (!l) continue;
    out.push({
      task: l.task,
      date: l.date,
      status: l.status,
      build: /^\d+$/.test(l.build || '') ? l.build : null,
      toolCalls: l.toolCalls || null,
      minutes: l.minutes || null,
      at: c.created_at || '',
      url: c.html_url || '',
    });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out.filter((l, i) => {
    const p = out[i - 1];
    return !(
      p &&
      p.task === l.task &&
      p.date === l.date &&
      p.status === l.status &&
      p.build === l.build &&
      Date.parse(l.at) - Date.parse(p.at) < 10 * 60000
    );
  });
}

/** The newest `n` dates whose run of `task` must have ended by `now`, newest first. */
export function dueDates(task, now, maxWallMinutes, n = 2) {
  const at = DAILY[task];
  const out = [];
  let date = ownerDate(now);
  for (let i = 0; i < n + 3 && out.length < n; i++) {
    const end =
      zonedToUtc(date, at) + (maxWallMinutes + END_SLACK_MINUTES) * 60000;
    if (end <= now) out.push(date);
    date = addDays(date, -1);
  }
  return out;
}

const maxWall = (policy, task) =>
  Number(policy?.runLimits?.[task]?.maxWallMinutes) || 180;

/**
 * How the daily `task` did on its last two due days (plus today, when today
 * already has a line).
 * → {verdict: OK|IDLE|LATE|STUCK, days: [{date, status, line}], last}
 * status: DONE | SKIPPED | FAILED | STOPPED-LIMIT | MISSING
 */
export function runOutcome(task, lines, {now, policy}) {
  const mine = lines.filter(l => l.task === task);
  const dates = dueDates(task, now, maxWall(policy, task), 2);
  const today = ownerDate(now);
  if (dates[0] !== today && mine.some(l => l.date === today))
    dates.unshift(today);
  const days = dates.slice(0, 2).map(date => {
    const ls = mine.filter(l => l.date === date);
    const good = ls.filter(l => isGood(l.status));
    const line =
      good.find(l => l.status === 'DONE') || good[0] || ls[ls.length - 1];
    return {date, status: line ? line.status : 'MISSING', line: line || null};
  });
  const bad = d => !d || !isGood(d.status);
  let verdict;
  if (bad(days[0]) && days[1] && bad(days[1])) verdict = 'STUCK';
  else if (bad(days[0])) verdict = 'LATE';
  else if (days[0].status === 'SKIPPED') verdict = 'IDLE';
  else verdict = 'OK';
  return {verdict, days, last: mine[mine.length - 1] || null};
}

function runSummary(task, outcome) {
  const d = outcome.days[0];
  if (!d) return `${taskName(task)} · no due run yet`;
  const when = d.line ? ` · ${short(d.line.at)} ${hhmmPT(d.line.at)} PT` : '';
  return `${taskName(task)} · ${d.date}${when} · ${d.status}`;
}

function runProblem(outcome) {
  return outcome.days
    .filter(d => !isGood(d.status))
    .map(d => `${d.date} ${d.status}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// The Daily card
// ---------------------------------------------------------------------------

/**
 * The `Rollout` block of a card body, one string for each platform line.
 * A line indented by four spaces or more continues the line above it.
 */
export function cardRollout(body) {
  const lines = String(body || '').split('\n');
  const i = lines.findIndex(l => l.trim() === 'Rollout');
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j];
    if (!t.trim() || t.trim().startsWith('```')) break;
    if (/^ {4,}/.test(t) && out.length) out[out.length - 1] += ` ${t.trim()}`;
    else out.push(t.trim());
  }
  return out;
}

/** The newest triage card: {date, at, url, rollout}. */
export function latestCard(comments) {
  let best = null;
  for (const c of comments || []) {
    const date = parseCardDate(c.body);
    if (!date) continue;
    if (!best || (c.created_at || '') > best.at)
      best = {
        date,
        at: c.created_at || '',
        url: c.html_url || '',
        rollout: cardRollout(c.body),
      };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

/** A daily fix-loop draft: the adoption label, or a loop branch (auto-sprint-policy.json → adopt). */
export function isLoopDraft(pull, adopt = {}) {
  const branch = pull.head?.ref || '';
  if (adopt.label && labelsOf(pull).includes(adopt.label)) return true;
  const any = (list, s) => (list || []).some(p => new RegExp(p).test(s));
  return (
    any(adopt.branchPatterns, branch) &&
    !any(adopt.excludeBranchPatterns, branch)
  );
}

// ---------------------------------------------------------------------------
// The status
// ---------------------------------------------------------------------------

/**
 * @param {object} s the sources (see the header), plus `now` (ms) and `repo`.
 * @returns the status object that the page and the Steward read.
 */
export function computeStatus(s) {
  const now = s.now;
  const owner = String(s.repo || '').split('/')[0];
  const policy = s.policy || {};
  const comments = s.comments || [];
  const issues = (s.issues || []).filter(i => !i.pull_request);
  const pulls = s.pulls || [];
  const lines = parseRunLines(comments, {owner});
  const events = parseEvents(comments, {owner});
  const card = latestCard(comments);
  const stages = [];
  const add = (key, name, verdict, who, details, problem = null) =>
    stages.push({
      n: stages.length + 1,
      key,
      name,
      verdict,
      who,
      details,
      problem,
    });

  // 1. Collect: the scheduled diagnostics and signals workflows.
  {
    let verdict = 'OK';
    const parts = [];
    const problems = [];
    const worse = v => {
      const rank = {OK: 0, LATE: 1, STUCK: 2};
      if (rank[v] > rank[verdict]) verdict = v;
    };
    for (const [file, name] of Object.entries(COLLECT_WORKFLOWS)) {
      const runs = (s.workflows?.[file] || [])
        .filter(r => r.status === 'completed')
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const [r0, r1] = runs;
      if (!r0) {
        worse('LATE');
        parts.push(`${name}: no scheduled run`);
        problems.push(`${name} has no scheduled run`);
        continue;
      }
      const ok = r => r && r.conclusion === 'success';
      if (!ok(r0) && r1 && !ok(r1)) worse('STUCK');
      else if (!ok(r0)) worse('LATE');
      const hours = Math.floor((now - Date.parse(r0.created_at)) / HOUR);
      if (hours >= COLLECT_STALE_HOURS) {
        worse('LATE');
        problems.push(`${name} has no run for ${hours} h`);
      } else if (!ok(r0))
        problems.push(
          `${name} ended with ${r0.conclusion}${r1 && !ok(r1) ? ' twice' : ''} (${short(r0.created_at)})`,
        );
      parts.push(
        `${name} ${short(r0.created_at)} ${hhmmPT(r0.created_at)} PT ${r0.conclusion}` +
          (hours >= COLLECT_STALE_HOURS ? ` (no run for ${hours} h)` : ''),
      );
    }
    const filed = issues.filter(
      i => now - Date.parse(i.created_at) < DAY,
    ).length;
    add(
      'collect',
      'Collect',
      verdict,
      parts.join(' · '),
      [`${plural(filed, 'issue')} filed in 24 h · ${issues.length} open`],
      problems.join('; ') || null,
    );
  }

  // 2. Triage: the cloud routine, and the investigate queue.
  const triage = runOutcome('triage', lines, {now, policy});
  {
    const inv = issues.filter(i => labelsOf(i).includes('investigate'));
    const untouched = inv.filter(
      i =>
        now - Date.parse(i.updated_at) >= LIMITS.investigateUntouchedDays * DAY,
    ).length;
    let verdict = triage.verdict;
    if (
      (verdict === 'OK' || verdict === 'IDLE') &&
      untouched >= LIMITS.investigateUntouched
    )
      verdict = 'BACKLOG';
    const details = [
      `${plural(inv.length, 'investigate issue')} · ${untouched} untouched for ${LIMITS.investigateUntouchedDays} days or more`,
    ];
    if (card)
      details.push(`last card ${card.date}, posted ${hhmmPT(card.at)} PT`);
    if (triage.verdict === 'LATE' || triage.verdict === 'STUCK')
      details.push(`not done: ${runProblem(triage)}`);
    add('triage', 'Triage', verdict, runSummary('triage', triage), details);
  }

  // 3. Fix: the daily fix loop and its drafts.
  const drafts = runOutcome('drafts', lines, {now, policy});
  const loopDrafts = pulls.filter(p => isLoopDraft(p, policy.adopt));
  {
    const actionable = issues.filter(i =>
      labelsOf(i).includes('loop-actionable'),
    ).length;
    let verdict = drafts.verdict;
    if (
      (verdict === 'OK' || verdict === 'IDLE') &&
      loopDrafts.length > LIMITS.loopDrafts
    )
      verdict = 'BACKLOG';
    const details = [
      `${plural(loopDrafts.length, 'loop draft')} for adoption · ${plural(actionable, 'loop-actionable issue')}`,
    ];
    if (drafts.verdict === 'LATE' || drafts.verdict === 'STUCK')
      details.push(`not done: ${runProblem(drafts)}`);
    add('fix', 'Fix', verdict, runSummary('drafts', drafts), details);
  }

  // 4. Integrate: the auto-sprint and the internal beta.
  const sprint = runOutcome('autoSprint', lines, {now, policy});
  const lastInternal =
    [...lines]
      .reverse()
      .find(l => l.task === 'autoSprint' && l.status === 'DONE' && l.build) ||
    null;
  {
    const details = [
      lastInternal
        ? `last internal beta ${lastInternal.build} (${lastInternal.date}) · ${ago(lastInternal.at, now)}`
        : 'no internal beta on the card in 21 days',
    ];
    if (sprint.verdict === 'IDLE')
      details.push('nothing to ship on the last run');
    if (sprint.verdict === 'LATE' || sprint.verdict === 'STUCK')
      details.push(`not done: ${runProblem(sprint)}`);
    add(
      'integrate',
      'Integrate',
      sprint.verdict,
      runSummary('autoSprint', sprint),
      details,
    );
  }

  // 5. Audit: the Release Auditor.
  const audit = runOutcome('auditor', lines, {now, policy});
  const verdicts = events.filter(
    e => e.kind === 'ready' || e.kind === 'not-ready',
  );
  const lastVerdict = verdicts[verdicts.length - 1] || null;
  {
    const details = [
      lastVerdict
        ? `last verdict: ${lastVerdict.kind === 'ready' ? 'READY' : 'NOT READY'} ${lastVerdict.action} ${lastVerdict.build} (${short(lastVerdict.at)})`
        : 'no verdict on the card in 21 days',
    ];
    if (audit.verdict === 'LATE' || audit.verdict === 'STUCK')
      details.push(`not done: ${runProblem(audit)}`);
    add('audit', 'Audit', audit.verdict, runSummary('auditor', audit), details);
  }

  // 6. Promote: the owner's go and the Promoter.
  const cands = candidates(events, {now});
  const waitingGo = cands.filter(c => c.state === 'no-approval');
  const publishing = cands.filter(
    c => c.state === 'approved' || c.state === 'in-progress',
  );
  const lastPublic =
    events
      .filter(
        e =>
          e.kind === 'promotion' &&
          e.state === 'DONE' &&
          e.action === 'public-beta',
      )
      .pop() || null;
  const everyDays = Number(policy?.promotion?.publicBetaEveryDays) || 2;
  {
    const failed = cands.find(c => c.state === 'failed' || c.state === 'stale');
    const age = lastPublic ? ageDays(lastPublic.at, now) : null;
    let verdict;
    const details = [
      lastPublic
        ? `last public beta ${lastPublic.build} (${short(lastPublic.at)}) · ${ago(lastPublic.at, now)}`
        : 'no public beta from the Promoter yet',
      `target: every ${everyDays} days`,
    ];
    if (failed) {
      verdict = 'LATE';
      details.unshift(
        `the publish of ${failed.build} ${failed.state === 'stale' ? 'stopped' : 'failed'}`,
      );
    } else if (waitingGo.length) {
      verdict = 'WAITS';
      details.unshift(
        `READY ${waitingGo.map(c => c.build).join(', ')} waits for your go`,
      );
    } else if (publishing.length) {
      verdict = 'OK';
      details.unshift(`publishing ${publishing.map(c => c.build).join(', ')}`);
    } else if (!lastPublic || age > everyDays) verdict = 'LATE';
    else verdict = 'OK';
    add('promote', 'Promote', verdict, 'Promoter · every 2 h', details);
  }

  // 7. Ramp: the production rollout.
  {
    const active = Boolean(s.rollout?.active);
    const live = card?.rollout?.length ? card.rollout : null;
    let verdict;
    const details = [];
    if (!active) {
      verdict = 'IDLE';
      details.push('no rollout in flight');
    } else {
      const text = (live || []).join(' ');
      if (/\b(PAUSED|HALTED)\b/i.test(text)) verdict = 'WAITS';
      else if (/review/i.test(text)) verdict = 'WAITS';
      else verdict = 'OK';
      if (live) {
        details.push(...live);
        details.push(`from the card of ${card.date}`);
      } else {
        details.push('the card has no Rollout lines; see active-rollout.json');
      }
    }
    const anomalies = issues.filter(i =>
      labelsOf(i).includes('anomaly'),
    ).length;
    if (anomalies) details.push(`${plural(anomalies, 'anomaly issue')} open`);
    const who = active
      ? `${s.rollout.release || '?'} · started ${s.rollout.startedAt || '?'}`
      : 'no rollout';
    add('ramp', 'Ramp', verdict, who, details);
  }

  // 8. Close: fixed issues that wait for production at 100%.
  {
    const fixed = issues.filter(i =>
      labelsOf(i).some(l => /^fixed-in:\d+$/.test(l)),
    );
    const builds = [
      ...new Set(
        fixed.flatMap(i =>
          labelsOf(i)
            .filter(l => /^fixed-in:\d+$/.test(l))
            .map(l => l.slice('fixed-in:'.length)),
        ),
      ),
    ].sort();
    const verdict = fixed.length ? 'WAITS' : 'OK';
    add('close', 'Close', verdict, 'prod-close · after 100 %', [
      fixed.length
        ? `${plural(fixed.length, 'issue')} fixed in ${builds.join(', ')} ${fixed.length === 1 ? 'waits' : 'wait'} for production at 100 %`
        : 'no fixed issue waits for production',
    ]);
  }

  // Needs you: the owner's decisions and actions, the READY builds, the PRs.
  const queue = issues
    .filter(i => labelsOf(i).includes(QUEUE_LABEL))
    .map(parseQueueIssue);
  const mine = sortQueue(queue).filter(
    i => i.kind === 'decision' || i.kind === 'action',
  );
  const items = [
    ...mine.filter(i => i.priority === 'P0').map(i => queueItem(i, now)),
    ...waitingGo.map(c => ({
      type: 'approve',
      title: `Public beta ${c.build} is READY`,
      build: c.build,
      reply: `owner-reply: go ${c.action} ${c.build}`,
      since: c.ready?.at || '',
      ageDays: ageDays(c.ready?.at, now),
      url: c.ready?.url || '',
      priority: 'P1',
    })),
    ...mine.filter(i => i.priority !== 'P0').map(i => queueItem(i, now)),
    ...pulls
      .filter(p => !isLoopDraft(p, policy.adopt))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      .map(p => ({
        type: 'review',
        number: p.number,
        title: p.title,
        draft: Boolean(p.draft),
        since: p.created_at,
        ageDays: ageDays(p.created_at, now),
        url: p.html_url,
        priority: 'P2',
      })),
  ];
  const needsYou = {
    counts: {
      decisions: items.filter(i => i.type === 'decision').length,
      actions: items.filter(i => i.type === 'action').length,
      approvals: items.filter(i => i.type === 'approve').length,
      reviews: items.filter(i => i.type === 'review').length,
    },
    stewardInfo: queue.filter(i => i.kind === 'info').length,
    items,
  };

  // The Steward: it posts a line only when the queue has items.
  const steward = lines.filter(l => l.task === 'steward');
  const stewardBad =
    steward.length >= 2 && steward.slice(-2).every(l => !isGood(l.status));

  // Bottlenecks, the worst first.
  const bottlenecks = [];
  const byKey = Object.fromEntries(stages.map(x => [x.key, x]));
  const outcomes = {triage, fix: drafts, integrate: sprint, audit};
  for (const st of stages.filter(x => x.verdict === 'STUCK')) {
    const o = outcomes[st.key];
    bottlenecks.push(
      `${st.name} stopped two due days in a row: ${o ? runProblem(o) : st.problem || st.who}.`,
    );
  }
  for (const i of items.filter(x => x.priority === 'P0'))
    bottlenecks.push(`P0 #${i.number} ${i.title} waits for you.`);
  for (const st of stages.filter(x => x.verdict === 'LATE')) {
    const o = outcomes[st.key];
    bottlenecks.push(
      `${st.name} is late: ${o ? runProblem(o) : st.problem || st.details[0]}.`,
    );
  }
  for (const st of stages.filter(x => x.verdict === 'BACKLOG'))
    bottlenecks.push(`${st.name} backlog: ${st.details[0]}.`);
  const old = items.filter(
    i => i.type !== 'review' && (i.ageDays ?? 0) > LIMITS.ownerWaitDays,
  );
  if (old.length)
    bottlenecks.push(
      `${plural(old.length, 'item')} ${old.length === 1 ? 'waits' : 'wait'} for you more than ${LIMITS.ownerWaitDays} days (the oldest: ${old[0].number ? `#${old[0].number}` : old[0].title}, ${old[0].ageDays} days).`,
    );
  if (stewardBad)
    bottlenecks.push(
      'The Steward failed on its last two runs: questions get no answer.',
    );
  if (byKey.ramp.details.some(d => /anomaly issues? open/.test(d)))
    bottlenecks.push(
      byKey.ramp.details.find(d => /anomaly issues? open/.test(d)) + '.',
    );

  // The overall line.
  let level = 'GREEN';
  let reason = 'every stage ran on its last due day';
  if (
    stages.some(x => x.verdict === 'STUCK') ||
    items.some(i => i.priority === 'P0')
  ) {
    level = 'RED';
  } else if (
    stages.some(x => x.verdict === 'LATE' || x.verdict === 'BACKLOG') ||
    stewardBad
  ) {
    level = 'AMBER';
  }
  if (level !== 'GREEN' && bottlenecks.length)
    reason = bottlenecks[0].replace(/\.$/, '');

  return {
    schemaVersion: SCHEMA_VERSION,
    computedAt: new Date(now).toISOString(),
    date: ownerDate(now),
    repo: s.repo,
    overall: {level, reason},
    needsYou,
    stages,
    bottlenecks,
    week: weekStats({
      now,
      lines,
      events,
      policy,
      queue,
      closedQueue: s.closedQueue || [],
    }),
    runs48h: recentRuns({now, lines, events, policy}),
    sources: {
      cardIssue: s.cardIssue || null,
      comments: comments.length,
      issues: issues.length,
      pulls: pulls.length,
    },
  };
}

function queueItem(i, now) {
  return {
    type: i.kind,
    number: i.number,
    title: i.title,
    priority: i.priority,
    reply: String(i.reply || '').split('\n')[0],
    since: i.createdAt,
    ageDays: ageDays(i.createdAt, now),
    due: i.due || null,
    escalated: i.escalated,
    url: i.url,
  };
}

// ---------------------------------------------------------------------------
// The week and the last 48 hours
// ---------------------------------------------------------------------------

const FREQUENT = ['steward', 'promoter'];

export function weekStats({now, lines, events, policy, queue, closedQueue}) {
  const since = now - 7 * DAY;
  const from = addDays(ownerDate(now), -6); // 7 calendar days, today included
  const week = lines.filter(l => l.date >= from);
  const counted = week.filter(l => !FREQUENT.includes(l.task));
  let missed = 0;
  for (const task of Object.keys(DAILY)) {
    for (const date of dueDates(task, now, maxWall(policy, task), 8)) {
      if (date < from) continue;
      if (!lines.some(l => l.task === task && l.date === date)) missed++;
    }
  }
  const escalatedSince = [...queue, ...(closedQueue || []).map(parseQueueIssue)]
    .filter(i => i.escalated && Date.parse(i.createdAt) >= since)
    .map(i => i.number);
  const steward = week.filter(l => l.task === 'steward');
  return {
    from,
    to: ownerDate(now),
    runs: counted.length,
    failed: counted.filter(l => !isGood(l.status)).length,
    skipped: counted.filter(l => l.status === 'SKIPPED').length,
    missed,
    internalBetas: [
      ...new Set(
        week
          .filter(
            l => l.task === 'autoSprint' && l.status === 'DONE' && l.build,
          )
          .map(l => l.build),
      ),
    ].length,
    publicBetas: events.filter(
      e =>
        e.kind === 'promotion' &&
        e.state === 'DONE' &&
        e.action === 'public-beta' &&
        Date.parse(e.at) >= since,
    ).length,
    escalations: new Set(escalatedSince).size,
    steward: {
      runs: steward.length,
      failed: steward.filter(l => !isGood(l.status)).length,
    },
  };
}

/**
 * The rows of the last 48 hours, newest first: each run line, each audit and
 * promotion line, and each due run that left no line. A Promoter run that
 * found no approval (SKIPPED) is left out. Rows of the same run, result and
 * date in a row become one row with a count.
 */
export function recentRuns({now, lines, events, policy}) {
  const since = now - 48 * HOUR;
  const rows = [];
  for (const l of lines) {
    if (Date.parse(l.at) < since) continue;
    if (l.task === 'promoter' && l.status === 'SKIPPED') continue;
    const note = [
      l.build ? `build ${l.build}` : null,
      l.toolCalls && l.toolCalls !== 'unknown' ? `${l.toolCalls} calls` : null,
      l.minutes && l.minutes !== 'unknown' ? `${l.minutes} min` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    rows.push({
      kind: 'run',
      at: l.at,
      task: l.task,
      name: taskName(l.task),
      date: l.date,
      result: l.status,
      note,
      url: l.url,
    });
  }
  for (const e of events) {
    if (Date.parse(e.at) < since) continue;
    if (e.kind === 'ready' || e.kind === 'not-ready')
      rows.push({
        kind: 'verdict',
        at: e.at,
        task: 'auditor',
        name: taskName('auditor'),
        date: ownerDate(Date.parse(e.at)),
        result: e.kind === 'ready' ? 'READY' : 'NOT READY',
        note: `${e.action} ${e.build}`,
        url: e.url,
      });
    else if (e.kind === 'promotion')
      rows.push({
        kind: 'promotion',
        at: e.at,
        task: 'promoter',
        name: taskName('promoter'),
        date: ownerDate(Date.parse(e.at)),
        result: e.state,
        note: `${e.action} ${e.build}`,
        url: e.url,
      });
  }
  for (const task of Object.keys(DAILY)) {
    for (const date of dueDates(task, now, maxWall(policy, task), 3)) {
      const at = zonedToUtc(date, DAILY[task]);
      if (at < since) continue;
      if (lines.some(l => l.task === task && l.date === date)) continue;
      rows.push({
        kind: 'missing',
        at: new Date(at).toISOString().replace('.000Z', 'Z'),
        task,
        name: taskName(task),
        date,
        result: 'MISSING',
        note: 'no run-health line',
        url: '',
      });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const out = [];
  for (const r of rows) {
    const p = out[out.length - 1];
    if (
      p &&
      p.kind === 'run' &&
      r.kind === 'run' &&
      p.task === r.task &&
      p.result === r.result &&
      p.date === r.date
    ) {
      p.count = (p.count || 1) + 1;
      continue;
    }
    out.push({...r});
  }
  return out;
}
