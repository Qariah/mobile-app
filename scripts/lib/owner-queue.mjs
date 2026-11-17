// @ai
//
// scripts/lib/owner-queue.mjs
// ---------------------------
// The pure logic of scripts/owner-queue.mjs: the owner queue.
//
// WHY. A scheduled run (the Auditor, the Promoter, the auto-sprint, the triage
// loop) used to put a question or a finding in its report, as prose. Nobody
// read it, nobody owned it, and a question (AskUserQuestion) stalled the run
// with no notice (owner, 2026-11-04). Now every question and every finding is
// one GitHub issue with the label `owner-queue`. The Steward (a cloud routine,
// .claude/routines/qariah-steward.md) reads the open queue every 4 hours and
// answers it, fixes it, hands it to the Fixer, or escalates it to the owner.
// The owner gets a push only for a decision of his.
//
// One issue = one item. Its body carries:
//   <!-- owner-queue:<key> -->     the dedup marker (one open issue for each key)
//   a `kind` line                  decision | action | info
//   the text that a run wrote (the body file)
//   a `## Reply` section           the exact text the owner would type
//
// Labels: `owner-queue` + the kind (`decision`, `action`, `info`), and
// `priority:P0` or `priority:P1` when the run set one. No priority = P2.
//
// No I/O here. scripts/__tests__/owner-queue.test.mjs covers every rule.

import {approvalReply} from './promotion-approval.mjs';

export const LABEL = 'owner-queue';
export const KINDS = ['decision', 'action', 'info'];
export const PRIORITIES = ['P0', 'P1', 'P2'];
export const ANSWERED_BY = ['steward', 'owner'];
export const RUNS = [
  'triage',
  'drafts',
  'autoSprint',
  'auditor',
  'promoter',
  'steward',
  'upstreamSteward',
  'retro',
  'hook',
  'session',
];
export const ESCALATED_LABEL = 'escalated';
export const MARKER_PREFIX = 'owner-queue:';

/** The colour of each label the queue creates (scripts/lib/triage-common.mjs PALETTE style). */
export const QUEUE_PALETTE = {
  [LABEL]: '5319e7',
  decision: 'd93f0b',
  action: 'fbca04',
  info: 'c5def5',
  'priority:P0': 'b60205',
  'priority:P1': 'd93f0b',
  [ESCALATED_LABEL]: 'e11d21',
};

/** A key from a title: lower case, `a-z0-9-`, at most 60 characters. */
export function slugKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** `<!-- owner-queue:<key> -->` */
export function markerFor(key) {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(String(key || '')))
    throw new Error(`owner-queue: bad key "${key}" (a-z, 0-9, ., _, -)`);
  return `<!-- ${MARKER_PREFIX}${key} -->`;
}

const MARKER_RE = /<!--\s*owner-queue:([a-z0-9][a-z0-9._-]{0,79})\s*-->/;
const FIELD_RE =
  /^-\s*(kind|run|due|priority|asked|do|not-before|blocks)\s*:\s*(.+?)\s*$/i;
