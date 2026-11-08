// @ai
//
// scripts/lib/promotion-approval.mjs
// ----------------------------------
// The rule for a public-beta or a production publish with no live session
// (docs/operations/feedback-graph.md, "The approval"). Pure functions; no I/O.
//
// Four kinds of comment on the `Daily card` issue make the record:
//
//   release-audit: READY public-beta 3790 commit=<40 hex>   the Release Auditor
//   release-audit: NOT READY public-beta 3790               the Release Auditor
//   owner-reply: go public-beta 3790                        Omar
//   owner-reply: cancel 3790 (or stop, hold)                Omar
//   promotion: STARTED|DONE|FAILED public-beta 3790         the Promoter
//
// An approval counts only when all of these are true:
//   1. the comment is by the repository owner's login;
//   2. the WHOLE comment is exactly `owner-reply: go <action> <build>`, so a
//      comment that a cloud session posted (the proxy adds a footer) or a reply
//      with more words does not count;
//   3. nobody edited the comment;
//   4. it is newer than the READY line for that action and build;
//   5. it is not older than MAX_AGE_DAYS;
//   6. no NOT READY line, no `cancel`, and no `promotion:` line follows;
//   7. that build has no DONE line, and no higher build has one.
//
// A cancel fails the other way, on purpose: any owner reply that starts with
// cancel, stop or hold counts, with more words or after an edit, for each number
// in it, or for every build when it has no number. A wrong cancel costs a new
// reply. A missed cancel publishes a build that Omar stopped.
//
// A Mac session uses the owner's `gh` login, so rule 1 cannot separate Omar from
// a session on the Mac. `owner-reply.mjs post` and the publish guard refuse the
// approval text, which stops an accident or an injected instruction. They do not
// stop an agent that sets out to forge one. Only a separate GitHub login for the
// agents closes that gap.

export const ACTIONS = ['public-beta', 'prod'];
export const MAX_AGE_DAYS = 7;
// A Promoter run has a wall clock of 5 hours, so a STARTED line with no end after
// this long means that the run died.
export const STALE_RUN_HOURS = 6;

const SHA = '[0-9a-f]{40}';
const ACT = 'public-beta|prod';
const APPROVE = new RegExp(
  `^owner-reply:[ \\t]*go[ \\t]+(${ACT})[ \\t]+(\\d+)$`,
  'i',
);
const NEAR_APPROVE = /^owner-reply:[ \t]*go\b/i;
const CANCEL = /^owner-reply:[ \t]*(?:cancel|stop|hold)\b(.*)$/i;
const READY = new RegExp(
  `^release-audit: READY (${ACT}) (\\d+) commit=(${SHA})(?:\\s|$)`,
);
const NOT_READY = new RegExp(
  `^release-audit: NOT READY (${ACT}) (\\d+)(?:\\s|$)`,
);
const PROMOTION = new RegExp(
  `^promotion: (STARTED|DONE|FAILED) (${ACT}) (\\d+)(?: commit=(${SHA}))?(?:\\s|$)`,
);

/** True when a reply text has the approval form. A cancel is safe for a session to post. */
export function isApprovalText(text) {
  const t = String(text || '').trim();
  return /^(owner-reply:[ \t]*)?go[ \t]+(public-beta|prod)\b/i.test(t);
}

/** The exact first line of a READY comment. */
export const readyLine = ({action, build, sha}) =>
  `release-audit: READY ${action} ${build} commit=${sha}`;
export const notReadyLine = ({action, build}) =>
  `release-audit: NOT READY ${action} ${build}`;
export const promotionLine = ({state, action, build}) =>
  `promotion: ${state} ${action} ${build}`;
export const approvalReply = ({action, build}) =>
  `owner-reply: go ${action} ${build}`;

/**
 * The events among issue comments (GitHub REST shape), oldest first.
 * A comment by any other login is not an event. An approval form with a fault
 * becomes `ignored`, so a report can say why it did not count.
 */
