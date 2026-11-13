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
import {
  ageText,
  auditReason,
  biggestGroup,
  buildRef,
  clean,
  dayAge,
  fixedByBuild,
  iosFullDate,
  links,
  notBeforeReady,
  parseReplies,
  ptDay,
  ptWhen,
  queueDetail,
  rolloutPlatforms,
  rolloutSub,
  runEntry,
  runNote,
  storeBuilds,
  storeText,
} from './pipeline-flow.mjs';

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
const hoursSince = (iso, now) =>
  iso && Number.isFinite(Date.parse(iso)) ? (now - Date.parse(iso)) / HOUR : 0;
// The Promoter runs at 08:00 and 23:00 PT, so an approved build goes out in
// less than a day. Promote is LATE after this many hours.
export const PROMOTE_WITHIN_HOURS = 24;

/**
 * The newest public beta, from the Promoter's DONE line or from the stores
 * (a build made by hand counts too). → {build, at, by} or null.
 */
export function newestPublicBeta(lastPublic, storePublic = []) {
  const all = [
    ...(lastPublic
      ? [{build: lastPublic.build, at: lastPublic.at, by: 'Promoter'}]
      : []),
    ...storePublic.map(b => ({build: b.build, at: b.at || null, by: b.by})),
  ].filter(b => Number(b.build) > 0);
  if (!all.length) return null;
  return all.reduce((a, b) => (Number(b.build) > Number(a.build) ? b : a));
}
// A date of a timestamp is its date in Los Angeles, like its time: a run at
// 05:34Z on 11-08 is "11-07 21:34 PT" (it was "11-08 21:34 PT" before).
const short = ptDay;
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
  const builds = storeBuilds(s.store, {lines, events});
  const platforms = rolloutPlatforms(s.rollout, card);
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
    const notes = [];
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
      // A manual run that passed after the failed scheduled run clears the failure
      // (2026-11-11). The scheduled run's age still decides "no run for N h".
      const manual = (s.workflowsManual?.[file] || []).find(
        r =>
          r.status === 'completed' &&
          ok(r) &&
          !ok(r0) &&
          r.created_at > r0.created_at,
      );
      if (manual) {
        notes.push(
          `${name}: the scheduled run of ${short(r0.created_at)} failed; a manual run passed ${ago(
            manual.created_at,
            now,
          )}`,
        );
      }
      if (!manual && !ok(r0) && r1 && !ok(r1)) worse('STUCK');
      else if (!manual && !ok(r0)) worse('LATE');
      const hours = Math.floor((now - Date.parse(r0.created_at)) / HOUR);
      if (hours >= COLLECT_STALE_HOURS) {
        worse('LATE');
        problems.push(`${name} has no run for ${hours} h`);
      } else if (!manual && !ok(r0))
        problems.push(
          `${name} ended with ${r0.conclusion}${
            r1 && !ok(r1) ? ' twice' : ''
          } (${short(r0.created_at)})`,
        );
      parts.push(
        `${name} ${short(r0.created_at)} ${hhmmPT(r0.created_at)} PT ${
          r0.conclusion
        }` + (hours >= COLLECT_STALE_HOURS ? ` (no run for ${hours} h)` : ''),
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
      [`${plural(filed, 'issue')} filed in 24 h · ${issues.length} open`, ...notes],
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
      `${plural(
        inv.length,
        'investigate issue',
      )} · ${untouched} untouched for ${
        LIMITS.investigateUntouchedDays
      } days or more`,
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
      `${plural(loopDrafts.length, 'loop draft')} for adoption · ${plural(
        actionable,
        'loop-actionable issue',
      )}`,
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
  // A build in the store that is newer than the auto-sprint's was made by hand.
  const handInternal =
    builds.internal.find(
      b =>
        b.by === 'hand' &&
        (!lastInternal || Number(b.build) > Number(lastInternal.build)),
    ) || null;
  {
    const details = [];
    if (handInternal)
      details.push(
        `newest internal beta ${buildRef(handInternal)}, built by hand${
          handInternal.at ? ` (${short(handInternal.at)})` : ''
        }`,
      );
    details.push(
      lastInternal
        ? `last internal beta ${handInternal ? 'from the auto-sprint ' : ''}${
            lastInternal.build
          } (${lastInternal.date}) · ${ago(lastInternal.at, now)}`
        : 'no internal beta from the auto-sprint on the card in 21 days',
    );
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
        ? `last verdict: ${
            lastVerdict.kind === 'ready' ? 'READY' : 'NOT READY'
          } ${lastVerdict.action} ${lastVerdict.build} (${short(
            lastVerdict.at,
          )})`
        : 'no verdict on the card in 21 days',
    ];
    if (audit.verdict === 'LATE' || audit.verdict === 'STUCK')
      details.push(`not done: ${runProblem(audit)}`);
    add('audit', 'Audit', audit.verdict, runSummary('auditor', audit), details);
  }

  // 6. Promote: the owner's go and the Promoter.
  // Owner rule (2026-11-09): Promote is LATE only when a build that must go out
  // does not go out. A public beta that is already in the stores, from the
  // Promoter or by hand, covers every READY build up to its number. When no
  // READY build waits, there is nothing to publish, and the stage is OK.
  const cands = candidates(events, {now});
  const lastPublic =
    events
      .filter(
        e =>
          e.kind === 'promotion' &&
          e.state === 'DONE' &&
          e.action === 'public-beta',
      )
      .pop() || null;
  const newestPublic = newestPublicBeta(lastPublic, builds.public);
  const open = cands.filter(
    c => !newestPublic || Number(c.build) > Number(newestPublic.build),
  );
  const waitingGo = open.filter(c => c.state === 'no-approval');
  const publishing = open.filter(
    c => c.state === 'approved' || c.state === 'in-progress',
  );
  const overdue =
    open.find(
      c =>
        c.state === 'approved' &&
        hoursSince(c.approval?.at, now) > PROMOTE_WITHIN_HOURS,
    ) || null;
  const failed = open.find(c => c.state === 'failed' || c.state === 'stale');
  {
    let verdict;
    const details = [
      newestPublic
        ? `last public beta ${newestPublic.build}${
            newestPublic.at ? ` (${short(newestPublic.at)})` : ''
          } · ${newestPublic.by === 'hand' ? 'by hand' : 'by the Promoter'}${
            newestPublic.at ? ` · ${ago(newestPublic.at, now)}` : ''
          }`
        : 'no public beta yet',
    ];
    if (failed) {
      verdict = 'LATE';
      details.unshift(
        `the publish of ${failed.build} ${
          failed.state === 'stale' ? 'stopped' : 'failed'
        }`,
      );
    } else if (overdue) {
      verdict = 'LATE';
      details.unshift(
        `${overdue.build} approved ${ago(
          overdue.approval.at,
          now,
        )}, not published`,
      );
    } else if (waitingGo.length) {
      verdict = 'WAITS';
      details.unshift(
        `READY ${waitingGo.map(c => c.build).join(', ')} waits for your go`,
      );
    } else if (publishing.length) {
      verdict = 'OK';
      details.unshift(`publishing ${publishing.map(c => c.build).join(', ')}`);
    } else {
      verdict = 'OK';
      details.unshift('nothing waits to go out');
    }
    add(
      'promote',
      'Promote',
      verdict,
      'Promoter · 08:00 and 23:00 PT',
      details,
    );
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
      ? platforms.ios || platforms.android
        ? `${rolloutSub(platforms)} · started ${s.rollout.startedAt || '?'}`
        : `${s.rollout.release || '?'} · started ${s.rollout.startedAt || '?'}`
      : 'no rollout';
    add('ramp', 'Ramp', verdict, who, details);
  }

  // 8. Close: fixed issues that wait for production at 100%.
  {
    const fixed = issues.filter(i =>
      labelsOf(i).some(l => /^fixed-in:\d+$/.test(l)),
    );
    const fixedBuilds = [
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
        ? `${plural(fixed.length, 'issue')} fixed in ${fixedBuilds.join(', ')} ${
            fixed.length === 1 ? 'waits' : 'wait'
          } for production at 100 %`
        : 'no fixed issue waits for production',
    ]);
  }

  // Needs you: the owner's decisions and actions, the READY builds, the PRs.
  const queue = issues
    .filter(i => labelsOf(i).includes(QUEUE_LABEL))
    .map(i => ({...parseQueueIssue(i), body: i.body || ''}));
  const mine = sortQueue(queue).filter(
    i => i.kind === 'decision' || i.kind === 'action',
  );
  const newestInternal =
    Math.max(
      0,
      ...builds.internal.map(b => Number(b.build)),
      lastInternal ? Number(lastInternal.build) : 0,
    ) || null;
  const qItem = i => queueItem(i, now, {newestInternal});
  const items = [
    ...mine.filter(i => i.priority === 'P0').map(qItem),
    ...waitingGo.map(c => ({
      type: 'approve',
      title: `Public beta ${c.build} is READY`,
      build: c.build,
      reply: `owner-reply: go ${c.action} ${c.build}`,
      since: c.ready?.at || '',
      ageDays: ageDays(c.ready?.at, now),
      url: c.ready?.url || '',
      priority: 'P1',
      age: ageText(c.ready?.at, now),
      why: `The Release Auditor marked ${c.action} ${c.build} READY. The Promoter publishes it only after your go.`,
      do: 'Comment on the Daily card with the exact text.',
      replies: [{text: `owner-reply: go ${c.action} ${c.build}`}],
      notBefore: null,
      blocks: ['go', 'promote'],
      group: 'now',
    })),
    ...mine.filter(i => i.priority !== 'P0').map(qItem),
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
        age: ageText(p.created_at, now),
        group: 'review',
      })),
  ];
  // An issue that the triage holds for the owner (the card's "HELD" block).
  const held = issues
    .filter(
      i =>
        labelsOf(i).includes('needs-decision') &&
        !labelsOf(i).includes(QUEUE_LABEL),
    )
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .map(i => ({
      type: 'held',
      number: i.number,
      title: i.title,
      since: i.created_at,
      ageDays: ageDays(i.created_at, now),
      age: ageText(i.created_at, now),
      url: i.html_url,
      note: 'Held on the Daily card for your decision. Reply on the issue in one line: fix it, or close it.',
    }));
  const needsYou = {
    counts: {
      decisions: items.filter(i => i.type === 'decision').length,
      actions: items.filter(i => i.type === 'action').length,
      approvals: items.filter(i => i.type === 'approve').length,
      reviews: items.filter(i => i.type === 'review').length,
      now: items.filter(i => i.group === 'now').length,
      later: items.filter(i => i.group === 'later').length,
      held: held.length,
    },
    stewardInfo: queue.filter(i => i.kind === 'info').length,
    items,
    held,
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
      `${st.name} stopped two due days in a row: ${
        o ? runProblem(o) : st.problem || st.who
      }.`,
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
      `${plural(old.length, 'item')} ${
        old.length === 1 ? 'waits' : 'wait'
      } for you more than ${LIMITS.ownerWaitDays} days (the oldest: ${
        old[0].number ? `#${old[0].number}` : old[0].title
      }, ${old[0].ageDays} days).`,
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

  const week = weekStats({
    now,
    lines,
    events,
    policy,
    queue,
    closedQueue: s.closedQueue || [],
  });
  const bodies = new Map(comments.map(x => [x.id, x.body]));
  const flow = buildFlow({
    now,
    owner,
    stages,
    lines,
    events,
    issues,
    comments,
    card,
    cardIssue: s.cardIssue || null,
    L: links(s.repo),
    workflows: s.workflows,
    triage,
    drafts,
    sprint,
    audit,
    queue,
    closedQueue: (s.closedQueue || []).map(parseQueueIssue),
    stewardBad,
    week,
    loopDrafts,
    lastInternal,
    handInternal,
    builds,
    verdicts,
    bodyOf: id => bodies.get(id) || '',
    waitingGo,
    cands,
    lastPublic,
    newestPublic,
    overdue,
    failedPublish: failed || null,
    platforms,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    computedAt: new Date(now).toISOString(),
    date: ownerDate(now),
    repo: s.repo,
    overall: {level, reason},
    needsYou,
    stages,
    // The 10 steps of the Pipeline page, in its order: the 8 stages (the same
    // objects as `stages`) plus the Steward and the owner's go (n: null).
    flow,
    rollout: platforms,
    builds,
    bottlenecks,
    week,
    runs48h: recentRuns({now, lines, events, policy}),
    sources: {
      cardIssue: s.cardIssue || null,
      comments: comments.length,
      issues: issues.length,
      pulls: pulls.length,
    },
  };
}

function queueItem(i, now, {newestInternal = null} = {}) {
  const d = queueDetail(i.body, {run: i.run});
  const ready = notBeforeReady(d.notBefore, {now, newestInternal});
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
    age: ageText(i.createdAt, now),
    why: d.why,
    do: d.do,
    replies: parseReplies(i.reply),
    notBefore: d.notBefore ? {...d.notBefore, ready} : null,
    blocks: d.blocks,
    // "later": a "not before" condition that does not hold yet, or that the
    // page cannot check. The item shows under "Later and held" with its text.
    group: d.notBefore && ready !== true ? 'later' : 'now',
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
    out.push({...r, when: ptWhen(r.at)});
  }
  return out;
}

// ---------------------------------------------------------------------------
// The flow of the Pipeline page: 10 steps with their detail
// ---------------------------------------------------------------------------

/** The order of the page: the 8 stages, plus the Steward after Triage and the owner's go after Audit. */
export const FLOW_KEYS = [
  'collect',
  'triage',
  'steward',
  'fix',
  'integrate',
  'audit',
  'go',
  'promote',
  'ramp',
  'close',
];

const QUEUE_MAX = 6;

/** "today at 15:00 PT" or "tomorrow at 15:00 PT": the next start of a daily task. */
export function nextRun(task, now) {
  const today = ownerDate(now);
  const at = DAILY[task];
  if (zonedToUtc(today, at) > now) return `today at ${at} PT`;
  return `tomorrow at ${at} PT`;
}

const lineRow = l =>
  runEntry({
    at: l.at,
    name: taskName(l.task),
    note: runNote(l),
    result: l.status,
    url: l.url,
  });

const lastText = (o, task) => {
  const d = o.days[0];
  if (!d) return `${taskName(task)}: no due run yet`;
  if (!d.line) return `${d.date} · ${d.status}`;
  return `${ptWhen(d.line.at)} PT · ${d.status}`;
};

const queueOf = ({title, items, total, more = null, empty = ''}) => ({
  title,
  total: total ?? items.length,
  items: items.slice(0, QUEUE_MAX),
  more: more && more.url ? more : null,
  empty,
});

const issueRow = (i, now, {age = 'created', suffix = ''} = {}) => ({
  ref: `#${i.number}`,
  title: `${i.title}${suffix}`,
  age: ageText(age === 'updated' ? i.updated_at : i.created_at, now),
  url: i.html_url,
});