/** The steps of the Pipeline page that `--blocks` may name. */
export const BLOCK_STEPS = [
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

/** The key of an issue body, or null. */
export function keyOf(body) {
  const m = String(body || '').match(MARKER_RE);
  return m ? m[1] : null;
}

/** The default reply text for a kind, when the run gave none. */
export function defaultReply(kind) {
  if (kind === 'decision')
    return 'Reply on this issue with your decision, in one line.';
  if (kind === 'action') return 'Reply `done` on this issue when it is done.';
  return 'Nothing. The Steward closes this item.';
}

// A reply that the script builds, so the caller does not write its text in a
// command. The publish guard denies a command with the text of a release
// approval in it (#835). `promotion` is the public-beta approval that the
// Promoter reads (scripts/lib/promotion-approval.mjs, approvalReply).
export const REPLY_KINDS = {
  promotion: build => approvalReply({action: 'public-beta', build}),
};

/**
 * Validate the fields of an `ask`. Returns {ok, errors, fields} with the
 * fields filled (key, priority, reply).
 */
export function validateAsk(f = {}) {
  const errors = [];
  const out = {...f};
  if (!KINDS.includes(out.kind))
    errors.push(`--kind must be ${KINDS.join('|')}`);
  if (!String(out.title || '').trim()) errors.push('--title is required');
  if (!String(out.body || '').trim()) errors.push('--body-file must hold text');
  if (
    out.due &&
    !/^\d{4}-\d{2}-\d{2}(T[\d:]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(out.due)
  )
    errors.push('--due must be an ISO date (YYYY-MM-DD or a full timestamp)');
  if (out.run && !RUNS.includes(out.run))
    errors.push(`--run must be ${RUNS.join('|')}`);
  // The Pipeline page fields (optional, one line each).
  for (const k of ['do', 'notBefore', 'blocks'])
    if (out[k] !== undefined && out[k] !== null)
      out[k] = String(out[k]).replace(/\s+/g, ' ').trim() || undefined;
  if (
    out.notBefore &&
    !/^build\s*>\s*\d+$/i.test(out.notBefore) &&
    !/^\d{4}-\d{2}-\d{2}/.test(out.notBefore)
  )
    errors.push('--not-before must be build>N or an ISO date');
  if (out.blocks) {
    const bad = out.blocks
      .split(/[\s,]+/)
      .filter(b => b && !BLOCK_STEPS.includes(b));
    if (bad.length)
      errors.push(`--blocks must name steps of ${BLOCK_STEPS.join('|')}`);
  }
  if (
    out.priority === undefined ||
    out.priority === null ||
    out.priority === ''
  )
    out.priority = 'P2';
  if (!PRIORITIES.includes(out.priority))
    errors.push(`--priority must be ${PRIORITIES.join('|')}`);
  if (
    out.issue !== undefined &&
    !(Number.isInteger(out.issue) && out.issue > 0)
  )
    errors.push('--issue must be a positive issue number');
  out.title = String(out.title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  out.key = out.key || slugKey(out.title);
  if (!out.key) errors.push('the title gives no key; pass --key=<a-z0-9->');
  else {
    try {
      markerFor(out.key);
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (out.replyKind !== undefined) {
    if (!Object.hasOwn(REPLY_KINDS, out.replyKind))
      errors.push(`--reply-kind must be ${Object.keys(REPLY_KINDS).join('|')}`);
    else if (!/^[1-9]\d*$/.test(String(out.build ?? '')))
      errors.push('--reply-kind needs --build=<digits>');
    else if (out.reply !== undefined)
      errors.push('give --reply or --reply-kind, not both');
    else out.reply = REPLY_KINDS[out.replyKind](String(out.build));
  } else if (out.build !== undefined) errors.push('--build needs --reply-kind');
  if (!String(out.reply || '').trim()) out.reply = defaultReply(out.kind);
  return {ok: errors.length === 0, errors, fields: out};
}

/** The labels of an item. */
export function labelsFor({kind, priority = 'P2'}) {
  const labels = [LABEL, kind];
  if (priority === 'P0' || priority === 'P1')
    labels.push(`priority:${priority}`);
  return labels;
}

/**
 * The issue body. `asked` is the ISO time of the ask (the caller passes it,
 * so a test can pin it).
 */
export function renderBody({
  kind,
  key,
  body,
  reply,
  run,
  due,
  priority = 'P2',
  asked,
  do: todo,
  notBefore,
  blocks,
}) {
  const L = [markerFor(key), '', `- kind: ${kind}`, `- priority: ${priority}`];
  if (run) L.push(`- run: ${run}`);
  if (due) L.push(`- due: ${due}`);
  if (asked) L.push(`- asked: ${asked}`);
  if (todo) L.push(`- do: ${todo}`);
  if (notBefore) L.push(`- not-before: ${notBefore}`);
  if (blocks) L.push(`- blocks: ${blocks}`);
  L.push('', String(body).trim(), '', '## Reply', '', String(reply).trim(), '');
  L.push(
    '_Filed by `scripts/owner-queue.mjs`. The Steward (`.claude/routines/qariah-steward.md`) reads this queue every 4 hours. It answers, fixes, hands over, or escalates. An escalation assigns the owner and sends one email._',
  );
  return L.join('\n');
}

/** The `## Reply` section of a body, or ''. */
export function replyOf(body) {
  const m = String(body || '').match(
    /^##\s*Reply\s*\n([\s\S]*?)(?:\n_Filed by|\n##\s|$)/m,
  );
  return m ? m[1].trim() : '';
}

/** The `- kind:` style fields of a body → {kind, run, due, priority, asked, do, not-before, blocks}. */
export function fieldsOf(body) {
  const out = {};
  for (const line of String(body || '').split('\n')) {
    const m = line.match(FIELD_RE);
    if (m && !out[m[1].toLowerCase()]) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/**
 * One queue item from a GitHub issue (REST shape, or the slim shape of
 * triage-common listIssues). The kind comes from the labels first, then the
 * body. → {number, title, key, kind, priority, run, due, asked, reply,
 *          escalated, assignees, createdAt, updatedAt, url, labels}
 */
export function parseQueueIssue(issue) {
  const labels = (issue.labels || []).map(l =>
    typeof l === 'string' ? l : l.name,
  );
  const f = fieldsOf(issue.body);
  const kind =
    KINDS.find(k => labels.includes(k)) ||
    (KINDS.includes(f.kind) ? f.kind : 'info');
  const pl = labels.find(l => /^priority:P[01]$/.test(l));
  const priority = pl
    ? pl.slice('priority:'.length)
    : PRIORITIES.includes(f.priority)
      ? f.priority
      : 'P2';
  const assignees = (issue.assignees || [])
    .map(a => (typeof a === 'string' ? a : a.login))
    .filter(Boolean);
  return {
    number: issue.number,
    title: issue.title || '',
    key: keyOf(issue.body),
    kind,
    priority,
    run: f.run || null,
    due: f.due || null,
    asked: f.asked || null,
    reply: replyOf(issue.body),
    escalated: labels.includes(ESCALATED_LABEL),
    assignees,
    createdAt: issue.created_at || issue.createdAt || '',
    updatedAt: issue.updated_at || issue.updatedAt || '',
    url: issue.html_url || issue.url || '',
    labels,
  };
}

const PRIO_RANK = {P0: 0, P1: 1, P2: 2};

/** Sort: P0 first, then the earliest due, then the oldest. */
export function sortQueue(items) {
  return [...items].sort((a, b) => {
    const p = PRIO_RANK[a.priority] - PRIO_RANK[b.priority];
    if (p) return p;
    const da = a.due || '9999';
    const db = b.due || '9999';
    if (da !== db) return da < db ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/**
 * The `NEEDS YOU` lines of the card: one for each open `decision` or `action`
 * item. `info` items are the Steward's, not the owner's.
 * → ['#<n> <title> — <reply>' ...]
 */
export function needsYouLines(items) {
  return sortQueue(items)
    .filter(i => i.kind === 'decision' || i.kind === 'action')
    .map(i => {
      const due = i.due ? ` (due ${i.due.slice(0, 10)})` : '';
      const prio = i.priority === 'P2' ? '' : ` [${i.priority}]`;
      return `#${i.number}${prio} ${i.title}${due} — ${i.reply.split('\n')[0]}`;
    });
}

/**
 * The owner-actions lines (scripts/owner-actions.mjs) that a queue item
 * replaces: an owner-actions item whose id equals a queue key. The queue
 * issue then owns that line, so the card does not say it twice. Everything
 * else in owner-actions.json stays: those items are checks against live
 * state, and the queue has no check.
 */
export function dropOverlap(ownerResults, items) {
  const keys = new Set(items.map(i => i.key).filter(Boolean));
  return (ownerResults || []).filter(r => !keys.has(r.id));
}

/** The comment that records an answer. */
export function answerBody({by, text, at}) {
  if (!ANSWERED_BY.includes(by))
    throw new Error(`--by must be ${ANSWERED_BY.join('|')}`);
  if (!String(text || '').trim()) throw new Error('--text-file must hold text');
  return [
    `<!-- owner-queue-answer by=${by}${at ? ` at=${at}` : ''} -->`,
    `**Answered by the ${by}.**`,
    '',
    String(text).trim(),
  ].join('\n');
}

/** The label that puts an open issue in the Fixer's queue (scripts/lib/triage-taxonomy.mjs). */
export const FIXER_LABEL = 'loop-actionable';

/**
 * Why a hand-over to the Fixer is refused, or '' when it may go. A hand-over
 * keeps the issue OPEN: the Fixer reads only open issues
 * (`scripts/triage-digest.mjs` → loopQueue), so an `answer` (which closes the
 * issue) loses the work. Before 2026-11-08 the Steward closed every hand-over,
 * and #777, #781, #793 and #795 reached no lane. The Steward adds the Fixer
 * label only after `scripts/lib/evidence-block.mjs` validates the block, so a
 * hand-over without the label is refused.
 * @param {{labels?: {name:string}[], state?: string}} issue
 */
export function handoverRefusal(issue) {
  const names = (issue.labels || []).map(l => l.name);
  if (!names.includes(LABEL)) return 'it is not an owner-queue issue';
  if (String(issue.state || 'open').toLowerCase() !== 'open')
    return 'it is closed';
  if (!names.includes(FIXER_LABEL))
    return `it has no ${FIXER_LABEL} label (validate the Evidence block, then add the label)`;
  return '';
}

/**
 * The escalation plan of the Steward for one run: which open items go to the
 * owner now, and which wait for the 9am PT batch. A P0 goes at once. A P1
 * `decision` or `action` goes in the 9am PT batch (the first run at or after
 * 9am PT: hour 9 in PST, hour 10 in PDT). A P2 waits for the Steward to
 * answer, fix or hand it over; it is escalated only when the Steward marks
 * it owner-only (then it carries `priority:P1` or `P0`). An item that is
 * already escalated is never sent twice.
 * @param {object[]} items  parsed queue items
 * @param {{hourPT:number}} o  the hour of the day in the owner's time zone
 */
export function escalationPlan(items, {hourPT}) {
  const now = [];
  const batch = [];
  for (const i of sortQueue(items)) {
    if (i.escalated || i.kind === 'info') continue;
    if (i.priority === 'P0') now.push(i);
    else if (i.priority === 'P1') batch.push(i);
  }
  // The routine fires at 01, 05, 09, 13, 17 and 21 UTC (0 1-23/4 * * *): 17:00 UTC is 9am
  // PST or 10am PDT, so the batch run is the one whose PT hour is 9 or 10.
  const batchDue = hourPT === 9 || hourPT === 10;
  return {now, batch, sendBatch: batchDue && batch.length > 0};
}

/** The hour of the day (0-23) in the owner's time zone. */
export function hourIn(ms, tz = 'America/Los_Angeles') {
  return (
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false,
      }).format(new Date(ms)),
    ) % 24
  );
}

/** One email text for a list of items (the Steward's escalation). */
export function escalationEmail(items, {repo}) {
  const lines = [
    `${items.length} item${
      items.length === 1 ? '' : 's'
    } in the owner queue need${items.length === 1 ? 's' : ''} you.`,
    '',
  ];
  for (const i of sortQueue(items)) {
    lines.push(
      `#${i.number} [${i.priority}] ${i.title}`,
      `  ${i.reply.split('\n')[0]}`,
      `  https://github.com/${repo}/issues/${i.number}`,
      '',
    );
  }
  lines.push('Reply on the issue. The Steward reads it within 4 hours.');
  return lines.join('\n');
}
