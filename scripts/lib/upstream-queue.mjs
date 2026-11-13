// @ai
//
// scripts/lib/upstream-queue.mjs — the queue of Qariah's open PRs on thebayaan/Bayaan.
// ---------------------------------------------------------------------------
// Pure functions for scripts/upstream-queue.mjs. The rule (docs/operations/standing-rules/fork-upstream.md,
// "Fork discipline & upstream PRs"): keep the open queue at about 6 or fewer; group
// the maintainer pings into ONE round-up comment on the most contextual PR;
// ping again only after 7 days or more. The Steward refuses to propose a new
// post over the limit, and drafts (never posts) the round-up text.

export const QUEUE_LIMIT = 6;
export const PING_DAYS = 7;

const DAY = 86400000;
const days = (from, to) =>
  Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / DAY));

/**
 * One queue item from a PR row and its activity.
 * @param {{number:number,title:string,created_at:string,updated_at:string,draft:boolean,head:{ref:string},html_url?:string}} pr
 * @param {{lastComment?:{user:string,at:string}, lastReview?:{user:string,state:string,at:string}}} activity
 * @param {{now:string, us:string, maintainer:string}} ctx
 */
export function queueItem(pr, activity = {}, ctx) {
  const events = [activity.lastComment, activity.lastReview].filter(Boolean);
  const last =
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] || null;
  const lastAt = last ? last.at : pr.updated_at || pr.created_at;
  const lastBy = last ? last.user : null;
  let waitsOn;
  if (pr.draft) waitsOn = 'us (draft)';
  else if (!last) waitsOn = 'maintainer (no review yet)';
  else if (last.user === ctx.us) waitsOn = 'maintainer';
  else if (last.state === 'APPROVED')
    waitsOn = 'maintainer (approved, not merged)';
  else waitsOn = 'us';
  return {
    number: pr.number,
    title: pr.title,
    branch: pr.head && pr.head.ref,
    url: pr.html_url || `https://github.com/thebayaan/Bayaan/pull/${pr.number}`,
    draft: !!pr.draft,
    ageDays: days(pr.created_at, ctx.now),
    idleDays: days(lastAt, ctx.now),
    lastAt,
    lastBy,
    waitsOn,
  };
}

/**
 * The queue summary.
 * @param {Array} items  queueItem() rows
 * @param {{limit?:number, pingDays?:number}} o
 */
export function summarize(items, o = {}) {
  const limit = o.limit ?? QUEUE_LIMIT;
  const pingDays = o.pingDays ?? PING_DAYS;
  const sorted = [...items].sort(
    (a, b) => b.ageDays - a.ageDays || a.number - b.number,
  );
  const onMaintainer = sorted.filter(i => i.waitsOn.startsWith('maintainer'));
  const oldestIdle = onMaintainer.reduce((m, i) => Math.max(m, i.idleDays), 0);
  return {
    open: sorted.length,
    limit,
    overLimit: sorted.length > limit,
    canPropose: sorted.length <= limit,
    onMaintainer: onMaintainer.length,
    onUs: sorted.length - onMaintainer.length,
    oldestIdleDays: oldestIdle,
    roundUpDue: onMaintainer.length > 0 && oldestIdle >= pingDays,
    items: sorted,
  };
}

/** The table for a report or a card. */
export function renderTable(summary) {
  const lines = [
    `Open Qariah PRs on thebayaan/Bayaan: ${summary.open} (limit ${summary.limit}${summary.overLimit ? ', OVER' : ''}); ${summary.onMaintainer} wait on the maintainer, ${summary.onUs} on us; the oldest wait is ${summary.oldestIdleDays} days.`,
    '',
    '| PR | Title | Age (d) | Idle (d) | Last by | Waits on |',
    '|---|---|---|---|---|---|',
    ...summary.items.map(
      i =>
        `| [#${i.number}](${i.url}) | ${i.title.replace(/\|/g, '\\|')}${i.draft ? ' (draft)' : ''} | ${i.ageDays} | ${i.idleDays} | ${i.lastBy || '—'} | ${i.waitsOn} |`,
    ),
  ];
  if (!summary.items.length) lines.push('| — | none open | — | — | — | — |');
  return lines.join('\n') + '\n';
}

/**
 * The round-up comment text (a draft; a person posts it). One comment, on the
 * oldest PR that waits on the maintainer. Plain, short, for Osman.
 */
export function roundUpText(
  summary,
  {maintainer = 'OKKHALIL3', pingDays = PING_DAYS} = {},
) {
  const waiting = summary.items.filter(
    i => i.waitsOn.startsWith('maintainer') && i.idleDays >= pingDays,
  );
  if (!waiting.length) return '';
  const target = waiting[0];
  const body = [
    `Hi @${maintainer}, a round-up of the open PRs from the Qariah side, so that one comment covers them all:`,
    '',
    ...waiting.map(
      i =>
        `- #${i.number} ${i.title} — open ${i.ageDays} days, no activity for ${i.idleDays} days. ${i.waitsOn === 'maintainer (approved, not merged)' ? 'Approved; it waits for a merge.' : 'It waits for your review.'}`,
    ),
    '',
    'Each one is small and stands alone. Tell me if one should wait, or be closed. Thank you.',
  ];
  return (
    [`<!-- round-up target: #${target.number} -->`, ...body].join('\n') + '\n'
  );
}