const fixedSuffix = i => {
  const b = labelsOf(i)
    .filter(l => /^fixed-in:\d+$/.test(l))
    .map(l => l.slice(9));
  return b.length ? ` · fixed in ${b.join(', ')}` : '';
};

/**
 * Add the detail fields to each stage, and make the two side steps. The stage
 * objects of `stages` gain the fields in place; `flow` holds the same objects
 * in the page's order.
 */
function buildFlow(c) {
  const {now, stages, lines, events, issues, card, L} = c;
  const by = Object.fromEntries(stages.map(x => [x.key, x]));
  const set = (key, fields) => Object.assign(by[key], fields);

  // 1. Collect
  {
    const st = by.collect;
    const rows = [];
    const notes = [];
    for (const [file, name] of Object.entries(COLLECT_WORKFLOWS)) {
      const runs = (c.workflows?.[file] || [])
        .filter(r => r.status === 'completed')
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      if (runs[0])
        rows.push(
          runEntry({
            at: runs[0].created_at,
            name,
            note: 'scheduled',
            result: runs[0].conclusion,
            url: runs[0].html_url,
          }),
        );
      const fails = runs.filter(
        r =>
          r.conclusion !== 'success' &&
          now - Date.parse(r.created_at) < 7 * DAY,
      );
      if (fails.length && runs[0]?.conclusion === 'success')
        notes.push(
          `${name} failed ${
            fails.length === 1 ? 'once' : `${fails.length} times`
          } in the last 7 days (${short(
            fails[0].created_at,
          )}); the next run passed.`,
        );
    }
    rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    const filed = issues
      .filter(i => now - Date.parse(i.created_at) < DAY)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const why =
      st.verdict === 'OK'
        ? [
            'Both collect workflows ran in the last 30 hours, and the newest run of each passed.',
            ...notes,
          ].join(' ')
        : `${st.problem || 'A collect workflow did not run'}.`;
    set('collect', {
      sub: Object.values(COLLECT_WORKFLOWS).join(' · '),
      last: rows[0]
        ? `${rows[0].when} PT · ${rows[0].result}`
        : 'no scheduled run',
      backlog: {
        n: filed.length,
        unit: `${filed.length === 1 ? 'issue' : 'issues'} filed in 24 h`,
      },
      why,
      runs: rows,
      queue: queueOf({
        title: `${filed.length} filed in 24 h · ${issues.length} open`,
        items: filed.map(i => issueRow(i, now)),
        total: filed.length,
        more: {
          text: `Open the ${issues.length} open issues, the newest first`,
          url: L.issues('sort:created-desc'),
        },
        empty: 'No issue was filed in the last 24 hours.',
      }),
      unblock:
        st.verdict === 'OK'
          ? 'Nothing. Both workflows run once a day on their own.'
          : 'Open the newest failed run, and fix its cause. The next scheduled run that passes clears this.',
      rule: 'LATE when the newest scheduled run failed or is older than 30 hours. STUCK when the last two failed.',
    });
  }

  // 2. Triage
  {
    const st = by.triage;
    const o = c.triage;
    const inv = issues.filter(i => labelsOf(i).includes('investigate'));
    const untouched = inv.filter(
      i =>
        now - Date.parse(i.updated_at) >= LIMITS.investigateUntouchedDays * DAY,
    ).length;
    const group = biggestGroup(inv);
    const mine = lines.filter(l => l.task === 'triage');
    const rows = mine.slice(-1).map(lineRow);
    if (card)
      rows.push(
        runEntry({
          at: card.at,
          name: 'Daily card',
          note: `card of ${card.date}`,
          result: 'posted',
          url: card.url,
        }),
      );
    if (st.verdict === 'LATE' || st.verdict === 'STUCK')
      rows.push(...mine.slice(-2, -1).map(lineRow));
    rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    let why;
    if (st.verdict === 'LATE' || st.verdict === 'STUCK')
      why = `The triage did not finish on its due day: ${runProblem(o)}.`;
    else
      why =
        `The triage ran on ${o.days[0].date}${
          card ? ` and posted the card at ${hhmmPT(card.at)} PT` : ''
        }.` +
        (st.verdict === 'BACKLOG'
          ? ` The queue is the problem: ${untouched} of the ${inv.length} investigate issues have had no update for ${LIMITS.investigateUntouchedDays} days or more. The limit is ${LIMITS.investigateUntouched}.`
          : ` ${untouched} of the ${inv.length} investigate issues have had no update for ${LIMITS.investigateUntouchedDays} days; the limit is ${LIMITS.investigateUntouched}.`);
    const oldest = [...inv].sort((a, b) =>
      a.updated_at < b.updated_at ? -1 : 1,
    );
    set('triage', {
      sub: 'Cloud routine · writes the Daily card',
      last: lastText(o, 'triage'),
      backlog: {
        n: untouched,
        unit: `untouched for ${LIMITS.investigateUntouchedDays} days`,
      },
      why,
      runs: rows,
      queue: queueOf({
        title: `${inv.length} investigate issues, the oldest first`,
        items: oldest.slice(0, 3).map(i => issueRow(i, now, {age: 'updated'})),
        total: inv.length,
        more: {
          text:
            group && group.count > 1
              ? `${group.count} of the ${inv.length} are in one incident group, ${group.group}. Open the list`
              : 'Open the list',
          url: L.issues('label:investigate sort:updated-asc'),
        },
        empty: 'No investigate issue is open.',
      }),
      unblock:
        st.verdict === 'BACKLOG'
          ? `Not your item. The queue must fall below ${
              LIMITS.investigateUntouched
            } untouched issues: a triage or hygiene session can close or group the old ${
              group ? group.group : ''
            } reports.`.replace('  ', ' ')
          : st.verdict === 'LATE' || st.verdict === 'STUCK'
            ? `Read the failed run of the cloud routine qariah-daily-triage. The next run, ${nextRun(
                'triage',
                now,
              )}, clears this when it passes.`
            : `Nothing. The routine runs every day at ${DAILY.triage} PT.`,
      rule: `BACKLOG when ${LIMITS.investigateUntouched} or more investigate issues have no update for ${LIMITS.investigateUntouchedDays} days. LATE or STUCK come from the run line, as for every daily run.`,
    });
  }

  // The Steward (a side step after Triage).
  let steward;
  {
    const mine = lines.filter(l => l.task === 'steward');
    const last = mine[mine.length - 1] || null;
    const open = sortQueue(c.queue);
    const forYou = open.filter(
      i => i.kind === 'decision' || i.kind === 'action',
    ).length;
    let verdict = 'OK';
    if (c.stewardBad) verdict = 'STUCK';
    else if (open.length && (!last || now - Date.parse(last.at) > 8 * HOUR))
      verdict = 'LATE';
    else if (!last) verdict = 'IDLE';
    const w = c.week.steward;
    const closed = (c.closedQueue || []).length;
    let why;
    if (verdict === 'STUCK')
      why =
        'The last two Steward runs failed. Questions in the queue get no answer.';
    else if (verdict === 'LATE')
      why = `${plural(open.length, 'item')} ${
        open.length === 1 ? 'is' : 'are'
      } open, and the newest Steward run is ${
        last ? `from ${ptWhen(last.at)} PT` : 'missing'
      }.`;
    else if (verdict === 'IDLE')
      why = 'The queue is empty, and the Steward left no run line in 21 days.';
    else
      why = `The last two Steward runs passed: ${plural(
        w.runs,
        'run',
      )} this week, ${
        w.failed
      } failed. In the last 7 days it answered or closed ${plural(
        closed,
        'queue item',
      )}.`;
    steward = {
      n: null,
      key: 'steward',
      name: 'Owner queue · Steward',
      verdict,
      who: last
        ? `Steward · ${ptWhen(last.at)} PT · ${last.status}`
        : 'Steward · no run line',
      details: [`${plural(open.length, 'open item')} · ${forYou} for you`],
      problem: null,
      sub: 'Cloud routine · answers, hands fixes to Fix, asks you',
      last: last ? `${ptWhen(last.at)} PT · ${last.status}` : 'no run line',
      backlog: {n: open.length, unit: 'owner items open'},
      why,
      runs: mine.slice(-2).reverse().map(lineRow),
      noRunsText:
        'The Steward writes a run line only when the queue has items.',
      queue: queueOf({
        title: `${plural(open.length, 'open item')}${
          open.length
            ? `, ${forYou === open.length ? 'all' : forYou} for you`
            : ''
        }`,
        items: open.map(i => ({
          ref: `#${i.number}`,
          title: i.title,
          age: ageText(i.createdAt, now),
          url: i.url,
        })),
        more:
          open.length > QUEUE_MAX
            ? {text: 'Open the queue', url: L.issues('label:owner-queue')}
            : null,
        empty: 'The owner queue is empty.',
      }),
      unblock:
        verdict === 'STUCK' || verdict === 'LATE'
          ? 'Read the newest run of the cloud routine qariah-steward. The next run that passes clears this.'
          : forYou
            ? 'Your replies. Needs you, at the top of the page, has the exact text.'
            : 'Nothing.',
      rule: 'STUCK when its last two runs failed: questions then get no answer. LATE when items are open and its newest run is older than 8 hours.',
    };
  }

  // 3. Fix
  {
    const st = by.fix;
    const o = c.drafts;
    const actionable = issues.filter(i =>
      labelsOf(i).includes('loop-actionable'),
    );
    const withFix = actionable.filter(i => fixedSuffix(i)).length;
    const why =
      st.verdict === 'LATE' || st.verdict === 'STUCK'
        ? `The fix loop did not finish on its due day: ${runProblem(o)}.`
        : `The fix loop ran on ${o.days[0].date}${
            o.days[0].line ? ` at ${hhmmPT(o.days[0].line.at)} PT` : ''
          }. ` +
          (c.loopDrafts.length
            ? `${plural(c.loopDrafts.length, 'loop draft')} ${
                c.loopDrafts.length === 1 ? 'waits' : 'wait'
              } for the auto-sprint.`
            : 'No loop draft is open.') +
          (actionable.length
            ? ` ${plural(actionable.length, 'loop-actionable issue')} ${
                actionable.length === 1 ? 'is' : 'are'
              } open; ${withFix} of them already ${
                withFix === 1 ? 'has' : 'have'
              } a fix in a build.`
            : '');
    set('fix', {
      sub: 'Daily fix loop · opens draft PRs',
      last: lastText(o, 'drafts'),
      backlog: {n: c.loopDrafts.length, unit: 'loop drafts'},
      why,
      runs: lines
        .filter(l => l.task === 'drafts')
        .slice(-2)
        .reverse()
        .map(lineRow),
      queue: queueOf({
        title: `${plural(
          actionable.length,
          'loop-actionable issue',
        )} · ${plural(c.loopDrafts.length, 'loop draft')}`,
        items: [
          ...c.loopDrafts.map(p => ({
            ref: `#${p.number}`,
            title: `${p.title} (draft PR)`,
            age: ageText(p.created_at, now),
            url: p.html_url,
          })),
          ...actionable.map(i => issueRow(i, now, {suffix: fixedSuffix(i)})),
        ],
        total: actionable.length + c.loopDrafts.length,
        more:
          actionable.length + c.loopDrafts.length > QUEUE_MAX
            ? {text: 'Open the list', url: L.issues('label:loop-actionable')}
            : null,
        empty: 'No loop-actionable issue and no loop draft.',
      }),
      unblock:
        st.verdict === 'BACKLOG'
          ? `The auto-sprint must adopt the drafts: more than ${LIMITS.loopDrafts} wait.`
          : st.verdict === 'LATE' || st.verdict === 'STUCK'
            ? `Read the failed run of the Mac task qariah-daily-triage-fix-loop. The next run, ${nextRun(
                'drafts',
                now,
              )}, clears this when it passes.`
            : 'Nothing. A NOT READY audit with a code fault comes back here as a new issue (the dashed line from Audit).',
      rule: `BACKLOG over ${LIMITS.loopDrafts} loop drafts. LATE when the run of the last due day is missing or failed.`,
    });
  }

  // 4. Integrate
  {
    const st = by.integrate;
    const o = c.sprint;
    const d0 = o.days[0];
    const hand = c.handInternal;
    let why;
    if (st.verdict === 'LATE' || st.verdict === 'STUCK')
      why = `The auto-sprint did not finish on its due day: ${runProblem(o)}.`;
    else if (st.verdict === 'IDLE')
      why = `The auto-sprint ran on ${d0.date} and found nothing to ship.`;
    else
      why = `The auto-sprint ran on ${d0.date}${
        c.lastInternal ? ` and built ${c.lastInternal.build}` : ''
      }.`;
    if (hand)
      why += ` The newest internal beta, ${buildRef(hand)}, was built by hand${
        hand.at ? ` on ${short(hand.at)}` : ''
      }, not by the auto-sprint.`;
    else if (c.builds.errors.length)
      why +=
        ' The page could not read the stores, so it does not show a build made by hand.';
    why += ` Its next run is ${nextRun('autoSprint', now)}.`;
    const rows = [];
    for (const b of c.builds.internal.slice(0, 3))
      rows.push({
        ref: buildRef(b),
        title: `${
          b.by === 'auto-sprint'
            ? 'From the auto-sprint'
            : 'Built by hand, not by the auto-sprint'
        } · ${storeText(b, {android: 'Play internal track'})}`,
        age: b.at ? dayAge(b.at, now) : '',
        url: L.pulls(b.build),
      });
    if (
      c.lastInternal &&
      !c.builds.internal.some(b => b.build === c.lastInternal.build)
    )
      rows.push({
        ref: c.lastInternal.build,
        title: 'The last internal beta from the auto-sprint',
        age: dayAge(c.lastInternal.at, now),
        url: c.lastInternal.url,
      });
    set('integrate', {
      sub: 'Auto-sprint · builds the internal beta',
      last: lastText(o, 'autoSprint'),
      backlog: {n: c.loopDrafts.length, unit: 'drafts to adopt'},
      why,
      runs: lines
        .filter(l => l.task === 'autoSprint')
        .slice(-2)
        .reverse()
        .map(l => ({
          ...lineRow(l),
          note: [l.status === 'SKIPPED' ? 'nothing to ship' : null, runNote(l)]
            .filter(Boolean)
            .join(' · '),
        })),
      queue: queueOf({
        title: 'internal betas',
        items: rows,
        empty: c.builds.errors.length
          ? `The stores did not answer: ${c.builds.errors.join('; ')}.`
          : 'No internal beta in the stores.',
      }),
      unblock:
        st.verdict === 'LATE' || st.verdict === 'STUCK'
          ? `Read the failed run of the Mac task qariah-daily-auto-sprint. The next run, ${nextRun(
              'autoSprint',
              now,
            )}, clears this when it passes.`
          : 'Nothing. It ships when a loop draft or an upstream sync waits for adoption.',
      rule: 'IDLE when the last run was SKIPPED: it had nothing to ship. LATE when the run of the last due day is missing or failed.',
    });
  }

  // 5. Audit
  const verdictRows = c.verdicts
    .slice(-4)
    .reverse()
    .map(e => {
      const r = auditReason(c.bodyOf(e.id));
      const closed = new Set((c.closedQueue || []).map(i => i.number));
      return {
        build: e.build,
        action: e.action,
        result: e.kind === 'ready' ? 'READY' : 'NOT READY',
        at: e.at,
        when: ptWhen(e.at),
        reason: r.text,
        tags: r.tags,
        issues: r.issues,
        url: e.url,
        closedIssues: r.issues.filter(n => closed.has(n)),
      };
    });
  {
    const st = by.audit;
    const o = c.audit;
    const lv = verdictRows[0] || null;
    const tagCount = {};
    for (const v of verdictRows)
      for (const t of v.tags) tagCount[t] = (tagCount[t] || 0) + 1;
    const repeat = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0];
    let why;
    if (st.verdict === 'LATE' || st.verdict === 'STUCK')
      why = `The Auditor did not finish on its due day: ${runProblem(o)}.`;
    else if (st.verdict === 'IDLE')
      why = 'The last Auditor run had no new candidate (SKIPPED).';
    else why = 'The run finished, so the stage reads OK.';
    if (lv)
      why += ` Its verdict was ${lv.result} for ${lv.build}${
        lv.reason && lv.result !== 'READY' ? ` (${lv.reason})` : ''
      }.`;
    if (repeat && repeat[1] > 1)
      why += ` The ${repeat[0]} stopped ${repeat[1]} of the last ${verdictRows.length} audits.`;
    const allNot =
      verdictRows.length && verdictRows.every(v => v.result === 'NOT READY');
    const openBlocker =
      lv && lv.result === 'NOT READY'
        ? lv.issues.find(n => c.queue.some(q => q.number === n))
        : null;
    const blockerTitle = openBlocker
      ? c.queue.find(q => q.number === openBlocker).title
      : '';
    const verdictOf = l => verdictRows.find(v => v.build === l.build) || null;
    set('audit', {
      sub: `Release Auditor · ${DAILY.auditor} PT${
        lv ? ` · verdict ${lv.result} ${lv.build}` : ''
      }`,
      last: lastText(o, 'auditor'),
      backlog: {
        n: lv && lv.result === 'NOT READY' ? 1 : 0,
        unit: 'candidate blocked',
      },
      why,
      runs: lines
        .filter(l => l.task === 'auditor')
        .slice(-2)
        .reverse()
        .map(l => {
          const v = verdictOf(l);
          return {
            ...lineRow(l),
            note: [
              v
                ? `${v.action} ${v.build}`
                : l.build
                  ? `build ${l.build}`
                  : null,
              runNote(l, {build: false}),
            ]
              .filter(Boolean)
              .join(' · '),
            result: v ? v.result : l.status,
            url: v ? v.url : l.url,
          };
        }),
      verdicts: verdictRows,
      queue: queueOf({
        title: verdictRows.length
          ? `the last ${plural(verdictRows.length, 'verdict')}${
              allNot
                ? `, ${verdictRows.length === 1 ? '' : 'all '}NOT READY`
                : ''
            }`
          : 'verdicts',
        items: verdictRows.map(v => ({
          ref: v.build,
          title: `${v.result === 'READY' ? 'READY' : v.reason || 'NOT READY'}${
            v.issues.length
              ? ` (${v.issues
                  .map(
                    n => `#${n}${v.closedIssues.includes(n) ? ', done' : ''}`,
                  )
                  .join('; ')})`
              : ''
          }`,
          age: ptDay(v.at),
          url: v.url,
        })),
        empty: 'No verdict on the card in 21 days.',
      }),
      unblock: openBlocker
        ? `#${openBlocker}: ${blockerTitle.replace(/[.…\s]+$/, '')}. The next run, ${nextRun(
            'auditor',
            now,
          )}, audits the head of qariah-main.`
        : `Nothing. The next run, ${nextRun(
            'auditor',
            now,
          )}, audits the head of qariah-main.`,
      rule: 'OK when the run of the last due day is DONE. The verdict itself (READY or NOT READY) feeds Your go.',
    });
    c.auditBlocker = openBlocker || null;
    c.verdictRows = verdictRows;
  }

  // Your go (a side step after Audit).
  let go;
  {
    const waiting = c.waitingGo;
    const lastReady =
      [...c.verdicts].reverse().find(e => e.kind === 'ready') || null;
    let streak = 0;
    for (const v of c.verdictRows) {
      if (v.result !== 'NOT READY') break;
      streak++;
    }
    go = {
      n: null,
      key: 'go',
      name: 'Your go',
      verdict: 'GATE',
      verdictText: 'YOU',
      who: 'You · a reply on the Daily card',
      details: [
        waiting.length
          ? `READY ${waiting.map(w => w.build).join(', ')} waits for your go`
          : 'no READY build waits',
      ],
      problem: null,
      sub: 'You approve a READY build on the Daily card',
      last: waiting.length
        ? `READY ${waiting[0].build} since ${ptWhen(waiting[0].ready?.at)} PT`
        : lastReady
          ? `Last READY build ${lastReady.build} on ${ptDay(lastReady.at)}`
          : 'No READY build in 21 days',
      backlog: {n: waiting.length, unit: 'builds to approve'},
      whyTitle: waiting.length ? 'WHY IT WAITS' : 'WHY NOTHING WAITS',
      why: waiting.length
        ? `${plural(waiting.length, 'READY build')} ${
            waiting.length === 1 ? 'waits' : 'wait'
          } for your go. The Promoter publishes only after it.`
        : streak && streak === c.verdictRows.length
          ? `Nothing waits for you here. The last ${plural(
              streak,
              'audit',
            )} all said NOT READY.`
          : 'Nothing waits for you here. No READY build is open.',
      runs: [],
      noRunsText:
        'This step is you. The Promoter reads your reply at 08:00 and 23:00 PT.',
      queue: queueOf({
        title: 'READY builds',
        items: waiting.map(w => ({
          ref: w.build,
          title: `READY ${w.action} · reply: owner-reply: go ${w.action} ${w.build}`,
          age: ageText(w.ready?.at, now),
          url: w.ready?.url || '',
        })),
        more: c.cardIssue
          ? {
              text: `Open the Daily card (#${c.cardIssue})`,
              url: L.issue(c.cardIssue),
            }
          : null,
        empty: 'No READY build waits for your go.',
      }),
      unblock:
        'When a build is READY, comment on the Daily card with exactly: owner-reply: go public-beta <build>',
      rule: 'A READY verdict with no go puts Promote at WAITS and adds the build to Needs you.',
    };
  }

  // 6. Promote
  {
    const st = by.promote;
    const promoterLines = lines.filter(l => l.task === 'promoter');
    const promoEvents = events.filter(e => e.kind === 'promotion');
    const runs = [
      ...promoterLines.map(lineRow),
      ...promoEvents.map(e =>
        runEntry({
          at: e.at,
          name: 'Promoter',
          note: `${e.action} ${e.build}`,
          result: e.state,
          url: e.url,
        }),
      ),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 2);
    const lastRun = runs[0] || null;
    const np = c.newestPublic;
    const npStore = np
      ? c.builds.public.find(b => String(b.build) === String(np.build))
      : null;
    const newestText = np
      ? `The newest public beta is ${npStore ? buildRef(npStore) : np.build}, ${
          np.by === 'hand' ? 'published by hand' : 'from the Promoter'
        }${np.at ? `, ${ago(np.at, now)}` : ''}${
          npStore ? ` (${storeText(npStore, {android: 'Play beta track'})})` : ''
        }.`
      : 'No public beta is in the stores yet.';
    let why;
    if (st.verdict === 'WAITS') why = 'A READY build waits for your go.';
    else if (st.verdict === 'LATE' && c.failedPublish)
      why = `The publish of ${c.failedPublish.build} ${
        c.failedPublish.state === 'stale' ? 'stopped' : 'failed'
      }.`;
    else if (st.verdict === 'LATE' && c.overdue)
      why = `You approved ${c.overdue.build} ${ago(
        c.overdue.approval.at,
        now,
      )}, and the Promoter has not published it. It runs at 08:00 and 23:00 PT.`;
    else if (st.details[0]?.startsWith('publishing'))
      why = `The Promoter is publishing ${st.details[0].slice(11)}.`;
    else why = `Nothing waits to go out. ${newestText}`;
    if (st.verdict !== 'OK' && np) why += ` ${newestText}`;
    const approved = c.cands.filter(
      x => x.state === 'approved' || x.state === 'in-progress',
    );
    set('promote', {
      sub: 'Promoter · 08:00 and 23:00 PT · public beta',
      last: lastRun
        ? `${lastRun.when} PT · ${lastRun.result}`
        : 'No public beta from the Promoter yet',
      backlog: {n: approved.length, unit: 'approved builds'},
      why,
      runs,
      lastRun,
      noRunsText:
        'The Promoter writes a run line only when it publishes. It has none in 21 days.',
      queue: queueOf({
        title: 'public betas',
        items: c.builds.public.slice(0, 3).map(b => ({
          ref: buildRef(b),
          title: `${
            b.by === 'Promoter' ? 'By the Promoter' : 'By hand'
          } · ${storeText(b, {android: 'Play beta track'})}`,
          age: b.at ? dayAge(b.at, now) : '',
          url: L.pulls(b.build),
        })),
        empty: c.builds.errors.length
          ? `The stores did not answer: ${c.builds.errors.join('; ')}.`
          : 'No public beta in the stores.',
      }),
      unblock:
        st.verdict === 'WAITS'
          ? 'Your go. Needs you, at the top of the page, has the exact text.'
          : `A READY verdict and your go.${
              c.auditBlocker ? ` The audit needs #${c.auditBlocker} first.` : ''
            }`,
      rule: `LATE when a publish failed or stopped, or when an approved build is not out ${PROMOTE_WITHIN_HOURS} hours after your go. WAITS when a READY build waits for your go. OK otherwise: a public beta in the stores, from the Promoter or by hand, covers each READY build up to its number.`,
    });
  }

  // 7. Ramp
  {
    const st = by.ramp;
    const p = c.platforms;
    const rolloutLines = c.comments
      .filter(
        x =>
          /^rollout:/.test(String(x.body || '')) &&
          String(x.user?.login || '').toLowerCase() === c.owner.toLowerCase(),
      )
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const rl = rolloutLines[rolloutLines.length - 1];
    const runs = [];
    if (card)
      runs.push(
        runEntry({
          at: card.at,
          name: 'Daily card',
          note: 'Rollout lines',
          result: 'posted',
          url: card.url,
        }),
      );
    if (rl)
      runs.push(
        runEntry({
          at: rl.created_at,
          name: 'Rollout line',
          note: clean(
            String(rl.body)
              .split('\n')[0]
              .replace(/^rollout:\s*/, ''),
          ).slice(0, 90),
          result: 'line',
          url: rl.html_url,
        }),
      );
    const anomalies = issues.filter(i => labelsOf(i).includes('anomaly'));
    const full = iosFullDate(p, card?.date);
    const liveText = [p.ios?.line, p.android?.line]
      .filter(Boolean)
      .map(x => x.replace(/\.$/, ''))
      .join('. ');
    let why;
    if (st.verdict === 'IDLE') why = 'No rollout is in flight.';
    else if (st.verdict === 'WAITS')
      why = `The Rollout lines of the card show a pause, a halt or a review: ${liveText}.`;
    else
      why = `A rollout is in flight and the card shows no pause, halt or review.${
        liveText ? ` ${liveText}.` : ''
      }`;
    set('ramp', {
      sub: rolloutSub(p),
      last: card
        ? `Card of ${ptDay(card.at)} · ${hhmmPT(card.at)} PT`
        : 'no card in 21 days',
      backlog: {n: anomalies.length, unit: 'anomaly issues'},
      why,
      runs,
      queue: queueOf({
        title: `${plural(anomalies.length, 'anomaly issue')} open`,
        items: anomalies.map(i => issueRow(i, now, {suffix: fixedSuffix(i)})),
        empty: 'No anomaly issue is open.',
      }),
      unblock:
        st.verdict === 'WAITS'
          ? 'A person resumes the ramp, or the store review ends. The card shows the state each day.'
          : st.verdict === 'IDLE'
            ? 'Nothing.'
            : full
              ? `Nothing. If nobody pauses it, iOS reaches 100 % on day 7, about ${full.slice(
                  5,
                )}.`
              : 'Nothing. The card shows the state each day.',
      rule: 'WAITS when the Rollout lines of the card say PAUSED, HALTED or review. IDLE when no rollout is in flight.',
    });
    c.iosFull = full;
  }

  // 8. Close
  {
    const groups = fixedByBuild(issues);
    const fixedN = issues.filter(i =>
      labelsOf(i).some(l => /^fixed-in:\d+$/.test(l)),
    ).length;
    const p = c.platforms;
    const notFull = [
      p.ios && p.ios.phased !== 'COMPLETE'
        ? `iOS ${p.ios.version || ''}`.trim()
        : null,
      p.android && p.android.percent != null && p.android.percent < 100
        ? 'Android'
        : null,
    ].filter(Boolean);
    set('close', {
      sub: 'prod-close · after 100 % on both stores',
      last: fixedN
        ? notFull.length
          ? `Waits for 100 % on ${notFull.join(' and ')}`
          : 'Waits for prod-close'
        : 'Nothing waits',
      backlog: {n: fixedN, unit: 'fixed issues wait'},
      why: fixedN
        ? `${plural(fixedN, 'open issue')} ${
            fixedN === 1 ? 'has' : 'have'
          } a fix in a build that is not at 100 % in production yet. prod-close closes them, and resolves their Sentry issues, only when the rollout ends.`
        : 'No open issue carries a fixed-in label.',
      fixedByBuild: groups,
      runs: [],
      noRunsText:
        'prod-close runs once the rollout reaches 100 % on both stores.',
      queue: queueOf({
        title: `${plural(fixedN, 'issue')}, by the build that fixes them`,
        items: groups.map(g => ({
          ref: g.build,
          title:
            g.count <= 3
              ? g.issues.map(i => `#${i.number}`).join(', ')
              : 'fixed issues',
          age: plural(g.count, 'issue'),
          url: L.issues(`label:fixed-in:${g.build}`),
        })),
        total: fixedN,
        more:
          groups.length > QUEUE_MAX
            ? {
                text: 'Open every issue with a fixed-in label',
                url: L.issues(
                  `label:${groups.map(g => `fixed-in:${g.build}`).join(',')}`,
                ),
              }
            : null,
        empty: 'No fixed issue waits.',
      }),
      unblock: fixedN
        ? `${
            notFull.length
              ? `${notFull.join(' and ')} at 100 %${
                  c.iosFull && notFull[0]?.startsWith('iOS')
                    ? ` (about ${c.iosFull.slice(5)})`
                    : ''
                }. `
              : ''
          }Then the rollout file closes and prod-close runs.`
        : 'Nothing.',
      rule: 'WAITS while any open issue carries a fixed-in label. OK when none does.',
    });
  }

  const all = {...by, steward, go};
  return FLOW_KEYS.map(k => all[k]);
}