export function parseEvents(comments, {owner}) {
  const out = [];
  const want = String(owner || '').toLowerCase();
  if (!want) return out;
  for (const c of comments || []) {
    const login = String((c.user && c.user.login) || '').toLowerCase();
    if (login !== want) continue;
    const body = String(c.body || '').trim();
    const first = body.split('\n')[0].trim();
    const base = {
      id: c.id,
      at: c.created_at || '',
      url: c.html_url || '',
    };
    let m;
    if ((m = first.match(CANCEL))) {
      out.push({...base, kind: 'cancel', builds: m[1].match(/\d+/g) || []});
    } else if (NEAR_APPROVE.test(first)) {
      const edited = c.updated_at && c.updated_at !== c.created_at;
      m = body.match(APPROVE);
      if (edited) {
        out.push({
          ...base,
          kind: 'ignored',
          reason: 'the comment was edited',
          text: first,
        });
      } else if (m) {
        out.push({
          ...base,
          kind: 'approve',
          action: m[1].toLowerCase(),
          build: m[2],
        });
      } else {
        out.push({
          ...base,
          kind: 'ignored',
          reason:
            'the comment is not exactly `owner-reply: go <action> <build>`',
          text: first,
        });
      }
    } else if ((m = first.match(READY))) {
      out.push({...base, kind: 'ready', action: m[1], build: m[2], sha: m[3]});
    } else if ((m = first.match(NOT_READY))) {
      out.push({...base, kind: 'not-ready', action: m[1], build: m[2]});
    } else if ((m = first.match(PROMOTION))) {
      out.push({
        ...base,
        kind: 'promotion',
        state: m[1],
        action: m[2],
        build: m[3],
        sha: m[4] || null,
      });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

const after = (e, t) => e.at > t;

/**
 * The state of one action and build.
 * → {state, reason, ready?, approval?, started?}
 * state: no-ready | voided | no-approval | expired | cancelled | approved |
 *        in-progress | stale | done | failed | superseded
 * Only `approved` lets a Promoter start. Only `in-progress` lets the guard admit
 * a publish command.
 */
export function evaluate(events, {action, build, now = Date.now()}) {
  const b = String(build);
  const same = e => e.build === b && e.action === action;
  const ready = events.filter(e => e.kind === 'ready' && same(e)).pop();
  if (!ready)
    return {state: 'no-ready', reason: `no READY line for ${action} ${b}`};
  const notReady = events.find(
    e => e.kind === 'not-ready' && same(e) && after(e, ready.at),
  );
  if (notReady)
    return {
      state: 'voided',
      reason: 'a NOT READY line follows the READY line',
      ready,
    };
  const approval = events
    .filter(e => e.kind === 'approve' && same(e) && after(e, ready.at))
    .pop();
  if (!approval)
    return {
      state: 'no-approval',
      reason: `no owner reply after the READY line for ${action} ${b}`,
      ready,
    };
  const published = events.filter(
    e => e.kind === 'promotion' && e.state === 'DONE' && e.action === action,
  );
  if (published.some(e => e.build === b))
    return {
      state: 'done',
      reason: 'this build is already published',
      ready,
      approval,
    };
  const newer = published.find(e => Number(e.build) > Number(b));
  if (newer)
    return {
      state: 'superseded',
      reason: `the newer build ${newer.build} is already published`,
      ready,
      approval,
    };
  const cancel = events.find(
    e =>
      e.kind === 'cancel' &&
      (e.builds.length === 0 || e.builds.includes(b)) &&
      after(e, approval.at),
  );
  if (cancel)
    return {
      state: 'cancelled',
      reason: 'an owner cancel follows the approval',
      ready,
      approval,
    };
  const steps = events.filter(
    e => e.kind === 'promotion' && same(e) && after(e, approval.at),
  );
  const last = steps[steps.length - 1];
  if (last && last.state === 'FAILED')
    return {
      state: 'failed',
      reason: `the publish failed; a new reply \`${approvalReply({action, build: b})}\` is a retry`,
      ready,
      approval,
    };
  const ageDays = (now - Date.parse(approval.at)) / 864e5;
  if (last && last.state === 'STARTED') {
    const runHours = (now - Date.parse(last.at)) / 36e5;
    if (runHours > STALE_RUN_HOURS)
      return {
        state: 'stale',
        reason: `a publish started ${Math.round(runHours)} hours ago and has no end line`,
        ready,
        approval,
        started: last,
      };
    return {
      state: 'in-progress',
      reason: 'a Promoter started this publish',
      ready,
      approval,
      started: last,
    };
  }
  if (!Number.isFinite(ageDays) || ageDays > MAX_AGE_DAYS)
    return {
      state: 'expired',
      reason: `the reply is older than ${MAX_AGE_DAYS} days`,
      ready,
      approval,
    };
  return {
    state: 'approved',
    reason: 'the owner approved this build',
    ready,
    approval,
  };
}

/** Every action and build that has a READY line, newest READY first. */
export function candidates(events, {now = Date.now()} = {}) {
  const seen = new Set();
  const out = [];
  for (const e of [...events].reverse()) {
    if (e.kind !== 'ready') continue;
    const k = `${e.action} ${e.build}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      action: e.action,
      build: e.build,
      ...evaluate(events, {action: e.action, build: e.build, now}),
    });
  }
  return out;
}

/** The newest approved build for an action, or null. */
export function nextApproved(events, {action, now = Date.now()}) {
  return (
    candidates(events, {now}).find(
      c => c.action === action && c.state === 'approved',
    ) || null
  );
}

/**
 * The guard's check: the approval file must name the in-progress publish that
 * GitHub shows now. → {ok, reason, build?, sha?, action?}
 */
export function verifyFile(file, events, {now = Date.now()} = {}) {
  if (!file || !file.action || !file.build || !file.sha || !file.approvalId)
    return {ok: false, reason: 'the approval file is missing or incomplete'};
  const r = evaluate(events, {action: file.action, build: file.build, now});
  if (r.state !== 'in-progress')
    return {
      ok: false,
      reason: `${file.action} ${file.build} is ${r.state}: ${r.reason}`,
    };
  if (r.approval.id !== file.approvalId)
    return {
      ok: false,
      reason: 'the approval file names a different owner reply',
    };
  if (r.ready.sha !== file.sha)
    return {
      ok: false,
      reason: 'the approval file names a different commit than the READY line',
    };
  if (r.started.id !== file.startedId)
    return {
      ok: false,
      reason: 'the approval file names a different STARTED line',
    };
  return {
    ok: true,
    reason: 'approved',
    action: file.action,
    build: String(file.build),
    sha: file.sha,
  };
}

/** The `### What to Test` section of a READY comment, for the TestFlight testers. */
export function whatToTest(body) {
  const lines = String(body || '').split('\n');
  const start = lines.findIndex(l => /^###\s+What to Test\s*$/i.test(l.trim()));
  if (start < 0) return '';
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^(#{1,6}\s|---\s*$)/.test(l.trim())) break;
    out.push(l);
  }
  return out.join('\n').trim();
}
